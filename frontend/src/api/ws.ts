export type SocketStatus = 'idle' | 'connecting' | 'open' | 'closed';

/** Envelope types that carry no app data. */
const QUIET = new Set(['ping', 'pong', 'connected']);

export interface LiveSocketOptions<E> {
  /** Returns the URL to connect to, or null to stay disconnected. */
  url: () => string | null;
  onEvent: (event: E) => void;
  onStatus?: (status: SocketStatus) => void;
  /** Called after a successful *re*connect (not the first connect). */
  onReconnect?: () => void;
  /**
   * The connection closed before it ever opened (handshake rejected: bad token/device).
   * Called once per failed attempt; the socket keeps retrying with backoff.
   */
  onHandshakeFail?: () => void;
  heartbeatMs?: number;
  /** Close and reconnect if nothing was received for this long. */
  staleMs?: number;
  maxBackoffMs?: number;
}

/**
 * Native WebSocket with exponential backoff + jitter, heartbeat pings and
 * stale-connection detection. Reconnects immediately when the browser goes online.
 */
export class LiveSocket<E extends { type: string }> {
  private ws: WebSocket | null = null;
  private attempt = 0;
  private everOpened = false;
  private stopped = true;
  private reconnectTimer: number | null = null;
  private heartbeatTimer: number | null = null;
  private lastMessageAt = 0;
  private status: SocketStatus = 'idle';
  private readonly opts: Required<
    Omit<LiveSocketOptions<E>, 'onStatus' | 'onReconnect' | 'onHandshakeFail'>
  > &
    Pick<LiveSocketOptions<E>, 'onStatus' | 'onReconnect' | 'onHandshakeFail'>;

  constructor(opts: LiveSocketOptions<E>) {
    this.opts = { heartbeatMs: 20_000, staleMs: 50_000, maxBackoffMs: 30_000, ...opts };
  }

  private setStatus(s: SocketStatus) {
    if (this.status === s) return;
    this.status = s;
    this.opts.onStatus?.(s);
  }

  private handleOnline = () => {
    if (this.stopped) return;
    if (this.status !== 'open') {
      this.attempt = 0;
      this.clearReconnect();
      this.connect();
    }
  };

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    window.addEventListener('online', this.handleOnline);
    this.connect();
  }

  stop() {
    this.stopped = true;
    window.removeEventListener('online', this.handleOnline);
    this.clearReconnect();
    this.clearHeartbeat();
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.onmessage = null;
      this.ws.onopen = null;
      try {
        this.ws.close(1000);
      } catch {
        /* ignore */
      }
    }
    this.ws = null;
    this.setStatus('idle');
  }

  send(data: unknown) {
    this.sendRaw(JSON.stringify(data));
  }

  sendRaw(text: string) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(text);
  }

  private connect() {
    if (this.stopped) return;
    const url = this.opts.url();
    if (!url) {
      this.setStatus('idle');
      return;
    }
    this.setStatus('connecting');
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    let opened = false;

    ws.onopen = () => {
      opened = true;
      const isReconnect = this.everOpened;
      this.everOpened = true;
      this.attempt = 0;
      this.lastMessageAt = Date.now();
      this.setStatus('open');
      this.startHeartbeat();
      if (isReconnect) this.opts.onReconnect?.();
    };

    ws.onmessage = (msg) => {
      this.lastMessageAt = Date.now();
      if (typeof msg.data !== 'string' || msg.data === 'pong') return;
      try {
        const parsed = JSON.parse(msg.data) as E;
        // Server keep-alives and the handshake ack only refresh lastMessageAt.
        if (parsed && typeof parsed.type === 'string' && !QUIET.has(parsed.type)) {
          this.opts.onEvent(parsed);
        }
      } catch {
        /* ignore malformed frames */
      }
    };

    ws.onerror = () => {
      // onclose follows; reconnect is scheduled there.
    };

    ws.onclose = () => {
      this.clearHeartbeat();
      this.ws = null;
      if (this.stopped) return;
      this.setStatus('closed');
      if (!opened) this.opts.onHandshakeFail?.();
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect() {
    this.clearReconnect();
    // 1 s, 2 s, 4 s … capped at 30 s, with ±20 % jitter so clients don't reconnect in lockstep.
    const base = Math.min(this.opts.maxBackoffMs, 1000 * 2 ** this.attempt);
    const delay = base * (0.8 + Math.random() * 0.4);
    this.attempt += 1;
    this.reconnectTimer = window.setTimeout(() => this.connect(), delay);
  }

  private startHeartbeat() {
    this.clearHeartbeat();
    this.heartbeatTimer = window.setInterval(() => {
      if (Date.now() - this.lastMessageAt > this.opts.staleMs) {
        // Dead connection: force-close and let onclose reconnect.
        try {
          this.ws?.close(4000, 'stale');
        } catch {
          /* ignore */
        }
        return;
      }
      // The backend answers the text frame 'ping' with 'pong'.
      this.sendRaw('ping');
    }, this.opts.heartbeatMs);
  }

  private clearHeartbeat() {
    if (this.heartbeatTimer != null) window.clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  private clearReconnect() {
    if (this.reconnectTimer != null) window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }
}
