/**
 * MatchRoom — Durable Object authority for match transport, ordering, and fan-out (Phase 3).
 *
 * Implements:
 * 1. Single-threaded actor per matchId backed by DO SQLite.
 * 2. Hibernatable WebSocket handling with membership and spectator auth.
 * 3. Frame protocol (§4.7): join, intent, state, rejected, timer, lifecycle, ping/pong.
 * 4. Upgrade authentication (§4.7): __Host- cookie, ?ticket= param, or in-band join token.
 * 5. FIFO action queue / cooperative multitasking protection (Rev 3 — F5).
 * 6. Timer min-heap scheduler using single DO alarm.
 * 7. P3 Edge function proxying: proxies exact HTTP payloads to roll-dice and move-auth without modifying them.
 * 8. Reconnect and catch-up via lastSeq.
 *
 * See docs/planning/SERVER_AUTHORITY_MIGRATION_PLAN.md §4.4, §4.7, §5-P3
 */

import { DurableObject } from 'cloudflare:workers';
import type { GameState } from '../../lib/types';
import { hashToken } from '../../lib/sessionV2';
import type { RateLimitDO } from '../rateLimit/RateLimitDO';

export interface Env {
  MATCH_ROOM: DurableObjectNamespace<MatchRoom>;
  RATE_LIMITER?: DurableObjectNamespace<RateLimitDO>;
  NEXT_PUBLIC_SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  NEXT_PUBLIC_SUPABASE_ANON_KEY?: string;
}

export type IntentKind =
  | 'REQUEST_ROLL'
  | 'REQUEST_MOVE'
  | 'DICE_COMMIT'
  | 'DICE_REVEAL'
  | 'CMD_REQUEST_TRUST';

export interface RoomSocketMeta {
  authenticated: boolean;
  wallet?: string;
  role: 'seat' | 'spectator';
  color?: string;
  connectedAt: number;
}

export interface ScheduledTimer {
  id: string;
  kind: 'turn' | 'bet_window' | 'afk_strike' | 'reconnect_grace';
  deadlineAt: number;
}

