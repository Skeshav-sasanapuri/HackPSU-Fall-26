# CLAUDE.md — "Jab" boxing coach (working title)

Read this whole file before doing anything. It is the hand-off from a long planning and prototyping chat.
The person you work with is **Keshav** (HackPSU Fall 2026, Penn State). Deadline: **Sunday Oct 25, 2026, 2:00 PM**.
He uses Claude Code with a limited token budget, so follow the "How to work with Keshav" rules at the bottom.

---

## 1. The idea in one paragraph

A polished boxing-coach web app that tracks **one arm** (the lead arm) with two body-worn motion sensors. The **forearm** sensor is a
Samsung **Galaxy Watch 4** on the wrist. The **upper-arm** sensor is a **Google Pixel phone** strapped to the bicep in a sports armband (later
an Arduino Nano 33 BLE Sense Lite, if there is time). The laptop browser shows a realistic, customizable 3D boxer (boxing shorts, abs,
gloves) whose lead arm mirrors the user's arm in real time. The app teaches about 10 lead-arm moves with a sensei character, gives cues
without showing the move, teaches combos, and scores each attempt on form, speed and estimated power. A punching-bag mode shows the user's
punches landing on a swinging bag with impact effects, called-out combos, rounds and a session summary. It is properly hosted (Vercel plus a
WebSocket relay) and pairing is seamless: **scan a QR code with the phone, enter a short code for the watch once, press Start.** No IPs, no adb,
no Chrome flags.

## 2. Decisions already made (do not reopen without asking)

- **No trained model in the new app.** The upper arm comes from the phone, the forearm from the watch. The old ML pipeline (`train/`,
  `laptop/live.html`, model mode of `laptop/mirror.html`) stays **on disk untouched** but gets **no UI anywhere** in the new app.
- **Properly hosted.** Frontend on **Vercel**. Keshav can claim a domain from MLH (`.tech`). Vercel cannot host a long-lived WebSocket server,
  so the relay must live elsewhere. See section 6.
- **Pairing:** the phone scans a QR code shown on the laptop. The watch pairs with a short code. See section 6.
- **Character:** a ready-made, realistic rigged human. Licensing is not a concern; it is a non-commercial hackathon project. Free assets are
  preferred. See section 7.
