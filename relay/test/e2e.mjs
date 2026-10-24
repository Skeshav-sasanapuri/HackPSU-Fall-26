// End-to-end check of the relay. Start it first (npm run dev), then: npm test   (RELAY=http://host:port to aim elsewhere)
const HTTP = process.env.RELAY ?? 'http://localhost:8787';
const WS = HTTP.replace(/^http/, 'ws');
let failed = 0;
const ok = (c, msg) => { console.log((c ? 'ok   ' : 'FAIL ') + msg); if (!c) failed++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function open(path) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS + path);
    ws.inbox = [];
    ws.onmessage = (e) => ws.inbox.push(String(e.data));
    ws.onopen = () => resolve(ws);
    ws.onerror = () => reject(new Error('cannot open ' + path));
  });
}
const post = (path, body) => fetch(HTTP + path, { method: 'POST', body: JSON.stringify(body) });
const last = (ws, pred) => ws.inbox.map((m) => { try { return JSON.parse(m); } catch { return null; } }).filter((m) => m && pred(m)).pop();

const health = await fetch(HTTP + '/health').then((r) => r.json());
ok(health.ok, 'health');

// ---- session room ----
const S = 'K7M2QX';
const viewer = await open(`/s/${S}?role=viewer`);
await sleep(100);
ok(last(viewer, (m) => m.event === 'presence' && !m.phone && !m.watch), 'viewer sees empty room');

const phone = await open(`/s/${S}?role=phone`);
const watch = await open(`/s/${S}?role=watch`);
await sleep(150);
ok(last(viewer, (m) => m.event === 'presence' && m.phone && m.watch), 'viewer sees phone and watch');

phone.send(JSON.stringify([{ pq: [0, 0, 0, 1], t: 1 }, { pq: [0, 0, 0, 1], t: 2 }]));
watch.send(JSON.stringify({ t: 5, q: [0, 0, 0, 1], g: [0, 0, 0], a: [0, 0, 9.8] }));
await sleep(150);
ok(viewer.inbox.some((m) => m.startsWith('[{"pq"')), 'phone batch reaches viewer');
ok(viewer.inbox.some((m) => m.includes('"q":[0,0,0,1]')), 'watch packet reaches viewer');
ok(!phone.inbox.some((m) => m.includes('"q":[')), 'devices do not hear each other');

viewer.send(JSON.stringify({ ping: 1, tl: 12.5 }));
await sleep(150);
ok(watch.inbox.some((m) => m.includes('"ping":1')), 'viewer ping reaches watch');
watch.send(JSON.stringify({ pong: 1, tl: 12.5, tw: 99 }));
await sleep(100);
ok(viewer.inbox.some((m) => m.includes('"pong":1')), 'pong reaches viewer');

viewer.send('"hb"');
await sleep(100);
ok(viewer.inbox.includes('"hb"'), 'heartbeat answered');

const phone2 = await open(`/s/${S}?role=phone`);
await sleep(200);
ok(phone.readyState !== 1, 'reconnecting phone replaces the old socket');
phone2.close();
await sleep(200);
ok(last(viewer, (m) => m.event === 'presence')?.phone === false, 'viewer sees phone leave');

const bad = await fetch(HTTP + '/s/ABC');
ok(bad.status === 400, 'bad session code rejected');

// ---- watch pairing ----
const dev = 'abcdef123456abcdef';
const standby = await open(`/d/${dev}`);
ok((await fetch(`${HTTP}/d/${dev}/status`).then((r) => r.json())).online, 'standby watch is online');
ok((await post('/pair/register', { code: 'H4PQ', deviceId: dev })).ok, 'watch registers a code');
const clash = await post('/pair/register', { code: 'H4PQ', deviceId: 'zzzzzzzzzzzzzz' });
ok(clash.status === 409, 'a code in use cannot be taken');
const res = await post('/pair/resolve', { code: 'h4pq' });
const body = await res.json();
ok(res.ok && body.deviceId === dev, 'laptop resolves the code (case-insensitive)');
ok((await post('/pair/resolve', { code: 'H4PQ' })).status === 404, 'a code works only once');
await sleep(100);
ok(last(standby, (m) => m.event === 'paired'), 'watch told it is paired');

const inv = await (await post(`/d/${dev}/invite`, { session: S })).json();
await sleep(100);
ok(inv.online && last(standby, (m) => m.event === 'invite' && m.session === S), 'invite reaches the standby watch');
standby.close();
await sleep(200);
ok(!(await fetch(`${HTTP}/d/${dev}/status`).then((r) => r.json())).online, 'watch offline after closing');
ok(!(await (await post(`/d/${dev}/invite`, { session: S })).json()).online, 'invite to an offline watch reports offline');

for (const w of [viewer, phone, watch, phone2]) try { w.close(); } catch {}
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
