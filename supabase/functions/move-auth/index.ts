import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';
import { recoverMessageAddress, recoverTypedDataAddress } from 'https://esm.sh/viem@2.37.0';
import {
  BASE_INDEX,
  BOARD_FINISH_INDEX,
  calculateNextPosition,
  getLegalTokenIndices,
  getNextPlayer,
  handleThreeSixes,
  processMove,
  activeColorsForTurns,
  stripPowerTypesForWire,
  resolveNetworkedMove,
  applyPower,
  type ColorCorner,
  type EngineGameState,
  type PlayerColor,
  type PowerType,
} from '../_shared/engine.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

const MOVE_PREFIX = 'Ludo Base move';
const PASS_PREFIX = 'Ludo Base pass';
const SEED_PREFIX = 'Ludo Base seed';
const POWER_PREFIX = 'Ludo Base power';
const MAX_AGE_MS = 10 * 60 * 1000;

const SESSION_DOMAIN = {
  name: 'Ludo Base',
  version: '1',
  chainId: 8453,
  verifyingContract: '0x0000000000000000000000000000000000000000',
} as const;
const SESSION_TYPES = {
  LudoMatchSession: [
    { name: 'wallet', type: 'address' },
    { name: 'matchId', type: 'string' },
    { name: 'roomCode', type: 'string' },
    { name: 'expiresAt', type: 'uint256' },
    { name: 'nonce', type: 'string' },
  ],
} as const;

async function verifyMatchSession(
  supabase: SupabaseClient,
  sessionId: string,
  matchId: string,
  expectedWallet: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: sess, error } = await supabase
    .from('match_sessions')
    .select('id, match_id, wallet_address, expires_at, revoked_at')
    .eq('id', sessionId)
    .maybeSingle();
  if (error || !sess) return { ok: false, error: 'Session not found' };
  if (sess.revoked_at) return { ok: false, error: 'Session revoked' };
  if (new Date(sess.expires_at).getTime() < Date.now()) return { ok: false, error: 'Session expired' };
  if (String(sess.match_id) !== String(matchId)) return { ok: false, error: 'Session match mismatch' };
  if (String(sess.wallet_address).toLowerCase() !== expectedWallet.toLowerCase()) {
    return { ok: false, error: 'Session wallet mismatch' };
  }
  return { ok: true };
}

function isFresh(issuedAt: string): boolean {
  const t = Date.parse(issuedAt);
  if (!Number.isFinite(t)) return false;
  const age = Date.now() - t;
  return age >= -60_000 && age <= MAX_AGE_MS;
}

function buildMoveMessage(p: { matchId: string; actor: string; color: string; tokenIndex: number; rollId: string; expectedSeq: number; issuedAt: string }) {
  return [
    MOVE_PREFIX,
    `match: ${p.matchId}`,
    `actor: ${p.actor.toLowerCase()}`,
    `color: ${p.color}`,
    `token: ${p.tokenIndex}`,
    `roll: ${p.rollId}`,
    `seq: ${p.expectedSeq}`,
    `issued: ${p.issuedAt}`,
  ].join('\n');
}

function buildPassMessage(p: { matchId: string; actor: string; rollId: string; expectedSeq: number; issuedAt: string }) {
  return [
    PASS_PREFIX,
    `match: ${p.matchId}`,
    `actor: ${p.actor.toLowerCase()}`,
    `roll: ${p.rollId}`,
    `seq: ${p.expectedSeq}`,
    `issued: ${p.issuedAt}`,
  ].join('\n');
}

function buildSeedMessage(p: { matchId: string; hostAddress: string; roomCode: string; expectedSeq: number; issuedAt: string }) {
  return [
    SEED_PREFIX,
    `match: ${p.matchId}`,
    `host: ${p.hostAddress.toLowerCase()}`,
    `room: ${p.roomCode}`,
    `seq: ${p.expectedSeq}`,
    `issued: ${p.issuedAt}`,
  ].join('\n');
}

