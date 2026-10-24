/* Jab relay. Forwards sensor messages between the phone / watch and the laptop browser. No fusion here.
 *
 *   WS   /s/<SESSION>?role=viewer|phone|watch   session room (one Durable Object per session)
 *   WS   /d/<DEVICE>                            watch standby socket (invites arrive here)
 *   GET  /d/<DEVICE>/status                     {online}
 *   POST /d/<DEVICE>/invite  {session}          tell a standby watch to join a session
 *   POST /pair/register      {code, deviceId}   watch shows a 4-character code
 *   POST /pair/resolve       {code}             laptop trades the code for the watch's device id (one use)
 */
export { SessionRoom } from './room';
export { DeviceHub } from './deviceHub';
export { Directory } from './directory';

export interface Env {
  ROOM: DurableObjectNamespace;
  HUB: DurableObjectNamespace;
  DIR: DurableObjectNamespace;
}

const SESSION_RE = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/;
const PAIR_RE = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/;
const DEVICE_RE = /^[a-z0-9]{12,40}$/;
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'content-type',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'content-type': 'application/json' } });

function withCors(res: Response): Response {
  const h = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS)) h.set(k, v);
  return new Response(res.body, { status: res.status, headers: h });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const parts = url.pathname.split('/').filter(Boolean);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    if (url.pathname === '/health') return json({ ok: true });

    if (parts[0] === 's' && parts.length === 2) {
      const code = parts[1].toUpperCase();
      if (!SESSION_RE.test(code)) return json({ error: 'bad session code' }, 400);
      if (req.headers.get('upgrade') !== 'websocket') return json({ error: 'websocket only' }, 426);
      return env.ROOM.get(env.ROOM.idFromName(code)).fetch(req);
    }

    if (parts[0] === 'd' && parts.length >= 2) {
      const id = parts[1].toLowerCase();
      if (!DEVICE_RE.test(id)) return json({ error: 'bad device id' }, 400);
      const hub = env.HUB.get(env.HUB.idFromName(id));
      if (parts.length === 2) {
        if (req.headers.get('upgrade') !== 'websocket') return json({ error: 'websocket only' }, 426);
        return hub.fetch(req);
      }
      if (parts[2] === 'status' && req.method === 'GET') return withCors(await hub.fetch(new Request('https://hub/status')));
      if (parts[2] === 'invite' && req.method === 'POST') {
        const body = (await req.json().catch(() => null)) as { session?: string } | null;
        const session = String(body?.session ?? '').toUpperCase();
        if (!SESSION_RE.test(session)) return json({ error: 'bad session code' }, 400);
        return withCors(await hub.fetch(new Request('https://hub/invite', { method: 'POST', body: JSON.stringify({ session }) })));
      }
    }

    if (parts[0] === 'pair' && req.method === 'POST') {
      const body = (await req.json().catch(() => null)) as { code?: string; deviceId?: string } | null;
      const code = String(body?.code ?? '').toUpperCase();
      if (!PAIR_RE.test(code)) return json({ error: 'bad code' }, 400);
      const dir = env.DIR.get(env.DIR.idFromName('directory'));
      if (parts[1] === 'register') {
        const deviceId = String(body?.deviceId ?? '').toLowerCase();
        if (!DEVICE_RE.test(deviceId)) return json({ error: 'bad device id' }, 400);
        return withCors(await dir.fetch(new Request('https://dir/register', { method: 'POST', body: JSON.stringify({ code, deviceId }) })));
      }
      if (parts[1] === 'resolve') {
        const res = await dir.fetch(new Request('https://dir/resolve', { method: 'POST', body: JSON.stringify({ code }) }));
        if (res.ok) {
          const { deviceId } = (await res.clone().json()) as { deviceId: string };
          await env.HUB.get(env.HUB.idFromName(deviceId)).fetch(new Request('https://hub/paired', { method: 'POST' }));
        }
        return withCors(res);
      }
    }

    return json({ error: 'not found' }, 404);
  },
} satisfies ExportedHandler<Env>;
