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

import type { GameState, BoardPlayer } from '../../lib/types';
import { hashToken } from '../../lib/sessionV2';
// Canonical initial state + the corner→position map. Both are pure (no DOM, no
// React), so they are safe in the Worker bundle — verified before importing:
// `lib/gameLogic` → `./types`, `./boardLayout`, `./constants`;
// `lib/boardLayout` → `./types`, `./progression`; `lib/progression` → nothing.
//
// The S0 seed used to hand-roll a GameState and drift from the real type: it
// invented `matchStats: { turnsTaken, captures, … }` when `MatchCaptureStats` is
// `Record<PlayerColor, { kicks, gotKicked }>`, and built `BoardPlayer` objects
// with `id/score/corner/rank/tokens`, none of which exist. Starting from the
// canonical state means the seed cannot disagree with the engine again.
import { INITIAL_GAME_STATE } from '../../lib/gameLogic';
import { CORNER_TO_POSITION, assignCornersForShape } from '../../lib/boardLayout';
import {
  getNextPlayer,
  getLegalTokenIndices,
  resolveNetworkedMove,
  resolveControllableColor,
  effectiveMoveSteps,
  checkThreeSixesForMove,
  applyPower,
  lcg32,
  activeColorsForTurns,
  type PlayerColor,
  type EngineGameState,
} from './engine';

/**
 * The context surface the room logic actually uses.
 *
 * Declared here rather than taking `DurableObjectState` so this module carries no
 * Workers-only identifier: it can be compiled and imported by the app project and
 * by a plain Node test. `DurableObjectState` is structurally assignable to this,
 * so `MatchRoom` passes its real ctx straight through.
 *
 * Only these four members are used — verified by grepping `this.ctx.` across the
 * file. `setAlarm` is optional because the code already guards it with a
 * `typeof` check, which also lets a test omit it.
 */
export interface RoomCtx {
  storage: {
    get<T = unknown>(key: string): Promise<T | undefined>;
    put<T = unknown>(key: string, value: T): Promise<void>;
    setAlarm?(scheduledTime: number): Promise<void>;
  };
  acceptWebSocket(ws: WebSocket): void;
  getWebSockets(): WebSocket[];
}

/** `WebSocketPair` is a Workers global; the test supplies its own on globalThis. */
type WebSocketPairCtor = new () => { 0: WebSocket; 1: WebSocket };
function newWebSocketPair(): { 0: WebSocket; 1: WebSocket } {
  const Ctor = (globalThis as unknown as { WebSocketPair?: WebSocketPairCtor }).WebSocketPair;
  if (!Ctor) throw new Error('WebSocketPair is not available in this runtime');
  return new Ctor();
}

/**
 * The environment the room logic needs. Deliberately narrower than the shell's
 * `Env`: the core never touches a DO binding (it reads Supabase config through
 * casts), and keeping `DurableObjectNamespace<MatchRoom>` out of here is what
 * lets this module load without `cloudflare:workers`.
 */
export interface RoomEnv {
  NEXT_PUBLIC_SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  NEXT_PUBLIC_SUPABASE_ANON_KEY?: string;
}

export type IntentKind =
  | 'REQUEST_ROLL'
  | 'REQUEST_MOVE'
  | 'REQUEST_POWER'
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
  kind: 'turn' | 'ai_turn' | 'bet_window' | 'afk_strike' | 'reconnect_grace' | 'TURN_TIMEOUT' | 'BET_TIMEOUT';
  deadlineAt: number;
}

/**
 * MatchRoomCore — all room behaviour, with no `cloudflare:workers` dependency.
 *
 * `MatchRoom` is a thin shell that extends `DurableObject` and forwards to this
 * class. The split exists so tests can construct the real room logic without the
 * Workers runtime: `cloudflare:workers` is an ESM bare specifier that neither
 * `tsx` nor plain Node can resolve, and the previous test's attempt to shim it by
 * patching `Module.prototype.require` could never work for an ESM import — which
 * is why the S3 gate failed with "MatchRoom is not a constructor" and verified
 * nothing.
 *
 * Behaviour lives here; only the runtime binding lives in `MatchRoom`.
 */
export class MatchRoomCore {
  private matchId: string = '';
  private seq: number = 0;
  private state: GameState | null = null;
  private roomVersion: number = 1;
  private timerHeap: ScheduledTimer[] = [];
  private actionQueue: Promise<void> = Promise.resolve();
  private socketMeta: Map<WebSocket, RoomSocketMeta> = new Map();
  private initialized: boolean = false;
  /** In-flight `ensureInitialized`, so concurrent callers share one run. */
  private initPromise: Promise<void> | null = null;

  constructor(
    protected readonly ctx: RoomCtx,
    protected readonly env: RoomEnv,
  ) {}

  private setSocketMeta(ws: WebSocket, meta: RoomSocketMeta): void {
    this.socketMeta.set(ws, meta);
    const hibernatable = ws as WebSocket & { serializeAttachment?: (attachment: unknown) => void };
    if (typeof hibernatable.serializeAttachment === 'function') {
      try {
        hibernatable.serializeAttachment(meta);
      } catch {
        // Non-hibernatable socket mock
      }
    }
  }

