import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { INITIAL_GAME_STATE, getLegalTokenIndices, processMove } from '@/lib/gameLogic';
import { assignCornersFFA } from '@/lib/boardLayout';
import { getBestMove } from '@/lib/aiEngine';
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

export async function POST() {
  try {
    const sb = db();
    const existing = await sb.from('live_matches').select('match_id, room_code').eq('arena_key', ARENA_KEY).maybeSingle();
    if (existing.data?.match_id) return NextResponse.json({ matchId: existing.data.match_id, roomCode: existing.data.room_code });

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
      host_address: 'ai-arena',
      seq: 0,
      state: { ...state, matchId },
      color_corner: cc,
      player_seats: Object.fromEntries(COLORS.map(color => [color, { kind: 'bot' }])),
    });
    if (stateError) throw stateError;
    const { error: liveError } = await sb.from('live_matches').insert({
      match_id: matchId,
      room_code: ROOM_CODE,
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
    return NextResponse.json({ matchId, roomCode: ROOM_CODE, created: true });
  } catch (err) {
    console.error('Power arena bootstrap failed:', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Arena unavailable' }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const { matchId: requestedMatchId, arenaKey, authorityId } = await request.json();
    if ((!requestedMatchId && !arenaKey) || !authorityId) return NextResponse.json({ error: 'Missing authority payload' }, { status: 400 });
    const sb = db();
    const matchId = requestedMatchId || (await sb.from('live_matches').select('match_id').eq('arena_key', ARENA_KEY).maybeSingle()).data?.match_id;
    if (!matchId) return NextResponse.json({ claimed: false });
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
