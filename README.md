# Motion Trainer: camera-supervised arm model (separate from the Motion Mirror app)

Goal: make a single Galaxy Watch 4 tell **shoulder movement from elbow movement** reliably, by training a small neural net on **your own arm**, using a webcam only while collecting data. After training, the webcam is not needed: the model runs in the browser in real time from the watch alone.

```
 COLLECT (webcam + watch, ~9 min per session)      TRAIN (once, on your laptop)         USE (watch only, real time)
 collect.html -> data/s01.json ...        ->      prepare.py  (align)  ->  train.py  ->  live.html  (loads model.json)
```

## 0. One-time setup

**Laptop** (Python 3.9+):
```
pip install aiohttp numpy torch        # for the GPU, see section 5 (CUDA build of torch)
cd trainer/laptop
python server.py
```
First start downloads the MediaPipe pose model (about 40 MB, needs internet once; everything else is already in `laptop/assets`). It prints the **Watch app address** (`ws://192.168.x.x:8770/ws?role=watch`).

**Watch**: this is a *new, separate app* (package `com.example.motioncollector`, name "Motion Collector"), so your Motion Mirror app is untouched.
1. Android Studio -> Open -> `trainer/watch-app`. 
2. In `app/src/main/java/com/example/motioncollector/MainActivity.kt` set `SERVER` to the printed watch address.
3. Run it on the watch exactly like before (wireless debugging, same Wi-Fi as the laptop). Allow body sensors when asked.
4. Tap **Start** on the watch. It shows rate, pressure and "sync pings".

It sends: orientation, gyro, accelerometer, **barometer**, the watch's own sample timestamps, and answers the laptop's clock pings.

Open `http://localhost:8770/collect.html` in **Chrome**. Allow the camera. Every item in "Before you start" should turn green.

## 1. Camera and body setup (do this the same way every session)

- Camera on a stand or the laptop, **chest height, about 2 to 2.5 m away**, whole upper body and both hips in view.
- Angle: **45 degrees toward your watch side** (watch on left wrist -> camera front-left), so the watch arm is never hidden by your torso. Sessions 3 and 5 use a **side-on 90 degree view**: a single camera sees depth poorly, so the forward raises are only well measured from the side, and the sideways raises from the front. Using both angles is what makes the ground truth trustworthy.
- Short sleeves or a fitted top, plain background, good light. A taped X on the floor for your feet.
- Stand still facing the same direction all session. **Do not turn your torso**: the watch has no compass, so "forward" is defined by the calibration pose, and the camera targets assume your body keeps facing that way.

## 2. The data plan: 6 sessions

| Session | Re-strap first? | Camera | Purpose |
|---|---|---|---|
| s01 | no (normal wear, label **A**) | 45 deg front | training |
| s02 | no, straight after s01 | 45 deg front | training |
| s03 | **yes**: take the watch off and put it on again, label **B** | **90 deg side** | training |
| s04 | **yes**, label **C** (a little looser or tighter than usual) | 45 deg front | training |
| s05 | **yes**, label **D** | 90 deg side | training |
| s06 | **yes**, label **E** | 45 deg front | **TEST: never trained on, gives the honest number** |

Why re-strap: every time you put the watch on, it sits slightly rotated and shifted on the wrist. Within one wearing the model looks great (that is easy); what you actually want is a model that works after you put the watch on tomorrow. The held-out session s06 measures exactly that. Change the **Strap / wear label** box each time you re-strap, so the file remembers.

Minimum if you are short on time: 4 sessions (s01, s02 same wearing; s03 re-strapped; s04 re-strapped as the test). If you can, record two of them on a different day.

Between sessions: rest 2 or 3 minutes, shake your arm out. The watch app can stay running; just press **Start session** again. Each file is saved to `trainer/data/` automatically and checked right away.

## 3. What happens inside one session (about 8 minutes)

Press **Start session** and just follow the voice and the big text. The page counts you in ("starting in 3...") before each block and beeps at the start. Everything is recorded continuously; the blocks only add labels.

1. **Rest**, arm hanging. 
2. **Sync flicks**: 3 fast elbow flicks (hand to shoulder and back) on the beeps. Used as a cross-check of the alignment.
3. **Calibration pose**: arm straight forward, level, palm down, hold still 6 s. This defines "forward" and must be the same pose you will use live.
4. **Forearm twists** x3 (palm up, palm down) with the arm out front. 
5. **Elbow only**: arm at your side / upper arm forward / upper arm sideways, 6 curls each.
6. **Shoulder only**: straight-arm raises forward, sideways, backward, across the body, 6 each, plus **shoulder rotation** (elbow at your side, forearm forward, hand swings out and in like a door).
7. **Both together** (raise while curling), **very slow** shoulder raise and elbow curl (5 s up, 5 s down: the hardest case for any watch).
8. **Free movement** (45 s, twice), and **your activity** (golf swing, swimming stroke, strumming... chosen in the Session box).
9. **Sync flicks again** and rest. Matching cues at the start and the end let the check see whether anything drifted.