- **Arm lengths** are estimated from the user's height, and the user can edit them. **Weight** is asked for and used for the power estimate.
- **"Power" is an estimate**, and the UI says so ("est."). It is computed from hand speed and body weight. It does not have to be perfect.
- **Move classifier:** a rule-based detector first. An optional template classifier (k-NN or DTW on the user's own recordings) may be added if
  it helps, but it may **only label moves**. It must never change the displayed arm pose.
- **Design:** light theme, deliberately not "AI-made looking". See section 10.
- Upper-arm sources must sit behind an interface, so the phone can later be swapped for the Arduino over **Web Bluetooth** (direct to laptop
  Chrome, no relay).

## 3. What exists today (folder layout Keshav will have)

```
trainer/
  CLAUDE.md          (this file)
  README.md          old kit README (collector, training, phone mode in section 6b)
  laptop/            OLD local prototype (Python relay + pages). Reference implementation for the maths.
    server.py        aiohttp relay on :8770, roles: watch / phone / browser(viewer). Serves the pages.
    shared.js        maths and stream helpers: qrot, toThree, yawRot, AXES, decodePacket, WatchLink, FeatureStream, GRU, AnatFilter ...
    mirror.html      old Motion Mirror mannequin (three.js r128). "Phone on bicep" mode WORKS on real hardware (Keshav confirmed).
    phone.html       phone sensor page: RelativeOrientationSensor + Accelerometer, gravity-checked quaternion convention, wake lock.
    collect.html, live.html, session_script.json   ML data collection and live model (legacy, leave alone)
    assets/          three.min.js (r128), MediaPipe files (legacy)
  watch-app/         Wear OS app "Motion Collector" (Kotlin, OkHttp 4.12, minSdk 30, compileSdk 34)
    app/src/main/java/com/example/motioncollector/MainActivity.kt
  train/             PyTorch training pipeline (legacy, leave alone)
  tests/             fake_watch.js (simulated watch; PHONE=1 also simulates the phone), parity tests (legacy)
```

### 3.1 Watch app today
- The server URL is hard-coded: `const val SERVER = "ws://192.168.1.20:8770/ws?role=watch"`. It has a Start/Stop button and keeps the screen on.
- Sensors: `TYPE_GAME_ROTATION_VECTOR` (falls back to `ROTATION_VECTOR`), gyroscope and accelerometer at about 100 Hz. Optional barometer and
  heart rate (heart rate is off by default).
- Packets (JSON text frames):
  - motion `{"t":ms,"dg":ms,"da":ms,"q":[x,y,z,w],"g":[gx,gy,gz],"a":[ax,ay,az]}`. `q` is the device→world quaternion (ENU-style world,
    z up). `g` is in rad/s and `a` in m/s² including gravity, both in device axes. `t` is the watch's elapsed-realtime clock in ms.
  - `{"p":hPa,"tp":ms}` (barometer), `{"hr":bpm,"acc":n}`, `{"bat":pct}`
  - It answers `{"ping":id,"tl":..}` with `{"pong":id,"tl":..,"tw":ms}`, used for clock sync.
- **Game rotation vector has no magnetometer, so its heading (yaw) is arbitrary and drifts.** The same is true of the phone's
  RelativeOrientationSensor. This is why calibration aligns their headings, and why the user must recalibrate now and then.
- The watch is worn on the **left wrist**, so the left arm is the lead arm in an orthodox stance. Still add a setting for the lead arm
  (left or right).

### 3.2 Phone page today (`laptop/phone.html`)
- Needs a secure context. On HTTPS hosting this just works, which is a big reason for hosting.
- `new RelativeOrientationSensor({frequency:60, referenceFrame:'device'})` plus `new Accelerometer({frequency:30})`.
- The quaternion convention is checked at runtime against gravity. If the quaternion maps gravity the wrong way, the page conjugates it.
  Tested with mocked sensors in both conventions; it chose correctly both times.
- Sends `{"pq":[x,y,z,w], "t":performance.now()}` about 60 times a second over `ws://host/ws?role=phone`. Requests a screen wake lock.
- Sensing stops if the page goes to the background or the screen turns off. Tell users to keep the page open; the wake lock helps.

### 3.3 Frames and maths (reuse exactly, it works)
Coordinate convention: **three.js world, y up**. The heading frame after calibration has **forward = +z**, up = +y.

```js
const AXES={'12':[0,1,0],'3':[1,0,0],'6':[0,-1,0],'9':[-1,0,0]};   // device axis by "clock" direction
const toThree=v=>[v[0],v[2],-v[1]], fromThree=v=>[v[0],-v[2],v[1]];
const qT=q=>{const l=Math.hypot(...q)||1;return [q[0]/l,q[2]/l,-q[1]/l,q[3]/l]};   // ENU quaternion -> three frame
const yawRot=(v,a)=>{const c=Math.cos(a),s=Math.sin(a);return [v[0]*c+v[2]*s,v[1],-v[0]*s+v[2]*c]};
// watch forearm: D = nrm(qrot(qT(q), toThree(AXES[watchAxis])))   (the strap-axis setting the user picks, as in collect.html)
// watch "palm/face" normal: N = qrot(qT(q),[0,1,0]) made orthogonal to D
```

Calibration pose ("ghost pose"): **arm straight out in front, palm flat, held still**. The page collects samples for 2.3 s and uses those
from 0.2 to 2.0 s before the end.
```js
// watch heading
yaw = Math.atan2(-d[0], d[2]);            // d = mean raw forearm direction
dd  = yawRot(d, yaw);                     // forearm in heading frame (about +z)
// phone: phoneAx = '6' if the phone's TOP edge points to the SHOULDER, '12' if it points to the ELBOW
us   = mean_i qrot(qT(pq_i), toThree(AXES[phoneAx]));          // nominal arm axis in phone world
yawP = Math.atan2(-us[0], us[2]);
ut   = yawRot(dd, -yawP);                                       // true upper-arm dir (= forearm dir in this pose) in phone world
aP   = nrm( mean_i fromThree(qrot(conj(qT(pq_i)), ut)) );       // actual arm axis in PHONE DEVICE frame (absorbs strap tilt)
tilt = angDeg(aP, AXES[phoneAx]);  // > 35 deg means the user probably picked the wrong Shoulder/Elbow option
// live upper arm in heading frame:
U = yawRot( qrot(qT(pq_latest), toThree(aP)), yawP );
// forearm in heading frame: yawRot(D, yaw)
```
How the phone sits around the arm (screen out, front or side) does not matter, because only the arm-axis direction is used. A crooked strap
costs a few degrees of heading (strap tilt and heading offset cannot be told apart from one pose). In simulation, with 11–17° of strap tilt,
a 34° heading offset and wobble, the upper-arm error was about 4–10°.

Old hand-speed estimate (shoulder assumed fixed): `hand = L1*U + (L2+0.09)*D`, finite difference at 50 Hz, EMA smoothed, capped at 25 m/s.
Old verdicts: shoulder / elbow / both / twist / still, from upper-arm vs elbow-angle angular speeds. Useful ideas for the move detector.

### 3.4 What did NOT work (context)
The trained GRU (watch only, camera-supervised with MediaPipe) reached a median of about 7.4° on held-out data. Live it looked clearly
wrong (heading drift, camera depth error), which is why the phone-on-bicep approach was adopted. Do not spend time on it.

## 4. Product: screens and flow

1. **Landing / Start** (laptop): "Start a session" creates a session. One clean screen, no developer jargon.
2. **Profile and character** (first run, editable later): name, height, weight, lead arm / stance, glove colour, shorts colour, skin tone
   (a range of real tones, not just a few presets), maybe body build. Arm lengths are derived from height and shown as editable fields
   ("Upper arm 31 cm, Forearm 27 cm (estimated from your height)").
3. **Connect devices**:
   - The laptop shows a big **QR code**. The phone scans it, which opens `https://<domain>/p/<SESSION>` and auto-joins. One button,
     "Start sensing". It then shows a big "Connected, strap me on" screen. Remember to ask for the motion-sensor permission.
   - **Watch:** see section 6.2. The first time, the user types the 4-character code the watch shows into the laptop. After that the watch is
     remembered and the user just taps Start on the watch.
   - Live status chips for each device (connected, rate in Hz), plus a "Which way does the phone's top edge point?" picker with a small
     illustration.
4. **Calibrate**: an animated ghost of the pose, a 3-2-1 countdown, a hold, then a confirmation. A small "Recalibrate" button is always
   reachable (keyboard shortcut too).
5. **Home / mode select**: Free mirror, Train (lessons), Bag (demo), History.
6. **Free mirror**: the boxer mirrors the arm, with live speed, power and the detected move.
7. **Train**: lessons with the sensei (section 8).
8. **Bag**: punching-bag mode (section 9).
9. **History / summary**: per-session stats (punch counts by type, best and average speed, power, accuracy, combos completed). Stored in
   localStorage first; a backend is optional.

Use a **sensor simulator** (`?sim=1`) that feeds believable watch and phone streams, ideally with scripted jabs, hooks and so on, so all UI
and game work can be built without hardware. `tests/fake_watch.js` has the arm simulator and phone-packet maths to port from.

## 5. Proposed architecture (adjust if you find a better option, but tell Keshav why)

```
app/        Vite + React + TypeScript + three.js (@react-three/fiber + drei are fine) -> deployed on Vercel
            routes: /  /setup  /connect  /p/:session (phone sensor page)  /train  /bag  /history
relay/      WebSocket relay with session rooms (see 6.1)
watch-app/  existing Wear OS app, modified for pairing + wss (see 6.2)
laptop/ train/ tests/   legacy, untouched
```
- All sensor fusion runs in the laptop browser, as it does now. The relay only forwards messages.
- Put the maths in a small, tested TS module: frames, calibration, U and D, hand position, speed, power, move detection. Port it from
  `shared.js` and `mirror.html` and keep its behaviour identical. Port the parity idea: unit tests on simulated data.
- Upper-arm source interface: `PhoneSource` now, `ArduinoBleSource` (Web Bluetooth) later. The forearm source is `WatchSource`.
- Batch packets to cut relay message count. For example the watch sends 2–4 samples per frame (about 25 frames a second), and the phone
  sends 2 samples per frame.
- Latency: watch and phone each go device → relay → laptop. Fuse using arrival time at first, as the old page did. If the arm visibly lags
  or jitters, add per-source clock-offset estimation (the ping/pong already exists in the watch app).

## 6. Hosting, relay and pairing

### 6.1 Relay
Vercel functions cannot hold WebSockets, so host the relay elsewhere. In order of preference:
1. **Cloudflare Workers + Durable Objects**: one Durable Object per session room, using the WebSocket hibernation API. Free plan if the
   current limits allow it. **Check the current free-tier limits for Durable Objects and WebSocket messages before choosing**, and estimate
   messages per minute with batching.
2. Fly.io or Render (a Node `ws` server). Render's free tier sleeps, which means cold starts.
3. Managed pub/sub services (Pusher, Ably, Supabase Realtime) usually have message caps too low for 60–100 Hz streams. Avoid unless verified.

Room protocol, roughly: `wss://<relay>/s/<SESSION>?role=viewer|phone|watch`. Session codes are short and unambiguous (no 0/O, 1/I). Rooms
expire after inactivity. The relay forwards phone and watch messages to viewers, and viewer commands to devices.
The domain: point the MLH `.tech` domain (or a subdomain) at Vercel. The relay can stay on its `*.workers.dev` URL, or use a subdomain if DNS
is moved to Cloudflare.

### 6.2 Watch pairing (Keshav asked how this works)
The watch runs **our own Wear OS app** (the modified Motion Collector), so we fully control its screen and logic. Plan:
- Replace the hard-coded IP with the fixed relay URL compiled in (`wss://...`). Switch OkHttp to `wss`, which works out of the box.
- On launch the watch connects to the relay's pairing lobby and shows a **4-character code** in big type. The user types it on the laptop's
  Connect screen once. The relay links that watch's device ID to the session, and the watch stores a device token (SharedPreferences).
- Next time the watch opens in "ready" state and waits. When a laptop session that has remembered this watch (localStorage) starts, the
  relay tells the watch, and the user just taps **Start** on the watch. No code, no IP.
- **Not possible with web pages alone:** "scan the QR on the phone and the watch connects automatically through the phone". That needs a
  native Android phone companion app using the Wearable Data Layer API (same applicationId and signing key as the watch app). Treat it as a
  stretch goal only.
- **Watch networking gotcha:** when a Wear OS watch is Bluetooth-connected to its phone it often routes internet through the phone's
  Bluetooth proxy (slow, high latency) instead of Wi-Fi. In the watch app, request Wi-Fi via
  `ConnectivityManager.requestNetwork(... TRANSPORT_WIFI ...)` and bind the socket to it, as Android's Wear docs recommend for
  high-bandwidth use. Measure the rate and latency on the device.
- Keep the old fields and packet format, so the legacy kit still works if needed. Add a `"role"` and session code to the URL. Heart rate
  stays optional.

### 6.3 Phone
`/p/:session` is the hosted version of `phone.html`. It is HTTPS, so there are no flags. It keeps the gravity-based convention check, the
wake lock and auto-reconnect, and shows a clear "keep this screen on" message. A native phone app is not needed.

## 7. The 3D character

Recommended pipeline (free):
1. **Blender + MPFB2** (the MakeHuman plugin, free, CC0 output): build a muscular male (abs) with boxing shorts. Add gloves (model simple
   ones, or a free model). Some skin variation can come from MPFB.
2. Export FBX → **Mixamo** auto-rigger (free with an Adobe account) → download with skin. Mixamo animations: boxing idle / fight stance,
   jab, hook, uppercut, blocks. These are **for the sensei / teacher, for the idle body and for demo loops, not for the user's tracked
   arm**. Mixamo's own free characters are a fallback.
3. In Blender, merge the animations into one **GLB** and compress it (gltf-transform with meshopt or Draco). Load it with GLTFLoader.

Driving the user's character:
- The whole body plays a looping guard-stance idle. **Each frame, after the AnimationMixer update, override the lead-arm bones**:
  - Rotate the upper-arm bone so its bone axis points along `U` (in character space).
  - Rotate the forearm bone along `D`, with twist taken from the watch normal `N`, so the palm faces the right way.
  - Keep the hand in a fist (static pose).
- Mixamo bone rest orientations differ per bone. Compute the rotation from the bone's rest direction to the target in the parent's
  space; do not assume axes.
- Optional procedural polish: slight torso rotation and shoulder lift on fast punches, so it reads as a real punch.
- Customization: skin tone through a material colour or texture multiply, plus shorts and glove colours. Build presets (body build) as
  shape keys if MPFB exports them.
- The view faces the user (mirror-like) by default. A side or 3/4 camera is useful for the sensei.

If Keshav provides a model, adapt to its skeleton. If none is ready yet, start with a Mixamo character or a placeholder rig so the work is
not blocked.

## 8. Training mode (lessons)

Lead-arm moves only, because only that arm is tracked. The sensei can still show full-body form. Ten moves, initial list:
1. Jab, 2. Double jab, 3. Body jab, 4. Lead hook (head), 5. Lead body hook, 6. Lead uppercut,
7. High guard (cover), 8. Parry (catch, small inward slap), 9. Elbow block (body), 10. Feint jab.

Combos (lead arm): jab-jab-hook; jab-body jab; jab-uppercut-hook; parry-jab; elbow block-hook; feint-jab-hook ...

Lesson structure per move:
1. **Watch**: the sensei demonstrates (animation, slowed, with key-point callouts).
2. **Copy**: the user copies it alongside the sensei a few times, with instant feedback.
3. **Cue only**: a voice or text call ("Jab!") without the demo, at random timing. Measures reaction time.
4. **Combos** once the parts are learned.
5. Score: stars or a grade per move, plus per-attempt breakdown.

Move detection, a rule-based first pass. Features: elbow angle φ = angle(U, D); upper-arm elevation and azimuth; hand position and velocity
(direction and speed); hold duration.
- **Guard**: upper arm down/forward-down, elbow bent, forearm up, hand near the chin.
- **Jab**: fast forward hand travel, elbow extends to nearly straight (φ small), upper arm rises toward horizontal-forward, returns to guard.
  Body jab is the same, aimed lower.
- **Hook**: upper arm lifts to about horizontal and out to the side, elbow held about 90°, hand sweeps horizontally inward across.
  Body hook is the same, lower.
- **Uppercut**: elbow about 90°, forearm vertical-ish, hand path mainly upward and forward.
- **Parry**: small, quick inward forearm sweep in front of the face, little extension, quick return.
- **High guard / elbow block**: held static poses (forearm vertical by the face, or the upper arm tight to the side with the forearm
  covering the body).
- **Feint**: the start of a jab (quick small extension) without completion.

Optional later: "Teach the app your moves". The user records about 5 of each, then a k-NN or DTW template classifier runs on short windows.
It only labels moves and never changes the pose.

Scoring per attempt:
- correct move
- reaction time (cue modes)
- peak hand speed
- estimated power
- extension (jab: elbow near straight at peak)
- return-to-guard time
- elbow flare (jab/uppercut)
- hook elbow angle
- guard discipline between punches (hand back up)

Power estimate (label it "est."):
- Arm mass from standard body-segment tables (upper arm + forearm + hand ≈ 5% of body mass).
- Effective mass = arm mass × factor (body contribution), plus a tunable constant.
- Estimated force ≈ m_eff · v_peak / Δt, with Δt about 10–20 ms. Or show a 0–100 power score from ½·m_eff·v².
- Tune so typical amateur jabs land in a plausible range. Optionally blend in the watch accelerometer's peak (it sits near the fist).

Hand speed: from `U`, `D` and the arm lengths, as in 3.3. This underestimates when the body rotates (the shoulder is assumed fixed).
That is fine; it is consistent.

## 9. Bag mode (the showpiece demo)
- A heavy bag hangs in a gym scene, at the user's reach distance (from their arm lengths). Physics: pendulum plus spring-damper, with
  swing and wobble.
- Hit when the glove (a sphere at the hand) meets the bag's capsule while moving toward it faster than a threshold. The impulse scales with
  speed and power.
- Impact feedback:
  - flash and shockwave ring, chalk-dust particles
  - a short-lived dent or ripple
  - camera shake scaled to power
  - hit-stop of a few frames
  - layered thud sounds with variation
  - floating numbers (speed, est. power, move name)
- Rounds with timer and bell, called combos (voice via the Web Speech API, or recorded clips), a combo counter and streaks, and a recorded
  session with an end-of-round summary card.

## 10. Design direction ("must not look AI-made")
- **Light theme.** No default dark mode. No blue/purple/teal gradients, glassmorphism, glowing neon, sparkle icons or emoji UI.
- Avoid the overused fonts: Inter, Poppins, Space Grotesk, Montserrat, Bebas Neue.
- Direction to propose (confirm with Keshav, who may send reference screenshots): an **old boxing-gym / fight-poster** feel.
  - Warm paper off-white and canvas tan, deep ink black, **one** strong red, and possibly a mustard accent.
  - A bold condensed display face for numbers and headlines, with a sturdy readable text face.
  - Heavy rules, big numerals, poster layout, tape and stitch textures used sparingly.
- Motion: snappy and physical, not floaty. Sound design matters as much as visuals.
- Keep developer information (Hz, quaternions, debug) behind a hidden debug panel (`?debug=1`).

## 11. Milestones (each one ends demo-able)
1. **Scaffold + relay + pairing**: app on Vercel, relay deployed, QR phone page, watch pairing code and remembered watch, device status, sim mode.
2. **Calibration + live arm** on a placeholder rig, with the maths ported and unit-tested against simulation.
3. **Real character**: GLB loaded, lead-arm bone driving, idle body loop, customization screen, height and weight to arm lengths.
4. **Bag mode**: physics, hits, effects, sound, rounds, summary.
5. **Train mode**: sensei animations, 10 moves, detector, scoring, combos, lesson flow.
6. **Polish**: onboarding, design pass, history, error states (sensor lost, recalibrate prompts), performance on the laptop.
7. Stretch: template classifier, Arduino Web Bluetooth source, native phone companion for one-tap watch pairing.

## 12. How to work with Keshav (important)
- **Save tokens.** Do not re-read large files you have already read, do not dump big files into the chat, and prefer targeted greps.
  Do not print long logs; summarize. Reuse the existing maths rather than re-deriving it. Unless it is wrong and could be better. 
- **Tell Keshav early about simple things he can do in parallel, by hand,** instead of spending tokens on them. Ask him for his choices
  instead of guessing on taste. Likely items:
  - claim the MLH domain
  - create Vercel and Cloudflare accounts and log in to the CLIs (`npx vercel login`, `npx wrangler login`)
  - make an Adobe account for Mixamo
  - install Blender + MPFB2, build the character and download the Mixamo animations
  - find sound effects (Freesound and similar)
  - pick a font and colour direction or send reference screenshots
  - get a snug armband
  - have Android Studio ready to rebuild and install the watch app
  - test the watch on Wi-Fi
- Instructions to him: **short, numbered, concrete, no fluff.** He gets frustrated by vague or long instructions.
- **Do not build unrequested extras.** Ask first ("I just asked" ≠ "build it"). Answer questions as questions.
- Never delete the legacy folders (`laptop/`, `train/`, `tests/`, old watch-app behaviour).
- Before each milestone, state in 2–3 lines what you will build. After it, say how to test it in a few numbered steps.
- Be honest about what is untested on real hardware. Keshav tests on the real watch and Pixel; ask him for what he sees.