function buildPowerMessage(p: {
  matchId: string; actor: string; color: string; power: string;
  tokenIndex: number | null; expectedSeq: number; issuedAt: string;
}) {
  return [
    POWER_PREFIX,
    `match: ${p.matchId}`,
    `actor: ${p.actor.toLowerCase()}`,
    `color: ${p.color}`,
    `power: ${p.power}`,
    `token: ${p.tokenIndex === null ? 'none' : p.tokenIndex}`,
    `seq: ${p.expectedSeq}`,
    `issued: ${p.issuedAt}`,
  ].join('\n');
}

async function recover(message: string, signature: string): Promise<string | null> {
  try {
    return (await recoverMessageAddress({ message, signature: signature as `0x${string}` })).toLowerCase();
  } catch {
    return null;
  }
}

type Seats = Record<string, { kind: 'human' | 'bot' | 'afk'; wallet?: string }>;

function seatOwnsColor(seats: Seats, color: string, wallet: string): { ok: boolean; kind?: string } {
  const seat = seats[color];
  if (!seat) return { ok: false };
  if (seat.kind === 'human') {
    return { ok: (seat.wallet || '').toLowerCase() === wallet.toLowerCase(), kind: 'human' };
  }
  return { ok: false, kind: seat.kind };
}

function activeColors(state: EngineGameState): PlayerColor[] {
  return activeColorsForTurns(state);
}

