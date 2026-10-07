/**
 * GEOPOLIS — Client temps réel WebSocket.
 * Reconnexion automatique avec backoff, heartbeat ping/pong, détection de
 * connexion perdue, resynchronisation complète après reconnexion, et
 * fallback HTTP (polling du snapshot) si le WebSocket tombe.
 */
import type { ServerMessage } from 'shared';

export type ConnectionStatus = 'connecting' | 'live' | 'reconnecting' | 'polling';

export interface RealtimeOptions {
  onMessage: (msg: ServerMessage) => void;
  onStatusChange: (status: ConnectionStatus) => void;
  getAuthToken?: () => string | null;
  pollWorld?: () => Promise<void>;
}

const HEARTBEAT_MS = 20_000;
const RECONNECT_BASE_MS = 1200;
const RECONNECT_MAX_MS = 20_000;
const POLL_FALLBACK_MS = 10_000;

export class RealtimeClient {
  private ws: WebSocket | null = null;
  private status: ConnectionStatus = 'connecting';
  private attempts = 0;
  private reconnectTimer: number | null = null;
  private heartbeatTimer: number | null = null;
  private pollTimer: number | null = null;
  private closedByUser = false;
  private subscribedCountry: string | null = null;

  constructor(private opts: RealtimeOptions) {}

  connect(): void {
    this.closedByUser = false;
    this.open();
  }

  disconnect(): void {
    this.closedByUser = true;
    this.clearTimers();
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
    this.setStatus('polling');
  }

  subscribe(countryId: string): void {
    this.subscribedCountry = countryId;
    this.send({ type: 'subscribe', countryId });
  }

  unsubscribe(): void {
    this.subscribedCountry = null;
    this.send({ type: 'unsubscribe' });
  }

  requestFullSync(): void {
    this.send({ type: 'request_full_sync' });
  }

  private setStatus(s: ConnectionStatus): void {
    if (this.status !== s) {
      this.status = s;
      this.opts.onStatusChange(s);
    }
  }

  private send(msg: unknown): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private clearTimers(): void {
    if (this.reconnectTimer !== null) window.clearTimeout(this.reconnectTimer);
    if (this.heartbeatTimer !== null) window.clearInterval(this.heartbeatTimer);
    if (this.pollTimer !== null) window.clearInterval(this.pollTimer);
    this.reconnectTimer = null;
    this.heartbeatTimer = null;
    this.pollTimer = null;
  }

  private startPollingFallback(): void {
    if (this.pollTimer !== null || !this.opts.pollWorld) return;
    this.setStatus('polling');
    void this.opts.pollWorld();
    this.pollTimer = window.setInterval(() => {
      if (this.opts.pollWorld) void this.opts.pollWorld();
    }, POLL_FALLBACK_MS);
  }

  private stopPollingFallback(): void {
    if (this.pollTimer !== null) window.clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  private open(): void {
    if (this.closedByUser) return;
    this.setStatus(this.attempts === 0 ? 'connecting' : 'reconnecting');
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    let ws: WebSocket;
    try {
      ws = new WebSocket(`${proto}://${window.location.host}/ws`);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      this.attempts = 0;
      this.setStatus('live');
      this.stopPollingFallback();
      const token = this.opts.getAuthToken?.();
      if (token) this.send({ type: 'hello', token });
      // Resynchronisation complète après reconnexion
      this.send({ type: 'request_full_sync' });
      if (this.subscribedCountry) this.send({ type: 'subscribe', countryId: this.subscribedCountry });
      this.heartbeatTimer = window.setInterval(() => {
        this.send({ type: 'ping', t: Date.now() });
      }, HEARTBEAT_MS);
    };

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(String(ev.data)) as ServerMessage;
        this.opts.onMessage(msg);
      } catch {
        /* message non-JSON ignoré : jamais de crash client */
      }
    };

    ws.onclose = () => {
      this.ws = null;
      if (this.heartbeatTimer !== null) window.clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
      if (!this.closedByUser) {
        this.startPollingFallback();
        this.scheduleReconnect();
      }
    };

    ws.onerror = () => {
      ws.close();
    };
  }

  private scheduleReconnect(): void {
    if (this.closedByUser || this.reconnectTimer !== null) return;
    const delay = Math.min(RECONNECT_BASE_MS * 2 ** this.attempts, RECONNECT_MAX_MS);
    this.attempts += 1;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.open();
    }, delay);
  }
}
