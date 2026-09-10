import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';
import { recoverMessageAddress } from 'https://esm.sh/viem@2.37.0';
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
  type ColorCorner,
  type EngineGameState,
  type PlayerColor,
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
const MAX_AGE_MS = 10 * 60 * 1000;

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
        message, signature, issuedAt, source,
      } = body;
      if (!matchId || !actor || !color || tokenIndex === undefined || !rollId || expectedSeq === undefined || !message || !signature || !issuedAt) {
        return json({ error: 'Missing move payload' }, 400);
      }
      if (!isFresh(issuedAt)) return json({ error: 'Proof expired' }, 401);

      const expectedMsg = buildMoveMessage({
        matchId, actor, color, tokenIndex: Number(tokenIndex), rollId, expectedSeq: Number(expectedSeq), issuedAt,
      });
      if (message !== expectedMsg) return json({ error: 'Message payload mismatch' }, 401);
      const recovered = await recover(message, signature);
      if (!recovered || recovered !== actor.toLowerCase()) {
        return json({ error: 'Invalid signature' }, 401);
      }

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
      const legal = getLegalTokenIndices(state.positions, color as PlayerColor, dice, cc);
      if (!legal.includes(Number(tokenIndex))) {
        return json({ error: 'Illegal token for this roll', legal }, 400);
      }

      const { newState, captured, bonusRoll, applied } = processMove(
        state,
        color as PlayerColor,
        Number(tokenIndex),
        dice,
        playerCount,
        cc,
        color as PlayerColor,
        activeColors(state)
      );
      if (!applied) return json({ error: 'Move rejected by engine' }, 400);

      const nextSeq = seq + 1;
      const toStore = { ...newState, lastUpdate: Date.now() };

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

      const fromPos = state.positions[color as PlayerColor][Number(tokenIndex)];
      await supabase.from('match_moves').insert({
        match_id: String(matchId),
        seq: nextSeq,
        actor: recovered,
        color,
        token_index: Number(tokenIndex),
        dice,
        roll_id: rollId,
        from_pos: fromPos,
        to_pos: toStore.positions[color as PlayerColor][Number(tokenIndex)],
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
      const { matchId, actor, rollId, expectedSeq, message, signature, issuedAt, source, reason } = body;
      if (!matchId || !actor || !rollId || expectedSeq === undefined || !message || !signature || !issuedAt) {
        return json({ error: 'Missing pass payload' }, 400);
      }
      if (!isFresh(issuedAt)) return json({ error: 'Proof expired' }, 401);
      const expectedMsg = buildPassMessage({
        matchId, actor, rollId, expectedSeq: Number(expectedSeq), issuedAt,
      });
      if (message !== expectedMsg) return json({ error: 'Message payload mismatch' }, 401);
      const recovered = await recover(message, signature);
      if (!recovered || recovered !== actor.toLowerCase()) {
        return json({ error: 'Invalid signature' }, 401);
      }

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