async function loadMatch(supabase: SupabaseClient, matchId: string) {
  const { data, error } = await supabase
    .from('match_states')
    .select('*')
    .eq('match_id', matchId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** Authorize in-match action: session key OR one-off signed message. */
async function authorizeActor(opts: {
  supabase: SupabaseClient;
  matchId: string;
  actor: string;
  sessionId?: string;
  message?: string;
  signature?: string;
  issuedAt?: string;
  expectedMessage?: string;
}): Promise<{ ok: true; via: 'session' | 'signature' } | { ok: false; error: string }> {
  const { supabase, matchId, actor, sessionId, message, signature, issuedAt, expectedMessage } = opts;
  if (sessionId) {
    const v = await verifyMatchSession(supabase, sessionId, matchId, actor);
    if (!v.ok) return v;
    return { ok: true, via: 'session' };
  }
  if (!message || !signature || !issuedAt || !expectedMessage) {
    return { ok: false, error: 'Missing session or signature' };
  }
  if (!isFresh(issuedAt)) return { ok: false, error: 'Proof expired' };
  if (message !== expectedMessage) return { ok: false, error: 'Message payload mismatch' };
  const recovered = await recover(message, signature);
  if (!recovered || recovered !== actor.toLowerCase()) {
    return { ok: false, error: 'Invalid signature' };
  }
  return { ok: true, via: 'signature' };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const url = new URL(req.url);
    const path = url.pathname.replace(/^\/+/, '');
    const body = await req.json();
    const action = body.action || path.split('/').pop();

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // ── SESSION: one EIP-712 grant per match (MetaMask / smart wallet) ──
    if (action === 'session' || path.endsWith('create-session')) {
      const { matchId, roomCode, wallet, expiresAt, nonce, signature } = body;
      if (!matchId || !wallet || !expiresAt || !nonce || !signature) {
        return json({ error: 'Missing session payload' }, 400);
      }
      if (Number(expiresAt) < Date.now()) return json({ error: 'expiresAt in the past' }, 400);
      // Cap session length (max 2h) so a typo cannot grant forever.
      if (Number(expiresAt) > Date.now() + 2 * 60 * 60 * 1000) {
        return json({ error: 'expiresAt too far in the future' }, 400);
      }

      let recovered: string;
      try {
        recovered = (await recoverTypedDataAddress({
          domain: SESSION_DOMAIN,
          types: SESSION_TYPES,
          primaryType: 'LudoMatchSession',
          message: {
            wallet: wallet as `0x${string}`,
            matchId: String(matchId),
            roomCode: String(roomCode || ''),
            expiresAt: BigInt(expiresAt),
            nonce: String(nonce),
          },
          signature: signature as `0x${string}`,
        })).toLowerCase();
      } catch {
        return json({ error: 'Invalid typed-data signature' }, 401);
      }
      if (recovered !== String(wallet).toLowerCase()) {
        return json({ error: 'Signer is not the session wallet' }, 401);
      }

      const row = await loadMatch(supabase, String(matchId));
      if (!row) return json({ error: 'Match not found — seed first' }, 404);
      const seats = row.player_seats as Seats;
      const humanSeat = Object.entries(seats).some(([, s]) =>
        s.kind === 'human' && (s.wallet || '').toLowerCase() === recovered
      );
      const isHostWallet = String(row.host_address || '').toLowerCase() === recovered;
      if (!humanSeat && !isHostWallet) {
        return json({ error: 'Wallet is not seated in this match' }, 403);
      }

      // Revoke prior active sessions for this wallet+match
      await supabase
        .from('match_sessions')
        .update({ revoked_at: new Date().toISOString() })
        .eq('match_id', String(matchId))
        .eq('wallet_address', recovered)
        .is('revoked_at', null);

      const { data: created, error: insErr } = await supabase
        .from('match_sessions')
        .insert({
          match_id: String(matchId),
          wallet_address: recovered,
          room_code: roomCode || row.room_code || null,
          expires_at: new Date(Number(expiresAt)).toISOString(),
        })
        .select('id, expires_at')
        .single();
      if (insErr || !created) return json({ error: insErr?.message || 'Session insert failed' }, 500);

      return json({ success: true, sessionId: created.id, expiresAt: created.expires_at, wallet: recovered });
    }

    // ── SEED: host writes initial match_states ──────────────────────────
    if (action === 'seed' || path.endsWith('seed-match')) {
      const { matchId, hostAddress, roomCode, colorCorner, playerSeats, initialState, message, signature, issuedAt, expectedSeq } = body;
      if (!matchId || !hostAddress || !message || !signature || !issuedAt || !colorCorner || !playerSeats || !initialState) {
        return json({ error: 'Missing seed payload' }, 400);
      }
      if (!isFresh(issuedAt)) return json({ error: 'Proof expired' }, 401);
      const expected = buildSeedMessage({
        matchId, hostAddress, roomCode: roomCode || '', expectedSeq: expectedSeq ?? 0, issuedAt,
      });
      if (message !== expected) return json({ error: 'Message payload mismatch' }, 401);
      const recovered = await recover(message, signature);
      if (!recovered || recovered !== hostAddress.toLowerCase()) {
        return json({ error: 'Invalid host signature' }, 401);
      }

      const { data: existing } = await supabase
        .from('match_states')
        .select('match_id, seq')
        .eq('match_id', matchId)
        .maybeSingle();
      if (existing && existing.seq > 0) {
        return json({ error: 'Match already seeded', seq: existing.seq }, 409);
      }

      const state = {
        ...initialState,
        matchId,
        seq: 0,
        lastUpdate: Date.now(),
        gamePhase: 'rolling',
        status: 'playing',
        isStarted: true,
      };

      const { error: upErr } = await supabase.from('match_states').upsert({
        match_id: matchId,
        room_code: roomCode || null,
        host_address: hostAddress.toLowerCase(),
        seq: 0,
        state,
        color_corner: colorCorner,
        player_seats: playerSeats,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'match_id' });
      if (upErr) return json({ error: upErr.message }, 500);
      return json({ success: true, seq: 0, state: stripPowerTypesForWire(state) });
    }

    // ── MOVE ────────────────────────────────────────────────────────────
    if (action === 'move' || path.endsWith('submit-move')) {
      const {
        matchId, actor, color, tokenIndex, rollId, expectedSeq,
        message, signature, issuedAt, source, sessionId,
      } = body;
      if (!matchId || !actor || !color || tokenIndex === undefined || !rollId || expectedSeq === undefined) {
        return json({ error: 'Missing move payload' }, 400);
      }

      const issued = issuedAt || new Date().toISOString();
      const expectedMsg = buildMoveMessage({
        matchId, actor, color, tokenIndex: Number(tokenIndex), rollId, expectedSeq: Number(expectedSeq), issuedAt: issued,
      });
      const auth = await authorizeActor({
        supabase,
        matchId: String(matchId),
        actor: String(actor),
        sessionId,
        message,
        signature,
        issuedAt,
        expectedMessage: expectedMsg,
      });
      if (!auth.ok) return json({ error: auth.error }, 401);
      const recovered = String(actor).toLowerCase();

      const row = await loadMatch(supabase, matchId);
      if (!row) return json({ error: 'Match not found' }, 404);

      const seq = Number(row.seq);
      if (Number(expectedSeq) !== seq) {
        return json({ error: 'Stale seq', seq }, 409);
      }

      const state = row.state as EngineGameState;
      const cc = row.color_corner as ColorCorner;
      const seats = row.player_seats as Seats;
      const playerCount = (state.playerCount || '4P') as EngineGameState['playerCount'];

      if (state.winner) return json({ error: 'Match finished' }, 400);
      if (state.currentPlayer !== color) return json({ error: 'Not this color turn', currentPlayer: state.currentPlayer }, 403);

      // Ownership
      if (source === 'host-assist') {
        if (recovered !== String(row.host_address || '').toLowerCase()) {
          return json({ error: 'Only host may assist' }, 403);
        }
        const seat = seats[color];
        if (!seat || seat.kind === 'human') {
          return json({ error: 'host-assist only for bot/AFK seats' }, 403);
        }
      } else {
        const own = seatOwnsColor(seats, color, recovered);
        if (!own.ok) return json({ error: 'Not your seat' }, 403);
      }

      // Roll binding
      const { data: roll, error: rollErr } = await supabase
        .from('match_rolls')
        .select('id, result, match_id, status')
        .eq('id', rollId)
        .maybeSingle();
      if (rollErr || !roll) return json({ error: 'Roll not found' }, 404);
      if (roll.match_id !== String(matchId)) return json({ error: 'Roll match mismatch' }, 403);
      if (roll.status !== 'open') return json({ error: 'Roll already consumed' }, 409);

      const dice = Number(roll.result);
      const boosted = state.activeBoost === color;
      const steps = boosted ? dice + 6 : dice;
      const legal = getLegalTokenIndices(state.positions, color as PlayerColor, steps, cc);
      if (!legal.includes(Number(tokenIndex))) {
        return json({ error: 'Illegal token for this roll', legal, boosted }, 400);
      }

      const move = resolveNetworkedMove({
        state,
        color: color as PlayerColor,
        tokenIndex: Number(tokenIndex),
        dice,
        cc,
        playerCount,
        activeColors: activeColors(state),
      });
      if (!move.ok || !move.state) {
        return json({ error: move.error || 'Move rejected by engine' }, 400);
      }
      const { captured, bonusRoll } = move;
      const nextSeq = seq + 1;
      const toStore = { ...move.state, lastUpdate: Date.now() };

      const { error: saveErr } = await supabase
        .from('match_states')
        .update({
          seq: nextSeq,
          state: toStore,
          updated_at: new Date().toISOString(),
        })
        .eq('match_id', matchId)
        .eq('seq', seq); // optimistic concurrency
      if (saveErr) return json({ error: saveErr.message }, 500);

      // Re-read to confirm we won the race
      const confirm = await loadMatch(supabase, matchId);
      if (!confirm || Number(confirm.seq) !== nextSeq) {
        return json({ error: 'Concurrent update', seq: confirm?.seq ?? seq }, 409);
      }

      await supabase.from('match_rolls').update({
        status: 'consumed',
        consumed_seq: nextSeq,
      }).eq('id', rollId);

      const fromPos = move.fromPos ?? state.positions[color as PlayerColor][Number(tokenIndex)];
      await supabase.from('match_moves').insert({
        match_id: String(matchId),
        seq: nextSeq,
        actor: recovered,
        color,
        token_index: Number(tokenIndex),
        dice,
        roll_id: rollId,
        from_pos: fromPos,
        to_pos: move.toPos ?? toStore.positions[color as PlayerColor][Number(tokenIndex)],
        captured,
        bonus_roll: bonusRoll,
      });

      // Broadcast to room channel (best-effort)
      try {
        const room = row.room_code;
        if (room) {
          await supabase.channel(`game-room-${room}`).send({
            type: 'broadcast',
            event: 'game-action',
            payload: {
              type: 'ENGINE_STATE',
              actionId: `move-${matchId}-${nextSeq}`,
              stateOverride: stripPowerTypesForWire(toStore),
              gameState: stripPowerTypesForWire(toStore),
              seq: nextSeq,
              source: 'match_states',
            },
          });
        }
      } catch { /* realtime optional */ }

      return json({
        success: true,
        seq: nextSeq,
        captured,
        bonusRoll,
        state: stripPowerTypesForWire(toStore),
      });
    }

    // ── PASS TURN ───────────────────────────────────────────────────────
    if (action === 'pass' || path.endsWith('pass-turn')) {
      const { matchId, actor, rollId, expectedSeq, message, signature, issuedAt, source, reason, sessionId } = body;
      if (!matchId || !actor || !rollId || expectedSeq === undefined) {
        return json({ error: 'Missing pass payload' }, 400);
      }
      const issuedP = issuedAt || new Date().toISOString();
      const expectedMsg = buildPassMessage({
        matchId, actor, rollId, expectedSeq: Number(expectedSeq), issuedAt: issuedP,
      });
      const authP = await authorizeActor({
        supabase, matchId: String(matchId), actor: String(actor), sessionId,
        message, signature, issuedAt, expectedMessage: expectedMsg,
      });
      if (!authP.ok) return json({ error: authP.error }, 401);
      const recovered = String(actor).toLowerCase();

      const row = await loadMatch(supabase, matchId);
      if (!row) return json({ error: 'Match not found' }, 404);
      const seq = Number(row.seq);
      if (Number(expectedSeq) !== seq) return json({ error: 'Stale seq', seq }, 409);

      const state = row.state as EngineGameState;
      const cc = row.color_corner as ColorCorner;
      const seats = row.player_seats as Seats;
      const color = state.currentPlayer;

      if (source === 'host-assist') {
        if (recovered !== String(row.host_address || '').toLowerCase()) {
          return json({ error: 'Only host may assist' }, 403);
        }
      } else {
        const own = seatOwnsColor(seats, color, recovered);
        if (!own.ok) return json({ error: 'Not your seat' }, 403);
      }

      const { data: roll } = await supabase
        .from('match_rolls')
        .select('id, result, match_id, status')
        .eq('id', rollId)
        .maybeSingle();
      if (!roll || roll.match_id !== String(matchId)) return json({ error: 'Roll not found' }, 404);
      if (roll.status !== 'open') return json({ error: 'Roll already consumed' }, 409);

      const dice = Number(roll.result);
      const legal = getLegalTokenIndices(state.positions, color, dice, cc);

      // Pass is only valid when no legal move OR explicit three-sixes
      const { isThreeSixes } = handleThreeSixes(state.consecutiveSixes || 0, dice);
      if (!isThreeSixes && legal.length > 0 && reason !== 'forced') {
        return json({ error: 'Legal moves exist', legal }, 400);
      }

      let next = { ...state };
      if (isThreeSixes) {
        next.consecutiveSixes = 0;
      } else {
        next.consecutiveSixes = dice === 6 ? (state.consecutiveSixes || 0) + 1 : 0;
      }
      next.currentPlayer = getNextPlayer(
        color,
        state.playerCount || '4P',
        activeColors(state),
        cc
      );
      next.diceValue = null;
      next.gamePhase = 'rolling';
      next.lastUpdate = Date.now();

      const nextSeq = seq + 1;
      const { error: saveErr } = await supabase
        .from('match_states')
        .update({ seq: nextSeq, state: next, updated_at: new Date().toISOString() })
        .eq('match_id', matchId)
        .eq('seq', seq);
      if (saveErr) return json({ error: saveErr.message }, 500);

      await supabase.from('match_rolls').update({
        status: 'passed',
        consumed_seq: nextSeq,
      }).eq('id', rollId);

      await supabase.from('match_moves').insert({
        match_id: String(matchId),
        seq: nextSeq,
        actor: recovered,
        color,
        token_index: -1,
        dice,
        roll_id: rollId,
        from_pos: null,
        to_pos: null,
        captured: false,
        bonus_roll: false,
      });

      try {
        const room = row.room_code;
        if (room) {
          await supabase.channel(`game-room-${room}`).send({
            type: 'broadcast',
            event: 'game-action',
            payload: {
              type: 'ENGINE_STATE',
              actionId: `pass-${matchId}-${nextSeq}`,
              stateOverride: stripPowerTypesForWire(next),
              gameState: stripPowerTypesForWire(next),
              seq: nextSeq,
              source: 'match_states',
            },
          });
        }
      } catch { /* optional */ }

      return json({ success: true, seq: nextSeq, state: stripPowerTypesForWire(next) });
    }

    // ── POWER (shield / boost / nuke / teleport) ────────────────────────
    if (action === 'power' || path.endsWith('submit-power')) {
      const {
        matchId, actor, color, power, tokenIndex, expectedSeq,
        message, signature, issuedAt, source, sessionId,
      } = body;
      if (!matchId || !actor || !color || !power || expectedSeq === undefined) {
        return json({ error: 'Missing power payload' }, 400);
      }
      const issuedW = issuedAt || new Date().toISOString();
      const ti = tokenIndex === null || tokenIndex === undefined ? null : Number(tokenIndex);
      const expectedMsg = buildPowerMessage({
        matchId, actor, color, power: String(power), tokenIndex: ti, expectedSeq: Number(expectedSeq), issuedAt: issuedW,
      });
      const authW = await authorizeActor({
        supabase, matchId: String(matchId), actor: String(actor), sessionId,
        message, signature, issuedAt, expectedMessage: expectedMsg,
      });
      if (!authW.ok) return json({ error: authW.error }, 401);
      const recovered = String(actor).toLowerCase();

      const row = await loadMatch(supabase, matchId);
      if (!row) return json({ error: 'Match not found' }, 404);
      const seq = Number(row.seq);
      if (Number(expectedSeq) !== seq) return json({ error: 'Stale seq', seq }, 409);

      const state = row.state as EngineGameState;
      const cc = row.color_corner as ColorCorner;
      const seats = row.player_seats as Seats;
      const playerCount = (state.playerCount || '4P') as EngineGameState['playerCount'];

      if (source === 'host-assist') {
        if (recovered !== String(row.host_address || '').toLowerCase()) {
          return json({ error: 'Only host may assist' }, 403);
        }
      } else {
        const own = seatOwnsColor(seats, color, recovered);
        if (!own.ok) return json({ error: 'Not your seat' }, 403);
      }

      const result = applyPower(
        state,
        color as PlayerColor,
        power as PowerType,
        ti ?? undefined,
        cc,
        playerCount
      );
      if (!result.ok) {
        return json({
          error: result.error,
          armed: result.armed,
          kept: result.kept,
          seq,
        }, result.kept ? 200 : 400);
      }

      const nextSeq = seq + 1;
      const toStore = { ...result.state, lastUpdate: Date.now() };
      const { error: saveErr } = await supabase
        .from('match_states')
        .update({ seq: nextSeq, state: toStore, updated_at: new Date().toISOString() })
        .eq('match_id', matchId)
        .eq('seq', seq);
      if (saveErr) return json({ error: saveErr.message }, 500);

      try {
        const room = row.room_code;
        if (room) {
          await supabase.channel(`game-room-${room}`).send({
            type: 'broadcast',
            event: 'game-action',
            payload: {
              type: 'ENGINE_STATE',
              actionId: `power-${matchId}-${nextSeq}`,
              stateOverride: stripPowerTypesForWire(toStore),
              gameState: stripPowerTypesForWire(toStore),
              seq: nextSeq,
              source: 'match_states',
            },
          });
        }
      } catch { /* optional */ }

      return json({
        success: true,
        seq: nextSeq,
        message: result.message,
        nukeFlash: result.nukeFlash,
        state: stripPowerTypesForWire(toStore),
      });
    }

    // ── GET STATE ───────────────────────────────────────────────────────
    if (action === 'get' || path.endsWith('get-match-state')) {
      const matchId = body.matchId || url.searchParams.get('matchId');
      if (!matchId) return json({ error: 'matchId required' }, 400);
      const row = await loadMatch(supabase, String(matchId));
      if (!row) return json({ error: 'Not found' }, 404);
      return json({
        seq: row.seq,
        state: stripPowerTypesForWire(row.state as EngineGameState),
        hostAddress: row.host_address,
        roomCode: row.room_code,
      });
    }

    return json({ error: `Unknown action: ${action}` }, 404);
  } catch (err) {
    console.error('❌ [MoveAuth] Error:', err);
    return json({ error: (err as Error).message }, 400);
  }
});
