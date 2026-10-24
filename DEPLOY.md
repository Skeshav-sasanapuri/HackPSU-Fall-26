# Jab: run and deploy

## Run everything locally (no hardware)
1. Terminal A: `cd relay && npm run dev`  (relay on http://localhost:8787)
2. Terminal B: `cd app && npm run dev`    (app on http://localhost:5173)
3. Open http://localhost:5173/?sim=1&debug=1  -> simulated phone and watch, no relay needed.
4. Without `?sim=1` the page talks to the relay. Fake devices: `cd app && npm run sim:devices -- <SESSION>`
   (the session code is in the page header), or `npm run sim:devices -- --pair` to fake a new watch.

Tests: `cd app && npm test` (maths, calibration, simulator) and `cd relay && npm test` (relay must be running).

## Deploy (already set up)
- Relay: `cd relay && npm run deploy` -> https://jab-relay.jab-relay.workers.dev (address is in `app/.env.production`
  and in the watch app's `RELAY` constant).
- App: `bash scripts/deploy-app.sh` -> Vercel project `app`, live at https://watcher.fit (once DNS is set) and
  https://app-theta-orcin-66.vercel.app. The script deploys from a git-free copy because Vercel blocks deploys whose
  commit author email is not on the Vercel account.
- Domain DNS at Porkbun: `A  @  76.76.21.21` and `CNAME  www  cname.vercel-dns.com` (delete Porkbun's parking records).

## Measuring lag
Open any laptop page with `?debug=1`. "delay" is sensor-to-laptop time per device (from clock-synced pings), "rtt" is
the ping round trip, "render" is frames per second. From the dev laptop to the Cloudflare relay the round trip was
about 55 ms.

## How a session connects
- Laptop opens a session (6-character code) and joins the relay room as the viewer.
- Phone scans the QR code -> `/p/<code>` -> joins the same room as the phone.
- Watch, first time: shows a 4-character code. Type it on the laptop. The laptop stores the watch's device id.
- Watch, later: open the app; the laptop invites it to the session; tap Start.
