import { RELAY_HTTP } from './config';

/* Watch pairing from the laptop's side. The watch shows a 4-character code once; trading it for the watch's device id
 * lets us remember the watch, after which "invite" is all that is needed per session. */
export type ResolveResult = { ok: true; deviceId: string } | { ok: false; reason: 'unknown' | 'slow' | 'network' };

async function post(path: string, body: unknown): Promise<Response> {
  return fetch(RELAY_HTTP + path, { method: 'POST', body: JSON.stringify(body) });
}

export async function resolvePairCode(code: string): Promise<ResolveResult> {
  try {
    const r = await post('/pair/resolve', { code });
    if (r.ok) return { ok: true, deviceId: ((await r.json()) as { deviceId: string }).deviceId };
    return { ok: false, reason: r.status === 429 ? 'slow' : 'unknown' };
  } catch { return { ok: false, reason: 'network' }; }
}

/** true when the watch heard the invitation (its app is open and on standby) */
export async function inviteWatch(deviceId: string, session: string): Promise<boolean> {
  try {
    const r = await post(`/d/${deviceId}/invite`, { session });
    return r.ok && !!((await r.json()) as { online: boolean }).online;
  } catch { return false; }
}

export async function watchOnStandby(deviceId: string): Promise<boolean> {
  try {
    const r = await fetch(`${RELAY_HTTP}/d/${deviceId}/status`);
    return r.ok && !!((await r.json()) as { online: boolean }).online;
  } catch { return false; }
}
