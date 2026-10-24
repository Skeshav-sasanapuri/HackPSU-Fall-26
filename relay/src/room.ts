import { DurableObject } from 'cloudflare:workers';

/* One room per session. Phone and watch frames go to every viewer; viewer messages (clock pings, commands) go to
 * every device. Nothing is stored: when all sockets are gone the object is simply evicted. Uses the hibernation API,
 * so an idle room costs nothing. Clients send "hb" every ~20 s and get "hb" back without waking the object. */
const MAX_MESSAGE = 64 * 1024;

export class SessionRoom extends DurableObject {
  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env as never);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('"hb"', '"hb"'));
  }

  async fetch(req: Request): Promise<Response> {
    const role = new URL(req.url).searchParams.get('role') ?? 'viewer';
    if (role !== 'viewer' && role !== 'phone' && role !== 'watch') return new Response('bad role', { status: 400 });

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    if (role !== 'viewer') {
      // a device that reconnects replaces its stale socket
      for (const old of this.ctx.getWebSockets(role)) {
        try { old.close(4000, 'replaced'); } catch { /* already closed */ }
      }
    }
    this.ctx.acceptWebSocket(server, [role]);
    this.presence();
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
    const size = typeof message === 'string' ? message.length : message.byteLength;
    if (size > MAX_MESSAGE) return;
    const fromViewer = this.ctx.getTags(ws).includes('viewer');
    const targets = fromViewer
      ? [...this.ctx.getWebSockets('phone'), ...this.ctx.getWebSockets('watch')]
      : this.ctx.getWebSockets('viewer');
    for (const t of targets) {
      if (t === ws || t.readyState !== WebSocket.READY_STATE_OPEN) continue;
      try { t.send(message); } catch { /* peer is going away */ }
    }
  }

  webSocketClose(ws: WebSocket, code: number): void {
    try { ws.close(code === 1005 || code === 1006 ? 1000 : code); } catch { /* already closed */ }
    this.presence();
  }

  webSocketError(): void {
    this.presence();
  }

  private live(tag: string): WebSocket[] {
    return this.ctx.getWebSockets(tag).filter((s) => s.readyState === WebSocket.READY_STATE_OPEN);
  }

  /** Tell everyone in the room who is connected. */
  private presence(): void {
    const msg = JSON.stringify({
      event: 'presence',
      phone: this.live('phone').length > 0,
      watch: this.live('watch').length > 0,
      viewer: this.live('viewer').length > 0,
    });
    for (const s of this.ctx.getWebSockets()) {
      if (s.readyState !== WebSocket.READY_STATE_OPEN) continue;
      try { s.send(msg); } catch { /* ignore */ }
    }
  }
}
