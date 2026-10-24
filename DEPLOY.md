# Jab: run and deploy

## Run everything locally (no hardware)
1. Terminal A: `cd relay && npm run dev`  (relay on http://localhost:8787)
2. Terminal B: `cd app && npm run dev`    (app on http://localhost:5173)
3. Open http://localhost:5173/?sim=1&debug=1  -> simulated phone and watch, no relay needed.
4. Without `?sim=1` the page talks to the relay. Fake devices: `cd app && npm run sim:devices -- <SESSION>`
   (the session code is in the page header), or `npm run sim:devices -- --pair` to fake a new watch.

Tests: `cd app && npm test` (maths, calibration, simulator) and `cd relay && npm test` (relay must be running).

## Deploy
1. Relay: `cd relay && npx wrangler login && npm run deploy`. Note the `https://jab-relay.<you>.workers.dev` address.
2. App: `cd app`, then `npx vercel login`, `npx vercel link`, and in the Vercel project settings add the environment
   variable `VITE_RELAY_URL` = the relay address. Then `npx vercel --prod`.
3. Watch: in `watch-app/.../MainActivity.kt` set `RELAY` to the same address, rebuild and install in Android Studio.
4. Domain: Vercel project > Settings > Domains > add the MLH `.tech` domain, then follow Vercel's DNS instructions.

## How a session connects
- Laptop opens a session (6-character code) and joins the relay room as the viewer.
- Phone scans the QR code -> `/p/<code>` -> joins the same room as the phone.
- Watch, first time: shows a 4-character code. Type it on the laptop. The laptop stores the watch's device id.
- Watch, later: open the app; the laptop invites it to the session; tap Start.