Rules that keep the data good: do the single-joint blocks **really single-joint** (that is what teaches the model the difference; the camera also checks you), keep the movements slow-to-medium with full range, and don't hold the arm in front of your torso where the camera can't see it.

After the last step the page saves the file and shows the **alignment check**. Treat it like this:
- **PASS**: keep it.
- **CHECK**: read the listed problems. Usually: arm not visible enough (move the camera / step back), watch rate low (Wi-Fi), arm not level in calibration. Repeat the session.
- **FAIL**: repeat it.

## 4. How alignment is done (so the data is not misaligned)

Wrong timing would silently ruin the training, so nothing is assumed:

1. **Clocks.** The watch stamps every sensor sample with its own clock. The laptop pings the watch every second and the watch answers with its clock. The best round trips (smallest delay) give the offset, and a straight-line fit also removes clock drift. Typical accuracy: 1 to 3 ms.
2. **Camera delay.** The webcam and pose model add a delay (often 60 to 120 ms). That is **measured from your data**: the speed of the forearm direction seen by the watch is cross-correlated with the speed seen by the camera and the lag is refined below one sample. It is reported for the first and the second half of the session; if they differ by more than 30 ms the file is flagged.
3. **Frames.** The rotation between camera coordinates and the watch's world is fitted from the forearm direction (which both see), with outliers trimmed. Residual error is reported (and the strap axis is auto-detected as a check).
4. **Heading.** "Forward" is taken from the calibration pose in the file, exactly the way `live.html` will do it.
5. **Sync flicks** at start and end are an independent visual cross-check of 1 and 2.

Your question about forearm twists as the cue: for the *watch* a twist is unambiguous (the gyro about the forearm axis), but the *camera* can barely see a twist, so it can't anchor the timing. Fast elbow flicks are seen clearly by both, so those are the cue. The twists are still recorded as their own block, so the model learns that a twist is not a shoulder or elbow movement.

## 5. Train

Do this once all sessions are recorded (or after any new session; it is cheap to redo). Everything runs in a terminal in `trainer/train`.

**Step 1: align every session** (this is where timing is fixed and the targets are made; read the report it prints):
```
cd trainer/train
python prepare.py ../data
```
Every session should say PASS. A CHECK or FAIL session: re-record it, do not train on it.

**Step 2: train with one session held out** (the honest test):
```
python train.py --test s06                # trains on s01-s05, reports on the unseen s06, writes ../laptop/model.json
python train.py --test s06 --no-baro      # same without the barometer: does it help?
python train.py --test s05                # optional: a different held-out session, to see how stable the number is
```
**Step 3: final model**, trained on everything (only after you are happy with the numbers above):
```
python train.py --include-test
```
Then open `live.html`.

**GPU (your RTX 3050 Ti).** `train.py` uses the GPU automatically if PyTorch can see it (`--device cpu` forces the CPU) and prints `training on GPU: ...` or `training on CPU`. The default `pip install torch` on Windows installs the CPU-only build, so install the CUDA build first: pick *Windows / Pip / CUDA* on https://pytorch.org/get-started/locally/ and run the command it shows (it looks like `pip install torch --index-url https://download.pytorch.org/whl/cu126`; if a newer CUDA is offered, that works too). Check with `python -c "import torch; print(torch.cuda.is_available())"` (must print True; the laptop NVIDIA driver must be reasonably recent). The model is small (about 55 thousand parameters), so this is not a heavy job: on a plain CPU the 5-session test run took about 4 minutes for 60 epochs, and the GPU should be faster but not dramatically, because the network is tiny. Training always finishes on the CPU for evaluation and export, exactly like the browser will run it.

**What the training does.** It cuts every session into 4-second windows, adds realistic perturbations (the watch sitting rotated a few degrees, sensor bias and noise, a stronger or weaker barometer) so the model does not memorise one strap position, and teaches the small GRU to output the upper-arm direction. It keeps the best epoch by a validation slice, then evaluates **streaming over the whole held-out session, one 50 Hz step at a time, the way the live page works**.

**How to read the report** (held-out section):
- `model` row: median / mean / 90th percentile angular error of the upper arm. Compare with `arm-straight` (what Motion Mirror v1 assumed) and `constant mean pose`. The model must beat both clearly.
- Per-block list: where it is good or bad (elbow-only, shoulder-only, both, slow, free).
- `which joint is moving`: accuracy on the single-joint blocks, next to what the camera itself achieves.
- The constraint rows (section 5b): one row per constraint, so you see which one helps and which does nothing or hurts.

Success threshold (my suggestion): median 15 degrees or better on the held-out session and 90% or better on `which joint`. If the held-out number is clearly worse after 6 sessions, the next step is a second sensor on the upper arm; this experiment tells you quickly and cheaply.

## 5b. Anatomical constraints (each one has its own on/off switch)

