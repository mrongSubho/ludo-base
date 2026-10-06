import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';
import { verifyPersonalSign, verifyTypedDataSign, parseChainId, DEFAULT_CHAIN_ID } from '../_shared/walletVerify.ts';
import {
  BASE_INDEX,
  BOARD_FINISH_INDEX,
  calculateNextPosition,
  getLegalTokenIndices,
  getNextPlayer,
  handleThreeSixes,
  isValidDice,
  processMove,
  activeColorsForTurns,
  stripPowerTypesForWire,
  pickPersistedState,
  resolveNetworkedMove,
  applyPower,
  type ColorCorner,
  type EngineGameState,
  type PlayerColor,
  type PowerType,
} from '../_shared/engine.ts';
import {
  checkExpectedSequence,
  compareAndSwapSequence,
  confirmSequenceAfterWrite,
  isDuplicateAction,
  isExpired,
  isTerminalMatch,
} from '../_shared/networkBoundary.ts';
import { verifyMatchSession } from '../_shared/matchSession.ts';
import { edgeError, edgeErrorBody, edgeErrorStatus, opaquePowerError } from '../_shared/errors.ts';
import { checkRollBinding } from '../_shared/rollReceipt.ts';
import { boardDigest } from '../_shared/boardDigest.ts';
import { assignCorners2v2, assignCornersFFA } from '../_shared/corners.ts';
import {
  casWon,
  checkPassLegality,
  checkSeatAuthority,
  passStatePatch,
} from '../_shared/turnAuthority.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-ludo-edge-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

/** Q6 — calver bumped on each deploy (lockstep with lib/edgeOps.ts EDGE_API_VERSION). */
const EDGE_API_VERSION = '2026-09-23.1';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS,
      'Content-Type': 'application/json',
      'x-ludo-edge-version': EDGE_API_VERSION,
    },
  });
}

const MOVE_PREFIX = 'Ludo Base move';
const PASS_PREFIX = 'Ludo Base pass';
const SEED_PREFIX = 'Ludo Base seed';
const POWER_PREFIX = 'Ludo Base power';
const MAX_AGE_MS = 10 * 60 * 1000;

const SESSION_DOMAIN_BASE = {
  name: 'Ludo Base',
  version: '1',
  // NOTE: kept in lockstep with lib/sessionProof.ts buildSessionDomain —
  // no verifyingContract (no onchain verifier exists; 0x0 reads as a scam
  // signal in wallet Review screens). Both sides must build byte-identical
  // domains or verification fails closed. chainId is resolved per-request
  // from body.chainId (allowlisted 84532/8453, default mainnet).
} as const;

/** Dual-chain session domain. Unknown chain ids fall back to mainnet here
 *  AND fail inside verifyTypedDataSign only when the domain itself is not
 *  allowlisted — explicit non-allowlist body.chainId is rejected 400 first. */
function sessionDomainFor(chainId: unknown) {
  if (chainId !== undefined && parseChainId(chainId) === null) return null;
  const cid = parseChainId(chainId) ?? DEFAULT_CHAIN_ID;
  return { ...SESSION_DOMAIN_BASE, chainId: cid } as const;
}
const SESSION_TYPES = {
  LudoMatchSession: [
    { name: 'wallet', type: 'address' },
    { name: 'matchId', type: 'string' },
    { name: 'roomCode', type: 'string' },
    { name: 'expiresAt', type: 'uint256' },
    { name: 'nonce', type: 'string' },
  ],
} as const;

function isFresh(issuedAt: string): boolean {
  const t = Date.parse(issuedAt);
  if (!Number.isFinite(t)) return false;
  const age = Date.now() - t;
  return age >= -60_000 && age <= MAX_AGE_MS;
}

function buildMoveMessage(p: { matchId: string; actor: string; color: string; tokenIndex: number; rollId: string; expectedSeq: number; issuedAt: string }) {
  return [
    MOVE_PREFIX,
    'Confirm your move — this only proves it is you.',
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
    'Confirm you skip this turn.',
    `match: ${p.matchId}`,
    `actor: ${p.actor.toLowerCase()}`,
    `roll: ${p.rollId}`,
    `seq: ${p.expectedSeq}`,
    `issued: ${p.issuedAt}`,
  ].join('\n');
}

