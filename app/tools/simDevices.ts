/* Pretends to be the phone page and the watch app, talking to a real relay. For testing the whole chain without hardware.
 *
 *   npx tsx tools/simDevices.ts <SESSION>            stream phone + watch into that session
 *   npx tsx tools/simDevices.ts --pair               act like a new watch: show a pairing code, wait for the laptop, then stream
 *   npx tsx tools/simDevices.ts --watch-id <id>      act like a remembered watch on standby (no code), wait for an invite
 * Options: --relay http://localhost:8787   --no-phone   --no-watch
 */
import { ArmSim } from '../src/sim/armSim';

const args = process.argv.slice(2);
const opt = (name: string, def = '') => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] ?? '' : def; };
const has = (name: string) => args.includes(name);
const HTTP = opt('--relay', 'http://localhost:8787').replace(/\/$/, '');
const WS = HTTP.replace(/^http/, 'ws');
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const rand = (n: number, set = ALPHABET) => Array.from({ length: n }, () => set[Math.floor(Math.random() * set.length)]).join('');

const arm = new ArmSim({ seed: Math.floor(Math.random() * 1000), watchHeading: Math.random() * 6 - 3, phoneHeading: Math.random() * 6 - 3 });
const WATCH_CLOCK_OFFSET = 77_123_456.5;

function stream(session: string) {
  const t0 = performance.now();
  if (!has('--no-watch')) {
    const w = new WebSocket(`${WS}/s/${session}?role=watch`);
    w.onopen = () => {
      console.log('watch streaming into', session);
      w.send(JSON.stringify({ bat: 88 }));
      setInterval(() => {
        const now = performance.now(), t = (now - t0) / 1000;
        const batch = [3, 2, 1, 0].map((i) => {
          const p = arm.watchPacket(t - i * 0.01, +(now - i * 10 + WATCH_CLOCK_OFFSET).toFixed(3));
          return { ...p, q: p.q.map(round), g: p.g.map(round), a: p.a.map(round) };
        });
        if (w.readyState === 1) w.send(JSON.stringify(batch));
      }, 40);
    };
    w.onmessage = (ev) => {
      const m = JSON.parse(String(ev.data));
      if (m.ping !== undefined) w.send(JSON.stringify({ pong: m.ping, tl: m.tl, tw: +(performance.now() + WATCH_CLOCK_OFFSET).toFixed(3) }));
    };
    w.onclose = () => process.exit(0);
  }
  if (!has('--no-phone')) {
    const p = new WebSocket(`${WS}/s/${session}?role=phone`);
    p.onopen = () => {
      console.log('phone streaming into', session);
      setInterval(() => {
        const now = performance.now(), t = (now - t0) / 1000;
        const batch = [1, 0].map((i) => {
          const q = arm.phonePacket(t - i * 0.02, +(now - i * 20).toFixed(1));
          return { pq: q.pq.map(round), t: q.t };
        });
        if (p.readyState === 1) p.send(JSON.stringify(batch));
      }, 40);
    };
    p.onclose = () => process.exit(0);
  }
}
const round = (v: number) => +v.toFixed(5);

async function standby(deviceId: string, registerCode: boolean) {
  if (registerCode) {
    for (;;) {
      const code = rand(4);
      const r = await fetch(`${HTTP}/pair/register`, { method: 'POST', body: JSON.stringify({ code, deviceId }) });
      if (r.ok) { console.log(`\n  WATCH CODE: ${code}\n  device id : ${deviceId}\n`); break; }
    }
  }
  const ws = new WebSocket(`${WS}/d/${deviceId}`);
  ws.onopen = () => console.log('on standby, waiting for the laptop');
  ws.onmessage = (ev) => {
    const m = JSON.parse(String(ev.data));
    if (m.event === 'paired') console.log('paired with a laptop');
    if (m.event === 'invite') { console.log('invited to session', m.session, '(auto-starting)'); stream(m.session); }
  };
  ws.onclose = () => { console.log('standby closed'); process.exit(0); };
  setInterval(() => ws.readyState === 1 && ws.send('"hb"'), 20_000);
}

const session = args.find((a) => /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/.test(a));
if (has('--pair')) void standby(rand(16, 'abcdef0123456789'), true);
else if (opt('--watch-id')) void standby(opt('--watch-id'), false);
else if (session) stream(session);
else { console.log('usage: tsx tools/simDevices.ts <SESSION> | --pair | --watch-id <id>'); process.exit(1); }