Everything here works in the **forearm frame** the watch gives: `d` = forearm axis, `n` = watch face direction (back of the wrist), `c = d x n`. The upper arm direction `u` is described by two numbers: `phi` = elbow bend (angle between upper arm and forearm, straight = 0) and `p` = which way around the forearm the upper arm sits (0 = on the watch-face side). So `u = cos(phi) d + sin(phi) (cos(p) n + sin(p) c)`. Constraints only limit how the forearm and upper arm move **relative to each other** (elbow and forearm twist); what the forearm does in the world (the shoulder) is never limited.

**1. `preset` (hand-set, the one from before).** Two rules with numbers I picked: bend `phi` is at most 145 deg (plus 12 deg slack), and the upper arm must stay on one side of the plane through `d` and `n` (a half circle for `p`, with 12 deg slack). The side (left or right wrist) is read from your camera data. It does not use any hinge-direction or calibration-time rule beyond that. Switch it off if you don't trust my numbers.

**2. Learned constraints (every number measured from the camera ground truth of the training sessions; only the safety margins are mine):**
- `bend`: `phi` must stay between the smallest and largest bend seen in the camera data (0.5th to 99.5th percentile, 5 deg margin).
- `side`: `p` must stay in the range of directions seen in the camera data (percentile range around the circular mean, 10 deg margin). It fades in as the elbow bends (nothing happens when the arm is straight, because `p` means nothing there). If the data covers the whole circle, it switches itself off.
- `vbend`: the bend can't change faster than the fastest bend in the camera data (x1.3 margin).
- `vside`: the upper arm can't swing around the forearm faster than the fastest swing in the camera data (x1.3 margin; relaxed when the arm is nearly straight).

Order of application: preset, bend, side, then the two speed limits. Each is a no-op when the model output already satisfies it.

`python train.py --test s06` prints the learned numbers, how many **held-out** camera frames respect each limit (if a limit is violated a lot by a re-strapped session, it does not carry over and should stay off), and one result row per constraint plus "all four learned". A constraint starts **ON** in `live.html` only if it lowered the held-out median error by at least 0.2 deg; you can flip each one yourself, and every switch shows how often it is changing the output.

On simulated data the rows are all equal (the simulated arm already obeys its own limits), so this table only becomes informative with your real sessions. Expect: `bend` and `vbend` to do little, `side` to be the interesting one, and the model to already respect most limits by itself.

`python anat.py validate` and `python anat.py lazy` (the old standalone estimator, a weak method that I keep only for comparison) still work.

Putting this into the network itself, only if the table shows real gains: feed `phi` and `p` of the model output back as extra inputs, or make the network predict `phi` and `p` inside the learned ranges so impossible outputs cannot be produced. The camera targets already obey the limits, so the network learns much of this by itself; expect the gain mainly on unusual movements.

## 6. Use it live

`http://localhost:8770/live.html` (with `server.py` running and the watch streaming): press **Calibrate** (arm straight forward, level, palm down, 3 second countdown, 2 second hold), then move. It shows the mannequin from your own point of view (behind you), joint angles, and a shoulder / elbow / both readout. The **Anatomy constraints** card has one checkbox per constraint (section 5b) so you can compare with and without each, live. Model memory can be reset with one button; re-calibrate if the heading drifts after a few minutes.

**Real time**: the model is a small causal GRU (about 55 thousand parameters), it only looks at the past, one 50 Hz step at a time, about 0.2 ms per step in the browser. Delay = at most one 20 ms step plus the watch-to-laptop network hop (usually 5 to 15 ms). No webcam is used.

## Honest limits

- The result can't be known before real data. The simulated tests only prove the pipeline (a 70 ms camera lag was recovered as 68 ms; the browser and PyTorch models agree to 1e-5); they say nothing about real accuracy.
- A single webcam has poor depth. The 45 / 90 degree camera plan and the plausibility filtering (bone lengths, visibility) reduce this, but the camera targets still carry roughly 5 degrees of noise: that is the floor.
- **Wrist rotation**: the watch sits on the wrist, so it measures the hand's orientation and the forearm twist directly. It cannot separate wrist bending from forearm movement. The camera's hand direction is recorded and `prepare.py` stores a `wrist_flex` angle in the cache, so this can be tested later, but I am not promising it.
- Heading drifts a little in the watch's game rotation vector (no compass). The check prints agreement by sixth of the session: rising numbers mean drift. Recalibrate in `live.html` when needed.

## Files

- `watch-app/` new Wear OS app (Motion Collector). Heart rate is **off** by default (`RECORD_HEART_RATE` in `MainActivity.kt`): it does not help the arm model (it lags effort by many seconds, updates about once a second, drains battery and needs a permission). Turn it on only if you want it in the files for a later fatigue feature.
- `laptop/server.py` relay, file server, saves and checks sessions; `collect.html` (recording, in the browser); `session_script.json` (the session steps); `live.html`; `shared.js` (features, model runtime, constraint projection); `assets/` (MediaPipe + three.js)
- `train/mm.py` shared feature code, `prepare.py` alignment, `train.py` training and export, `anat.py` joint constraints (preset + learned)
- `tests/` simulator and checks used to test this kit (not needed for use)