export class MatchRoom extends DurableObject<Env> {
  private matchId: string = '';
  private seq: number = 0;
  private state: GameState | null = null;
  private roomVersion: number = 1;
  private timerHeap: ScheduledTimer[] = [];
  private actionQueue: Promise<void> = Promise.resolve();
  private socketMeta: Map<WebSocket, RoomSocketMeta> = new Map();
  private initialized: boolean = false;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
  }

  /**
   * Initialize state from SQLite storage on first activation.
   */
  private async ensureInitialized(matchId: string): Promise<void> {
    if (this.initialized) return;
    this.matchId = matchId;

    const storedSeq = await this.ctx.storage.get<number>('seq');
    const storedState = await this.ctx.storage.get<GameState>('state');
    const storedVersion = await this.ctx.storage.get<number>('roomVersion');
    const storedTimers = await this.ctx.storage.get<ScheduledTimer[]>('timerHeap');

    if (storedSeq !== undefined) this.seq = storedSeq;
    if (storedState) this.state = storedState;
    if (storedVersion !== undefined) this.roomVersion = storedVersion;
    if (storedTimers) this.timerHeap = storedTimers;

    this.initialized = true;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const parts = url.pathname.split('/').filter(Boolean);
    const matchId = parts[2] || '';

    await this.ensureInitialized(matchId);

    if (url.pathname.endsWith('/ws')) {
      const upgradeHeader = request.headers.get('Upgrade');
      if (!upgradeHeader || upgradeHeader.toLowerCase() !== 'websocket') {
        return new Response('Expected WebSocket upgrade', { status: 426 });
      }

      // Check ticket or cookie on upgrade
      const ticket = url.searchParams.get('ticket');
      const cookieHeader = request.headers.get('Cookie') || '';
      let initialWallet: string | undefined;
      let initialRole: 'seat' | 'spectator' = 'spectator';
      let authenticated = false;

      if (ticket) {
        // Validate ticket against database sessions
        const verified = await this.verifyTicket(ticket, matchId);
        if (verified.ok) {
          initialWallet = verified.wallet;
          initialRole = verified.role;
          authenticated = true;
        }
      } else if (cookieHeader) {
        const verified = await this.verifyCookie(cookieHeader, matchId);
        if (verified.ok) {
          initialWallet = verified.wallet;
          initialRole = verified.role;
          authenticated = true;
        }
      }

      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);

      this.ctx.acceptWebSocket(server);

      this.socketMeta.set(server, {
        authenticated,
        wallet: initialWallet,
        role: initialRole,
        connectedAt: Date.now(),
      });

      // If already authenticated and state exists, dispatch freshest state
      if (authenticated && this.state) {
        server.send(
          JSON.stringify({
            t: 'state',
            seq: this.seq,
            state: this.state,
            source: 'match_states',
            deadlineAt: this.getEarliestDeadline(),
          })
        );
      }

      return new Response(null, { status: 101, webSocket: client });
    }

    if (url.pathname.endsWith('/info')) {
      return Response.json({
        ok: true,
        matchId: this.matchId,
        seq: this.seq,
        roomVersion: this.roomVersion,
        activeSockets: this.ctx.getWebSockets().length,
        hasState: !!this.state,
      });
    }

    return new Response('Not found', { status: 404 });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const text = typeof message === 'string' ? message : new TextDecoder().decode(message);
    let frame: Record<string, unknown>;
    try {
      frame = JSON.parse(text);
    } catch {
      ws.send(JSON.stringify({ t: 'rejected', code: 'MALFORMED_FRAME', error: 'Invalid JSON' }));
      return;
    }

    const t = frame.t;

    if (t === 'pong') {
      return;
    }

    if (t === 'ping') {
      ws.send(JSON.stringify({ t: 'pong', ts: Date.now() }));
      return;
    }

    // In-band join frame
    if (t === 'join') {
      await this.handleJoinFrame(ws, frame);
      return;
    }

    // Intent frame
    if (t === 'intent') {
      // Enqueue in FIFO action queue to guarantee sequential execution
      this.actionQueue = this.actionQueue.then(async () => {
        try {
          await this.handleIntentFrame(ws, frame);
        } catch (err) {
          console.error('[MatchRoom] Intent execution error:', err);
          ws.send(
            JSON.stringify({
              t: 'rejected',
              intentId: frame.intentId,
              code: 'INTERNAL_ERROR',
              error: (err as Error).message,
            })
          );
        }
      });
      return;
    }

    ws.send(JSON.stringify({ t: 'rejected', code: 'UNKNOWN_FRAME_TYPE' }));
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    this.socketMeta.delete(ws);
    ws.close(code, reason);
  }

  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    console.error('[MatchRoom] WebSocket error:', error);
    this.socketMeta.delete(ws);
    ws.close(1011, 'Internal error');
  }

  /**
   * Handle in-band join frame carrying credential token and optional lastSeq.
   */
  private async handleJoinFrame(ws: WebSocket, frame: Record<string, unknown>): Promise<void> {
    const token = typeof frame.token === 'string' ? frame.token : undefined;
    const asRole = frame.as === 'seat' ? 'seat' : 'spectator';
    const lastSeq = typeof frame.lastSeq === 'number' ? frame.lastSeq : undefined;

    let meta = this.socketMeta.get(ws);
    if (!meta) {
      meta = { authenticated: false, role: asRole, connectedAt: Date.now() };
      this.socketMeta.set(ws, meta);
    }

    if (!meta.authenticated && token) {
      const verified = await this.verifySessionToken(token, this.matchId);
      if (verified.ok) {
        meta.authenticated = true;
        meta.wallet = verified.wallet;
        meta.role = verified.role;
      } else {
        ws.send(
          JSON.stringify({
            t: 'rejected',
            code: 'NOT_AUTHORIZED',
            error: verified.error || 'Authentication failed',
          })
        );
        return;
      }
    }

    // If still not authenticated and trying to act as seat, reject
    if (!meta.authenticated && asRole === 'seat') {
      ws.send(
        JSON.stringify({
          t: 'rejected',
          code: 'NOT_AUTHORIZED',
          error: 'Authentication credential required for seat role',
        })
      );
      return;
    }

    // If client requested catch-up or has stale state
    if (this.state) {
      ws.send(
        JSON.stringify({
          t: 'state',
          seq: this.seq,
          state: this.state,
          source: 'match_states',
          deadlineAt: this.getEarliestDeadline(),
          resync: lastSeq !== undefined && lastSeq < this.seq,
        })
      );
    }
  }

  /**
   * Handle gameplay intent. In Phase 3, this proxies directly to the Edge functions
   * without modifying them, updates local state + seq, and fans out state frames.
   */
  private async handleIntentFrame(ws: WebSocket, frame: Record<string, unknown>): Promise<void> {
    const meta = this.socketMeta.get(ws);
    const intentId = String(frame.intentId || '');
    const kind = frame.kind as IntentKind;
    const payload = (frame.payload || {}) as Record<string, unknown>;

    if (!meta || !meta.authenticated || meta.role !== 'seat') {
      ws.send(
        JSON.stringify({
          t: 'rejected',
          intentId,
          code: 'NOT_AUTHORIZED',
          error: 'Only authenticated seat holders may submit intents',
        })
      );
      return;
    }

    const supabaseUrl =
      (this.env as unknown as Record<string, string>).NEXT_PUBLIC_SUPABASE_URL ||
      process.env.NEXT_PUBLIC_SUPABASE_URL ||
      '';
    const anonKey =
      (this.env as unknown as Record<string, string>).NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      '';

    if (kind === 'REQUEST_ROLL') {
      // Proxy to roll-dice Edge function
      const res = await fetch(`${supabaseUrl}/functions/v1/roll-dice`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${anonKey}`,
        },
        body: JSON.stringify(payload),
      }).catch(() => null);

      if (!res) {
        ws.send(
          JSON.stringify({
            t: 'rejected',
            intentId,
            code: 'ROOM_UNAVAILABLE',
            error: 'Edge roll-dice service unavailable',
          })
        );
        return;
      }

      const data = (await res.json().catch(() => ({}))) as {
        code?: string;
        error?: string;
        state?: GameState;
        seq?: number;
      };
      if (!res.ok) {
        ws.send(
          JSON.stringify({
            t: 'rejected',
            intentId,
            code: data.code || 'ILLEGAL_ACTION',
            error: data.error || `HTTP ${res.status}`,
          })
        );
        return;
      }

      // Roll minted successfully: update local state if state provided or notify client
      if (data.state) {
        await this.applyNewState(data.state, data.seq ?? this.seq + 1);
      } else {
        // Echo back roll result to caller
        ws.send(JSON.stringify({ t: 'intent_ack', intentId, data }));
      }
      return;
    }

    if (kind === 'REQUEST_MOVE') {
      // Proxy to move-auth Edge function
      const isPass = payload.action === 'pass' || !payload.tokenIndex;
      const endpoint = isPass ? 'pass-turn' : 'submit-move';

      const res = await fetch(`${supabaseUrl}/functions/v1/move-auth/${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${anonKey}`,
        },
        body: JSON.stringify(payload),
      }).catch(() => null);

      if (!res) {
        ws.send(
          JSON.stringify({
            t: 'rejected',
            intentId,
            code: 'ROOM_UNAVAILABLE',
            error: 'Edge move-auth service unavailable',
          })
        );
        return;
      }

      const data = (await res.json().catch(() => ({}))) as {
        code?: string;
        error?: string;
        state?: GameState;
        seq?: number;
      };
      if (!res.ok) {
        ws.send(
          JSON.stringify({
            t: 'rejected',
            intentId,
            code: data.code || 'ILLEGAL_ACTION',
            error: data.error || `HTTP ${res.status}`,
            seq: this.seq,
          })
        );
        return;
      }

      if (data.state) {
        await this.applyNewState(data.state, data.seq ?? this.seq + 1);
      }
      return;
    }

    // Other intents (DICE_COMMIT, DICE_REVEAL, CMD_REQUEST_TRUST)
    ws.send(JSON.stringify({ t: 'intent_ack', intentId, ok: true }));
  }

  /**
   * Apply validated state transition, save to SQLite and broadcast to all connected sockets.
   */
  private async applyNewState(newState: GameState, newSeq: number): Promise<void> {
    this.state = newState;
    this.seq = newSeq;

    await this.ctx.storage.put('state', this.state);
    await this.ctx.storage.put('seq', this.seq);

    const deadlineAt = this.getEarliestDeadline();

    const broadcastPayload = JSON.stringify({
      t: 'state',
      seq: this.seq,
      state: this.state,
      source: 'match_states',
      deadlineAt,
    });

    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(broadcastPayload);
      } catch {
        // Socket closed
      }
    }
  }

  /**
   * Timer Min-Heap scheduler (Rev 3 — F5).
   */
  public async scheduleTimer(id: string, kind: ScheduledTimer['kind'], delayMs: number): Promise<void> {
    const deadlineAt = Date.now() + delayMs;
    this.timerHeap = this.timerHeap.filter(t => t.id !== id);
    this.timerHeap.push({ id, kind, deadlineAt });
    this.timerHeap.sort((a, b) => a.deadlineAt - b.deadlineAt);

    await this.ctx.storage.put('timerHeap', this.timerHeap);

    const nextEarliest = this.timerHeap[0]?.deadlineAt;
    if (nextEarliest) {
      await this.ctx.storage.setAlarm(nextEarliest);
    }
  }

  async alarm(): Promise<void> {
    const now = Date.now();
    const expired: ScheduledTimer[] = [];
    const remaining: ScheduledTimer[] = [];

    for (const timer of this.timerHeap) {
      if (timer.deadlineAt <= now) {
        expired.push(timer);
      } else {
        remaining.push(timer);
      }
    }

    this.timerHeap = remaining;
    await this.ctx.storage.put('timerHeap', this.timerHeap);

    for (const timer of expired) {
      const timerMsg = JSON.stringify({
        t: 'timer',
        kind: timer.kind,
        deadlineAt: timer.deadlineAt,
      });

      for (const ws of this.ctx.getWebSockets()) {
        try {
          ws.send(timerMsg);
        } catch {
          // Socket closed
        }
      }
    }

    const nextEarliest = this.timerHeap[0]?.deadlineAt;
    if (nextEarliest) {
      await this.ctx.storage.setAlarm(nextEarliest);
    }
  }

  private getEarliestDeadline(): number | null {
    return this.timerHeap[0]?.deadlineAt ?? null;
  }

  // ─── Verification helpers ──────────────────────────────────────────────────
  private async verifyTicket(ticket: string, matchId: string): Promise<{ ok: boolean; wallet?: string; role: 'seat' | 'spectator'; error?: string }> {
    const tokenHash = await hashToken(ticket);
    const db = await this.queryDatabaseSession(tokenHash, matchId);
    if (!db || db.match_id !== matchId) {
      return { ok: false, role: 'spectator', error: 'Invalid or expired match ticket' };
    }
    return {
      ok: true,
      wallet: db.wallet_address,
      role: db.scope === 'match' ? 'seat' : 'spectator',
    };
  }

  private async verifyCookie(cookieHeader: string, matchId: string): Promise<{ ok: boolean; wallet?: string; role: 'seat' | 'spectator' }> {
    const match = cookieHeader.match(/(?:__Host-ludo_session|ludo_session)=([^;]+)/);
    if (!match || !match[1]) return { ok: false, role: 'spectator' };
    return this.verifySessionToken(match[1], matchId);
  }

  private async verifySessionToken(token: string, matchId: string): Promise<{ ok: boolean; wallet?: string; role: 'seat' | 'spectator'; error?: string }> {
    const tokenHash = await hashToken(token);
    const db = await this.queryDatabaseSession(tokenHash, matchId);
    if (!db) {
      return { ok: false, role: 'spectator', error: 'Session not found' };
    }
    if (db.scope === 'match' && db.match_id === matchId) {
      return { ok: true, wallet: db.wallet_address, role: 'seat' };
    }
    if (db.scope === 'spectator' && db.match_id === matchId) {
      return { ok: true, wallet: db.wallet_address, role: 'spectator' };
    }
    if (db.scope === 'app') {
      return { ok: true, wallet: db.wallet_address, role: 'spectator' };
    }
    return { ok: false, role: 'spectator', error: 'Insufficient session scope' };
  }

  private async queryDatabaseSession(tokenHash: string, _matchId: string): Promise<{ wallet_address: string; scope: string; match_id?: string } | null> {
    const supabaseUrl =
      (this.env as unknown as Record<string, string>).NEXT_PUBLIC_SUPABASE_URL ||
      process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey =
      (this.env as unknown as Record<string, string>).SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceKey) return null;

    try {
      const url = `${supabaseUrl}/rest/v1/sessions?token_hash=eq.${tokenHash}&revoked_at=is.null&select=wallet_address,scope,match_id,expires_at`;
      const res = await fetch(url, {
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
        },
      });
      if (!res.ok) return null;
      const data = await res.json();
      if (!Array.isArray(data) || data.length === 0) return null;
      return data[0];
    } catch {
      return null;
    }
  }
}
