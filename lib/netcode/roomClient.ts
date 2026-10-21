/**
 * Match Room v2 Client Transport
 *
 * Implements the client-side transport for Server Authority Migration Phase 3:
 * - Connects to Cloudflare Durable Object room (`/api/room/:matchId/ws` or `NEXT_PUBLIC_ROOM_WS_URL`)
 * - Authenticates via cookie session or in-band join token / ticket
 * - Dispatches player intents (REQUEST_ROLL, REQUEST_MOVE, etc.) to the room
 * - Receives ordered state broadcasts tagged with server `seq`
 * - Automatic reconnect with `lastSeq` resync
 * - Tracks room connection status and timers
 *
 * See docs/planning/SERVER_AUTHORITY_MIGRATION_PLAN.md §4.7, §5-P3
 */

import type { GameState } from '../types';

export type RoomConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'resyncing';

export interface RoomClientConfig {
  matchId: string;
  ticket?: string;
  inBandToken?: string;
  wsUrlOverride?: string;
  onState: (state: GameState, seq: number, lastIntentId?: string) => void;
  onStatusChange?: (status: RoomConnectionStatus) => void;
  onRejected?: (err: { intentId?: string; code: string; error: string; seq?: number }) => void;
  onIntentAck?: (ack: { intentId: string; ok?: boolean; data?: unknown }) => void;
  onTimer?: (timer: { timerId: string; kind: string; remainingMs: number }) => void;
  onError?: (err: Event | Error) => void;
}

export interface SendIntentOptions {
  timeoutMs?: number;
}