function buildSeedMessage(p: { matchId: string; hostAddress: string; roomCode: string; expectedSeq: number; issuedAt: string; board: string }) {
  return [
    SEED_PREFIX,
    'Start this match — nothing leaves your wallet.',
    `match: ${p.matchId}`,
    `host: ${p.hostAddress.toLowerCase()}`,
    `room: ${p.roomCode}`,
    `seq: ${p.expectedSeq}`,
    // SEC-16: the board the host is agreeing to. Without it the signature
    // covered only the match identity, so any board could be seeded afterwards.
    `board: ${p.board}`,
    `issued: ${p.issuedAt}`,
  ].join('\n');
}

function buildPowerMessage(p: {
  matchId: string; actor: string; color: string; power: string;
  tokenIndex: number | null; expectedSeq: number; issuedAt: string;
}) {
  return [
    POWER_PREFIX,
    'Confirm your power play — this only proves it is you.',
    `match: ${p.matchId}`,
    `actor: ${p.actor.toLowerCase()}`,
    `color: ${p.color}`,
    `power: ${p.power}`,
    `token: ${p.tokenIndex === null ? 'none' : p.tokenIndex}`,
    `seq: ${p.expectedSeq}`,
    `issued: ${p.issuedAt}`,
  ].join('\n');
}

/** 6492-aware personal-sign check (EOA ecrecover + 1271/6492 on the 8453/84532 allowlist). */
async function verifyActorSignature(
  actor: string,
  message: string,
  signature: string,
): Promise<{ ok: true } | { ok: false; error: string; code: string }> {
  const verdict = await verifyPersonalSign({ address: actor, message, signature });
  if (verdict.ok) return { ok: true };
  return {
    ok: false,
    error: verdict.code === 'ecrecover-invalid' ? 'Invalid signature' : 'Signer mismatch',
    code: verdict.code,
  };
}

type Seats = Record<string, { kind: 'human' | 'bot' | 'afk'; wallet?: string }>;

