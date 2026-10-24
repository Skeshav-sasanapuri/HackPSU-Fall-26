import { DurableObject } from 'cloudflare:workers';

/* Short pairing codes -> device ids. A single instance; traffic is a handful of requests per pairing.
 * Codes live for 10 minutes and can be resolved once. Guesses are rate limited. */
const TTL_MS = 10 * 60 * 1000;
const MAX_GUESSES_PER_MIN = 30;

interface Entry { deviceId: string; exp: number }

export class Directory extends DurableObject {
  private guesses: number[] = [];

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const body = (await req.json()) as { code: string; deviceId?: string };
    const json = (b: unknown, status = 200) =>
      new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
    const now = Date.now();
    const key = `c:${body.code}`;

    if (url.pathname === '/register') {
      const existing = await this.ctx.storage.get<Entry>(key);
      if (existing && existing.exp > now && existing.deviceId !== body.deviceId) return json({ error: 'code taken' }, 409);
      await this.ctx.storage.put(key, { deviceId: body.deviceId!, exp: now + TTL_MS } satisfies Entry);
      await this.prune(now);
      return json({ ok: true, ttl: TTL_MS });
    }

    if (url.pathname === '/resolve') {
      this.guesses = this.guesses.filter((t) => now - t < 60_000);
      if (this.guesses.length >= MAX_GUESSES_PER_MIN) return json({ error: 'slow down' }, 429);
      this.guesses.push(now);
      const e = await this.ctx.storage.get<Entry>(key);
      if (!e || e.exp <= now) return json({ error: 'unknown code' }, 404);
      await this.ctx.storage.delete(key);
      return json({ deviceId: e.deviceId });
    }
    return json({ error: 'not found' }, 404);
  }

  private async prune(now: number): Promise<void> {
    const all = await this.ctx.storage.list<Entry>({ prefix: 'c:' });
    for (const [k, v] of all) if (v.exp <= now) await this.ctx.storage.delete(k);
  }
}
