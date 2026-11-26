/**
 * Match Room v2 Client Transport
 *
 * Implements the client-side transport for Server Authority Migration Phase 3 & Wave 1:
 * - Connects to Cloudflare Durable Object room (`/api/room/:matchId/ws` or `NEXT_PUBLIC_ROOM_WS_URL`)
 * - Authenticates via __Host-ludo_session cookie or in-band join token (never query params)
 * - Dispatches versioned v1 intents (REQUEST_ROLL, REQUEST_MOVE, etc.) to the room
 * - Receives ordered state broadcasts tagged with server `seq` and `roomInstance`
 * - Unified 3s × 10 bounded reconnect ladder, 25s/60s pong watchdog, and typed RoomError rejections
 */

import type { GameState } from '../types';
import { applyStatePatch, type MatchEvent, type StatePatch } from '../matchEvents';
import { DisconnectReason, RoomError, type RoomErrorCode } from '../roomCodes';
import { ROOM_PROTOCOL_VERSION, ROOM_RECONNECT_CONFIG } from '../roomProtocol';
import { bumpNet } from './counters';
import { track } from '../telemetry';

export type RoomConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'resyncing';

export interface RoomClientConfig {
  matchId: string;
  ticket?: string;
  inBandToken?: string;
  as?: 'seat' | 'spectator';
  wsUrlOverride?: string;
  maxReconnectAttempts?: number;
  reconnectBaseDelayMs?: number;
  maxReconnectDelayMs?: number;
  pingIntervalMs?: number;
  pongTimeoutMs?: number;
  onState: (state: GameState, seq: number, lastIntentId?: string, resync?: boolean) => void;
  onEvents?: (events: MatchEvent[], seq: number) => void;
  onStatusChange?: (status: RoomConnectionStatus) => void;
  onRejected?: (err: RoomError) => void;
  onIntentAck?: (ack: { intentId: string; ok?: boolean; data?: unknown }) => void;
  onTimer?: (timer: { timerId: string; kind: string; remainingMs: number; deadlineAt?: number }) => void;
  onReconnectAttempt?: (info: {
    reason: DisconnectReason;
    attempt: number;
    maxAttempts: number;
    delayMs: number;
    matchId: string;
    roomInstance: string | null;
  }) => void;
  onReconnectExhausted?: (info: {
    reason: DisconnectReason;
    attempts: number;
    matchId: string;
    roomInstance: string | null;
  }) => void;
  onAuthExpired?: (err: RoomError) => void;
  onRoomInstance?: (roomInstance: string) => void;
  onSocial?: (msg: {
    socialType: 'EMOTE' | 'CHAT' | 'REMATCH' | 'PROJECTILE';
    payload: Record<string, unknown>;
    fromColor?: string;
    wallet?: string;
  }) => void;
  onError?: (err: Event | Error) => void;
}

export interface SendIntentOptions {
  timeoutMs?: number;
}

export class RoomClient {
  private matchId: string;
  private ticket?: string;
  private inBandToken?: string;
  private asRole: 'seat' | 'spectator';
  private wsUrlOverride?: string;
  private maxReconnectAttempts: number;
  private reconnectBaseDelayMs: number;
  private maxReconnectDelayMs: number;
  private pingIntervalMs: number;
  private pongTimeoutMs: number;

  private ws: WebSocket | null = null;
  private status: RoomConnectionStatus = 'disconnected';
  private knownSeq = 0;
  private lastState: GameState | null = null;
  private pendingResync = false;
  private role: 'seat' | 'spectator' = 'spectator';
  private seatColor: string | null = null;
  private roomInstance: string | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private lastPongAt = 0;
  private hasEverConnected = false;
  private manualDisconnect = false;
  private reconnectHalted = false;
  private lastDisconnectReason: DisconnectReason = DisconnectReason.SERVER_CLOSED;
  private listenersBound = false;
  private clockOffsetMs = 0;
  private hasClockSample = false;
  private lastPingSentAt = 0;