/** Wallet owning `color`, or null when the seat is a bot/AFK/unowned. */
function seatWalletOf(seats: Seats, color: string): string | null {
  const seat = seats[color];
  if (!seat || seat.kind !== 'human') return null;
  return seat.wallet || null;
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

async function staleStateResponse(supabase: SupabaseClient, matchId: string) {
  const current = await loadMatch(supabase, String(matchId));
  if (!current) return json({ error: 'Match not found', code: 'MATCH_NOT_FOUND' }, 404);
  return json({
    error: 'Stale seq',
    code: 'STALE_SEQ',
    seq: Number(current.seq),
    state: stripPowerTypesForWire(current.state as EngineGameState),
  }, 409);
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
}): Promise<{ ok: true; via: 'session' | 'signature' } | { ok: false; error: string; code?: string }> {
  const { supabase, matchId, actor, sessionId, message, signature, issuedAt, expectedMessage } = opts;
  if (sessionId) {
    const v = await verifyMatchSession(supabase, sessionId, matchId, actor);
    if (!v.ok) return { ...v, code: 'SESSION_EXPIRED' };
    return { ok: true, via: 'session' };
  }
  if (!message || !signature || !issuedAt || !expectedMessage) {
    return { ok: false, error: 'Missing session or signature' };
  }
  if (!isFresh(issuedAt)) return { ok: false, error: 'Proof expired' };
  if (message !== expectedMessage) return { ok: false, error: 'Message payload mismatch' };
  const sigCheck = await verifyActorSignature(String(actor), message, signature);
  if (!sigCheck.ok) {
    return { ok: false, error: sigCheck.error, code: sigCheck.code };
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
    if (action === 'provisional-session') {
      const { authorizationKey, roomCode, wallet, expiresAt, nonce, signature } = body;
      if (!authorizationKey || !wallet || !expiresAt || !nonce || !signature) {
        return json({ error: 'Missing provisional session payload' }, 400);
      }
      if (Number(expiresAt) < Date.now() || Number(expiresAt) > Date.now() + 2 * 60 * 60 * 1000) {
        return json({ error: 'Invalid provisional expiry' }, 400);
      }
      const provisionalDomain = sessionDomainFor(body.chainId);
      if (!provisionalDomain) return json({ error: 'Unsupported chain' }, 400);
      // 6492-aware typed-data grant (EOA ecrecover + 1271/6492 on the grant chain).
      const provisionalVerdict = await verifyTypedDataSign({
        domain: provisionalDomain,
        types: SESSION_TYPES,
        primaryType: 'LudoMatchSession',
        message: {
          wallet: wallet as `0x${string}`,
          matchId: String(authorizationKey),
          roomCode: String(roomCode || ''),
          expiresAt: BigInt(expiresAt),
          nonce: String(nonce),
        },
        claimedWallet: String(wallet),
        signature,
        chainId: provisionalDomain.chainId,
      });
      if (!provisionalVerdict.ok) {
        return json({ error: 'Invalid provisional typed-data signature', code: provisionalVerdict.code }, 401);
      }
      const recovered: string = String(wallet).toLowerCase();
      const { data, error } = await supabase.from('provisional_match_sessions').upsert({
        authorization_key: String(authorizationKey),
        wallet_address: recovered,
        room_code: roomCode || null,
        expires_at: new Date(Number(expiresAt)).toISOString(),
        // SEC-17: scoped to the wallet as well. On `authorization_key` alone two
        // wallets sharing a key silently overwrote each other's grant.
      }, { onConflict: 'authorization_key,wallet_address' }).select('id').single();
      if (error || !data) return json({ error: error?.message || 'Provisional session failed' }, 500);
      return json({ success: true, provisionalId: data.id });
    }

    if (action === 'bind-provisional-session') {
      const { provisionalId, matchId, roomCode } = body;
      if (!provisionalId || !matchId) return json({ error: 'Missing provisional binding payload' }, 400);
      const provisional = await supabase.from('provisional_match_sessions')
        .select('wallet_address, expires_at, room_code').eq('id', provisionalId).maybeSingle();
      if (provisional.error || !provisional.data) return json({ error: 'Provisional session not found' }, 404);
      if (isExpired(provisional.data.expires_at, Date.now())) return json({ error: 'Provisional session expired' }, 401);
      const row = await loadMatch(supabase, String(matchId));
      if (!row) return json({ error: 'Match not found — seed first' }, 404);
      const wallet = String(provisional.data.wallet_address).toLowerCase();
      const seated = Object.values(row.player_seats as Seats).some(s =>
        s.kind === 'human' && (s.wallet || '').toLowerCase() === wallet
      );
      if (!seated && String(row.host_address || '').toLowerCase() !== wallet) {
        return json({ error: 'Wallet is not seated in this match' }, 403);
      }
      const existing = await supabase.from('match_sessions')
        .select('id, expires_at').eq('match_id', String(matchId))
        .eq('wallet_address', wallet).is('revoked_at', null).maybeSingle();
      if (existing.data) {
        return json({ success: true, sessionId: existing.data.id, expiresAt: existing.data.expires_at });
      }
      const { data, error } = await supabase.from('match_sessions').insert({
        match_id: String(matchId),
        wallet_address: wallet,
        room_code: roomCode || provisional.data.room_code || row.room_code || null,
        expires_at: provisional.data.expires_at,
      }).select('id, expires_at').single();
      if (error || !data) return json({ error: error?.message || 'Session binding failed' }, 500);
      return json({ success: true, sessionId: data.id, expiresAt: data.expires_at });
    }

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

      const grantDomain = sessionDomainFor(body.chainId);
      if (!grantDomain) return json({ error: 'Unsupported chain' }, 400);
      // 6492-aware typed-data grant (EOA ecrecover + 1271/6492 on the grant chain).
      const sessionVerdict = await verifyTypedDataSign({
        domain: grantDomain,
        types: SESSION_TYPES,
        primaryType: 'LudoMatchSession',
        message: {
          wallet: wallet as `0x${string}`,
          matchId: String(matchId),
          roomCode: String(roomCode || ''),
          expiresAt: BigInt(expiresAt),
          nonce: String(nonce),
        },
        claimedWallet: String(wallet),
        signature,
        chainId: grantDomain.chainId,
      });
      if (!sessionVerdict.ok) {
        return json({ error: 'Invalid typed-data signature', code: sessionVerdict.code }, 401);
      }
      const recovered: string = String(wallet).toLowerCase();

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
      // SEC-16: recompute the digest from what actually arrived and compare.
      // The client signing its own digest proves nothing if we trust that value.
      const actualBoard = await boardDigest({ initialState, colorCorner, playerSeats });
      const expected = buildSeedMessage({
        matchId, hostAddress, roomCode: roomCode || '', expectedSeq: expectedSeq ?? 0,
        issuedAt, board: actualBoard,
      });
      if (message !== expected) return json({ error: 'Message payload mismatch' }, 401);
      const seedCheck = await verifyActorSignature(String(hostAddress), message, signature);
      if (!seedCheck.ok) {
        return json({ error: 'Invalid host signature', code: seedCheck.code }, 401);
      }
      const recovered = String(hostAddress).toLowerCase();

      const { data: canonicalMatch, error: matchError } = await supabase
        .from('matches')
        .select('id, room_code, participants')
        .eq('id', String(matchId))
        .maybeSingle();
      // SEC-31: a PostgREST error names the table, column and constraint and its
      // hint suggests the exact GRANT to add. Log it, never return it.
      if (matchError) {
        console.error('[move-auth] matches read failed', JSON.stringify({
          code: matchError.code, message: matchError.message, hint: matchError.hint,
        }));
        return json(edgeErrorBody('INTERNAL'), edgeErrorStatus('INTERNAL'));
      }
      if (!canonicalMatch) return json({ error: 'Canonical match not found' }, 404);
      const canonicalParticipants = (canonicalMatch.participants || []).map((p: string) => String(p).toLowerCase());
      if (String(canonicalMatch.room_code || '') !== String(roomCode || '') ||
          canonicalParticipants[0] !== String(hostAddress).toLowerCase()) {
        return json({ error: 'Seed identity does not match canonical match' }, 403);
      }
      const seats = playerSeats as Seats;
      const SEAT_KEYS = ['green', 'red', 'yellow', 'blue'];
      // Seat keys must be a subset of the four colours: an extra key is a seat
      // the engine never reads, and a smuggling channel into persisted state.
      for (const key of Object.keys(seats)) {
        if (!SEAT_KEYS.includes(key)) return json({ error: 'Unknown seat key' }, 400);
      }
      const seenWallets = new Set<string>();
      for (const [key, seat] of Object.entries(seats)) {
        if (!SEAT_KEYS.includes(key) || !seat) return json({ error: 'Invalid seat entry' }, 400);
        if (seat.kind === 'human') {
          const w = String(seat.wallet || '').toLowerCase();
          if (!w || !canonicalParticipants.includes(w)) {
            return json({ error: 'Seat wallet is not a canonical participant' }, 403);
          }
          // The same wallet in two seats would let one player hold both sides.
          if (seenWallets.has(w)) return json({ error: 'Wallet seated twice' }, 400);
          seenWallets.add(w);
        } else if (seat.kind !== 'bot' && seat.kind !== 'afk') {
          return json({ error: 'Unknown seat kind' }, 400);
        }
      }

      // SEC-16: the colour assignment must match what the engine derives for the
      // declared mode, so a host cannot seat a 2v2 pair on one diagonal.
      const declaredCount = String((initialState as { playerCount?: unknown })?.playerCount ?? '4P');
      const derivedCc = declaredCount === '2v2'
        ? assignCorners2v2()
        : assignCornersFFA(declaredCount === '1v1' ? '1v1' : '4P');
      const ccGiven = (colorCorner || {}) as Record<string, string>;
      if (!SEAT_KEYS.every((k) => (derivedCc as Record<string, string>)[k] === ccGiven[k])) {
        return json({ error: 'color_corner does not match the declared mode' }, 400);
      }

      const { data: existing } = await supabase
        .from('match_states')
        .select('match_id, seq')
        .eq('match_id', matchId)
        .maybeSingle();
      if (existing && existing.seq > 0) {
        return json({ error: 'Match already seeded', seq: existing.seq }, 409);
      }

      // SEC-32: `initialState` arrives from the request. It is persisted into an
      // authority row, so it goes through the whitelist rather than being stored
      // as received — the old blacklist covered only powerTiles[].type.
      const state = {
        ...pickPersistedState(initialState),
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
      if (upErr) {
        console.error('[move-auth] session upsert failed', JSON.stringify({
          code: upErr.code, message: upErr.message, hint: upErr.hint,
        }));
        return json(edgeErrorBody('INTERNAL'), edgeErrorStatus('INTERNAL'));
      }
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
      if (!auth.ok) return json({ error: auth.error, code: auth.code }, 401);
      const recovered = String(actor).toLowerCase();

      const row = await loadMatch(supabase, matchId);
      if (!row) return json({ error: 'Match not found' }, 404);

      const seq = Number(row.seq);
      if (!checkExpectedSequence(seq, Number(expectedSeq)).ok) {
        return staleStateResponse(supabase, matchId);
      }

      const state = row.state as EngineGameState;
      const cc = row.color_corner as ColorCorner;
      const seats = row.player_seats as Seats;
      const playerCount = (state.playerCount || '4P') as EngineGameState['playerCount'];

      if (isTerminalMatch(state)) return json({ error: 'Match finished', code: 'MATCH_FINISHED' }, 409);
      if (state.currentPlayer !== color) return json({ error: 'Not this color turn', currentPlayer: state.currentPlayer }, 403);

      // Ownership
      // SEC-19: `move` already refused host-assist on a human seat; `pass` did
      // not. Both now call one function, so they cannot diverge again.
      const seatOk = checkSeatAuthority({
        source,
        seats: seats as Record<string, { kind: string; wallet?: string }>,
        color: String(color),
        actor: recovered,
        hostAddress: row.host_address,
      });
      if (!seatOk.ok) return json({ error: seatOk.error, code: seatOk.code }, seatOk.status);

      // Roll binding (SEC-01)
      const { data: roll, error: rollErr } = await supabase
        .from('match_rolls')
        .select('id, result, match_id, status, seat_color, turn_seq, wallet_address')
        .eq('id', rollId)
        .maybeSingle();
      if (rollErr) return json({ error: 'Roll lookup failed' }, 500);
      if (!roll) return json({ error: 'Roll not found' }, 404);
      if (roll.match_id !== String(matchId)) {
        return json({ error: 'Roll match mismatch' }, 403);
      }
      const binding = checkRollBinding({
        roll, color: String(color), seq,
        hostAddress: row.host_address,
        seatWallet: (c: string) => seatWalletOf(seats, c),
      });
      if (!binding.ok) return json({ error: binding.error, code: binding.code }, binding.status);
      if (isDuplicateAction(roll.status)) return json({ error: 'Roll already consumed', code: 'DUPLICATE_ACTION' }, 409);

      // ENG-13: the face comes from a CHECK-constrained column, but a receipt
      // written by an older build or a hand-edited row must not reach the engine.
      const dice = Number(roll.result);
      if (!isValidDice(dice)) {
        return json({ error: 'Invalid dice face', code: 'ILLEGAL_ACTION' }, 400);
      }
      const boosted = state.activeBoost === color;
      const steps = boosted ? dice + 6 : dice;
      const legal = getLegalTokenIndices(state.positions, color as PlayerColor, steps, cc);
      if (!legal.includes(Number(tokenIndex))) {
        return json({ error: 'Illegal token for this roll', legal, boosted }, 400);
      }

      // ENG-05: the third consecutive six forfeits the turn. It is a `pass`, not
      // a move, and the counter now lives in the engine rather than in a
      // hook-level copy the client controls.
      if (handleThreeSixes(state.consecutiveSixes || 0, dice).isThreeSixes) {
        return json({ error: 'Third consecutive six forfeits the turn', code: 'THREE_SIXES' }, 409);
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
      const nextSeq = compareAndSwapSequence(seq, Number(expectedSeq));
      if (nextSeq === null) return staleStateResponse(supabase, matchId);
      const toStore = { ...move.state, lastUpdate: Date.now() };

      // SEC-15: select the column back. A CAS that matches zero rows is a 200
      // with an empty body, not an error — without this the loser of a race
      // reported success for a state it never persisted.
      const { data: saved, error: saveErr } = await supabase
        .from('match_states')
        .update({
          seq: nextSeq,
          // SEC-32: whitelist on every write, not only at seed.
          state: pickPersistedState(toStore),
          updated_at: new Date().toISOString(),
        })
        .eq('match_id', matchId)
        .eq('seq', seq) // optimistic concurrency
        .select('seq');
      const cas = casWon({ error: saveErr, data: saved });
      if (!cas.ok) return staleStateResponse(supabase, matchId);

      // Re-read to confirm we won the race
      const confirm = await loadMatch(supabase, matchId);
      if (!confirm || !confirmSequenceAfterWrite(Number(confirm.seq), nextSeq).ok) {
        return staleStateResponse(supabase, matchId);
      }

      await supabase.from('match_rolls').update({
        status: 'consumed',
        consumed_seq: nextSeq,
      }).eq('id', rollId);

      const fromPos = move.fromPos ?? state.positions[color as PlayerColor][Number(tokenIndex)];
      const { error: moveInsErr } = await supabase.from('match_moves').insert({
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
      if (moveInsErr) {
        // The state is committed; only the audit row failed. Say so rather than
        // returning a clean 200 — a move with no `match_moves` row is exactly
        // the gap SEC-15 is about, and it must be visible in logs.
        console.error('[move-auth] match_moves insert failed', moveInsErr);
        return json({ error: 'Move audit write failed', code: 'AUDIT_WRITE_FAILED' }, 500);
      }

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
      const { matchId, actor, rollId, expectedSeq, message, signature, issuedAt, source, sessionId } = body;
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
      if (!authP.ok) return json({ error: authP.error, code: authP.code }, 401);
      const recovered = String(actor).toLowerCase();

      const row = await loadMatch(supabase, matchId);
      if (!row) return json({ error: 'Match not found', code: 'MATCH_NOT_FOUND' }, 404);
      const seq = Number(row.seq);
      if (!checkExpectedSequence(seq, Number(expectedSeq)).ok) return staleStateResponse(supabase, matchId);

      const state = row.state as EngineGameState;
      if (isTerminalMatch(state)) return json({ error: 'Match finished', code: 'MATCH_FINISHED' }, 409);
      const cc = row.color_corner as ColorCorner;
      const seats = row.player_seats as Seats;
      const color = state.currentPlayer;

      // SEC-19: the pass branch never refused host-assist on a human seat, so
      // the host could end a human's turn — including with a pass that human
      // never chose. `move` already had this rule; both now call one function.
      const seatOk = checkSeatAuthority({
        source,
        seats: seats as Record<string, { kind: string; wallet?: string }>,
        color: String(color),
        actor: recovered,
        hostAddress: row.host_address,
      });
      if (!seatOk.ok) return json({ error: seatOk.error, code: seatOk.code }, seatOk.status);

      const { data: roll } = await supabase
        .from('match_rolls')
        .select('id, result, match_id, status, seat_color, turn_seq, wallet_address')
        .eq('id', rollId)
        .maybeSingle();
      if (!roll) return json({ error: 'Roll not found' }, 404);
      if (roll.match_id !== String(matchId)) {
        return json({ error: 'Roll match mismatch' }, 403);
      }
      const passBinding = checkRollBinding({
        roll, color: String(color), seq,
        hostAddress: row.host_address,
        seatWallet: (c: string) => seatWalletOf(seats, c),
      });
      if (!passBinding.ok) return json({ error: passBinding.error, code: passBinding.code }, passBinding.status);
      if (isDuplicateAction(roll.status)) return json({ error: 'Roll already consumed', code: 'DUPLICATE_ACTION' }, 409);

      const dice = Number(roll.result);
      const legal = getLegalTokenIndices(state.positions, color, dice, cc);

      // SEC-18: `reason: 'forced'` is gone from both the contract and the
      // destructuring above. The caller used to be able to assert its own
      // forced-ness and hand the turn over at will; the engine now decides,
      // from the face and the counter, whether a pass is legal.
      const legality = checkPassLegality({
        legal,
        dice,
        consecutiveSixes: state.consecutiveSixes || 0,
      });
      if (!legality.ok) {
        return json({ error: legality.error, code: legality.code, legal }, legality.status);
      }
      const { isThreeSixes } = handleThreeSixes(state.consecutiveSixes || 0, dice);

      const handedTo = getNextPlayer(
        color,
        state.playerCount || '4P',
        activeColors(state),
        cc
      );
      // SEC-30: `powerSpentThisTurn` was left untouched by `pass`, so a player
      // who spent a power and then had no legal move carried `true` into the
      // next turn and was refused every power until they moved again.
      let next = {
        ...state,
        ...passStatePatch({
          currentPlayer: handedTo,
          dice,
          consecutiveSixes: isThreeSixes ? 0 : (state.consecutiveSixes || 0),
          now: Date.now(),
        }),
      };

      const nextSeq = compareAndSwapSequence(seq, Number(expectedSeq));
      if (nextSeq === null) return staleStateResponse(supabase, matchId);
      const { data: passSaved, error: saveErr } = await supabase
        .from('match_states')
        .update({ seq: nextSeq, state: pickPersistedState(next), updated_at: new Date().toISOString() })
        .eq('match_id', matchId)
        .eq('seq', seq)
        .select('seq');
      const passCas = casWon({ error: saveErr, data: passSaved });
      if (!passCas.ok) return staleStateResponse(supabase, matchId);
      const passConfirm = await loadMatch(supabase, matchId);
      if (!passConfirm || !confirmSequenceAfterWrite(Number(passConfirm.seq), nextSeq).ok) {
        return staleStateResponse(supabase, matchId);
      }

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
      if (!authW.ok) return json({ error: authW.error, code: authW.code }, 401);
      const recovered = String(actor).toLowerCase();

      const row = await loadMatch(supabase, matchId);
      if (!row) return json({ error: 'Match not found' }, 404);
      const seq = Number(row.seq);
      if (!checkExpectedSequence(seq, Number(expectedSeq)).ok) return staleStateResponse(supabase, matchId);

      const state = row.state as EngineGameState;
      if (isTerminalMatch(state)) return json({ error: 'Match finished', code: 'MATCH_FINISHED' }, 409);
      const cc = row.color_corner as ColorCorner;
      const seats = row.player_seats as Seats;
      const playerCount = (state.playerCount || '4P') as EngineGameState['playerCount'];

      // SEC-19: this branch was missing the human-seat refusal entirely, so the
      // host could spend any player's power on their turn.
      const powerSeatOk = checkSeatAuthority({
        source,
        seats: seats as Record<string, { kind: string; wallet?: string }>,
        color: String(color),
        actor: recovered,
        hostAddress: row.host_address,
      });
      if (!powerSeatOk.ok) return json({ error: powerSeatOk.error, code: powerSeatOk.code }, powerSeatOk.status);

      const result = applyPower(
        state,
        color as PlayerColor,
        power as PowerType,
        ti ?? undefined,
        cc,
        playerCount
      );
      if (!result.ok) {
        // SEC-31: the engine string stays in the log; the caller gets a code.
        // `armed`/`kept` are kept because the UI acts on them and they reveal
        // nothing about another player.
        const code = opaquePowerError(result.error);
        if (!result.armed && !result.kept) {
          console.error('[move-auth] power refused', JSON.stringify({ code, engine: result.error }));
        }
        return json({
          error: 'Power could not be used',
          code,
          armed: result.armed,
          kept: result.kept,
          seq,
        }, result.kept ? 200 : 400);
      }

      const nextSeq = compareAndSwapSequence(seq, Number(expectedSeq));
      if (nextSeq === null) return staleStateResponse(supabase, matchId);
      const toStore = { ...result.state, lastUpdate: Date.now() };
      const { data: powerSaved, error: saveErr } = await supabase
        .from('match_states')
        .update({ seq: nextSeq, state: pickPersistedState(toStore), updated_at: new Date().toISOString() })
        .eq('match_id', matchId)
        .eq('seq', seq)
        .select('seq');
      const powerCas = casWon({ error: saveErr, data: powerSaved });
      if (!powerCas.ok) return staleStateResponse(supabase, matchId);
      const powerConfirm = await loadMatch(supabase, matchId);
      if (!powerConfirm || !confirmSequenceAfterWrite(Number(powerConfirm.seq), nextSeq).ok) {
        return staleStateResponse(supabase, matchId);
      }

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

    // ── RESYNC (N0): session-proofed snapshot for player resume ────────
    if (action === 'resync' || path.endsWith('resync-match-state')) {
      const matchId = body.matchId || url.searchParams.get('matchId');
      const sessionId = body.sessionId as string | undefined;
      const actor = String(body.actor || '').toLowerCase();
      if (!matchId) return json({ error: 'matchId required', code: 'MATCH_NOT_FOUND' }, 400);
      if (!sessionId || !actor) {
        return json({ error: 'Resync requires match session proof', code: 'SESSION_EXPIRED' }, 401);
      }
      const v = await verifyMatchSession(supabase, sessionId, String(matchId), actor);
      if (!v.ok) return json({ error: v.error, code: 'SESSION_EXPIRED' }, 401);
      const row = await loadMatch(supabase, String(matchId));
      if (!row) return json({ error: 'Not found', code: 'MATCH_NOT_FOUND' }, 404);
      return json({
        seq: row.seq,
        state: stripPowerTypesForWire(row.state as EngineGameState),
        hostAddress: row.host_address,
        roomCode: row.room_code,
      });
    }

    // ── GET STATE (spectators / cold start — world-readable board) ──────
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
    // SEC-31: never echo a caught exception. It may be a Supabase error object
    // carrying a grant hint.
    console.error('[move-auth] unhandled', (err as Error)?.stack || String(err));
    return json(edgeErrorBody('INTERNAL'), edgeErrorStatus('INTERNAL'));
  }
});
