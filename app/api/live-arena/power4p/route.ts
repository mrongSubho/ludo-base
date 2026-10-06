import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { INITIAL_GAME_STATE, getLegalTokenIndices, processMove } from '@/lib/gameLogic';
import { assignCornersFFA } from '@/lib/boardLayout';
import { getBestMove } from '@/lib/aiEngine';
import { requireAppSession } from '@/lib/serverAuth';
import { checkRateLimit, rateKey, rateLimitHeaders } from '@/lib/rateLimit';
import type { GameState, PlayerColor } from '@/lib/types';

const ARENA_KEY = 'power4p-ai';
const ROOM_CODE = 'ARENA-POWER-4P';
const COLORS: PlayerColor[] = ['green', 'red', 'yellow', 'blue'];

function db() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase service role is not configured');
  return createClient(url, key);
}

/**
 * SEC-07: the arena's authority.
 *
 * The arena is AI-vs-AI, but its tick used to run in whichever spectator's
 * browser happened to have it open — `app/page.tsx` sent a PATCH every 3s and
 * the first `.or(authority_id.is.null, …)` write won. That is a deliberate
 * trust-boundary break: any visitor could advance the board, and could win the
 * match for a side.
 *
 * Now host-gated. The **first session-holding caller to bootstrap the arena
 * becomes its host** (`live_matches.host_address`), and only that wallet may
 * drive the tick. Everyone else may still watch; they simply do not tick. If
 * the host goes away, the claim is reclaimable after the same 8s heartbeat
 * window the authority lease already used, so a closed tab does not orphan the
 * arena permanently.
 *
 * There is no money in this match, so the blast radius is the board, not a
 * balance — but a spectator being able to decide a winner is still wrong.
 */
async function arenaHost(sb: ReturnType<typeof db>, matchId: string): Promise<string | null> {
  const { data } = await sb
    .from('live_matches')
    .select('host_address')
    .eq('match_id', matchId)
    .maybeSingle();
  const host = data?.host_address ? String(data.host_address).toLowerCase() : null;
  return host && host !== 'ai-arena' ? host : null;
}

/**
 * POST /api/live-arena/power4p — bootstrap the AI arena (session required).
 *
 * Returns `isHost` so the caller knows whether it may drive the tick.
 */