  private pendingIntents = new Map<
    string,
    {
      resolve: (value: { ok: boolean; data?: unknown }) => void;
      reject: (reason: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();

  private callbacks: {
    onState: (state: GameState, seq: number, lastIntentId?: string, resync?: boolean) => void;
    onEvents?: (events: MatchEvent[], seq: number) => void;
    onStatusChange?: (status: RoomConnectionStatus) => void;
    onRejected?: (err: RoomError) => void;
    onIntentAck?: (ack: { intentId: string; ok?: boolean; data?: unknown }) => void;
    onTimer?: (timer: { timerId: string; kind: string; remainingMs: number; deadlineAt?: number }) => void;
    onReconnectAttempt?: RoomClientConfig['onReconnectAttempt'];
    onReconnectExhausted?: RoomClientConfig['onReconnectExhausted'];
    onAuthExpired?: (err: RoomError) => void;
    onRoomInstance?: (roomInstance: string) => void;
    onSocial?: RoomClientConfig['onSocial'];
    onError?: (err: Event | Error) => void;
  };

  constructor(config: RoomClientConfig) {
    this.matchId = config.matchId;
    this.ticket = config.ticket;
    this.inBandToken = config.inBandToken;
    this.asRole = config.as ?? (config.inBandToken || config.ticket ? 'seat' : 'spectator');
    this.wsUrlOverride = config.wsUrlOverride;
    this.maxReconnectAttempts = config.maxReconnectAttempts ?? ROOM_RECONNECT_CONFIG.maxAttempts;
    this.reconnectBaseDelayMs = config.reconnectBaseDelayMs ?? ROOM_RECONNECT_CONFIG.baseDelayMs;
    this.maxReconnectDelayMs = config.maxReconnectDelayMs ?? ROOM_RECONNECT_CONFIG.maxDelayMs;
    this.pingIntervalMs = config.pingIntervalMs ?? ROOM_RECONNECT_CONFIG.pingIntervalMs;
    this.pongTimeoutMs = config.pongTimeoutMs ?? ROOM_RECONNECT_CONFIG.pongTimeoutMs;
    this.callbacks = {
      onState: config.onState,
      onEvents: config.onEvents,
      onStatusChange: config.onStatusChange,
      onRejected: config.onRejected,
      onIntentAck: config.onIntentAck,
      onTimer: config.onTimer,
      onReconnectAttempt: config.onReconnectAttempt,
      onReconnectExhausted: config.onReconnectExhausted,
      onAuthExpired: config.onAuthExpired,
      onRoomInstance: config.onRoomInstance,
      onSocial: config.onSocial,
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

  public getRoomInstance(): string | null {
    return this.roomInstance;
  }

  public getClockOffsetMs(): number {
    return Math.round(this.clockOffsetMs);
  }

  public getServerNow(): number {
    return Math.round(Date.now() + this.clockOffsetMs);
  }

  private setStatus(newStatus: RoomConnectionStatus): void {
    if (this.status !== newStatus) {
      this.status = newStatus;
      this.callbacks.onStatusChange?.(newStatus);
    }
  }

  private handleOnline = (): void => {
    if (
      !this.manualDisconnect &&
      !this.reconnectHalted &&
      this.status === 'disconnected' &&
      this.reconnectAttempts < this.maxReconnectAttempts
    ) {
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
      this.connect();
    }
  };

  private handleOffline = (): void => {
    this.lastDisconnectReason = DisconnectReason.NET_DOWN;
  };

  private handleNetworkChange = (): void => {
    this.lastDisconnectReason = DisconnectReason.NETWORK_SWITCH;
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.sendPingFrame();
    }
  };

  private bindNetworkListeners(): void {
    if (this.listenersBound) return;
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('online', this.handleOnline);
      window.addEventListener('offline', this.handleOffline);
    }
    if (typeof navigator !== 'undefined') {
      const navConn = (navigator as {
        connection?: { addEventListener?: (t: string, l: () => void) => void };
      }).connection;
      navConn?.addEventListener?.('change', this.handleNetworkChange);
    }
    this.listenersBound = true;
  }

  private unbindNetworkListeners(): void {
    if (!this.listenersBound) return;
    if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
      window.removeEventListener('online', this.handleOnline);
      window.removeEventListener('offline', this.handleOffline);
    }
    if (typeof navigator !== 'undefined') {
      const navConn = (navigator as {
        connection?: { removeEventListener?: (t: string, l: () => void) => void };
      }).connection;
      navConn?.removeEventListener?.('change', this.handleNetworkChange);
    }
    this.listenersBound = false;
  }

  /**
   * Resolves the WebSocket endpoint for the match room without placing credentials in query params.
   */
  public resolveWebSocketUrl(): string {
    if (this.wsUrlOverride) {
      return this.wsUrlOverride.replace(':matchId', this.matchId);
    }
    const envWsUrl =
      typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_ROOM_WS_URL
        ? process.env.NEXT_PUBLIC_ROOM_WS_URL
        : undefined;

    if (envWsUrl) {
      const base = envWsUrl.endsWith('/') ? envWsUrl.slice(0, -1) : envWsUrl;
      return `${base.replace(':matchId', this.matchId)}`;
    }
    if (typeof window !== 'undefined') {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      return `${proto}//${window.location.host}/api/room/${encodeURIComponent(this.matchId)}/ws`;
    }
    return `ws://localhost:3000/api/room/${encodeURIComponent(this.matchId)}/ws`;
  }

  /**
   * Connect to the room.
   */
  public connect(): void {
    if (this.status === 'connecting' || this.status === 'connected') {
      return;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.manualDisconnect = false;
    this.reconnectHalted = false;
    this.pendingResync = false;
    this.lastDisconnectReason = DisconnectReason.SERVER_CLOSED;
    this.bindNetworkListeners();
    this.setStatus('connecting');
    const url = this.resolveWebSocketUrl();

    try {
      this.ws = new WebSocket(url);
    } catch (err) {
      this.setStatus('disconnected');
      this.callbacks.onError?.(err instanceof Error ? err : new Error(String(err)));
      this.scheduleReconnect(DisconnectReason.SOCKET_NULL);
      return;
    }

    const activeSocket = this.ws;

    activeSocket.onopen = () => {
      if (this.ws !== activeSocket) return;
      this.lastPongAt = Date.now();
      this.sendJoinFrame();
      this.startHeartbeat();
    };

    activeSocket.onmessage = (event) => {
      if (this.ws !== activeSocket) return;
      this.handleMessage(event.data);
    };

    activeSocket.onerror = (event) => {
      if (this.ws !== activeSocket) return;
      this.callbacks.onError?.(event);
    };

    activeSocket.onclose = () => {
      if (this.ws !== activeSocket) return;
      this.stopHeartbeat();
      this.detachSocketHandlers(activeSocket);
      this.ws = null;
      this.rejectAllPending(
        new RoomError('SOCKET_CLOSED', 'Room socket closed', {
          roomInstance: this.roomInstance ?? undefined,
        })
      );
      this.setStatus('disconnected');
      if (!this.manualDisconnect && !this.reconnectHalted) {
        this.scheduleReconnect(this.determineDisconnectReason());
      }
    };
  }

  private detachSocketHandlers(sock: WebSocket): void {
    sock.onclose = null;
    sock.onerror = null;
    sock.onmessage = null;
    sock.onopen = null;
  }

  private determineDisconnectReason(): DisconnectReason {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      return DisconnectReason.NET_DOWN;
    }
    return this.lastDisconnectReason;
  }

  private sendJoinFrame(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const joinPayload: Record<string, unknown> = {
      v: ROOM_PROTOCOL_VERSION,
      t: 'join',
      as: this.asRole,
      lastSeq: this.knownSeq,
      caps: ['delta'],
    };

    if (this.inBandToken) {
      joinPayload.token = this.inBandToken;
    } else if (this.ticket) {
      joinPayload.ticket = this.ticket;
    }

    this.ws.send(JSON.stringify(joinPayload));
  }

  private sendPingFrame(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const ts = Date.now();
      this.lastPingSentAt = ts;
      this.ws.send(JSON.stringify({ v: ROOM_PROTOCOL_VERSION, t: 'ping', ts }));
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.lastPongAt = Date.now();
    this.pingInterval = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      if (Date.now() - this.lastPongAt >= this.pongTimeoutMs) {
        this.handleHeartbeatTimeout();
        return;
      }
      this.sendPingFrame();
    }, this.pingIntervalMs);
  }

  private stopHeartbeat(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  private handleHeartbeatTimeout(): void {
    this.stopHeartbeat();
    bumpNet('net_heartbeat_timeout');
    this.lastDisconnectReason = DisconnectReason.HEARTBEAT_TIMEOUT;
    const staleWs = this.ws;
    this.ws = null;
    if (staleWs) {
      this.detachSocketHandlers(staleWs);
      try {
        staleWs.close();
      } catch {
        // Ignore close errors on dead socket
      }
    }
    this.rejectAllPending(
      new RoomError('SOCKET_CLOSED', 'Heartbeat pong timeout', {
        roomInstance: this.roomInstance ?? undefined,
      })
    );
    this.setStatus('disconnected');
    if (!this.manualDisconnect && !this.reconnectHalted) {
      this.scheduleReconnect(DisconnectReason.HEARTBEAT_TIMEOUT);
    }
  }

  private scheduleReconnect(reason: DisconnectReason): void {
    if (this.reconnectTimer || this.manualDisconnect || this.reconnectHalted) return;
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      track('room_reconnect_exhausted', {
        reason,
        attempts: this.reconnectAttempts,
        matchId: this.matchId,
        roomInstance: this.roomInstance,
      });
      this.callbacks.onReconnectExhausted?.({
        reason,
        attempts: this.reconnectAttempts,
        matchId: this.matchId,
        roomInstance: this.roomInstance,
      });
      return;
    }

    this.reconnectAttempts++;
    bumpNet('net_reconnect_attempt');
    const expDelay = this.reconnectBaseDelayMs * Math.pow(1.5, this.reconnectAttempts - 1);
    const delayMs = Math.min(this.maxReconnectDelayMs, expDelay + Math.floor(Math.random() * 300));

    track('room_reconnect_attempt', {
      reason,
      attempt: this.reconnectAttempts,
      matchId: this.matchId,
      roomInstance: this.roomInstance,
    });
    this.callbacks.onReconnectAttempt?.({
      reason,
      attempt: this.reconnectAttempts,
      maxAttempts: this.maxReconnectAttempts,
      delayMs,
      matchId: this.matchId,
      roomInstance: this.roomInstance,
    });

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delayMs);
  }

  private resolvePendingIntent(intentId: string, data: unknown): void {
    const pending = this.pendingIntents.get(intentId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pendingIntents.delete(intentId);
    bumpNet('net_intent_ok');
    pending.resolve({ ok: true, data });
  }

  private haltOnFatalProtocolOrAuth(kind: 'auth' | 'protocol', roomErr: RoomError): void {
    this.reconnectHalted = true;
    this.lastDisconnectReason =
      kind === 'auth' ? DisconnectReason.AUTH_EXPIRED : DisconnectReason.PROTOCOL_MISMATCH;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopHeartbeat();
    const currentWs = this.ws;
    this.ws = null;
    if (currentWs) {
      this.detachSocketHandlers(currentWs);
      try {
        currentWs.close();
      } catch {
        // Ignore close errors
      }
    }
    this.rejectAllPending(roomErr);
    this.setStatus('disconnected');
    if (kind === 'auth') {
      this.callbacks.onAuthExpired?.(roomErr);
    } else {
      this.callbacks.onError?.(roomErr);
    }
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

    if (typeof msg.roomInstance === 'string' && msg.roomInstance.length > 0 && msg.roomInstance !== this.roomInstance) {
      this.roomInstance = msg.roomInstance;
      this.callbacks.onRoomInstance?.(msg.roomInstance);
    }

    const type = msg.t;

    if (typeof msg.serverNow === 'number' && Number.isFinite(msg.serverNow)) {
      const now = Date.now();
      let sampleOffset = msg.serverNow - now;
      if (type === 'pong') {
        const sentAt = typeof msg.clientTs === 'number' ? msg.clientTs : this.lastPingSentAt;
        if (sentAt > 0 && now >= sentAt) {
          const rtt = Math.max(0, now - sentAt);
          sampleOffset = msg.serverNow + rtt / 2 - now;
        }
      }
      if (!this.hasClockSample) {
        this.clockOffsetMs = sampleOffset;
        this.hasClockSample = true;
      } else {
        const alpha = type === 'pong' ? 0.35 : 0.2;
        this.clockOffsetMs = this.clockOffsetMs * (1 - alpha) + sampleOffset * alpha;
      }
    }

    if (type === 'joined') {
      const wasReconnect = this.hasEverConnected && this.reconnectAttempts > 0;
      this.hasEverConnected = true;
      this.reconnectAttempts = 0;
      this.lastPongAt = Date.now();
      this.lastDisconnectReason = DisconnectReason.SERVER_CLOSED;
      if (wasReconnect) {
        bumpNet('net_reconnect_success');
      }
      this.role = (msg.role as 'seat' | 'spectator') || 'spectator';
      this.seatColor = (msg.seat as string) || null;
      this.setStatus('connected');

      const serverSeq = typeof msg.seq === 'number' ? msg.seq : 0;
      if (serverSeq >= this.knownSeq && msg.state) {
        this.knownSeq = serverSeq;
        const state = msg.state as GameState;
        if (typeof msg.deadlineAt === 'number' || msg.deadlineAt === null) {
          state.deadlineAt = msg.deadlineAt as number | null;
        }
        this.lastState = state;
        this.pendingResync = false;
        this.callbacks.onState(state, serverSeq, undefined, true);
      }
      return;
    }

    if (type === 'state') {
      this.lastDisconnectReason = DisconnectReason.SERVER_CLOSED;
      const seq = typeof msg.seq === 'number' ? msg.seq : 0;
      const lastIntentId = typeof msg.lastIntentId === 'string' ? msg.lastIntentId : undefined;
      if (seq >= this.knownSeq && msg.state) {
        const isResync = Boolean(msg.resync) || this.pendingResync;
        this.pendingResync = false;
        this.knownSeq = seq;
        const state = msg.state as GameState;
        if (typeof msg.deadlineAt === 'number' || msg.deadlineAt === null) {
          state.deadlineAt = msg.deadlineAt as number | null;
        }
        this.lastState = state;
        this.callbacks.onState(state, seq, lastIntentId, isResync);
        if (lastIntentId) {
          this.resolvePendingIntent(lastIntentId, {
            seq,
            roomInstance: this.roomInstance ?? undefined,
          });
        }
      }
      return;
    }

    if (type === 'delta') {
      this.lastDisconnectReason = DisconnectReason.SERVER_CLOSED;
      const seq = typeof msg.seq === 'number' ? msg.seq : 0;
      const prevSeq = typeof msg.prevSeq === 'number' ? msg.prevSeq : -1;
      const lastIntentId = typeof msg.lastIntentId === 'string' ? msg.lastIntentId : undefined;

      if (seq <= this.knownSeq) {
        return;
      }

      if (!this.lastState || prevSeq !== this.knownSeq || !msg.patch || typeof msg.patch !== 'object') {
        // Sequence gap or missing baseline: automatically resync full snapshot.
        this.pendingResync = true;
        this.setStatus('resyncing');
        this.sendJoinFrame();
        return;
      }

      const nextState = applyStatePatch(this.lastState, msg.patch as StatePatch);
      if (typeof msg.deadlineAt === 'number' || msg.deadlineAt === null) {
        nextState.deadlineAt = msg.deadlineAt as number | null;
      }
      this.pendingResync = false;
      this.knownSeq = seq;
      this.lastState = nextState;
      this.callbacks.onState(nextState, seq, lastIntentId, false);
      if (Array.isArray(msg.events) && msg.events.length > 0) {
        this.callbacks.onEvents?.(msg.events as MatchEvent[], seq);
      }
      if (lastIntentId) {
        this.resolvePendingIntent(lastIntentId, {
          seq,
          roomInstance: this.roomInstance ?? undefined,
        });
      }
      return;
    }

    if (type === 'intent_ack') {
      const intentId = msg.intentId as string;
      this.resolvePendingIntent(intentId, msg.data);
      this.callbacks.onIntentAck?.({
        intentId,
        ok: true,
        data: msg.data,
      });
      return;
    }

    if (type === 'rejected') {
      const intentId = typeof msg.intentId === 'string' && msg.intentId.length > 0 ? msg.intentId : undefined;
      const code = ((typeof msg.code === 'string' && msg.code) || 'ROOM_INTENT_FAILED') as RoomErrorCode;
      const error = (typeof msg.error === 'string' && msg.error) || 'Action rejected';
      const seq = typeof msg.seq === 'number' ? msg.seq : undefined;
      const roomErr = new RoomError(code, error, {
        seq,
        intentId,
        roomInstance: this.roomInstance ?? undefined,
      });

      if (intentId) {
        const pending = this.pendingIntents.get(intentId);
        if (pending) {
          clearTimeout(pending.timer);
          this.pendingIntents.delete(intentId);
          pending.reject(roomErr);
        }
      } else {
        const isAuthFailure =
          code === 'SESSION_EXPIRED' ||
          code === 'TICKET_INVALID' ||
          (code === 'NOT_AUTHORIZED' && this.asRole === 'seat');
        if (isAuthFailure) {
          this.haltOnFatalProtocolOrAuth('auth', roomErr);
        }
      }

      if (code === 'PROTOCOL_MISMATCH') {
        this.haltOnFatalProtocolOrAuth('protocol', roomErr);
      }

      this.callbacks.onRejected?.(roomErr);
      return;
    }

    if (type === 'sync_needed') {
      this.pendingResync = true;
      this.setStatus('resyncing');
      this.sendJoinFrame();
      return;
    }

    if (type === 'timer') {
      const deadlineAt = typeof msg.deadlineAt === 'number' ? msg.deadlineAt : undefined;
      const remainingMs =
        typeof msg.remainingMs === 'number'
          ? msg.remainingMs
          : deadlineAt !== undefined
            ? Math.max(0, deadlineAt - this.getServerNow())
            : 0;
      this.callbacks.onTimer?.({
        timerId: String(msg.timerId || ''),
        kind: String(msg.kind || ''),
        remainingMs,
        deadlineAt,
      });
      return;
    }

    if (type === 'pong') {
      this.lastPongAt = Date.now();
      bumpNet('net_heartbeat_ok');
      return;
    }

    if (type === 'social') {
      const socialType = msg.socialType;
      if (
        socialType === 'EMOTE' ||
        socialType === 'CHAT' ||
        socialType === 'REMATCH' ||
        socialType === 'PROJECTILE'
      ) {
        const payload =
          msg.payload && typeof msg.payload === 'object' && !Array.isArray(msg.payload)
            ? (msg.payload as Record<string, unknown>)
            : {};
        this.callbacks.onSocial?.({
          socialType,
          payload,
          fromColor: typeof msg.fromColor === 'string' ? msg.fromColor : undefined,
          wallet: typeof msg.wallet === 'string' ? msg.wallet : undefined,
        });
      }
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
      throw new RoomError('NO_ROOM', 'Room is not connected', {
        roomInstance: this.roomInstance ?? undefined,
      });
    }

    const intentId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const timeoutMs = options.timeoutMs ?? 10000;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingIntents.delete(intentId);
        this.lastDisconnectReason = DisconnectReason.INTENT_TIMEOUT;
        reject(
          new RoomError('INTENT_TIMEOUT', `Intent ${kind} (${intentId}) timed out after ${timeoutMs}ms`, {
            intentId,
            roomInstance: this.roomInstance ?? undefined,
          })
        );
      }, timeoutMs);

      this.pendingIntents.set(intentId, { resolve, reject, timer });

      const frame = {
        v: ROOM_PROTOCOL_VERSION,
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
   * Broadcast an ephemeral in-match social reaction (EMOTE / CHAT / REMATCH / PROJECTILE).
   * Fire-and-forget; never enters the game engine intent queue.
   */
  public sendSocial(
    socialType: 'EMOTE' | 'CHAT' | 'REMATCH' | 'PROJECTILE',
    payload: Record<string, unknown> = {}
  ): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return false;
    }
    this.ws.send(
      JSON.stringify({
        v: ROOM_PROTOCOL_VERSION,
        t: 'social',
        socialType,
        payload,
      })
    );
    return true;
  }

  /**
   * Seed the room with the initial match state (host only, first activation).
   */
  public async seedState(payload: unknown): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new RoomError('NO_ROOM', 'Room is not connected', {
        roomInstance: this.roomInstance ?? undefined,
      });
    }
    this.ws.send(JSON.stringify({ v: ROOM_PROTOCOL_VERSION, t: 'seed', payload }));
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
    this.manualDisconnect = true;
    this.pendingResync = false;
    this.lastDisconnectReason = DisconnectReason.CLIENT_DISCONNECT;
    this.unbindNetworkListeners();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopHeartbeat();
    this.rejectAllPending(
      new RoomError('SOCKET_CLOSED', 'Room disconnected by client', {
        roomInstance: this.roomInstance ?? undefined,
      })
    );
    if (this.ws) {
      this.detachSocketHandlers(this.ws);
      try {
        this.ws.close();
      } catch {
        // Ignore close errors
      }
      this.ws = null;
    }
    this.setStatus('disconnected');
  }
}
