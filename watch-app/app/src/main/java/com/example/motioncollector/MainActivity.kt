package com.example.motioncollector

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Typeface
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.net.wifi.WifiManager
import android.os.BatteryManager
import android.os.Bundle
import android.os.Handler
import android.os.HandlerThread
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import okhttp3.Call
import okhttp3.Callback
import okhttp3.Dns
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.io.IOException
import java.util.Locale
import java.util.concurrent.TimeUnit

// >>> EDIT ONCE after deploying the relay: its https address, no trailing slash. <<<
const val RELAY = "https://jab-relay.jab-relay.workers.dev"

// Leave "" for normal use. To use the old local kit (laptop/server.py, no pairing) set its address, e.g.
// "ws://192.168.1.20:8770/ws?role=watch".
const val LEGACY_SERVER = ""

// Heart rate does not help the arm model (it lags effort by many seconds and updates about once a second), costs battery
// and needs a permission prompt, so it is OFF by default. Set to true if you want it in the recordings anyway.
const val RECORD_HEART_RATE = false

// Characters a pairing / session code can contain (no 0/O, 1/I).
private const val CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"
private val SESSION_RE = Regex("[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}")
private const val FRAME_SAMPLES = 4      // motion samples per websocket frame (about 25 frames a second)

/**
 * Jab watch app (the old Motion Collector, same sensor packets). Pairing:
 *  - first run: shows a 4-character code (registered with the relay); type it once on the laptop
 *  - after that the watch is remembered: open the app, the laptop invites it to its session, tap Start
 * Motion packets are sent in batches of 4 as a JSON array.
 *
 *  motion   {"t":ms,"dg":ms,"da":ms,"q":[x,y,z,w],"g":[..],"a":[..]}
 *           t  = timestamp of the orientation sample in ms since watch boot (SystemClock.elapsedRealtime clock)
 *           dg = gyro sample time minus t, da = accelerometer sample time minus t (so nothing is silently late)
 *  pressure {"p":hPa,"tp":ms}                  barometer
 *  hr       {"hr":bpm,"acc":n}
 *  pong     {"pong":id,"tl":<laptop clock echoed>,"tw":ms}   answer to {"ping":id,"tl":..} so the laptop can
 *           measure the clock offset between laptop and watch (NTP style, many times per session)
 */
class MainActivity : Activity(), SensorEventListener {
    private lateinit var sm: SensorManager
    private lateinit var prefs: SharedPreferences
    private lateinit var codeView: TextView
    private lateinit var status: TextView
    private lateinit var button: Button
    private lateinit var repair: Button
    private val ui = Handler(Looper.getMainLooper())
    private val sensorThread = HandlerThread("sensors").apply { start() }
    private val sensorHandler = Handler(sensorThread.looper)

    @Volatile private var ws: WebSocket? = null          // streaming socket (/s/<session>)
    @Volatile private var standby: WebSocket? = null     // standby socket (/d/<device>)
    @Volatile private var running = false
    @Volatile private var connected = false
    @Volatile private var standbyUp = false
    @Volatile private var alive = true

    private lateinit var deviceId: String
    private var paired = false
    private var currentCode = ""
    private var pendingSession: String? = null           // from the laptop's invitation
    private var streamSession: String? = null           // the session we are streaming into right now

    private val quat = FloatArray(4)          // [w, x, y, z]
    private val gyro = FloatArray(3)
    private val acc = FloatArray(3)
    private var tGyro = 0L
    private var tAcc = 0L
    private var haveGyro = false
    private var haveAcc = false
    private var sent = 0
    private var lastTick = SystemClock.elapsedRealtime()
    private val batch = ArrayList<String>()
    @Volatile private var hrText = "HR -"
    @Volatile private var baroText = "- hPa"
    @Volatile private var pings = 0

    private var wake: PowerManager.WakeLock? = null
    private var wifi: WifiManager.WifiLock? = null