  private getSocketMeta(ws: WebSocket): RoomSocketMeta | undefined {
    const cached = this.socketMeta.get(ws);
    if (cached) return cached;
    const hibernatable = ws as WebSocket & { deserializeAttachment?: () => unknown };
    if (typeof hibernatable.deserializeAttachment === 'function') {
      try {
        const restored = hibernatable.deserializeAttachment() as RoomSocketMeta | null | undefined;
        if (restored && typeof restored === 'object') {
          this.socketMeta.set(ws, restored);
          return restored;
        }
      } catch {
        // Ignore attachment deserialization failure
      }
    }
    return undefined;
  }

  /**
   * Initialize state from SQLite storage on first activation.
   *
   * `this.initialized` is only set at the END of the async body, so two
   * concurrent callers both passed the guard and both ran the seeding path.
   * That is exactly what happens on a fresh match: the preflight
   * `GET /api/room/:id/ws` and the WebSocket upgrade arrive together, so the
   * room self-seeded TWICE — with two different `assignCornersForShape` draws,
   * because the seating rule is random. A live board's corners changed
   * mid-match, and the second seed landed at seq 1 as another `server_seeded`.
   *
   * Memoise the in-flight promise instead: the first caller runs it, everyone
   * else awaits the same one.
   */
  private async ensureInitialized(matchId?: string): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;
    this.initPromise = this.doInitialize(matchId).finally(() => {
      this.initPromise = null;
    });
    return this.initPromise;
  }

  private async doInitialize(matchId?: string): Promise<void> {
    if (matchId) {
      this.matchId = matchId;
      await this.ctx.storage.put('matchId', matchId);
    } else if (!this.matchId) {
      const storedMatchId = await this.ctx.storage.get<string>('matchId');
      if (storedMatchId) this.matchId = storedMatchId;
    }
    const effectiveMatchId = this.matchId;

    const storedSeq = await this.ctx.storage.get<number>('seq');
    const storedState = await this.ctx.storage.get<GameState>('state');
    const storedVersion = await this.ctx.storage.get<number>('roomVersion');
    const storedTimers = await this.ctx.storage.get<ScheduledTimer[]>('timerHeap');

    if (storedSeq !== undefined) this.seq = storedSeq;
    if (storedState) this.state = storedState;
    if (storedVersion !== undefined) this.roomVersion = storedVersion;
    if (storedTimers) this.timerHeap = storedTimers;

    // S0: If state not cached in DO SQLite, restore from Postgres match_states
    if (!this.state && effectiveMatchId) {
      const supabaseUrl =
        (this.env as unknown as Record<string, string>).NEXT_PUBLIC_SUPABASE_URL ||
        process.env.NEXT_PUBLIC_SUPABASE_URL;
      const serviceKey =
        (this.env as unknown as Record<string, string>).SUPABASE_SERVICE_ROLE_KEY ||
        process.env.SUPABASE_SERVICE_ROLE_KEY;

      if (!supabaseUrl || !serviceKey) {
        // Never silent. A missing URL made the room skip Postgres entirely and
        // every match then stalled with no state frame and no error anywhere.
        console.error(
          '[MatchRoom] cannot reach Postgres — missing NEXT_PUBLIC_SUPABASE_URL' +
          ' and/or SUPABASE_SERVICE_ROLE_KEY in the Worker env. Add a `vars` block to' +
          ' wrangler.jsonc (public config) and `wrangler secret put SUPABASE_SERVICE_ROLE_KEY`,' +
          ' then redeploy.',
        );
      } else {
        try {
          const res = await fetch(`${supabaseUrl}/rest/v1/match_states?match_id=eq.${effectiveMatchId}&select=seq,state`, {
            headers: {
              apikey: serviceKey,
              Authorization: `Bearer ${serviceKey}`,
            },
          });
          if (res.ok) {
            const rows = (await res.json()) as Array<{ seq: number; state: GameState }>;
            if (rows && rows.length > 0 && rows[0].state) {
              this.state = rows[0].state;
              this.seq = rows[0].seq;
              await this.ctx.storage.put('state', this.state);
              await this.ctx.storage.put('seq', this.seq);
            }
          }
        } catch (err) {
          console.warn('[MatchRoom] Failed to load match_states from Postgres:', err);
        }
      }
    }

    // S3: If still no state, seed itself from matches + match_seats
    if (!this.state && effectiveMatchId) {
      const supabaseUrl =
        (this.env as unknown as Record<string, string>).NEXT_PUBLIC_SUPABASE_URL ||
        process.env.NEXT_PUBLIC_SUPABASE_URL;
      const serviceKey =
        (this.env as unknown as Record<string, string>).SUPABASE_SERVICE_ROLE_KEY ||
        process.env.SUPABASE_SERVICE_ROLE_KEY;

      if (!supabaseUrl || !serviceKey) {
        console.error(
          '[MatchRoom] cannot self-seed — NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY' +
          ' is missing from the Worker env. The room has no seats to build a roster from, so it' +
          ' will never fan out a state frame.',
        );
      } else {
        try {
          const [matchRes, seatsRes] = await Promise.all([
            fetch(`${supabaseUrl}/rest/v1/matches?id=eq.${effectiveMatchId}&select=match_shape,game_mode`, {
              headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
            }),
            fetch(`${supabaseUrl}/rest/v1/match_seats?match_id=eq.${effectiveMatchId}&select=color,wallet_address,seat_index&order=seat_index.asc`, {
              headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
            }),
          ]);

          if (matchRes.ok && seatsRes.ok) {
            const matchRows = (await matchRes.json()) as Array<{ match_shape: string; game_mode: string }>;
            const seatsRows = (await seatsRes.json()) as Array<{ color: string; wallet_address: string; seat_index: number }>;

            if (matchRows.length > 0 && seatsRows.length > 0) {
              const matchShape = (matchRows[0].match_shape || '4P') as '1v1' | '2v2' | '4P';
              // Seating comes from the shared rule, never a local map. This used
              // to hard-code `green:'BL', yellow:'BR'`, which seats a 1v1 pair on
              // ADJACENT corners — the opposite of the engine's documented "one
              // diagonal" — and ignored `match_shape` entirely, so 2v2 and 4P got
              // the same fixed layout.
              const defaultCorners = assignCornersForShape(matchShape);

              // `BoardPlayer` is { name, level, avatar, color, position, isAi?,
              // walletAddress? } — see lib/types.ts. The previous version invented
              // id/score/corner/rank/tokens and omitted level/avatar/position.
              const boardPlayers: BoardPlayer[] = seatsRows.map((s) => {
                const color = s.color as PlayerColor;
                const corner = defaultCorners[color] || 'BL';
                return {
                  name: s.wallet_address ? `Player ${s.wallet_address.slice(0, 6)}` : `Player ${color}`,
                  level: 1,
                  avatar: '',
                  color,
                  position: CORNER_TO_POSITION[corner],
                  isAi: false,
                  walletAddress: s.wallet_address,
                };
              });

              // Built from the canonical initial state rather than hand-rolled, so
              // every field the engine expects is present with the right shape.
              const seededState: GameState = {
                ...INITIAL_GAME_STATE,
                matchId: effectiveMatchId,
                playerCount: matchShape,
                currentPlayer: (seatsRows[0]?.color as PlayerColor) || 'green',
                status: 'playing',
                isStarted: true,
                isBotMatch: false,
                lastUpdate: Date.now(),
                initialBoardConfig: {
                  players: boardPlayers,
                  colorCorner: defaultCorners,
                },
              };

              this.state = seededState;
              this.seq = 0;
              await this.ctx.storage.put('state', this.state);
              await this.ctx.storage.put('seq', this.seq);
              // commitToPostgres(state, expectedSeq, eventType, eventPayload) —
              // the seed is the first event, so it carries an empty payload.
              await this.commitToPostgres(this.state, 0, 'server_seeded', {});
            }
          }
        } catch (err) {
          console.warn('[MatchRoom] Failed to self-seed from match_seats:', err);
        }
      }
    }

    if (this.state && !this.state.winner && this.timerHeap.length === 0 && effectiveMatchId) {
      const curColor = this.state.currentPlayer as PlayerColor;
      const kind = this.isBotOrAutoPlaying(curColor) ? 'ai_turn' : 'turn';
      const delay = kind === 'ai_turn' ? 1000 : 15000;
      await this.scheduleTimer(effectiveMatchId, kind, delay);
    }

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
      let initialColor: string | undefined;
      let authenticated = false;

      if (ticket) {
        // Validate ticket against database sessions
        const verified = await this.verifyTicket(ticket, matchId);
        if (verified.ok) {
          initialWallet = verified.wallet;
          initialRole = verified.role;
          initialColor = verified.color;
          authenticated = true;
        }
      } else if (cookieHeader) {
        const verified = await this.verifyCookie(cookieHeader, matchId);
        if (verified.ok) {
          initialWallet = verified.wallet;
          initialRole = verified.role;
          initialColor = verified.color;
          authenticated = true;
        }
      }

      const pair = newWebSocketPair();
      const [client, server] = Object.values(pair);

      this.ctx.acceptWebSocket(server);

      this.setSocketMeta(server, {
        authenticated,
        wallet: initialWallet,
        role: initialRole,
        color: initialColor,
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

      try {
        return new Response(null, { status: 101, webSocket: client } as ResponseInit & { webSocket?: unknown });
      } catch {
        return new Response(null, { status: 200, webSocket: client } as ResponseInit & { webSocket?: unknown });
      }
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
    await this.ensureInitialized();
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

    // Seed frame (host, first activation only).
    // A fresh Durable Object has no board — `ensureInitialized` reads SQLite, which
    // is empty for a new match, so every intent would hit ROOM_NOT_READY. The host
    // writes the seed it already owns. Accepted only when the room holds nothing, so
    // a reconnecting host cannot rewrite a live match, and only from an
    // authenticated seat, so a spectator cannot inject a board.
    if (t === 'seed') {
      const meta = this.getSocketMeta(ws);
      if (!meta?.authenticated || meta.role !== 'seat') {
        ws.send(JSON.stringify({ t: 'rejected', code: 'NOT_AUTHORIZED', error: 'Only authenticated seats may seed a room' }));
        return;
      }
      if (this.state) {
        ws.send(JSON.stringify({ t: 'seed_ack', ok: true, deduped: true, seq: this.seq }));
        return;
      }
      const seeded = frame.payload as GameState | undefined;
      if (!seeded || typeof seeded !== 'object') {
        ws.send(JSON.stringify({ t: 'rejected', code: 'MALFORMED_FRAME', error: 'Seed payload missing' }));
        return;
      }
      this.state = seeded;
      this.seq = 0;
      await this.ctx.storage.put('state', this.state);
      await this.ctx.storage.put('seq', this.seq);

      // S0: Commit initial seed directly to Postgres match_states via match_commit_action
      await this.commitToPostgres(this.state, 0, 'match_seeded', {
        seq: 0,
        currentPlayer: this.state.currentPlayer,
        winner: this.state.winner,
      });

      if (!this.state.winner && this.matchId) {
        const curColor = this.state.currentPlayer as PlayerColor;
        const kind = this.isBotOrAutoPlaying(curColor) ? 'ai_turn' : 'turn';
        const delay = kind === 'ai_turn' ? 1000 : 15000;
        await this.scheduleTimer(this.matchId, kind, delay);
      }

      const seedBroadcast = JSON.stringify({
        t: 'state',
        seq: this.seq,
        state: this.state,
        source: 'room_seed',
        deadlineAt: this.getEarliestDeadline(),
      });
      for (const sock of this.ctx.getWebSockets()) {
        try {
          sock.send(seedBroadcast);
        } catch {
          // Socket closed mid-fanout.
        }
      }
      ws.send(JSON.stringify({ t: 'seed_ack', ok: true, seq: this.seq }));
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
      await this.actionQueue;
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
   * Handle in-band join frame carrying credential token/ticket and optional lastSeq.
   */
  private async handleJoinFrame(ws: WebSocket, frame: Record<string, unknown>): Promise<void> {
    const token =
      typeof frame.token === 'string'
        ? frame.token
        : typeof frame.ticket === 'string'
          ? frame.ticket
          : undefined;
    const asRole = frame.as === 'seat' ? 'seat' : 'spectator';
    const lastSeq = typeof frame.lastSeq === 'number' ? frame.lastSeq : undefined;

    let meta = this.getSocketMeta(ws);
    if (!meta) {
      meta = { authenticated: false, role: asRole, connectedAt: Date.now() };
      this.setSocketMeta(ws, meta);
    }

    if (!meta.authenticated && token) {
      const verified = await this.verifySessionToken(token, this.matchId);
      if (verified.ok) {
        meta.authenticated = true;
        meta.wallet = verified.wallet;
        meta.role = verified.role;
        meta.color = verified.color;
        this.setSocketMeta(ws, meta);
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

    // Acknowledge the join.
    //
    // `RoomClient` has exactly one transition into 'connected' — a `t: 'joined'`
    // frame — and everything downstream hangs off it: the host writing its seed,
    // `roomAuthority` engaging, `roomStatus` leaving 'connecting'. This handler
    // used to answer with `state` (or `rejected`) only, so a perfectly healthy
    // room left every client parked at 'connecting' forever. That is the whole
    // of "Still linking both players…".
    //
    // Sent before the catch-up frame so the client is marked connected before it
    // processes the board, and deliberately WITHOUT `state` — the frame below
    // carries it, and the client's own `knownSeq` gate dedupes regardless.
    ws.send(
      JSON.stringify({
        t: 'joined',
        role: meta.role,
        seat: meta.color ?? null,
        wallet: meta.wallet ?? null,
        seq: this.seq,
        hasState: !!this.state,
      })
    );

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
    const meta = this.getSocketMeta(ws);
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
      // In-process roll execution (P4)
      if (this.state && !this.state.winner) {
        const curColor = this.state.currentPlayer as PlayerColor;
        if (meta.role === 'seat' && (!meta.color || meta.color !== curColor)) {
          ws.send(
            JSON.stringify({
              t: 'rejected',
              intentId,
              code: 'NOT_YOUR_TURN',
              error: 'Not your turn to roll',
            })
          );
          return;
        }

        const rand = new Uint8Array(1);
        crypto.getRandomValues(rand);
        const rollValue = (rand[0] % 6) + 1;

        const cc = this.state.initialBoardConfig?.colorCorner || {
          green: 'BL',
          yellow: 'BR',
          blue: 'TR',
          red: 'TL',
        };

        // SV-03B: Check third consecutive six at roll time and auto-pass turn
        const sixes = checkThreeSixesForMove(
          this.state as unknown as EngineGameState,
          rollValue
        );
        if (sixes.forbidden) {
          const nextPlayer = getNextPlayer(curColor, this.state.playerCount, this.getActiveColors(), cc);
          const nextState: GameState = {
            ...this.state,
            diceValue: null,
            currentPlayer: nextPlayer,
            isRolling: false,
            gamePhase: 'rolling',
            consecutiveSixes: 0,
            activeBoost: null,
            powerSpentThisTurn: false,
            captureMessage: 'Three 6s! Turn forfeited.',
            lastUpdate: Date.now(),
          };
          await this.applyNewState(nextState, this.seq + 1, 'turn_passed');
          ws.send(JSON.stringify({ t: 'intent_ack', intentId, data: { state: nextState, seq: this.seq } }));
          return;
        }

        const nextStrikes = { ...this.state.strikes, [curColor]: 0 };
        const nextAfk = { ...this.state.afkStats };
        if (nextAfk[curColor]) {
          nextAfk[curColor] = {
            ...nextAfk[curColor],
            consecutiveTurns: 0,
            isAutoPlaying: false,
          };
        }

        // SV-03C + SV-04: Resolve controllable color (2v2 teammate assist) and effective steps (boost +6)
        const targetColor = resolveControllableColor(this.state.positions, curColor, this.state.playerCount);
        const steps = effectiveMoveSteps(
          this.state as unknown as EngineGameState,
          curColor,
          rollValue
        );

        const legalMoves = getLegalTokenIndices(
          this.state.positions,
          targetColor,
          steps,
          cc
        );

        // SV-03A: Auto-pass whenever there are zero legal moves, even on a 6
        if (legalMoves.length === 0) {
          const nextPlayer = getNextPlayer(curColor, this.state.playerCount, this.getActiveColors(), cc);
          const nextState: GameState = {
            ...this.state,
            diceValue: null,
            currentPlayer: nextPlayer,
            isRolling: false,
            gamePhase: 'rolling',
            consecutiveSixes: 0,
            activeBoost: null,
            powerSpentThisTurn: false,
            strikes: nextStrikes,
            afkStats: nextAfk,
            lastUpdate: Date.now(),
          };
          await this.applyNewState(nextState, this.seq + 1, 'turn_passed');
          ws.send(JSON.stringify({ t: 'intent_ack', intentId, data: { state: nextState, seq: this.seq } }));
          return;
        }

        const nextState: GameState = {
          ...this.state,
          diceValue: rollValue,
          isRolling: false,
          gamePhase: 'moving',
          strikes: nextStrikes,
          afkStats: nextAfk,
          lastUpdate: Date.now(),
        };

        await this.applyNewState(nextState, this.seq + 1, 'roll_minted');
        ws.send(JSON.stringify({ t: 'intent_ack', intentId, data: { state: nextState, seq: this.seq } }));
        return;
      }

      // Proxy fallback to roll-dice Edge function
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

      if (data.state) {
        await this.applyNewState(data.state, data.seq ?? this.seq + 1, 'roll_minted');
      } else {
        ws.send(JSON.stringify({ t: 'intent_ack', intentId, data }));
      }
      return;
    }

    if (kind === 'REQUEST_MOVE') {
      // In-process move execution (P4)
      if (this.state && !this.state.winner) {
        const curColor = this.state.currentPlayer as PlayerColor;
        if (meta.role === 'seat' && (!meta.color || meta.color !== curColor)) {
          ws.send(
            JSON.stringify({
              t: 'rejected',
              intentId,
              code: 'NOT_YOUR_TURN',
              error: 'Not your turn to move',
            })
          );
          return;
        }

        const cc = this.state.initialBoardConfig?.colorCorner || {
          green: 'BL',
          yellow: 'BR',
          blue: 'TR',
          red: 'TL',
        };

        if (payload.action === 'pass') {
          const nextPlayer = getNextPlayer(curColor, this.state.playerCount, this.getActiveColors(), cc);
          const nextState: GameState = {
            ...this.state,
            currentPlayer: nextPlayer,
            diceValue: null,
            isRolling: false,
            gamePhase: 'rolling',
            consecutiveSixes: 0,
            activeBoost: null,
            powerSpentThisTurn: false,
            lastUpdate: Date.now(),
          };
          await this.applyNewState(nextState, this.seq + 1, 'turn_passed');
          ws.send(JSON.stringify({ t: 'intent_ack', intentId, data: { state: nextState, seq: this.seq } }));
          return;
        }

        const tokenIndex = typeof payload.tokenIndex === 'number' ? payload.tokenIndex : 0;
        const diceVal = typeof this.state.diceValue === 'number' ? this.state.diceValue : 0;

        // SA-1/TU-4: this used `processMove`, which owns capture, traps and victory
        // but NOT boost consumption, the three-sixes counter, or power pickup — those
        // live in `resolveNetworkedMove`. A room-authoritative match therefore played
        // classic rules under a power label. One call now, same as the client path.
        const resolved = resolveNetworkedMove({
          state: this.state as unknown as import('./engine').EngineGameState,
          color: curColor,
          tokenIndex,
          dice: diceVal,
          cc,
          playerCount: this.state.playerCount,
          activeColors: this.getActiveColors(),
          now: Date.now(),
        });

        if (!resolved.ok || !resolved.state) {
          ws.send(
            JSON.stringify({
              t: 'rejected',
              intentId,
              code: resolved.code || 'ILLEGAL_MOVE',
              error: resolved.error || 'Token move is illegal',
            })
          );
          return;
        }

        const nextStrikes = { ...this.state.strikes, [curColor]: 0 };
        const nextAfk = { ...this.state.afkStats };
        if (nextAfk[curColor]) {
          nextAfk[curColor] = {
            ...nextAfk[curColor],
            consecutiveTurns: 0,
            isAutoPlaying: false,
          };
        }

        let nextState: GameState = {
          ...(resolved.state as unknown as GameState),
          strikes: nextStrikes,
          afkStats: nextAfk,
        };

        // A bonus roll (six, capture, or a power that ended the turn) keeps the mover
        // on turn. `processMove` has already advanced `currentPlayer`, so restore it.
        if (resolved.bonusRoll && !nextState.winner) {
          nextState = {
            ...nextState,
            currentPlayer: curColor,
            diceValue: null,
            isRolling: false,
            gamePhase: 'rolling',
          };
        }

        await this.applyNewState(nextState, this.seq + 1, 'move_committed');
        ws.send(JSON.stringify({ t: 'intent_ack', intentId, data: { state: nextState, seq: this.seq } }));
        return;
      }

      // Proxy fallback to move-auth Edge function
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
        await this.applyNewState(data.state, data.seq ?? this.seq + 1, 'move_committed');
      }
      return;
    }

    if (kind === 'REQUEST_POWER') {
      // PW-3: a power is spent against the ROOM's inventory, never the caller's.
      // `applyPower` re-checks turn, phase, the once-per-turn budget and ownership,
      // so a forged intent can name a power it does not hold and be refused.
      if (this.state && !this.state.winner) {
        const curColor = this.state.currentPlayer as PlayerColor;
        if (meta.role === 'seat' && (!meta.color || meta.color !== curColor)) {
          ws.send(
            JSON.stringify({
              t: 'rejected',
              intentId,
              code: 'NOT_YOUR_TURN',
              error: 'Not your turn to use a power',
            })
          );
          return;
        }

        const cc = this.state.initialBoardConfig?.colorCorner || {
          green: 'BL',
          yellow: 'BR',
          blue: 'TR',
          red: 'TL',
        };
        const powerType = typeof payload.power === 'string' ? payload.power : '';
        const tokenIndex = typeof payload.tokenIndex === 'number' ? payload.tokenIndex : undefined;

        const result = applyPower(
          this.state as unknown as import('./engine').EngineGameState,
          curColor,
          powerType as Parameters<typeof applyPower>[2],
          tokenIndex,
          cc,
          this.state.playerCount,
          Date.now()
        );

        if (!result.ok) {
          ws.send(
            JSON.stringify({
              t: 'rejected',
              intentId,
              code: result.armed ? 'POWER_ARMED' : 'POWER_REFUSED',
              error: result.error,
              seq: this.seq,
            })
          );
          return;
        }

        await this.applyNewState(result.state as unknown as GameState, this.seq + 1, 'power_committed');
        ws.send(JSON.stringify({ t: 'intent_ack', intentId, data: { state: result.state, seq: this.seq } }));

        if ((result.state as unknown as GameState).winner) {
          this.timerHeap = [];
          await this.ctx.storage.put('timerHeap', this.timerHeap);
        }
        return;
      }

      ws.send(
        JSON.stringify({
          t: 'rejected',
          intentId,
          code: 'ROOM_NOT_READY',
          error: 'No live match state in this room',
        })
      );
      return;
    }

    if (kind === 'CMD_REQUEST_TRUST') {
      if (this.state && meta.color) {
        const seatColor = meta.color as PlayerColor;
        const nextStrikes = { ...this.state.strikes, [seatColor]: 0 };
        const nextAfk = { ...this.state.afkStats };
        if (nextAfk[seatColor]) {
          nextAfk[seatColor] = {
            ...nextAfk[seatColor],
            isAutoPlaying: false,
            consecutiveTurns: 0,
          };
        }
        const nextState: GameState = {
          ...this.state,
          strikes: nextStrikes,
          afkStats: nextAfk,
          lastUpdate: Date.now(),
        };
        await this.applyNewState(nextState, this.seq + 1, 'trust_restored');
        ws.send(JSON.stringify({ t: 'intent_ack', intentId, ok: true, data: { state: nextState, seq: this.seq } }));
        return;
      }
      ws.send(JSON.stringify({ t: 'intent_ack', intentId, ok: true }));
      return;
    }

    // Other intents (DICE_COMMIT, DICE_REVEAL)
    ws.send(JSON.stringify({ t: 'intent_ack', intentId, ok: true }));
  }

  /**
   * Commit state transition to Postgres match_states atomically via match_commit_action RPC.
   */
  private async commitToPostgres(
    state: GameState,
    expectedSeq: number,
    eventType: string,
    eventPayload: Record<string, unknown>
  ): Promise<void> {
    const supabaseUrl =
      (this.env as unknown as Record<string, string>).NEXT_PUBLIC_SUPABASE_URL ||
      process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey =
      (this.env as unknown as Record<string, string>).SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceKey) {
      // Same silent-skip as the two seeding sites: the commit would vanish with
      // no trace, which is how a match could look live while nothing persisted.
      console.error(
        '[MatchRoom] cannot commit to Postgres — NEXT_PUBLIC_SUPABASE_URL or' +
        ' SUPABASE_SERVICE_ROLE_KEY is missing from the Worker env.',
      );
      return;
    }

    try {
      await fetch(`${supabaseUrl}/rest/v1/rpc/match_commit_action`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: serviceKey,
            Authorization: `Bearer ${serviceKey}`,
          },
          body: JSON.stringify({
            p_match_id: this.matchId,
            p_expected_seq: expectedSeq,
            p_new_state: state,
            p_event_type: eventType,
            p_event_payload: eventPayload,
          }),
        });
      } catch (e) {
        console.warn('[MatchRoom] match_commit_action warning:', e);
      }
  }

  /**
   * Apply validated state transition, save to SQLite and broadcast to all connected sockets.
   * Atomically calls match_commit_action RPC on Postgres to record state and room events.
   */
  private async applyNewState(newState: GameState, newSeq: number, eventType: string = 'move_committed'): Promise<void> {
    this.state = newState;
    this.seq = newSeq;

    await this.ctx.storage.put('state', this.state);
    await this.ctx.storage.put('seq', this.seq);

    await this.commitToPostgres(newState, newSeq - 1, eventType, {
      seq: newSeq,
      currentPlayer: newState.currentPlayer,
      winner: newState.winner,
    });

    if (newState.winner) {
      this.timerHeap = [];
      await this.ctx.storage.put('timerHeap', this.timerHeap);
    } else {
      const curColor = newState.currentPlayer as PlayerColor;
      if (this.isBotOrAutoPlaying(curColor)) {
        await this.scheduleTimer(this.matchId, 'ai_turn', 1000);
      } else {
        await this.scheduleTimer(this.matchId, 'turn', 15000);
      }
    }

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

  private getActiveColors(): PlayerColor[] {
    return this.state ? activeColorsForTurns(this.state as unknown as EngineGameState) : [];
  }

  private isBotOrAutoPlaying(color: PlayerColor): boolean {
    if (!this.state) return false;
    const player = this.state.initialBoardConfig?.players?.find(p => p.color === color);
    if (player?.isAi) return true;
    const afk = this.state.afkStats?.[color];
    return Boolean(afk?.isAutoPlaying || afk?.isKicked);
  }

  private async executeServerBotTurn(color: PlayerColor): Promise<void> {
    if (!this.state || this.state.winner || this.state.currentPlayer !== color) return;

    let seed = 0;
    for (let i = 0; i < this.matchId.length; i++) {
      seed = (seed * 31 + this.matchId.charCodeAt(i)) >>> 0;
    }
    seed = (seed + this.seq * 1013904223) >>> 0;
    const rng = lcg32(seed);
    const rollValue = Math.floor(rng() * 6) + 1;

    const cc = this.state.initialBoardConfig?.colorCorner || {
      green: 'BL',
      yellow: 'BR',
      blue: 'TR',
      red: 'TL',
    };

    const sixes = checkThreeSixesForMove(
      this.state as unknown as EngineGameState,
      rollValue
    );
    if (sixes.forbidden) {
      const nextPlayer = getNextPlayer(color, this.state.playerCount, this.getActiveColors(), cc);
      const nextState: GameState = {
        ...this.state,
        diceValue: null,
        currentPlayer: nextPlayer,
        isRolling: false,
        gamePhase: 'rolling',
        consecutiveSixes: 0,
        activeBoost: null,
        powerSpentThisTurn: false,
        captureMessage: 'Three 6s! Turn forfeited.',
        lastUpdate: Date.now(),
      };
      await this.applyNewState(nextState, this.seq + 1, 'turn_passed');
      return;
    }

    const targetColor = resolveControllableColor(this.state.positions, color, this.state.playerCount);
    const steps = effectiveMoveSteps(
      this.state as unknown as EngineGameState,
      color,
      rollValue
    );

    const legalMoves = getLegalTokenIndices(
      this.state.positions,
      targetColor,
      steps,
      cc
    );

    if (legalMoves.length === 0) {
      const nextPlayer = getNextPlayer(color, this.state.playerCount, this.getActiveColors(), cc);
      const nextState: GameState = {
        ...this.state,
        diceValue: null,
        currentPlayer: nextPlayer,
        isRolling: false,
        gamePhase: 'rolling',
        consecutiveSixes: 0,
        activeBoost: null,
        powerSpentThisTurn: false,
        lastUpdate: Date.now(),
      };
      await this.applyNewState(nextState, this.seq + 1, 'turn_passed');
      return;
    }

    let chosenToken = legalMoves[0];
    for (const tIdx of legalMoves) {
      const pos = this.state.positions[targetColor][tIdx];
      if (pos === -1 && steps === 6) {
        chosenToken = tIdx;
        break;
      }
      if (pos > this.state.positions[targetColor][chosenToken]) {
        chosenToken = tIdx;
      }
    }

    const resolved = resolveNetworkedMove({
      state: this.state as unknown as import('./engine').EngineGameState,
      color,
      tokenIndex: chosenToken,
      dice: rollValue,
      cc,
      playerCount: this.state.playerCount,
      activeColors: this.getActiveColors(),
      now: Date.now(),
    });

    if (resolved.ok && resolved.state) {
      let nextState = resolved.state as unknown as GameState;
      if (resolved.bonusRoll && !nextState.winner) {
        nextState = {
          ...nextState,
          currentPlayer: color,
          diceValue: null,
          isRolling: false,
          gamePhase: 'rolling',
        };
      }
      await this.applyNewState(nextState, this.seq + 1, 'move_committed');
    } else {
      const nextPlayer = getNextPlayer(color, this.state.playerCount, this.getActiveColors(), cc);
      const nextState: GameState = {
        ...this.state,
        diceValue: null,
        currentPlayer: nextPlayer,
        isRolling: false,
        gamePhase: 'rolling',
        consecutiveSixes: 0,
        activeBoost: null,
        powerSpentThisTurn: false,
        lastUpdate: Date.now(),
      };
      await this.applyNewState(nextState, this.seq + 1, 'turn_passed');
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
    if (nextEarliest && typeof this.ctx.storage.setAlarm === 'function') {
      await this.ctx.storage.setAlarm(nextEarliest);
    }
  }

  async alarm(): Promise<void> {
    await this.ensureInitialized();
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
      if (timer.kind === 'ai_turn' && this.state && !this.state.winner) {
        const cur = this.state.currentPlayer as PlayerColor;
        if (this.isBotOrAutoPlaying(cur)) {
          await this.executeServerBotTurn(cur);
        }
      }

      if ((timer.kind === 'turn' || timer.kind === 'TURN_TIMEOUT') && this.state && !this.state.winner) {
        const cur = this.state.currentPlayer as PlayerColor;
        const strikes = { ...this.state.strikes };
        const afk = { ...this.state.afkStats };
        strikes[cur] = (strikes[cur] || 0) + 1;
        if (afk[cur]) {
          afk[cur] = {
            ...afk[cur],
            consecutiveTurns: (afk[cur].consecutiveTurns || 0) + 1,
            totalTriggers: (afk[cur].totalTriggers || 0) + 1,
            isAutoPlaying: strikes[cur] >= 3 ? true : afk[cur].isAutoPlaying,
          };
        }
        const cc = this.state.initialBoardConfig?.colorCorner;
        const nextPlayer = getNextPlayer(cur, this.state.playerCount, this.getActiveColors(), cc);
        const nextState: GameState = {
          ...this.state,
          currentPlayer: nextPlayer,
          diceValue: null,
          isRolling: false,
          gamePhase: 'rolling',
          consecutiveSixes: 0,
          activeBoost: null,
          powerSpentThisTurn: false,
          strikes,
          afkStats: afk,
          lastUpdate: Date.now(),
        };
        await this.applyNewState(nextState, this.seq + 1, 'turn_timeout');
      }

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
    if (nextEarliest && typeof this.ctx.storage.setAlarm === 'function') {
      await this.ctx.storage.setAlarm(nextEarliest);
    }
  }

  private getEarliestDeadline(): number | null {
    return this.timerHeap[0]?.deadlineAt ?? null;
  }

  // ─── Verification helpers ──────────────────────────────────────────────────
  private async verifyTicket(ticket: string, matchId: string): Promise<{ ok: boolean; wallet?: string; role: 'seat' | 'spectator'; color?: string; error?: string }> {
    const tokenHash = await hashToken(ticket);
    const db = await this.queryDatabaseSession(tokenHash, matchId);
    if (!db || db.match_id !== matchId) {
      return { ok: false, role: 'spectator', error: 'Invalid or expired match ticket' };
    }
    return {
      ok: true,
      wallet: db.wallet_address,
      role: db.scope === 'match' ? 'seat' : 'spectator',
      color: db.seat_color || undefined,
    };
  }

  private async verifyCookie(cookieHeader: string, matchId: string): Promise<{ ok: boolean; wallet?: string; role: 'seat' | 'spectator'; color?: string }> {
    const match = cookieHeader.match(/(?:__Host-ludo_session|ludo_session)=([^;]+)/);
    if (!match || !match[1]) return { ok: false, role: 'spectator' };
    return this.verifySessionToken(match[1], matchId);
  }

  private async verifySessionToken(token: string, matchId: string): Promise<{ ok: boolean; wallet?: string; role: 'seat' | 'spectator'; color?: string; error?: string }> {
    const tokenHash = await hashToken(token);
    const db = await this.queryDatabaseSession(tokenHash, matchId);
    if (!db) {
      return { ok: false, role: 'spectator', error: 'Session not found' };
    }
    if (db.scope === 'match' && db.match_id === matchId) {
      return { ok: true, wallet: db.wallet_address, role: 'seat', color: db.seat_color || undefined };
    }
    if (db.scope === 'spectator' && db.match_id === matchId) {
      return { ok: true, wallet: db.wallet_address, role: 'spectator' };
    }
    if (db.scope === 'app') {
      return { ok: true, wallet: db.wallet_address, role: 'spectator' };
    }
    return { ok: false, role: 'spectator', error: 'Insufficient session scope' };
  }

  private async queryDatabaseSession(tokenHash: string, _matchId: string): Promise<{ wallet_address: string; scope: string; match_id?: string; seat_color?: string | null } | null> {
    const supabaseUrl =
      (this.env as unknown as Record<string, string>).NEXT_PUBLIC_SUPABASE_URL ||
      process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey =
      (this.env as unknown as Record<string, string>).SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceKey) return null;

    try {
      const url = `${supabaseUrl}/rest/v1/sessions?token_hash=eq.${tokenHash}&revoked_at=is.null&select=wallet_address,scope,match_id,expires_at,seat_color`;
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
