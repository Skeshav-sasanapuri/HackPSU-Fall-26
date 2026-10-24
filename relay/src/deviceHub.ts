import { DurableObject } from 'cloudflare:workers';

/* One per watch (keyed by its device id). The watch keeps a standby socket here while its app is open, so a laptop
 * that remembers the watch can invite it to a session without any code. */
export class DeviceHub extends DurableObject {
  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env as never);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('"hb"', '"hb"'));
  }

  private live(): WebSocket[] {
    return this.ctx.getWebSockets().filter((s) => s.readyState === WebSocket.READY_STATE_OPEN);
  }

  private tell(msg: unknown): number {
    const text = JSON.stringify(msg);
    let n = 0;
    for (const s of this.live()) {
      try { s.send(text); n++; } catch { /* ignore */ }
    }
    return n;
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (req.headers.get('upgrade') === 'websocket') {
      for (const old of this.ctx.getWebSockets()) {
        try { old.close(4000, 'replaced'); } catch { /* already closed */ }
      }
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.ctx.acceptWebSocket(server);
      return new Response(null, { status: 101, webSocket: client });
    }
    const json = (b: unknown, status = 200) =>
      new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
    if (url.pathname === '/status') return json({ online: this.live().length > 0 });
    if (url.pathname === '/paired') return json({ delivered: this.tell({ event: 'paired' }) });
    if (url.pathname === '/invite') {
      const { session } = (await req.json()) as { session: string };
      const delivered = this.tell({ event: 'invite', session });
      return json({ online: delivered > 0, delivered });
    }
    return json({ error: 'not found' }, 404);
  }

  webSocketMessage(): void { /* the watch has nothing to say on standby */ }

  webSocketClose(ws: WebSocket, code: number): void {
    try { ws.close(code === 1005 || code === 1006 ? 1000 : code); } catch { /* already closed */ }
  }
}