export async function POST(request: Request) {
  try {
    // SEC-07: a session is required to open the arena at all. Without one there
    // is nobody who can be its host.
    const { searchParams } = new URL(request.url);
    const wallet = await requireAppSession(
      searchParams.get('walletAddress'),
      searchParams.get('sessionId'),
    );
    if (!wallet) {
      return NextResponse.json({ error: 'Session required to watch the arena' }, { status: 401 });
    }

    const sb = db();
    const existing = await sb.from('live_matches').select('match_id, room_code').eq('arena_key', ARENA_KEY).maybeSingle();
    if (existing.data?.match_id) {
      return NextResponse.json({
        matchId: existing.data.match_id,
        roomCode: existing.data.room_code,
        // Tells the client whether it may drive the tick, so a non-host
        // spectator does not PATCH at all.
        isHost: (await arenaHost(sb, existing.data.match_id)) === wallet,
      });
    }

    const cc = assignCornersFFA('4P');
    const state: GameState = {
      ...INITIAL_GAME_STATE,
      matchId: `arena-${crypto.randomUUID()}`,
      playerCount: '4P',
      isStarted: true,
      status: 'playing',
      botDifficulty: 'pro',
      currentPlayer: 'green',
      lastUpdate: Date.now(),
    };
    const match = await sb.from('matches').insert({
      room_code: ROOM_CODE,
      game_mode: 'power',
      participants: COLORS.map(c => `ai-${c}`),
      streaming_enabled: true,
      metadata: { arena_key: ARENA_KEY, ai: true, match_type: '4P' },
    }).select('id').single();
    if (match.error || !match.data) throw match.error || new Error('Failed to create arena match');
    const matchId = String(match.data.id);
    const { error: stateError } = await sb.from('match_states').insert({
      match_id: matchId,
      room_code: ROOM_CODE,
      host_address: wallet,
      seq: 0,
      state: { ...state, matchId },
      color_corner: cc,
      player_seats: Object.fromEntries(COLORS.map(color => [color, { kind: 'bot' }])),
    });
    if (stateError) throw stateError;
    const { error: liveError } = await sb.from('live_matches').insert({
      match_id: matchId,
      room_code: ROOM_CODE,
      // SEC-07: the bootstrapping wallet is the arena host, not the placeholder
      // 'ai-arena' that matched nothing.
      host_address: wallet,
      arena_key: ARENA_KEY,
      bet_window_status: 'closed',
      spectator_count: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    if (liveError) {
      const raced = await sb.from('live_matches').select('match_id, room_code').eq('arena_key', ARENA_KEY).maybeSingle();
      if (raced.data?.match_id) return NextResponse.json({ matchId: raced.data.match_id, roomCode: raced.data.room_code });
      throw liveError;
    }
    return NextResponse.json({ matchId, roomCode: ROOM_CODE, created: true, isHost: true });
  } catch (err) {
    console.error('Power arena bootstrap failed:', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Arena unavailable' }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    // SEC-07: `requestedMatchId` is GONE. Accepting a caller-supplied matchId
    // let any client name a live match and take a write against it. Only the
    // arena key is accepted, and the match is resolved server-side.
    const { arenaKey, authorityId, walletAddress, sessionId } = await request.json();
    if (arenaKey !== ARENA_KEY || !authorityId) {
      return NextResponse.json({ error: 'Missing authority payload' }, { status: 400 });
    }

    // SEC-07: a session is required, and it must be the arena's host.
    const wallet = await requireAppSession(walletAddress, sessionId);
    if (!wallet) return NextResponse.json({ error: 'Session required' }, { status: 401 });

    // Defence in depth: middleware already bounds this, but a direct caller
    // gets the same bound.
    const limit = checkRateLimit(rateKey('arena:tick', wallet), 40, 60_000);
    if (!limit.ok) {
      return NextResponse.json(
        { error: 'Too many requests', retryAfter: limit.retryAfterSec },
        { status: 429, headers: rateLimitHeaders(limit) },
      );
    }

    const sb = db();
    const { data: arena } = await sb
      .from('live_matches')
      .select('match_id')
      .eq('arena_key', ARENA_KEY)
      .maybeSingle();
    const matchId = arena?.match_id;
    if (!matchId) return NextResponse.json({ claimed: false });

    // SEC-07: host-gated. Not the host? Watch, do not drive.
    const host = await arenaHost(sb, matchId);
    if (host && host !== wallet) {
      return NextResponse.json({ claimed: false, reason: 'NOT_HOST' }, { status: 403 });
    }

    const now = new Date().toISOString();
    const claim = await sb.from('live_matches').update({ authority_id: authorityId, authority_heartbeat: now, updated_at: now })
      .eq('match_id', matchId)
      .or(`authority_id.is.null,authority_heartbeat.lt.${new Date(Date.now() - 8000).toISOString()}`)
      .select('match_id').maybeSingle();
    if (!claim.data) return NextResponse.json({ claimed: false });
    const row = await sb.from('match_states').select('seq, state, color_corner').eq('match_id', matchId).single();
    if (row.error || !row.data) return NextResponse.json({ claimed: true });
    const state = row.data.state as GameState;
    if (state.winner) return NextResponse.json({ claimed: true, ended: true });
    const color = state.currentPlayer as PlayerColor;
    const roll = Math.floor(Math.random() * 6) + 1;
    const legal = getLegalTokenIndices(state.positions, color, roll, row.data.color_corner);
    const next = legal.length
      ? processMove({ ...state, diceValue: roll, gamePhase: 'moving' }, color, getBestMove(state.positions, color, roll, row.data.color_corner, '4P', state.powerTiles, state, 'pro') ?? legal[0], roll, '4P', row.data.color_corner).newState
      : { ...state, currentPlayer: COLORS[(COLORS.indexOf(color) + 1) % COLORS.length], diceValue: null, gamePhase: 'rolling', lastUpdate: Date.now() };
    const updated = await sb.from('match_states').update({ state: next, seq: Number(row.data.seq) + 1, updated_at: now })
      .eq('match_id', matchId).eq('seq', row.data.seq).select('seq').maybeSingle();
    return NextResponse.json({ claimed: true, advanced: !!updated.data });
  } catch (err) {
    console.error('Power arena tick failed:', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Arena tick failed' }, { status: 500 });
  }
}