    // Watches connected by Bluetooth to a phone often route internet through the phone (slow, high latency).
    // We ask for a real Wi-Fi network and bind every socket to it once it is available.
    private val baseClient = OkHttpClient.Builder()
        .pingInterval(15, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .build()
    @Volatile private var client: OkHttpClient = baseClient
    @Volatile private var onWifi = false
    private var netCallback: ConnectivityManager.NetworkCallback? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        sm = getSystemService(SENSOR_SERVICE) as SensorManager
        prefs = getSharedPreferences("jab", Context.MODE_PRIVATE)
        deviceId = prefs.getString("deviceId", null) ?: randomString(16, "abcdef0123456789").also {
            prefs.edit().putString("deviceId", it).apply()
        }
        paired = prefs.getBoolean("paired", false)

        codeView = TextView(this).apply {
            textSize = 40f
            typeface = Typeface.MONOSPACE
            letterSpacing = 0.2f
            gravity = Gravity.CENTER
            setTextColor(Color.parseColor("#FFC107"))
        }
        status = TextView(this).apply {
            text = "Starting..."
            textSize = 14f
            gravity = Gravity.CENTER
            setTextColor(Color.WHITE)
        }
        button = Button(this).apply {
            text = "Start"
            setOnClickListener { if (running) stop() else start() }
        }
        repair = Button(this).apply {
            text = "Re-pair"
            textSize = 11f
            setOnClickListener { rePair() }
        }
        setContentView(ScrollView(this).apply {
            setBackgroundColor(Color.BLACK)
            addView(LinearLayout(context).apply {
                orientation = LinearLayout.VERTICAL
                gravity = Gravity.CENTER
                setPadding(36, 36, 36, 36)
                addView(codeView)
                addView(status)
                addView(button)
                addView(repair)
            })
        })

        requestWifi()
        render()
    }

    override fun onStart() {
        super.onStart()
        alive = true
        if (LEGACY_SERVER.isEmpty()) {
            openStandby()
            if (!paired) registerCode()
        }
        render()
    }

    override fun onStop() {
        super.onStop()
        // keep streaming if running (wake locks hold the sensors); the standby socket is only for waiting
        if (!running) closeStandby()
    }

    /* ---------------- networking ---------------- */

    private fun requestWifi() {
        try {
            val cm = getSystemService(ConnectivityManager::class.java)
            val req = NetworkRequest.Builder()
                .addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
                .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                .build()
            val cb = object : ConnectivityManager.NetworkCallback() {
                override fun onAvailable(network: Network) {
                    client = baseClient.newBuilder()
                        .socketFactory(network.socketFactory)
                        .dns(object : Dns {
                            override fun lookup(hostname: String) = network.getAllByName(hostname).toList()
                        })
                        .build()
                    onWifi = true
                    ui.post {
                        render()
                        if (!running && LEGACY_SERVER.isEmpty() && alive) { closeStandby(); openStandby() }
                    }
                }

                override fun onLost(network: Network) {
                    client = baseClient
                    onWifi = false
                    ui.post { render() }
                }
            }
            netCallback = cb
            cm.requestNetwork(req, cb)
        } catch (_: Exception) {
            // no Wi-Fi API available: the default network is used
        }
    }

    private fun wsBase() = RELAY.replaceFirst("http", "ws")   // https -> wss, http -> ws

