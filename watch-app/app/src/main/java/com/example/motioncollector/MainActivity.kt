package com.example.motioncollector

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.graphics.Color
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.net.wifi.WifiManager
import android.os.BatteryManager
import android.os.Bundle
import android.os.Handler
import android.os.HandlerThread
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import android.view.Gravity
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import java.util.Locale
import java.util.concurrent.TimeUnit

// >>> EDIT THIS: use the "Watch app address" that trainer/laptop/server.py prints on your laptop <<<
const val SERVER = "ws://10.182.126.107:8770/ws?role=watch"

// Heart rate does not help the arm model (it lags effort by many seconds and updates about once a second), costs battery
// and needs a permission prompt, so it is OFF by default. Set to true if you want it in the recordings anyway.
const val RECORD_HEART_RATE = false

/**
 * Motion Collector: streams everything the training pipeline needs, with the watch's own clock.
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
    private lateinit var status: TextView
    private lateinit var button: Button
    private val ui = Handler(Looper.getMainLooper())
    private val sensorThread = HandlerThread("sensors").apply { start() }
    private val sensorHandler = Handler(sensorThread.looper)

    @Volatile private var ws: WebSocket? = null
    @Volatile private var running = false
    @Volatile private var connected = false

    private val quat = FloatArray(4)          // [w, x, y, z]
    private val gyro = FloatArray(3)
    private val acc = FloatArray(3)
    private var tGyro = 0L
    private var tAcc = 0L
    private var haveGyro = false
    private var haveAcc = false
    private var sent = 0
    private var lastTick = SystemClock.elapsedRealtime()
    @Volatile private var hrText = "HR -"
    @Volatile private var baroText = "- hPa"
    @Volatile private var pings = 0

    private var wake: PowerManager.WakeLock? = null
    private var wifi: WifiManager.WifiLock? = null

    private val client = OkHttpClient.Builder()
        .pingInterval(15, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .build()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        sm = getSystemService(SENSOR_SERVICE) as SensorManager
        status = TextView(this).apply {
            text = "Ready"
            textSize = 14f
            gravity = Gravity.CENTER
            setTextColor(Color.WHITE)
        }
        button = Button(this).apply {
            text = "Start"
            setOnClickListener { if (running) stop() else start() }
        }
        setContentView(LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setBackgroundColor(Color.BLACK)
            setPadding(36, 36, 36, 36)
            addView(status)
            addView(button)
        })
    }

    private fun start() {
        val rot = sm.getDefaultSensor(Sensor.TYPE_GAME_ROTATION_VECTOR)
            ?: sm.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR)
        val gy = sm.getDefaultSensor(Sensor.TYPE_GYROSCOPE)
        val ac = sm.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)
        if (rot == null || gy == null || ac == null) {
            status.text = "Missing motion sensor"
            return
        }
        running = true
        haveGyro = false
        haveAcc = false
        hrText = "HR -"
        baroText = "- hPa"
        button.text = "Stop"
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        try {
            val pm = getSystemService(POWER_SERVICE) as PowerManager
            wake = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "collector:wake").apply { acquire(3 * 60 * 60 * 1000L) }
            val wm = applicationContext.getSystemService(WIFI_SERVICE) as WifiManager
            // low jitter Wi-Fi: matters for clock sync
            wifi = wm.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "collector:wifi").apply { acquire() }
        } catch (_: Exception) {}
        status.text = "Connecting..."
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
        try { wake?.release() } catch (_: Exception) {}
        try { wifi?.release() } catch (_: Exception) {}
        window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        button.text = "Start"
        status.text = "Stopped"
    }

    private fun openSocket() {
        ws = client.newWebSocket(Request.Builder().url(SERVER).build(), object : WebSocketListener() {
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
                ui.post { status.text = "Can't reach laptop\nRetrying..." }
                retry()
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                connected = false
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

    private fun sendMotion(e: SensorEvent) {
        val socket = ws ?: return
        if (!connected || !haveGyro || !haveAcc || socket.queueSize() > 50_000) return
        SensorManager.getQuaternionFromVector(quat, e.values)
        val dg = (tGyro - e.timestamp) / 1e6
        val da = (tAcc - e.timestamp) / 1e6
        socket.send(
            "{\"t\":${ms(e.timestamp)},\"dg\":${String.format(Locale.US, "%.2f", dg)},\"da\":${String.format(Locale.US, "%.2f", da)}," +
                "\"q\":[${quat[1]},${quat[2]},${quat[3]},${quat[0]}]," +
                "\"g\":[${gyro[0]},${gyro[1]},${gyro[2]}],\"a\":[${acc[0]},${acc[1]},${acc[2]}]}"
        )
        sent++
        val now = SystemClock.elapsedRealtime()
        if (now - lastTick >= 1000) {
            val hz = sent * 1000L / (now - lastTick)
            sent = 0
            lastTick = now
            val line = "Streaming $hz Hz\n$baroText\n$hrText\nsync pings $pings"
            ui.post { status.text = line }
        }
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {}

    override fun onDestroy() {
        if (running) stop()
        sensorThread.quitSafely()
        super.onDestroy()
    }
}
