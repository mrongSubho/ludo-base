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

import type { GameState, BoardPlayer, PowerType } from '../../lib/types';
import type { RoomErrorCode } from '../../lib/roomCodes';
import {
  ROOM_PROTOCOL_VERSION,
  MAX_ROOM_FRAME_BYTES,
  ROOM_INTENT_RATE_LIMIT,
  isSupportedProtocolVersion,
  formatRoomInstance,
  utf8ByteLength,
} from '../../lib/roomProtocol';
import { hashToken } from '../../lib/sessionV2';
import { filterProfanity } from '../../lib/profanity';
import {
  buildMoveEvents,
  buildPowerTriggerEvents,
  buildRollEvents,
  computeStatePatch,
  sanitizeDeltaForWire,
  type MatchEvent,
} from '../../lib/matchEvents';
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
import { BOT_TEMPLATES, CORNER_TO_POSITION, assignCornersForShape } from '../../lib/boardLayout';
import { BASE_INDEX, POWER_TILES_COUNT, TURN_TIMERS, MAX_AFK_STRIKES } from '../../lib/constants';
import { getBestMove, getBestPowerUsage } from '../../lib/aiEngine';
import {
  getNextPlayer,
  getLegalTokenIndices,
  resolveNetworkedMove,
  resolveRollWithBoost,
  resolveControllableColor,
  clearShieldsOnTurnChange,
  applyPower,
  lcg32,
  rollUnbiasedDie,
  spawnReplacementTile,
  stripPowerTypesForWire,
  activeColorsForTurns,
  createInitialPositions,
  type PlayerColor,
  type EngineGameState,
  type EngineGameMode,
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
  id?: { toString(): string };
  storage: {
    get<T = unknown>(key: string): Promise<T | undefined>;
    put<T = unknown>(key: string, value: T): Promise<void>;
    setAlarm?(scheduledTime: number): Promise<void>;
    deleteAlarm?(): Promise<void>;
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
  initialStateSentSeq?: number;
  supportsDelta?: boolean;
}

export interface ScheduledTimer {
  id: string;
  kind: 'turn' | 'ai_turn' | 'bet_window' | 'afk_strike' | 'reconnect_grace' | 'TURN_TIMEOUT' | 'BET_TIMEOUT' | 'dead_match';
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
  private intentWindows: Map<WebSocket, number[]> = new Map();
  private socialWindows: Map<WebSocket, number[]> = new Map();
  private socialCooldowns: Map<WebSocket, number> = new Map();
  private readonly bootId: string = crypto.randomUUID().replace(/-/g, '').slice(0, 8);
  private initialized: boolean = false;
  /** In-flight `ensureInitialized`, so concurrent callers share one run. */
  private initPromise: Promise<void> | null = null;

  constructor(
    protected readonly ctx: RoomCtx,
    protected readonly env: RoomEnv,
  ) {}

  public getRoomInstance(): string {
    return formatRoomInstance(this.ctx.id?.toString(), this.bootId);
  }

  private sendFrame(ws: WebSocket, payload: Record<string, unknown>): void {
    ws.send(
      JSON.stringify({
        v: ROOM_PROTOCOL_VERSION,
        roomInstance: this.getRoomInstance(),
        serverNow: Date.now(),
        ...payload,
      })
    );
  }

  private sendRejected(
    ws: WebSocket,
    code: RoomErrorCode,
    error: string,
    opts?: { intentId?: string; seq?: number },
  ): void {
    this.sendFrame(ws, {
      t: 'rejected',
      code,
      error,
      ...(opts?.intentId ? { intentId: opts.intentId } : {}),
      ...(opts?.seq !== undefined ? { seq: opts.seq } : {}),
    });
  }

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

  private sanitizeForSocket(state: GameState, ws: WebSocket): GameState {
    const meta = this.getSocketMeta(ws);
    const viewerColor = meta?.role === 'seat' ? meta.color : undefined;
    return stripPowerTypesForWire(state, viewerColor);
  }

  private turnTimerId(matchId: string): string {
    return `${matchId}:turn`;
  }

  private deadMatchTimerId(matchId: string): string {
    return `${matchId}:dead_match`;
  }

  private isFinishedState(state: GameState | null): boolean {
    return Boolean(state && (Boolean(state.winner) || Boolean(state.abortReason)));
  }

  private isOriginalAiSeat(color: PlayerColor): boolean {
    if (!this.state) return false;
    const player = this.state.initialBoardConfig?.players?.find((p) => p.color === color);
    return Boolean(player?.isAi);
  }

  private countConnectedSeats(excludeWs?: WebSocket): number {
    let count = 0;
    for (const sock of this.ctx.getWebSockets()) {
      if (excludeWs && sock === excludeWs) continue;
      if (typeof sock.readyState === 'number' && sock.readyState !== 1) continue;
      const meta = this.getSocketMeta(sock);
      if (meta?.authenticated && meta.role === 'seat') {
        count += 1;
      }
    }
    return count;
  }

  private async syncAlarmToHeap(): Promise<void> {
    const nextEarliest = this.timerHeap[0]?.deadlineAt;
    if (nextEarliest && typeof this.ctx.storage.setAlarm === 'function') {
      await this.ctx.storage.setAlarm(nextEarliest);
    } else if (!nextEarliest && typeof this.ctx.storage.deleteAlarm === 'function') {
      await this.ctx.storage.deleteAlarm();
    }
  }

  private async cancelTimer(id: string): Promise<void> {
    const before = this.timerHeap.length;
    this.timerHeap = this.timerHeap.filter((t) => t.id !== id);
    if (this.timerHeap.length !== before) {
      await this.ctx.storage.put('timerHeap', this.timerHeap);
      await this.syncAlarmToHeap();
    }
  }

  private async clearAllTimers(): Promise<void> {
    this.timerHeap = [];
    await this.ctx.storage.put('timerHeap', this.timerHeap);
    if (typeof this.ctx.storage.deleteAlarm === 'function') {
      await this.ctx.storage.deleteAlarm();
    }
  }

  private getTurnDeadline(): number | null {
    return this.timerHeap.find((t) => t.kind !== 'dead_match')?.deadlineAt ?? null;
  }

  private async scheduleTurnTimerForState(matchId: string): Promise<void> {
    if (!this.state || this.isFinishedState(this.state) || !matchId) return;
    const curColor = this.state.currentPlayer as PlayerColor;
    const isAiTurn = this.isBotOrAutoPlaying(curColor);
    const kind: ScheduledTimer['kind'] = isAiTurn ? 'ai_turn' : 'turn';
    const phaseKind: 'cast' | 'move' | 'ai_turn' = isAiTurn
      ? 'ai_turn'
      : this.state.gamePhase === 'moving' && typeof this.state.diceValue === 'number'
        ? 'move'
        : 'cast';
    const delayMs =
      phaseKind === 'ai_turn'
        ? TURN_TIMERS.aiStepMs
        : phaseKind === 'move'
          ? TURN_TIMERS.moveMs
          : TURN_TIMERS.castMs;

    await this.scheduleTimer(this.turnTimerId(matchId), kind, delayMs);
    this.state.deadlineAt = this.getTurnDeadline();
    this.state.turnDurationMs = delayMs;
    this.state.turnPhaseKind = phaseKind;
  }

  private async invokeVaultRefund(): Promise<void> {
    if (!this.matchId) return;
    const supabaseUrl =
      (this.env as unknown as Record<string, string>).NEXT_PUBLIC_SUPABASE_URL ||
      process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey =
      (this.env as unknown as Record<string, string>).SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceKey) return;

    try {
      const res = await fetch(`${supabaseUrl}/rest/v1/rpc/arena_vault_refund_match`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
        },
        body: JSON.stringify({ p_match_id: this.matchId }),
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        console.warn('[MatchRoom] arena_vault_refund_match HTTP failed:', res.status, errText);
      }
    } catch (e) {
      console.warn('[MatchRoom] arena_vault_refund_match warning:', e);
    }
  }

  private async handleSeatDisconnect(ws: WebSocket): Promise<void> {
    await this.ensureInitialized();
    const meta = this.getSocketMeta(ws);
    const wasSeat = Boolean(meta?.authenticated && meta.role === 'seat');
    this.socketMeta.delete(ws);
    this.intentWindows.delete(ws);
    this.socialWindows.delete(ws);
    this.socialCooldowns.delete(ws);
    if (
      wasSeat &&
      this.state &&
      !this.isFinishedState(this.state) &&
      this.matchId &&
      this.countConnectedSeats(ws) === 0 &&
      !this.timerHeap.some((t) => t.kind === 'dead_match')
    ) {
      await this.scheduleTimer(
        this.deadMatchTimerId(this.matchId),
        'dead_match',
        TURN_TIMERS.maxDullMs
      );
    }
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
            fetch(`${supabaseUrl}/rest/v1/matches?id=eq.${effectiveMatchId}&select=match_shape,game_mode,metadata`, {
              headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
            }),
            fetch(`${supabaseUrl}/rest/v1/match_seats?match_id=eq.${effectiveMatchId}&select=color,wallet_address,seat_index,seat_kind&order=seat_index.asc`, {
              headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
            }),
          ]);

          if (matchRes.ok && seatsRes.ok) {
            const matchRows = (await matchRes.json()) as Array<{
              match_shape: string;
              game_mode: string;
              metadata?: { botDifficulty?: string; unranked?: boolean; botBackfill?: boolean } | null;
            }>;
            const seatsRows = (await seatsRes.json()) as Array<{
              color: string;
              wallet_address: string;
              seat_index: number;
              seat_kind?: 'human' | 'bot';
            }>;

            if (matchRows.length > 0 && seatsRows.length > 0) {
              const matchShape = (matchRows[0].match_shape || '4P') as '1v1' | '2v2' | '4P';
              const rawMode = matchRows[0].game_mode;
              const gameMode: EngineGameMode =
                rawMode === 'power' ? 'power' : rawMode === 'quick' ? 'quick' : 'classic';
              // Seating comes from the shared rule, never a local map. This used
              // to hard-code `green:'BL', yellow:'BR'`, which seats a 1v1 pair on
              // ADJACENT corners — the opposite of the engine's documented "one
              // diagonal" — and ignored `match_shape` entirely, so 2v2 and 4P got
              // the same fixed layout.
              const defaultCorners = assignCornersForShape(matchShape);

              // `BoardPlayer` is { name, level, avatar, color, position, isAi?,
              // walletAddress? } — see lib/types.ts.
              const boardPlayers: BoardPlayer[] = seatsRows.map((s, idx) => {
                const color = s.color as PlayerColor;
                const corner = defaultCorners[color] || 'BL';
                const isAi = s.seat_kind === 'bot' || String(s.wallet_address || '').startsWith('bot:');
                const tpl = isAi ? BOT_TEMPLATES[idx % BOT_TEMPLATES.length] : null;
                return {
                  name: tpl
                    ? tpl.name
                    : s.wallet_address
                      ? `Player ${s.wallet_address.slice(0, 6)}`
                      : `Player ${color}`,
                  level: tpl ? tpl.level : 1,
                  avatar: tpl ? tpl.avatar : '',
                  color,
                  position: CORNER_TO_POSITION[corner],
                  isAi,
                  walletAddress: s.wallet_address,
                };
              });

              let powerTileSeed: number | undefined;
              const powerTiles: GameState['powerTiles'] = [];
              if (gameMode === 'power') {
                const seedArr = new Uint32Array(1);
                crypto.getRandomValues(seedArr);
                powerTileSeed = (seedArr[0] >>> 0) || 1;
                const rand = lcg32(powerTileSeed);
                const taken = new Set<string>();
                for (let i = 0; i < POWER_TILES_COUNT; i++) {
                  const tile = spawnReplacementTile(taken, rand, defaultCorners);
                  if (tile) {
                    taken.add(`${tile.r},${tile.c}`);
                    powerTiles.push(tile);
                  }
                }
              }

              const metaDiff = matchRows[0].metadata?.botDifficulty;
              const botDifficulty =
                metaDiff === 'rookie' || metaDiff === 'master' ? metaDiff : 'pro';

              // Built from the canonical initial state rather than hand-rolled, so
              // every field the engine expects is present with the right shape.
              const seededState: GameState = {
                ...INITIAL_GAME_STATE,
                matchId: effectiveMatchId,
                playerCount: matchShape,
                gameMode,
                positions: createInitialPositions(defaultCorners, gameMode),
                currentPlayer: (seatsRows[0]?.color as PlayerColor) || 'green',
                status: 'playing',
                isStarted: true,
                isBotMatch: false,
                botDifficulty,
                powerTiles,
                ...(powerTileSeed !== undefined ? { powerTileSeed } : {}),
                lastUpdate: Date.now(),
                initialBoardConfig: {
                  players: boardPlayers,
                  colorCorner: defaultCorners,
                },
              };

              this.state = seededState;
              this.seq = 0;
              await this.scheduleTurnTimerForState(effectiveMatchId);
              await this.ctx.storage.put('state', this.state);
              await this.ctx.storage.put('seq', this.seq);
              // commitToPostgres(state, expectedSeq, eventType, eventPayload) —
              // the seed is the first event, so it carries timer metadata.
              await this.commitToPostgres(this.state, 0, 'server_seeded', {
                deadlineAt: this.state.deadlineAt ?? null,
                turnDurationMs: this.state.turnDurationMs ?? null,
                turnPhaseKind: this.state.turnPhaseKind ?? null,
                roomInstance: this.getRoomInstance(),
              });
            }
          }
        } catch (err) {
          console.warn('[MatchRoom] Failed to self-seed from match_seats:', err);
        }
      }
    }

    if (this.state && !this.isFinishedState(this.state) && effectiveMatchId) {
      const hasTurnTimer = this.timerHeap.some((t) => t.kind !== 'dead_match');
      if (!hasTurnTimer) {
        await this.scheduleTurnTimerForState(effectiveMatchId);
        await this.ctx.storage.put('state', this.state);
      }
      if (this.countConnectedSeats() === 0 && !this.timerHeap.some((t) => t.kind === 'dead_match')) {
        await this.scheduleTimer(
          this.deadMatchTimerId(effectiveMatchId),
          'dead_match',
          TURN_TIMERS.maxDullMs
        );
      }
    }

    this.initialized = true;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const parts = url.pathname.split('/').filter(Boolean);
    const matchId = parts[2] || '';

    await this.ensureInitialized(matchId);
    const roomInstance = this.getRoomInstance();

    if (url.pathname.endsWith('/ws')) {
      const upgradeHeader = request.headers.get('Upgrade');
      if (!upgradeHeader || upgradeHeader.toLowerCase() !== 'websocket') {
        return new Response('Expected WebSocket upgrade', {
          status: 426,
          headers: { 'X-Room-Instance': roomInstance },
        });
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

      const usedUpgradeTicket = Boolean(ticket);
      let initialStateSentSeq: number | undefined;
      const meta: RoomSocketMeta = {
        authenticated,
        wallet: initialWallet,
        role: initialRole,
        color: initialColor,
        connectedAt: Date.now(),
      };
      this.setSocketMeta(server, meta);

      if (authenticated && initialRole === 'seat' && matchId) {
        await this.cancelTimer(this.deadMatchTimerId(matchId));
      }

      // Legacy ?ticket= upgrade path: dispatch freshest sanitized state immediately.
      // Cookie-authenticated upgrades skip upgrade-time state so `join` -> `joined` -> `state`
      // never emits a duplicate snapshot on connect.
      if (usedUpgradeTicket && authenticated && this.state) {
        this.sendFrame(server, {
          t: 'state',
          seq: this.seq,
          state: this.sanitizeForSocket(this.state, server),
          source: 'match_states',
          deadlineAt: this.getTurnDeadline(),
        });
        initialStateSentSeq = this.seq;
        meta.initialStateSentSeq = initialStateSentSeq;
        this.setSocketMeta(server, meta);
      }

      try {
        return new Response(null, {
          status: 101,
          headers: { 'X-Room-Instance': roomInstance },
          webSocket: client,
        } as ResponseInit & { webSocket?: unknown });
      } catch {
        return new Response(null, {
          status: 200,
          headers: { 'X-Room-Instance': roomInstance },
          webSocket: client,
        } as ResponseInit & { webSocket?: unknown });
      }
    }

    if (url.pathname.endsWith('/info')) {
      return Response.json(
        {
          ok: true,
          matchId: this.matchId,
          seq: this.seq,
          roomVersion: this.roomVersion,
          protocolVersion: ROOM_PROTOCOL_VERSION,
          roomInstance,
          activeSockets: this.ctx.getWebSockets().length,
          hasState: !!this.state,
        },
        { headers: { 'X-Room-Instance': roomInstance } }
      );
    }

    return new Response('Not found', { status: 404 });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    await this.ensureInitialized();
    if (utf8ByteLength(message) > MAX_ROOM_FRAME_BYTES) {
      this.sendRejected(ws, 'FRAME_TOO_LARGE', 'Frame exceeds 32 KB limit');
      return;
    }

    const text = typeof message === 'string' ? message : new TextDecoder().decode(message);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      this.sendRejected(ws, 'MALFORMED_FRAME', 'Invalid JSON');
      return;
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      this.sendRejected(ws, 'MALFORMED_FRAME', 'Expected JSON object frame');
      return;
    }
    const frame = parsed as Record<string, unknown>;
    const rawIntentId = typeof frame.intentId === 'string' && frame.intentId.length > 0 ? frame.intentId : undefined;

    if (!isSupportedProtocolVersion(frame.v)) {
      this.sendRejected(
        ws,
        'PROTOCOL_MISMATCH',
        `Unsupported protocol version: ${String(frame.v)}`,
        { intentId: rawIntentId }
      );
      return;
    }

    const t = frame.t;

    if (t === 'pong') {
      return;
    }

    if (t === 'ping') {
      this.sendFrame(ws, {
        t: 'pong',
        ts: Date.now(),
        ...(typeof frame.ts === 'number' ? { clientTs: frame.ts } : {}),
      });
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
        this.sendRejected(ws, 'NOT_AUTHORIZED', 'Only authenticated seats may seed a room');
        return;
      }
      if (this.state) {
        this.sendFrame(ws, { t: 'seed_ack', ok: true, deduped: true, seq: this.seq });
        return;
      }
      const seeded = frame.payload as GameState | undefined;
      if (!seeded || typeof seeded !== 'object') {
        this.sendRejected(ws, 'MALFORMED_FRAME', 'Seed payload missing');
        return;
      }
      this.state = seeded;
      this.seq = 0;

      if (!this.isFinishedState(this.state) && this.matchId) {
        await this.scheduleTurnTimerForState(this.matchId);
        if (this.countConnectedSeats() > 0) {
          await this.cancelTimer(this.deadMatchTimerId(this.matchId));
        }
      }

      const earliestDeadline = this.getTurnDeadline();
      this.state.deadlineAt = earliestDeadline;
      await this.ctx.storage.put('state', this.state);
      await this.ctx.storage.put('seq', this.seq);

      // S0: Commit initial seed directly to Postgres match_states via match_commit_action
      await this.commitToPostgres(this.state, 0, 'match_seeded', {
        seq: 0,
        currentPlayer: this.state.currentPlayer,
        winner: this.state.winner,
        deadlineAt: earliestDeadline,
        turnDurationMs: this.state.turnDurationMs ?? null,
        turnPhaseKind: this.state.turnPhaseKind ?? null,
        roomInstance: this.getRoomInstance(),
      });

      for (const sock of this.ctx.getWebSockets()) {
        try {
          this.sendFrame(sock, {
            t: 'state',
            seq: this.seq,
            state: this.sanitizeForSocket(this.state, sock),
            source: 'room_seed',
            deadlineAt: earliestDeadline,
          });
        } catch {
          // Socket closed mid-fanout.
        }
      }
      this.sendFrame(ws, { t: 'seed_ack', ok: true, seq: this.seq });
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
          this.sendRejected(ws, 'INTERNAL_ERROR', (err as Error).message, {
            intentId: rawIntentId,
            seq: this.seq,
          });
        }
      });
      await this.actionQueue;
      return;
    }

    if (t === 'social') {
      await this.handleSocialFrame(ws, frame);
      return;
    }

    this.sendRejected(ws, 'UNKNOWN_FRAME_TYPE', 'Unknown frame type');
  }

  private async handleSocialFrame(ws: WebSocket, frame: Record<string, unknown>): Promise<void> {
    const meta = this.getSocketMeta(ws);
    if (!meta || !meta.authenticated || meta.role !== 'seat') {
      this.sendRejected(ws, 'NOT_AUTHORIZED', 'Only authenticated seats may send social reactions');
      return;
    }

    const socialType = frame.socialType;
    if (
      socialType !== 'EMOTE' &&
      socialType !== 'CHAT' &&
      socialType !== 'REMATCH' &&
      socialType !== 'PROJECTILE'
    ) {
      this.sendRejected(ws, 'MALFORMED_FRAME', 'Invalid socialType');
      return;
    }

    const nowMs = Date.now();
    const prev = this.socialWindows.get(ws) || [];
    const recent = prev.filter((ts) => ts > nowMs - 10_000);
    if (recent.length >= 10) {
      this.socialWindows.set(ws, recent);
      this.sendRejected(ws, 'RATE_LIMITED', 'Too many social reactions — slow down');
      return;
    }

    if (socialType === 'EMOTE' || socialType === 'PROJECTILE') {
      const lastActionAt = this.socialCooldowns.get(ws) ?? 0;
      if (nowMs - lastActionAt < 800) {
        this.sendRejected(ws, 'RATE_LIMITED', 'Reaction cooldown active');
        return;
      }
      this.socialCooldowns.set(ws, nowMs);
    }

    recent.push(nowMs);
    this.socialWindows.set(ws, recent);

    const raw =
      frame.payload && typeof frame.payload === 'object' && !Array.isArray(frame.payload)
        ? (frame.payload as Record<string, unknown>)
        : {};
    const seatColor = meta.color || 'green';
    const seatWallet = meta.wallet;

    let sanitized: Record<string, unknown>;
    if (socialType === 'CHAT') {
      const cleanText = filterProfanity(String(raw.text || '').trim()).slice(0, 120);
      if (!cleanText) return;
      sanitized = {
        text: cleanText,
        color: seatColor,
        audience: raw.audience === 'team' ? 'team' : 'all',
        t: nowMs,
      };
    } else if (socialType === 'EMOTE') {
      const emoteId = String(raw.emoteId || 'gl').slice(0, 24);
      const customText =
        typeof raw.customText === 'string'
          ? filterProfanity(raw.customText.trim()).slice(0, 32)
          : undefined;
      const assetUrl =
        typeof raw.assetUrl === 'string' && raw.assetUrl.startsWith('/emotes/')
          ? raw.assetUrl.slice(0, 120)
          : undefined;
      sanitized = {
        emoteId,
        color: seatColor,
        ...(seatWallet ? { actor: seatWallet } : {}),
        ...(customText ? { customText } : {}),
        ...(assetUrl ? { assetUrl } : {}),
        t: nowMs,
      };
    } else if (socialType === 'PROJECTILE') {
      const pid = raw.projectileId;
      const toColor = raw.toColor;
      const validIds = new Set(['emp-bomb', 'holo-ghost', 'cryo-balloon', 'plasma-pie']);
      const validColors = new Set(['green', 'red', 'yellow', 'blue']);
      if (
        typeof pid !== 'string' ||
        !validIds.has(pid) ||
        typeof toColor !== 'string' ||
        !validColors.has(toColor) ||
        toColor === seatColor
      ) {
        this.sendRejected(ws, 'MALFORMED_FRAME', 'Invalid projectile payload');
        return;
      }
      sanitized = {
        id: typeof raw.id === 'string' && raw.id ? raw.id.slice(0, 48) : `${nowMs}-${seatColor}`,
        projectileId: pid,
        fromColor: seatColor,
        toColor,
        ...(seatWallet ? { actor: seatWallet } : {}),
        t: nowMs,
      };
    } else {
      sanitized = {
        kind: raw.kind,
        ...(typeof raw.proposalId === 'string' ? { proposalId: raw.proposalId.slice(0, 80) } : {}),
        ...(typeof raw.matchId === 'string' ? { matchId: raw.matchId.slice(0, 80) } : {}),
        ...(typeof raw.newMatchId === 'string' ? { newMatchId: raw.newMatchId.slice(0, 80) } : {}),
        ...(typeof raw.roomCode === 'string' ? { roomCode: raw.roomCode.slice(0, 24) } : {}),
        color: seatColor,
        ...(seatWallet ? { wallet: seatWallet } : {}),
        ...(typeof raw.actor === 'string' ? { actor: raw.actor.slice(0, 48) } : {}),
        t: nowMs,
      };
    }

    for (const sock of this.ctx.getWebSockets()) {
      if (sock === ws) continue;
      try {
        this.sendFrame(sock, {
          t: 'social',
          socialType,
          payload: sanitized,
          fromColor: seatColor,
          ...(seatWallet ? { wallet: seatWallet } : {}),
        });
      } catch {
        // Socket closed mid-fanout.
      }
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    await this.handleSeatDisconnect(ws);
    try {
      ws.close(code, reason);
    } catch {
      // Already closed
    }
  }

  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    console.error('[MatchRoom] WebSocket error:', error);
    await this.handleSeatDisconnect(ws);
    try {
      ws.close(1011, 'Internal error');
    } catch {
      // Already closed
    }
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
    const usedTicket = typeof frame.token !== 'string' && typeof frame.ticket === 'string';
    const asRole = frame.as === 'seat' ? 'seat' : 'spectator';
    const lastSeq = typeof frame.lastSeq === 'number' ? frame.lastSeq : undefined;
    const wantsDelta = Array.isArray(frame.caps) && frame.caps.includes('delta');

    let meta = this.getSocketMeta(ws);
    if (!meta) {
      meta = { authenticated: false, role: asRole, connectedAt: Date.now(), supportsDelta: wantsDelta };
      this.setSocketMeta(ws, meta);
    } else if (wantsDelta && !meta.supportsDelta) {
      meta.supportsDelta = true;
      this.setSocketMeta(ws, meta);
    }

    if (!meta.authenticated && token) {
      const verified = await this.verifySessionToken(token, this.matchId, usedTicket ? 'ticket' : 'token');
      if (verified.ok) {
        meta.authenticated = true;
        meta.wallet = verified.wallet;
        meta.role = verified.role;
        meta.color = verified.color;
        this.setSocketMeta(ws, meta);
      } else {
        this.sendRejected(
          ws,
          verified.code || 'NOT_AUTHORIZED',
          verified.error || 'Authentication failed'
        );
        return;
      }
    }

    // If still not authenticated and trying to act as seat, reject
    if (!meta.authenticated && asRole === 'seat') {
      this.sendRejected(
        ws,
        'NOT_AUTHORIZED',
        'Authentication credential required for seat role'
      );
      return;
    }

    if (meta.authenticated && meta.role === 'seat' && this.matchId) {
      await this.cancelTimer(this.deadMatchTimerId(this.matchId));
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
    this.sendFrame(ws, {
      t: 'joined',
      role: meta.role,
      seat: meta.color ?? null,
      wallet: meta.wallet ?? null,
      seq: this.seq,
      hasState: !!this.state,
    });

    // If client requested catch-up or has stale state
    if (this.state) {
      const alreadySentAtUpgrade = meta.initialStateSentSeq === this.seq && lastSeq === this.seq;
      if (meta.initialStateSentSeq !== undefined) {
        meta.initialStateSentSeq = undefined;
        this.setSocketMeta(ws, meta);
      }
      if (!alreadySentAtUpgrade) {
        this.sendFrame(ws, {
          t: 'state',
          seq: this.seq,
          state: this.sanitizeForSocket(this.state, ws),
          source: 'match_states',
          deadlineAt: this.getTurnDeadline(),
          resync: lastSeq !== undefined && lastSeq < this.seq,
        });
      }
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

    const nowMs = Date.now();
    const prevTimestamps = this.intentWindows.get(ws) || [];
    const recentTimestamps = prevTimestamps.filter((ts) => ts > nowMs - ROOM_INTENT_RATE_LIMIT.windowMs);
    if (recentTimestamps.length >= ROOM_INTENT_RATE_LIMIT.maxIntents) {
      this.intentWindows.set(ws, recentTimestamps);
      this.sendRejected(ws, 'RATE_LIMITED', 'Too many intents — slow down', {
        intentId,
        seq: this.seq,
      });
      return;
    }
    recentTimestamps.push(nowMs);
    this.intentWindows.set(ws, recentTimestamps);

    if (!meta || !meta.authenticated || meta.role !== 'seat') {
      this.sendRejected(
        ws,
        'NOT_AUTHORIZED',
        'Only authenticated seat holders may submit intents',
        { intentId }
      );
      return;
    }

    if (
      typeof frame.seq === 'number' &&
      Number.isFinite(frame.seq) &&
      frame.seq < this.seq &&
      this.state
    ) {
      this.sendFrame(ws, {
        t: 'sync_needed',
        serverSeq: this.seq,
        clientSeq: frame.seq,
      });
    }

    if (kind === 'REQUEST_ROLL') {
      if (!this.state) {
        this.sendRejected(ws, 'ROOM_NOT_READY', 'No live match state in this room', { intentId });
        return;
      }
      if (this.isFinishedState(this.state)) {
        this.sendRejected(ws, 'MATCH_FINISHED', 'Match has already finished', { intentId, seq: this.seq });
        return;
      }
      const curColor = this.state.currentPlayer as PlayerColor;
      if (meta.role === 'seat' && (!meta.color || meta.color !== curColor)) {
        this.sendRejected(ws, 'NOT_YOUR_TURN', 'Not your turn to roll', { intentId });
        return;
      }
      if (this.state.gamePhase !== 'rolling' || this.state.diceValue !== null) {
        this.sendRejected(ws, 'ALREADY_ROLLED', 'Already rolled this turn', { intentId, seq: this.seq });
        return;
      }

      const rollValue = rollUnbiasedDie();

      const cc = this.state.initialBoardConfig?.colorCorner || {
        green: 'BL',
        yellow: 'BR',
        blue: 'TR',
        red: 'TL',
      };

      // SV-03A/B/C + SV-04: Three-sixes forfeit check, Boost 6-then-roll split, and legal move check
      const resolvedRoll = resolveRollWithBoost({
        state: this.state as unknown as EngineGameState,
        color: curColor,
        rollValue,
        cc,
        playerCount: this.state.playerCount,
        activeColors: this.getActiveColors(),
        now: Date.now(),
      });

      const rollEventMeta = {
        rollValue,
        seatColor: curColor,
        walletAddress: meta.wallet ?? null,
        outcome: resolvedRoll.outcome,
      };
      const rollEvents = buildRollEvents({
        color: curColor,
        rollValue,
        outcome: resolvedRoll.outcome,
        activeDice: resolvedRoll.activeDice,
        boostSplitActive: resolvedRoll.boostSplitActive,
      });

      if (resolvedRoll.outcome === 'forfeit_three_sixes') {
        const nextState = resolvedRoll.state as unknown as GameState;
        await this.applyNewState(nextState, this.seq + 1, 'turn_passed', rollEventMeta, {
          lastIntentId: intentId,
          events: rollEvents,
        });
        this.sendFrame(ws, {
          t: 'intent_ack',
          intentId,
          ok: true,
          data: { seq: this.seq, roomInstance: this.getRoomInstance() },
        });
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

      const nextState: GameState = {
        ...(resolvedRoll.state as unknown as GameState),
        strikes: nextStrikes,
        afkStats: nextAfk,
        lastUpdate: Date.now(),
      };

      const eventType = resolvedRoll.outcome === 'no_moves' ? 'turn_passed' : 'roll_minted';
      await this.applyNewState(nextState, this.seq + 1, eventType, rollEventMeta, {
        lastIntentId: intentId,
        events: rollEvents,
      });
      this.sendFrame(ws, {
        t: 'intent_ack',
        intentId,
        ok: true,
        data: { seq: this.seq, roomInstance: this.getRoomInstance() },
      });
      return;
    }

    if (kind === 'REQUEST_MOVE') {
      if (!this.state) {
        this.sendRejected(ws, 'ROOM_NOT_READY', 'No live match state in this room', { intentId });
        return;
      }
      if (this.isFinishedState(this.state)) {
        this.sendRejected(ws, 'MATCH_FINISHED', 'Match has already finished', { intentId, seq: this.seq });
        return;
      }
      const curColor = this.state.currentPlayer as PlayerColor;
      if (meta.role === 'seat' && (!meta.color || meta.color !== curColor)) {
        this.sendRejected(ws, 'NOT_YOUR_TURN', 'Not your turn to move', { intentId });
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
          activeShields: clearShieldsOnTurnChange(this.state.activeShields, curColor, nextPlayer),
          diceValue: null,
          isRolling: false,
          gamePhase: 'rolling',
          consecutiveSixes: 0,
          activeBoost: null,
          boostPendingDice: null,
          boostSubMoveBonus: false,
          powerSpentThisTurn: false,
          lastUpdate: Date.now(),
        };
        await this.applyNewState(nextState, this.seq + 1, 'turn_passed', undefined, { lastIntentId: intentId });
        this.sendFrame(ws, {
          t: 'intent_ack',
          intentId,
          ok: true,
          data: { seq: this.seq, roomInstance: this.getRoomInstance() },
        });
        return;
      }

      if (this.state.gamePhase !== 'moving' || typeof this.state.diceValue !== 'number') {
        this.sendRejected(ws, 'NOT_ROLLED', 'Roll the dice before moving', { intentId, seq: this.seq });
        return;
      }

      const tokenIndex = typeof payload.tokenIndex === 'number' ? payload.tokenIndex : 0;
      const diceVal = this.state.diceValue;

      const prevStateForEvents = this.state;
      const targetColorForMove = resolveControllableColor(this.state.positions, curColor, this.state.playerCount);

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
        this.sendRejected(
          ws,
          (resolved.code || 'ILLEGAL_MOVE') as RoomErrorCode,
          resolved.error || 'Token move is illegal',
          { intentId, seq: this.seq }
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

      // A bonus roll (six, capture, finish, or a power) keeps the mover on turn.
      // Only reset to `rolling` when no split Boost Step 2 remains.
      if (resolved.bonusRoll && !nextState.winner && resolved.splitStepRemaining == null) {
        nextState = {
          ...nextState,
          currentPlayer: curColor,
          diceValue: null,
          isRolling: false,
          gamePhase: 'rolling',
        };
      }

      const moveEvents = buildMoveEvents({
        prevState: prevStateForEvents,
        nextState,
        color: curColor,
        targetColor: targetColorForMove,
        tokenIndex,
        steps: diceVal,
        fromPos: resolved.fromPos ?? BASE_INDEX,
        toPos: resolved.toPos ?? BASE_INDEX,
        captured: resolved.captured,
        finishedToken: resolved.finishedToken,
        cc,
      });

      await this.applyNewState(nextState, this.seq + 1, 'move_committed', undefined, {
        lastIntentId: intentId,
        events: moveEvents,
      });
      this.sendFrame(ws, {
        t: 'intent_ack',
        intentId,
        ok: true,
        data: { seq: this.seq, roomInstance: this.getRoomInstance() },
      });
      return;
    }

    if (kind === 'REQUEST_POWER') {
      if (!this.state) {
        this.sendRejected(ws, 'ROOM_NOT_READY', 'No live match state in this room', { intentId });
        return;
      }
      if (this.isFinishedState(this.state)) {
        this.sendRejected(ws, 'MATCH_FINISHED', 'Match has already finished', { intentId, seq: this.seq });
        return;
      }

      const curColor = this.state.currentPlayer as PlayerColor;
      if (meta.role === 'seat' && (!meta.color || meta.color !== curColor)) {
        this.sendRejected(ws, 'NOT_YOUR_TURN', 'Not your turn to use a power', { intentId });
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

      const prevStateForEvents = this.state;
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
        this.sendRejected(
          ws,
          result.armed ? 'POWER_ARMED' : 'POWER_REFUSED',
          result.error,
          { intentId, seq: this.seq }
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
      const nextState: GameState = {
        ...(result.state as unknown as GameState),
        strikes: nextStrikes,
        afkStats: nextAfk,
      };

      const powerEvents = buildPowerTriggerEvents({
        prevState: prevStateForEvents,
        nextState,
        color: curColor,
        powerType: powerType as PowerType,
        tokenIndex,
      });

      await this.applyNewState(nextState, this.seq + 1, 'power_committed', undefined, {
        lastIntentId: intentId,
        events: powerEvents,
      });
      this.sendFrame(ws, {
        t: 'intent_ack',
        intentId,
        ok: true,
        data: { seq: this.seq, roomInstance: this.getRoomInstance() },
      });
      return;
    }

    if (kind === 'CMD_REQUEST_TRUST') {
      if (!this.state) {
        this.sendRejected(ws, 'ROOM_NOT_READY', 'No live match state in this room', { intentId });
        return;
      }
      if (this.isFinishedState(this.state)) {
        this.sendRejected(ws, 'MATCH_FINISHED', 'Match has already finished', { intentId, seq: this.seq });
        return;
      }
      if (!meta.color) {
        this.sendRejected(ws, 'NOT_AUTHORIZED', 'Only seated players may manage trust', { intentId });
        return;
      }

      const seatColor = meta.color as PlayerColor;
      const wantTrust = payload.trust === true;
      const currentAfk = this.state.afkStats?.[seatColor];
      const isAuto = Boolean(currentAfk?.isAutoPlaying);
      const isKicked = Boolean(currentAfk?.isKicked);
      const hasStrikes = (this.state.strikes?.[seatColor] ?? 0) > 0;

      if (!wantTrust && isKicked) {
        this.sendRejected(ws, 'NOT_AUTHORIZED', 'Seat kicked after maximum AFK strikes', {
          intentId,
          seq: this.seq,
        });
        return;
      }

      if (wantTrust) {
        if (isAuto || isKicked) {
          this.sendFrame(ws, {
            t: 'intent_ack',
            intentId,
            ok: true,
            data: { seq: this.seq, roomInstance: this.getRoomInstance(), noop: true },
          });
          return;
        }
        const nextAfk = {
          ...this.state.afkStats,
          [seatColor]: {
            consecutiveTurns: currentAfk?.consecutiveTurns ?? 0,
            totalTriggers: currentAfk?.totalTriggers ?? 0,
            isKicked: Boolean(currentAfk?.isKicked),
            isAutoPlaying: true,
          },
        };
        const nextState: GameState = {
          ...this.state,
          afkStats: nextAfk,
          lastUpdate: Date.now(),
        };
        await this.applyNewState(
          nextState,
          this.seq + 1,
          'trust_delegated',
          { seatColor, trust: true },
          { preserveTimer: seatColor !== this.state.currentPlayer, lastIntentId: intentId },
        );
        this.sendFrame(ws, {
          t: 'intent_ack',
          intentId,
          ok: true,
          data: { seq: this.seq, roomInstance: this.getRoomInstance() },
        });
        return;
      }

      if (!isAuto && !hasStrikes) {
        this.sendFrame(ws, {
          t: 'intent_ack',
          intentId,
          ok: true,
          data: { seq: this.seq, roomInstance: this.getRoomInstance(), noop: true },
        });
        return;
      }

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
      await this.applyNewState(
        nextState,
        this.seq + 1,
        'trust_restored',
        { seatColor, trust: false },
        { preserveTimer: seatColor !== this.state.currentPlayer, lastIntentId: intentId },
      );
      this.sendFrame(ws, {
        t: 'intent_ack',
        intentId,
        ok: true,
        data: { seq: this.seq, roomInstance: this.getRoomInstance() },
      });
      return;
    }

    this.sendRejected(ws, 'UNKNOWN_INTENT', 'Unknown intent kind', { intentId });
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
      const res = await fetch(`${supabaseUrl}/rest/v1/rpc/match_commit_action`, {
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
      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        console.error('[MatchRoom] match_commit_action HTTP failed:', res.status, errText);
        return;
      }
      const body = (await res.json().catch(() => null)) as { ok?: boolean; error?: string; current_seq?: number } | null;
      if (body && body.ok === false) {
        console.error('[MatchRoom] match_commit_action rejected:', body.error, { expectedSeq, current_seq: body.current_seq });
      }
    } catch (e) {
      console.warn('[MatchRoom] match_commit_action warning:', e);
    }
  }

  /**
   * Apply validated state transition, save to SQLite and broadcast to all connected sockets.
   * Atomically calls match_commit_action RPC on Postgres to record state and room events.
   */
  private async applyNewState(
    newState: GameState,
    newSeq: number,
    eventType: string = 'move_committed',
    eventExtra?: Record<string, unknown>,
    opts?: { preserveTimer?: boolean; lastIntentId?: string; events?: MatchEvent[]; forceFullState?: boolean },
  ): Promise<void> {
    const prevState = this.state;
    const prevSeq = this.seq;
    const prevDurationMs = this.state?.turnDurationMs ?? null;
    const prevPhaseKind = this.state?.turnPhaseKind ?? null;
    this.state = { ...newState };
    this.seq = newSeq;

    if (this.isFinishedState(this.state)) {
      await this.clearAllTimers();
      this.state.deadlineAt = null;
      this.state.turnDurationMs = null;
      this.state.turnPhaseKind = null;
    } else if (!opts?.preserveTimer) {
      await this.scheduleTurnTimerForState(this.matchId);
    } else {
      this.state.deadlineAt = this.getTurnDeadline();
      this.state.turnDurationMs = this.state.turnDurationMs ?? prevDurationMs;
      this.state.turnPhaseKind = this.state.turnPhaseKind ?? prevPhaseKind;
    }

    const deadlineAt = this.state.deadlineAt ?? this.getTurnDeadline();
    await this.ctx.storage.put('state', this.state);
    await this.ctx.storage.put('seq', this.seq);

    await this.commitToPostgres(this.state, newSeq - 1, eventType, {
      seq: newSeq,
      currentPlayer: this.state.currentPlayer,
      winner: this.state.winner,
      deadlineAt,
      turnDurationMs: this.state.turnDurationMs ?? null,
      turnPhaseKind: this.state.turnPhaseKind ?? null,
      roomInstance: this.getRoomInstance(),
      ...(eventExtra || {}),
    });

    const rawPatch = prevState && !opts?.forceFullState ? computeStatePatch(prevState, this.state) : null;
    const events = opts?.events ?? [];

    for (const ws of this.ctx.getWebSockets()) {
      try {
        const meta = this.getSocketMeta(ws);
        if (meta?.supportsDelta && rawPatch !== null) {
          const viewerColor = meta.role === 'seat' ? meta.color : undefined;
          const sanitized = sanitizeDeltaForWire(rawPatch, events, viewerColor);
          this.sendFrame(ws, {
            t: 'delta',
            seq: this.seq,
            prevSeq,
            patch: sanitized.patch,
            events: sanitized.events,
            deadlineAt,
            ...(opts?.lastIntentId ? { lastIntentId: opts.lastIntentId } : {}),
          });
        } else {
          this.sendFrame(ws, {
            t: 'state',
            seq: this.seq,
            state: this.sanitizeForSocket(this.state, ws),
            source: 'match_states',
            deadlineAt,
            ...(opts?.lastIntentId ? { lastIntentId: opts.lastIntentId } : {}),
          });
        }
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

  private async executeServerBotTurn(
    color: PlayerColor,
    opts?: {
      suppressBonusRoll?: boolean;
      eventTypeOverride?: string;
      eventExtra?: Record<string, unknown>;
    },
  ): Promise<void> {
    if (!this.state || this.isFinishedState(this.state) || this.state.currentPlayer !== color) return;

    const cc = this.state.initialBoardConfig?.colorCorner || {
      green: 'BL',
      yellow: 'BR',
      blue: 'TR',
      red: 'TL',
    };

    const pickBotToken = (
      currentState: GameState,
      targetColor: PlayerColor,
      legalMoves: number[],
      steps: number,
    ): number => {
      const best = getBestMove(
        currentState.positions,
        color,
        steps,
        cc,
        currentState.playerCount,
        (currentState.powerTiles || []) as { r: number; c: number }[],
        currentState,
        currentState.botDifficulty || 'pro',
      );
      if (best && best.color === targetColor && legalMoves.includes(best.tokenIndex)) {
        return best.tokenIndex;
      }
      return legalMoves[0];
    };

    const timeoutEvents: MatchEvent[] =
      opts?.eventTypeOverride === 'turn_timeout'
        ? [
            {
              type: 'TURN_TIMEOUT',
              color,
              strikeCount: Number(opts.eventExtra?.strikeCount ?? this.state.strikes?.[color] ?? 1),
              kicked: Boolean(opts.eventExtra?.isKicked ?? this.state.afkStats?.[color]?.isKicked),
            },
          ]
        : [];

    const commitResolvedMove = async (
      resolvedState: GameState,
      resolvedBonus: boolean,
      splitRemaining: number | null | undefined,
      meta?: Record<string, unknown>,
      events: MatchEvent[] = [],
    ) => {
      let nextState = resolvedState;
      if (opts?.suppressBonusRoll && !nextState.winner && nextState.currentPlayer === color) {
        const nextPlayer = getNextPlayer(color, nextState.playerCount, this.getActiveColors(), cc);
        nextState = {
          ...nextState,
          currentPlayer: nextPlayer,
          activeShields: clearShieldsOnTurnChange(nextState.activeShields, color, nextPlayer),
          diceValue: null,
          isRolling: false,
          gamePhase: 'rolling',
          consecutiveSixes: 0,
          activeBoost: null,
          boostPendingDice: null,
          boostSubMoveBonus: false,
          powerSpentThisTurn: false,
          lastUpdate: Date.now(),
        };
      } else if (!opts?.suppressBonusRoll && resolvedBonus && !nextState.winner && splitRemaining == null) {
        nextState = {
          ...nextState,
          currentPlayer: color,
          diceValue: null,
          isRolling: false,
          gamePhase: 'rolling',
        };
      }
      await this.applyNewState(
        nextState,
        this.seq + 1,
        opts?.eventTypeOverride || 'move_committed',
        meta,
        { events },
      );
    };

    // Continue pending move (e.g. Boost Step 2 or timed-out human move phase) without rolling a second time.
    if (this.state.gamePhase === 'moving' && typeof this.state.diceValue === 'number') {
      const targetColor = resolveControllableColor(this.state.positions, color, this.state.playerCount);
      const stepVal = this.state.diceValue;
      const legalMoves = getLegalTokenIndices(this.state.positions, targetColor, stepVal, cc);
      if (legalMoves.length === 0) {
        const nextPlayer = getNextPlayer(color, this.state.playerCount, this.getActiveColors(), cc);
        await this.applyNewState(
          {
            ...this.state,
            diceValue: null,
            currentPlayer: nextPlayer,
            activeShields: clearShieldsOnTurnChange(this.state.activeShields, color, nextPlayer),
            isRolling: false,
            gamePhase: 'rolling',
            consecutiveSixes: 0,
            activeBoost: null,
            boostPendingDice: null,
            boostSubMoveBonus: false,
            powerSpentThisTurn: false,
            lastUpdate: Date.now(),
          },
          this.seq + 1,
          opts?.eventTypeOverride || 'turn_passed',
          opts?.eventExtra,
          { events: timeoutEvents },
        );
        return;
      }

      const preMoveState = this.state;
      const chosenToken = pickBotToken(this.state, targetColor, legalMoves, stepVal);
      const resolved = resolveNetworkedMove({
        state: this.state as unknown as EngineGameState,
        color,
        tokenIndex: chosenToken,
        dice: stepVal,
        cc,
        playerCount: this.state.playerCount,
        activeColors: this.getActiveColors(),
        now: Date.now(),
      });
      if (resolved.ok && resolved.state) {
        const moveEvents = [
          ...timeoutEvents,
          ...buildMoveEvents({
            prevState: preMoveState,
            nextState: resolved.state as unknown as GameState,
            color,
            targetColor,
            tokenIndex: chosenToken,
            steps: stepVal,
            fromPos: resolved.fromPos ?? BASE_INDEX,
            toPos: resolved.toPos ?? BASE_INDEX,
            captured: resolved.captured,
            finishedToken: resolved.finishedToken,
            cc,
          }),
        ];
        await commitResolvedMove(
          resolved.state as unknown as GameState,
          Boolean(resolved.bonusRoll),
          resolved.splitStepRemaining,
          opts?.eventExtra,
          moveEvents,
        );
        return;
      }
    }

    if (this.state.gamePhase === 'rolling' && this.state.diceValue === null && !this.state.powerSpentThisTurn && opts?.eventTypeOverride !== 'turn_timeout') {
      const powerPick = getBestPowerUsage(
        this.state,
        color,
        cc,
        this.state.playerCount,
        this.state.botDifficulty || 'pro',
      );
      if (powerPick) {
        const prevPowerState = this.state;
        const powerApplied = applyPower(
          this.state as unknown as EngineGameState,
          color,
          powerPick.type,
          powerPick.tokenIdx,
          cc,
          this.state.playerCount,
          Date.now(),
        );
        if (powerApplied.ok) {
          const nextPowerState: GameState = {
            ...(powerApplied.state as unknown as GameState),
            lastUpdate: Date.now(),
          };
          const powerEvents = buildPowerTriggerEvents({
            prevState: prevPowerState,
            nextState: nextPowerState,
            color,
            powerType: powerPick.type,
            tokenIndex: powerPick.tokenIdx,
          });
          await this.applyNewState(
            nextPowerState,
            this.seq + 1,
            'power_committed',
            {
              seatColor: color,
              walletAddress: null,
              source: 'server_autoplay',
              ...(opts?.eventExtra || {}),
            },
            { preserveTimer: true, events: powerEvents },
          );
          if (!this.state || this.isFinishedState(this.state)) {
            return;
          }
        }
      }
    }

    const rollValue = rollUnbiasedDie();

    const resolvedRoll = resolveRollWithBoost({
      state: this.state as unknown as EngineGameState,
      color,
      rollValue,
      cc,
      playerCount: this.state.playerCount,
      activeColors: this.getActiveColors(),
      now: Date.now(),
    });

    const botRollMeta = {
      rollValue,
      seatColor: color,
      walletAddress: null,
      source: 'server_autoplay',
      ...(opts?.eventExtra || {}),
    };

    const rollEvents: MatchEvent[] = [
      ...timeoutEvents,
      ...buildRollEvents({
        color,
        rollValue,
        outcome: resolvedRoll.outcome,
        activeDice: resolvedRoll.activeDice,
        boostSplitActive: resolvedRoll.boostSplitActive,
        source: opts?.eventTypeOverride === 'turn_timeout' ? 'timeout' : 'bot',
      }),
    ];

    if (resolvedRoll.outcome !== 'moving' || resolvedRoll.activeDice == null || resolvedRoll.legalMoves.length === 0) {
      await this.applyNewState(
        resolvedRoll.state as unknown as GameState,
        this.seq + 1,
        opts?.eventTypeOverride || 'turn_passed',
        botRollMeta,
        { events: rollEvents },
      );
      return;
    }

    // Split bot/timeout roll into a visible roll frame so clients see the rolled face
    // before the follow-up move delta arrives and hops across the board.
    const rollState: GameState = {
      ...(resolvedRoll.state as unknown as GameState),
      lastUpdate: Date.now(),
    };
    await this.applyNewState(
      rollState,
      this.seq + 1,
      'roll_minted',
      botRollMeta,
      { preserveTimer: true, events: rollEvents },
    );

    const activeDice = resolvedRoll.activeDice;
    const chosenToken = pickBotToken(
      rollState,
      resolvedRoll.targetColor,
      resolvedRoll.legalMoves,
      activeDice
    );

    const resolved = resolveNetworkedMove({
      state: rollState as unknown as EngineGameState,
      color,
      tokenIndex: chosenToken,
      dice: activeDice,
      cc,
      playerCount: this.state.playerCount,
      activeColors: this.getActiveColors(),
      now: Date.now(),
    });

    if (resolved.ok && resolved.state) {
      const moveEvents = buildMoveEvents({
        prevState: rollState,
        nextState: resolved.state as unknown as GameState,
        color,
        targetColor: resolvedRoll.targetColor,
        tokenIndex: chosenToken,
        steps: activeDice,
        fromPos: resolved.fromPos ?? BASE_INDEX,
        toPos: resolved.toPos ?? BASE_INDEX,
        captured: resolved.captured,
        finishedToken: resolved.finishedToken,
        cc,
      });
      await commitResolvedMove(
        resolved.state as unknown as GameState,
        Boolean(resolved.bonusRoll),
        resolved.splitStepRemaining,
        botRollMeta,
        moveEvents,
      );
    } else {
      const nextPlayer = getNextPlayer(color, this.state.playerCount, this.getActiveColors(), cc);
      const nextState: GameState = {
        ...rollState,
        diceValue: null,
        currentPlayer: nextPlayer,
        activeShields: clearShieldsOnTurnChange(rollState.activeShields, color, nextPlayer),
        isRolling: false,
        gamePhase: 'rolling',
        consecutiveSixes: 0,
        activeBoost: null,
        boostPendingDice: null,
        boostSubMoveBonus: false,
        powerSpentThisTurn: false,
        lastUpdate: Date.now(),
      };
      await this.applyNewState(
        nextState,
        this.seq + 1,
        opts?.eventTypeOverride || 'turn_passed',
        botRollMeta,
      );
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
    await this.syncAlarmToHeap();
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

    const deadTimer = expired.find((t) => t.kind === 'dead_match');
    if (deadTimer && this.state && !this.isFinishedState(this.state)) {
      if (this.countConnectedSeats() === 0) {
        await this.clearAllTimers();
        const abortedState: GameState = {
          ...this.state,
          winner: 'aborted',
          abortReason: 'no_connected_seats_30s',
          isRolling: false,
          diceValue: null,
          deadlineAt: null,
          turnDurationMs: null,
          turnPhaseKind: null,
          lastUpdate: Date.now(),
        };
        await this.applyNewState(
          abortedState,
          this.seq + 1,
          'match_aborted',
          {
            reason: 'no_connected_seats_30s',
            matchId: this.matchId,
          },
          { forceFullState: true },
        );
        await this.invokeVaultRefund();
        return;
      }
    }

    for (const timer of expired) {
      if (this.isFinishedState(this.state)) break;

      if (timer.kind === 'ai_turn' && this.state && !this.isFinishedState(this.state)) {
        const cur = this.state.currentPlayer as PlayerColor;
        if (this.isBotOrAutoPlaying(cur)) {
          if (!this.isOriginalAiSeat(cur)) {
            const curStrikes = this.state.strikes?.[cur] || 0;
            const curAfk = this.state.afkStats?.[cur];
            // Escalate strikes 2 and 3 only for AFK-triggered auto-play, never voluntary trust delegation.
            if (curStrikes > 0 && !curAfk?.isKicked) {
              const nextStrikes = curStrikes + 1;
              const shouldKick = nextStrikes >= MAX_AFK_STRIKES;
              this.state = {
                ...this.state,
                strikes: { ...this.state.strikes, [cur]: nextStrikes },
                afkStats: {
                  ...this.state.afkStats,
                  [cur]: {
                    consecutiveTurns: (curAfk?.consecutiveTurns || 0) + 1,
                    totalTriggers: (curAfk?.totalTriggers || 0) + 1,
                    isAutoPlaying: true,
                    isKicked: shouldKick,
                  },
                },
                lastUpdate: Date.now(),
              };
            }
          }
          await this.executeServerBotTurn(cur);
        }
      }

      if ((timer.kind === 'turn' || timer.kind === 'TURN_TIMEOUT') && this.state && !this.isFinishedState(this.state)) {
        const cur = this.state.currentPlayer as PlayerColor;
        const curStrikes = this.state.strikes?.[cur] || 0;
        const nextStrikes = curStrikes + 1;
        const currentAfk = this.state.afkStats?.[cur] || {
          consecutiveTurns: 0,
          totalTriggers: 0,
          isAutoPlaying: false,
          isKicked: false,
        };
        const shouldKick = Boolean(currentAfk.isKicked) || nextStrikes >= MAX_AFK_STRIKES;
        this.state = {
          ...this.state,
          strikes: { ...this.state.strikes, [cur]: nextStrikes },
          afkStats: {
            ...this.state.afkStats,
            [cur]: {
              ...currentAfk,
              consecutiveTurns: (currentAfk.consecutiveTurns || 0) + 1,
              totalTriggers: (currentAfk.totalTriggers || 0) + 1,
              isAutoPlaying: true,
              isKicked: shouldKick,
            },
          },
          lastUpdate: Date.now(),
        };
        await this.executeServerBotTurn(cur, {
          suppressBonusRoll: true,
          eventTypeOverride: 'turn_timeout',
          eventExtra: {
            timedOutColor: cur,
            strikeCount: nextStrikes,
            isKicked: shouldKick,
          },
        });
      }

      for (const ws of this.ctx.getWebSockets()) {
        try {
          this.sendFrame(ws, {
            t: 'timer',
            timerId: timer.id,
            kind: timer.kind,
            deadlineAt: timer.deadlineAt,
            remainingMs: Math.max(0, timer.deadlineAt - Date.now()),
          });
        } catch {
          // Socket closed
        }
      }
    }

    await this.syncAlarmToHeap();
  }

  private getEarliestDeadline(): number | null {
    return this.getTurnDeadline();
  }

  // ─── Verification helpers ──────────────────────────────────────────────────
  private async verifyTicket(
    ticket: string,
    matchId: string
  ): Promise<{ ok: boolean; wallet?: string; role: 'seat' | 'spectator'; color?: string; code?: RoomErrorCode; error?: string }> {
    const tokenHash = await hashToken(ticket);
    const lookup = await this.queryDatabaseSession(tokenHash, matchId);
    if (lookup.status === 'expired') {
      return { ok: false, role: 'spectator', code: 'SESSION_EXPIRED', error: 'Match session has expired' };
    }
    if (lookup.status === 'missing' || lookup.row.match_id !== matchId) {
      return { ok: false, role: 'spectator', code: 'TICKET_INVALID', error: 'Invalid or expired match ticket' };
    }
    return {
      ok: true,
      wallet: lookup.row.wallet_address,
      role: lookup.row.scope === 'match' ? 'seat' : 'spectator',
      color: lookup.row.seat_color || undefined,
    };
  }

  private async verifyCookie(
    cookieHeader: string,
    matchId: string
  ): Promise<{ ok: boolean; wallet?: string; role: 'seat' | 'spectator'; color?: string; code?: RoomErrorCode; error?: string }> {
    const match = cookieHeader.match(/(?:__Host-ludo_session|ludo_session)=([^;]+)/);
    if (!match || !match[1]) return { ok: false, role: 'spectator' };
    return this.verifySessionToken(match[1], matchId, 'token');
  }

  private async verifySessionToken(
    token: string,
    matchId: string,
    credentialKind: 'token' | 'ticket' = 'token'
  ): Promise<{ ok: boolean; wallet?: string; role: 'seat' | 'spectator'; color?: string; code?: RoomErrorCode; error?: string }> {
    const tokenHash = await hashToken(token);
    const lookup = await this.queryDatabaseSession(tokenHash, matchId);
    if (lookup.status === 'expired') {
      return { ok: false, role: 'spectator', code: 'SESSION_EXPIRED', error: 'Session expired' };
    }
    if (lookup.status === 'missing') {
      return {
        ok: false,
        role: 'spectator',
        code: credentialKind === 'ticket' ? 'TICKET_INVALID' : 'NOT_AUTHORIZED',
        error: 'Session not found',
      };
    }
    const db = lookup.row;
    if (db.scope === 'match' && db.match_id === matchId) {
      return { ok: true, wallet: db.wallet_address, role: 'seat', color: db.seat_color || undefined };
    }
    if (db.scope === 'spectator' && db.match_id === matchId) {
      return { ok: true, wallet: db.wallet_address, role: 'spectator' };
    }
    if (db.scope === 'app') {
      return { ok: true, wallet: db.wallet_address, role: 'spectator' };
    }
    return { ok: false, role: 'spectator', code: 'NOT_AUTHORIZED', error: 'Insufficient session scope' };
  }

  private async queryDatabaseSession(
    tokenHash: string,
    _matchId: string
  ): Promise<
    | { status: 'ok'; row: { wallet_address: string; scope: string; match_id?: string; expires_at?: string | null; seat_color?: string | null; idle_expires_at?: string | null } }
    | { status: 'expired' }
    | { status: 'missing' }
  > {
    const supabaseUrl =
      (this.env as unknown as Record<string, string>).NEXT_PUBLIC_SUPABASE_URL ||
      process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey =
      (this.env as unknown as Record<string, string>).SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceKey) return { status: 'missing' };

    try {
      const url = `${supabaseUrl}/rest/v1/sessions?token_hash=eq.${tokenHash}&revoked_at=is.null&select=wallet_address,scope,match_id,expires_at,seat_color,idle_expires_at`;
      const res = await fetch(url, {
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
        },
      });
      if (!res.ok) return { status: 'missing' };
      const data = await res.json();
      if (!Array.isArray(data) || data.length === 0) return { status: 'missing' };
      const row = data[0] as {
        wallet_address: string;
        scope: string;
        match_id?: string;
        expires_at?: string | null;
        seat_color?: string | null;
        idle_expires_at?: string | null;
      };
      const nowMs = Date.now();
      if (row.expires_at && new Date(row.expires_at).getTime() <= nowMs) return { status: 'expired' };
      if (row.idle_expires_at && new Date(row.idle_expires_at).getTime() <= nowMs) return { status: 'expired' };
      return { status: 'ok', row };
    } catch {
      return { status: 'missing' };
    }
  }
}
