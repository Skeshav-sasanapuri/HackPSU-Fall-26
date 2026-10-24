/* A WebSocket that reconnects by itself and keeps the relay connection warm ("hb" is answered by the relay without
 * waking its room object). Used by the laptop viewer and by the phone page. */
export type SocketState = 'connecting' | 'up' | 'down';

export interface RelaySocketHandlers {
  onState?: (s: SocketState) => void;
  onMessage?: (text: string, arrival: number) => void;
}

export class RelaySocket {
  private ws: WebSocket | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private hb: ReturnType<typeof setInterval> | null = null;
  private wanted = false;
  private tries = 0;
  state: SocketState = 'down';

  constructor(private url: string, private h: RelaySocketHandlers = {}) {}

  open() {
    this.wanted = true;
    this.connect();
    this.hb ??= setInterval(() => this.send('"hb"'), 20_000);
  }

  close() {
    this.wanted = false;
    if (this.timer) clearTimeout(this.timer);
    if (this.hb) clearInterval(this.hb);
    this.timer = this.hb = null;
    this.ws?.close(1000);
    this.ws = null;
    this.set('down');
  }

  send(text: string): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(text);
    return true;
  }

  private set(s: SocketState) {
    if (s !== this.state) { this.state = s; this.h.onState?.(s); }
  }

  private connect() {
    if (!this.wanted) return;
    this.set('connecting');
    let ws: WebSocket;
    try { ws = new WebSocket(this.url); } catch { this.retry(); return; }
    this.ws = ws;
    ws.onopen = () => { this.tries = 0; this.set('up'); };
    ws.onmessage = (ev) => {
      if (typeof ev.data !== 'string' || ev.data === '"hb"') return;
      this.h.onMessage?.(ev.data, performance.now());
    };
    ws.onclose = () => { if (this.ws === ws) { this.ws = null; this.set('down'); this.retry(); } };
    ws.onerror = () => { try { ws.close(); } catch { /* ignore */ } };
  }

  private retry() {
    if (!this.wanted) return;
    const delay = Math.min(5000, 400 * 2 ** Math.min(this.tries++, 4));
    this.timer = setTimeout(() => this.connect(), delay);
  }
}