export class RoomClient {
  private matchId: string;
  private ticket?: string;
  private inBandToken?: string;
  private wsUrlOverride?: string;
  private ws: WebSocket | null = null;
  private status: RoomConnectionStatus = 'disconnected';
  private knownSeq = 0;
  private role: 'seat' | 'spectator' = 'spectator';
  private seatColor: string | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private pendingIntents = new Map<
    string,
    {
      resolve: (value: { ok: boolean; data?: unknown }) => void;
      reject: (reason: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();

  private callbacks: {
    onState: (state: GameState, seq: number, lastIntentId?: string) => void;
    onStatusChange?: (status: RoomConnectionStatus) => void;
    onRejected?: (err: { intentId?: string; code: string; error: string; seq?: number }) => void;
    onIntentAck?: (ack: { intentId: string; ok?: boolean; data?: unknown }) => void;
    onTimer?: (timer: { timerId: string; kind: string; remainingMs: number }) => void;
    onError?: (err: Event | Error) => void;
  };

  constructor(config: RoomClientConfig) {
    this.matchId = config.matchId;
    this.ticket = config.ticket;
    this.inBandToken = config.inBandToken;
    this.wsUrlOverride = config.wsUrlOverride;
    this.callbacks = {
      onState: config.onState,
      onStatusChange: config.onStatusChange,
      onRejected: config.onRejected,
      onIntentAck: config.onIntentAck,
      onTimer: config.onTimer,
      onError: config.onError,
    };
  }

  public getStatus(): RoomConnectionStatus {
    return this.status;
  }

  public getSeq(): number {
    return this.knownSeq;
  }

  public getRole(): 'seat' | 'spectator' {
    return this.role;
  }

  public getSeatColor(): string | null {
    return this.seatColor;
  }

  private setStatus(newStatus: RoomConnectionStatus): void {
    if (this.status !== newStatus) {
      this.status = newStatus;
      this.callbacks.onStatusChange?.(newStatus);
    }
  }

  /**
   * Resolves the WebSocket endpoint for the match room.
   */
  public resolveWebSocketUrl(): string {
    let url: string;
    if (this.wsUrlOverride) {
      url = this.wsUrlOverride.replace(':matchId', this.matchId);
    } else {
      const envWsUrl =
        typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_ROOM_WS_URL
          ? process.env.NEXT_PUBLIC_ROOM_WS_URL
          : undefined;

      if (envWsUrl) {
        const base = envWsUrl.endsWith('/') ? envWsUrl.slice(0, -1) : envWsUrl;
        url = `${base.replace(':matchId', this.matchId)}`;
      } else if (typeof window !== 'undefined') {
        const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        url = `${proto}//${window.location.host}/api/room/${encodeURIComponent(this.matchId)}/ws`;
      } else {
        url = `ws://localhost:3000/api/room/${encodeURIComponent(this.matchId)}/ws`;
      }
    }

    if (this.ticket && !url.includes('ticket=')) {
      const sep = url.includes('?') ? '&' : '?';
      url += `${sep}ticket=${encodeURIComponent(this.ticket)}`;
    }
    return url;
  }

  /**
   * Connect to the room.
   */
  public connect(): void {
    if (this.status === 'connecting' || this.status === 'connected') {
      return;
    }

    this.setStatus('connecting');
    const url = this.resolveWebSocketUrl();

    try {
      this.ws = new WebSocket(url);
    } catch (err) {
      this.setStatus('disconnected');
      this.callbacks.onError?.(err instanceof Error ? err : new Error(String(err)));
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.sendJoinFrame();
      this.startHeartbeat();
    };

    this.ws.onmessage = (event) => {
      this.handleMessage(event.data);
    };

    this.ws.onerror = (event) => {
      this.callbacks.onError?.(event);
    };

    this.ws.onclose = () => {
      this.stopHeartbeat();
      this.rejectAllPending(new Error('Room socket closed'));
      this.setStatus('disconnected');
      this.scheduleReconnect();
    };
  }

  private sendJoinFrame(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const joinPayload: Record<string, unknown> = {
      t: 'join',
      lastSeq: this.knownSeq,
    };

    if (this.inBandToken) {
      joinPayload.token = this.inBandToken;
    } else if (this.ticket) {
      joinPayload.ticket = this.ticket;
    }

    this.ws.send(JSON.stringify(joinPayload));
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.pingInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ t: 'ping' }));
      }
    }, 25000);
  }

  private stopHeartbeat(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectAttempts++;
    // Exponential backoff with jitter, capped at 10s
    const delay = Math.min(10000, 500 * Math.pow(1.5, this.reconnectAttempts) + Math.random() * 300);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  /**
   * Handle incoming message frame from the room.
   */
  private handleMessage(raw: unknown): void {
    if (typeof raw !== 'string') return;
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    const type = msg.t;

    if (type === 'joined') {
      this.setStatus('connected');
      this.role = (msg.role as 'seat' | 'spectator') || 'spectator';
      this.seatColor = (msg.seat as string) || null;
      const serverSeq = typeof msg.seq === 'number' ? msg.seq : 0;
      if (serverSeq >= this.knownSeq && msg.state) {
        this.knownSeq = serverSeq;
        this.callbacks.onState(msg.state as GameState, serverSeq);
      }
      return;
    }

    if (type === 'state') {
      const seq = typeof msg.seq === 'number' ? msg.seq : 0;
      if (seq >= this.knownSeq && msg.state) {
        this.knownSeq = seq;
        const lastIntentId = typeof msg.lastIntentId === 'string' ? msg.lastIntentId : undefined;
        this.callbacks.onState(msg.state as GameState, seq, lastIntentId);
      }
      return;
    }

    if (type === 'intent_ack') {
      const intentId = msg.intentId as string;
      const pending = this.pendingIntents.get(intentId);
      if (pending) {
        clearTimeout(pending.timer);
        this.pendingIntents.delete(intentId);
        pending.resolve({ ok: true, data: msg.data });
      }
      this.callbacks.onIntentAck?.({
        intentId,
        ok: true,
        data: msg.data,
      });
      return;
    }

    if (type === 'rejected') {
      const intentId = typeof msg.intentId === 'string' ? msg.intentId : undefined;
      const code = (msg.code as string) || 'UNKNOWN_ERROR';
      const error = (msg.error as string) || 'Action rejected';
      const seq = typeof msg.seq === 'number' ? msg.seq : undefined;

      if (intentId) {
        const pending = this.pendingIntents.get(intentId);
        if (pending) {
          clearTimeout(pending.timer);
          this.pendingIntents.delete(intentId);
          pending.reject(new Error(`[${code}] ${error}`));
        }
      }

      this.callbacks.onRejected?.({ intentId, code, error, seq });
      return;
    }

    if (type === 'sync_needed') {
      this.setStatus('resyncing');
      // Request catch-up frame with knownSeq
      this.sendJoinFrame();
      return;
    }

    if (type === 'timer') {
      this.callbacks.onTimer?.({
        timerId: String(msg.timerId || ''),
        kind: String(msg.kind || ''),
        remainingMs: Number(msg.remainingMs || 0),
      });
      return;
    }

    if (type === 'pong') {
      // Heartbeat acknowledged
      return;
    }
  }

  /**
   * Submit an intent to the room.
   */
  public async sendIntent(
    kind: string,
    payload: unknown = {},
    options: SendIntentOptions = {}
  ): Promise<{ ok: boolean; data?: unknown }> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('Room is not connected');
    }

    const intentId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const timeoutMs = options.timeoutMs ?? 10000;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingIntents.delete(intentId);
        reject(new Error(`Intent ${kind} (${intentId}) timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pendingIntents.set(intentId, { resolve, reject, timer });

      const frame = {
        t: 'intent',
        intentId,
        kind,
        payload,
        seq: this.knownSeq,
      };

      this.ws?.send(JSON.stringify(frame));
    });
  }

  /**
   * Seed the room with the initial match state (host only, first activation).
   *
   * A Durable Object starts empty: `ensureInitialized` reads SQLite, so a fresh
   * room has no board and every intent would be refused with ROOM_NOT_READY. The
   * host therefore writes the seed it already owns. The DO accepts it only when it
   * has nothing stored, so a reconnecting host cannot rewrite a live board.
   */
  public async seedState(payload: unknown): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('Room is not connected');
    }
    this.ws.send(JSON.stringify({ t: 'seed', payload }));
  }

  private rejectAllPending(err: Error): void {
    for (const [, pending] of this.pendingIntents) {
      clearTimeout(pending.timer);
      pending.reject(err);
    }
    this.pendingIntents.clear();
  }

  /**
   * Cleanly disconnect and tear down timers.
   */
  public disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopHeartbeat();
    this.rejectAllPending(new Error('Room disconnected by client'));
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.onmessage = null;
      this.ws.onopen = null;
      this.ws.close();
      this.ws = null;
    }
    this.setStatus('disconnected');
  }
}