    private fun openStandby() {
        if (standby != null) return
        val url = "${wsBase()}/d/$deviceId"
        standby = client.newWebSocket(Request.Builder().url(url).build(), object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                standbyUp = true
                ui.post { render() }
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                val o = try { JSONObject(text) } catch (_: Exception) { return }
                when (o.optString("event")) {
                    "paired" -> {
                        paired = true
                        prefs.edit().putBoolean("paired", true).apply()
                        ui.post { render() }
                    }
                    "invite" -> {
                        val session = o.optString("session").uppercase(Locale.US)
                        if (!SESSION_RE.matches(session)) return
                        paired = true
                        prefs.edit().putBoolean("paired", true).apply()
                        ui.post { onInvite(session) }
                    }
                }
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) = standbyDown(webSocket)
            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) = standbyDown(webSocket, code)
        })
    }

    private fun standbyDown(webSocket: WebSocket, code: Int = 0) {
        if (standby === webSocket) standby = null
        standbyUp = false
        ui.post { render() }
        // code 4000 = another instance of this watch took over; do not fight it
        if (alive && code != 4000 && !running) ui.postDelayed({ if (alive && !running && standby == null) openStandby() }, 2000)
    }

    private fun closeStandby() {
        standby?.close(1000, null)
        standby = null
        standbyUp = false
    }

    private fun registerCode() {
        if (paired || !alive) return
        if (currentCode.isEmpty()) currentCode = randomString(4, CODE_ALPHABET)
        val code = currentCode
        val body = "{\"code\":\"$code\",\"deviceId\":\"$deviceId\"}".toRequestBody("application/json".toMediaType())
        client.newCall(Request.Builder().url("$RELAY/pair/register").post(body).build()).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                ui.post { render() }
                ui.postDelayed({ registerCode() }, 3000)
            }

            override fun onResponse(call: Call, response: Response) {
                response.use {
                    if (it.code == 409) {            // someone else holds this code right now
                        currentCode = randomString(4, CODE_ALPHABET)
                        ui.post { registerCode() }
                    } else {
                        ui.post { render() }
                        // codes live 10 minutes: refresh the same code while we wait
                        ui.postDelayed({ registerCode() }, 9 * 60 * 1000L)
                    }
                }
            }
        })
    }

    private fun rePair() {
        paired = false
        pendingSession = null
        currentCode = ""
        prefs.edit().putBoolean("paired", false).apply()
        if (running) stop()
        render()
        registerCode()
    }

    private fun onInvite(session: String) {
        if (running && session != streamSession) {
            stop()
            pendingSession = session
            start()
            return
        }
        pendingSession = session
        render()
    }

    /* ---------------- UI ---------------- */

    private fun render() {
        val net = if (onWifi) "Wi-Fi" else "default network"
        if (running) {
            codeView.visibility = View.GONE
            button.isEnabled = true
            button.text = "Stop"
            repair.visibility = View.GONE
            return
        }
        repair.visibility = if (paired && LEGACY_SERVER.isEmpty()) View.VISIBLE else View.GONE
        if (LEGACY_SERVER.isNotEmpty()) {
            codeView.visibility = View.GONE
            button.isEnabled = true
            button.text = "Start"
            status.text = "Local kit mode"
            return
        }
        if (!paired) {
            codeView.visibility = View.VISIBLE
            codeView.text = if (currentCode.isEmpty()) "····" else currentCode
            button.isEnabled = false
            button.text = "Start"
            status.text = if (currentCode.isEmpty()) "Getting a code...\n$net" else "Type this code on the laptop\n$net"
            return
        }
        codeView.visibility = View.GONE
        val session = pendingSession
        button.isEnabled = session != null
        button.text = "Start"
        status.text = when {
            session != null -> "Session $session ready\n$net"
            standbyUp -> "Paired\nWaiting for the laptop\n$net"
            else -> "Paired\nConnecting...\n$net"
        }
    }

    /* ---------------- streaming ---------------- */

    private fun start() {
        val rot = sm.getDefaultSensor(Sensor.TYPE_GAME_ROTATION_VECTOR)
            ?: sm.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR)
        val gy = sm.getDefaultSensor(Sensor.TYPE_GYROSCOPE)
        val ac = sm.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)
        if (rot == null || gy == null || ac == null) {
            status.text = "Missing motion sensor"
            return
        }
        val session = pendingSession
        if (LEGACY_SERVER.isEmpty() && session == null) {
            status.text = "Start a session on the laptop first"
            return
        }
        streamSession = session
        running = true
        haveGyro = false
        haveAcc = false
        batch.clear()
        hrText = "HR -"
        baroText = "- hPa"
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        try {
            val pm = getSystemService(POWER_SERVICE) as PowerManager
            wake = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "collector:wake").apply { acquire(3 * 60 * 60 * 1000L) }
            val wm = applicationContext.getSystemService(WIFI_SERVICE) as WifiManager
            // low jitter Wi-Fi: matters for clock sync
            wifi = wm.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "collector:wifi").apply { acquire() }
        } catch (_: Exception) {}
        status.text = "Connecting..."
        render()
        openSocket()
        for (s in listOf(rot, gy, ac)) sm.registerListener(this, s, 10_000, sensorHandler) // ~100 Hz
        sm.getDefaultSensor(Sensor.TYPE_PRESSURE)?.let { sm.registerListener(this, it, 20_000, sensorHandler) }
            ?: run { baroText = "no barometer" }
        if (!RECORD_HEART_RATE) {
            hrText = "HR off"
        } else if (checkSelfPermission(Manifest.permission.BODY_SENSORS) == PackageManager.PERMISSION_GRANTED) {
            registerHeartRate()
        } else {
            requestPermissions(arrayOf(Manifest.permission.BODY_SENSORS), 7)
        }
        sendBattery()
    }

    private fun registerHeartRate() {
        val hr = sm.getDefaultSensor(Sensor.TYPE_HEART_RATE)
        if (hr == null) hrText = "HR n/a" else sm.registerListener(this, hr, SensorManager.SENSOR_DELAY_NORMAL, sensorHandler)
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == 7 && running) {
            if (grantResults.isNotEmpty() && grantResults[0] == PackageManager.PERMISSION_GRANTED) registerHeartRate()
            else hrText = "HR off"
        }
    }

    private fun stop() {
        running = false
        connected = false
        sm.unregisterListener(this)
        ws?.close(1000, null)
        ws = null
        streamSession = null
        try { wake?.release() } catch (_: Exception) {}
        try { wifi?.release() } catch (_: Exception) {}
        window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        status.text = "Stopped"
        render()
        if (alive && LEGACY_SERVER.isEmpty()) openStandby()
    }

    private fun streamUrl(): String =
        if (LEGACY_SERVER.isNotEmpty()) LEGACY_SERVER else "${wsBase()}/s/${streamSession}?role=watch"

    private fun openSocket() {
        ws = client.newWebSocket(Request.Builder().url(streamUrl()).build(), object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                connected = true
                ui.post { status.text = "Streaming" }
                sendBatteryNow()
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                // {"ping":7,"tl":123456.789}  ->  answer at once with the watch clock
                if (!text.startsWith("{\"ping\"")) return
                val tw = SystemClock.elapsedRealtimeNanos() / 1e6
                val id = Regex("\"ping\":(-?\\d+)").find(text)?.groupValues?.get(1) ?: return
                val tl = Regex("\"tl\":([-0-9.eE+]+)").find(text)?.groupValues?.get(1) ?: "0"
                webSocket.send("{\"pong\":$id,\"tl\":$tl,\"tw\":${String.format(Locale.US, "%.3f", tw)}}")
                pings++
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                connected = false
                ui.post { status.text = "Can't reach the relay\nRetrying..." }
                retry()
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                connected = false
                if (code == 4000) {            // replaced by another connection of this watch
                    ui.post { status.text = "Taken over by another connection" }
                    return
                }
                retry()
            }
        })
    }

    private fun retry() {
        if (running) ui.postDelayed({ if (running && !connected) openSocket() }, 1500)
    }

    private fun batteryPercent(): Int {
        val i: Intent = registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED)) ?: return -1
        val level = i.getIntExtra(BatteryManager.EXTRA_LEVEL, -1)
        val scale = i.getIntExtra(BatteryManager.EXTRA_SCALE, -1)
        return if (level < 0 || scale <= 0) -1 else level * 100 / scale
    }

    private fun sendBatteryNow() {
        val pct = batteryPercent()
        if (connected && pct >= 0) ws?.send("{\"bat\":$pct}")
    }

    private fun sendBattery() {
        if (!running) return
        sendBatteryNow()
        ui.postDelayed({ sendBattery() }, 30_000)
    }

    private fun ms(ns: Long) = String.format(Locale.US, "%.3f", ns / 1e6)

    override fun onSensorChanged(e: SensorEvent) {
        when (e.sensor.type) {
            Sensor.TYPE_GYROSCOPE -> {
                gyro[0] = e.values[0]; gyro[1] = e.values[1]; gyro[2] = e.values[2]
                tGyro = e.timestamp; haveGyro = true
            }
            Sensor.TYPE_ACCELEROMETER -> {
                acc[0] = e.values[0]; acc[1] = e.values[1]; acc[2] = e.values[2]
                tAcc = e.timestamp; haveAcc = true
            }
            Sensor.TYPE_PRESSURE -> {
                baroText = String.format(Locale.US, "%.2f hPa", e.values[0])
                if (connected) ws?.send("{\"p\":${String.format(Locale.US, "%.4f", e.values[0])},\"tp\":${ms(e.timestamp)}}")
            }
            Sensor.TYPE_HEART_RATE -> {
                val bpm = e.values[0]
                if (bpm > 0f && e.accuracy != SensorManager.SENSOR_STATUS_NO_CONTACT) {
                    hrText = "HR ${bpm.toInt()}"
                    if (connected) ws?.send("{\"hr\":${bpm.toInt()},\"acc\":${e.accuracy}}")
                }
            }
            else -> sendMotion(e)
        }
    }

    // Called on the sensor thread only, so `batch` needs no lock.
    private fun sendMotion(e: SensorEvent) {
        val socket = ws ?: return
        if (!connected || !haveGyro || !haveAcc || socket.queueSize() > 50_000) return
        SensorManager.getQuaternionFromVector(quat, e.values)
        val dg = (tGyro - e.timestamp) / 1e6
        val da = (tAcc - e.timestamp) / 1e6
        batch.add(
            "{\"t\":${ms(e.timestamp)},\"dg\":${String.format(Locale.US, "%.2f", dg)},\"da\":${String.format(Locale.US, "%.2f", da)}," +
                "\"q\":[${quat[1]},${quat[2]},${quat[3]},${quat[0]}]," +
                "\"g\":[${gyro[0]},${gyro[1]},${gyro[2]}],\"a\":[${acc[0]},${acc[1]},${acc[2]}]}"
        )
        sent++
        if (batch.size >= FRAME_SAMPLES) {
            socket.send(batch.joinToString(",", "[", "]"))
            batch.clear()
        }
        val now = SystemClock.elapsedRealtime()
        if (now - lastTick >= 1000) {
            val hz = sent * 1000L / (now - lastTick)
            sent = 0
            lastTick = now
            val net = if (onWifi) "Wi-Fi" else "default net"
            val line = "Streaming $hz Hz\n${streamSession ?: ""}\n$net\n$baroText\n$hrText\nsync pings $pings"
            ui.post { status.text = line }
        }
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {}

    private fun randomString(n: Int, alphabet: String): String {
        val r = java.security.SecureRandom()
        return String(CharArray(n) { alphabet[r.nextInt(alphabet.length)] })
    }

    override fun onDestroy() {
        alive = false
        if (running) stop()
        closeStandby()
        try { netCallback?.let { getSystemService(ConnectivityManager::class.java).unregisterNetworkCallback(it) } } catch (_: Exception) {}
        sensorThread.quitSafely()
        super.onDestroy()
    }
}
