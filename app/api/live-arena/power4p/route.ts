import { NextResponse } from 'next/server';
import { INITIAL_GAME_STATE, getLegalTokenIndices } from '@/lib/gameLogic';
import { clearShieldsOnTurnChange, lcg32, rollPowerTypeLcg, resolveNetworkedMove, seatedColorsFor } from '@/lib/engine/core';
import { assignCornersForShape, BOT_TEMPLATES, CORNER_TO_POSITION, getBoardCoordinate } from '@/lib/boardLayout';
import { POWER_TILES_COUNT } from '@/lib/constants';
import { calculateLevel } from '@/lib/progression';
import { getBestMove } from '@/lib/aiEngine';
import { requireAppSession, requireSessionWallet, serviceDb } from '@/lib/serverAuth';
import { checkRateLimit, rateKey, rateLimitHeaders } from '@/lib/rateLimit';
import { getDemoExhibitionByKey } from '@/lib/arena/demoArenas';
import {
  SPECTATOR_BET_WINDOW_DEFAULT_SEC,
  computeBetWindowBounds,
  settleSpectatorMatchBets,
} from '@/lib/spectatorBetting';
import type { GameState, PlayerColor, ColorCorner, PowerType } from '@/lib/types';
import type { Json } from '@/types/database.types';

function db() {
  return serviceDb();
}

/**
 * SEC-07: Host-gated AI arena authority.
 * Only whitelisted demo exhibition keys (`power4p-ai`, `vip-classic-1v1`, `apex-power-2v2`)
 * may be bootstrapped or ticked; callers cannot supply arbitrary matchIds.
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
 * POST /api/live-arena/power4p — bootstrap any whitelisted AI exhibition arena (session required).
 */
export async function POST(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const expectedWallet = searchParams.get('walletAddress') || undefined;
    const requestedKey = searchParams.get('arenaKey') || 'power4p-ai';
    const ex = getDemoExhibitionByKey(requestedKey);
    if (!ex) {
      return NextResponse.json({ error: 'Unknown exhibition arenaKey' }, { status: 400 });
    }

    const wallet = await requireSessionWallet(request, { scope: 'app', expectedWallet });
    if (!wallet) {
      return NextResponse.json({ error: 'Session required to watch the arena' }, { status: 401 });
    }

    const sb = db();
    const existing = await sb
      .from('live_matches')
      .select('match_id, room_code, bet_window_status, window_closed_at')
      .eq('arena_key', ex.arenaKey)
      .maybeSingle();

    if (existing.data?.match_id) {
      const existingState = await sb
        .from('match_states')
        .select('state')
        .eq('match_id', existing.data.match_id)
        .maybeSingle();
      const s = existingState.data?.state as unknown as GameState | undefined;

      // If previous AI match hasn't finished yet, keep it alive and enforce hard window close once expired.
      if (!s?.winner) {
        if (
          existing.data.bet_window_status === 'open' &&
          existing.data.window_closed_at &&
          Date.now() >= Date.parse(existing.data.window_closed_at)
        ) {
          await sb
            .from('live_matches')
            .update({
              bet_window_status: 'closed',
              updated_at: new Date().toISOString(),
            })
            .eq('match_id', existing.data.match_id)
            .eq('bet_window_status', 'open');
        }
        return NextResponse.json({
          matchId: existing.data.match_id,
          roomCode: existing.data.room_code,
          arenaKey: ex.arenaKey,
          isHost: (await arenaHost(sb, existing.data.match_id)) === wallet,
        });
      }

      // Previous AI exhibition ended — detach old arena_key so a fresh AI match starts
      await sb
        .from('live_matches')
        .update({ arena_key: null, bet_window_status: 'closed' })
        .eq('match_id', existing.data.match_id);
    }

    const activeColors = [...seatedColorsFor(ex.matchShape)];
    const cc = assignCornersForShape(ex.matchShape);
    const powerTileSeed = (crypto.getRandomValues(new Uint32Array(1))[0] >>> 0) || 1;
    const seededTiles: { r: number; c: number; type: PowerType }[] = [];

    if (ex.gameMode === 'power') {
      const seedRand = lcg32(powerTileSeed);
      const takenCells = new Set<string>();
      while (seededTiles.length < POWER_TILES_COUNT) {
        const rp = Math.floor(seedRand() * 52);
        const pt = getBoardCoordinate(rp, activeColors[0], cc);
        if (!pt) continue;
        const key = `${pt.r},${pt.c}`;
        if (takenCells.has(key)) continue;
        takenCells.add(key);
        seededTiles.push({ r: pt.r, c: pt.c, type: rollPowerTypeLcg(seedRand) });
      }
    }

    const initialBoardConfig = {
      colorCorner: cc,
      players: activeColors.map((color, idx) => {
        const bot = ex.bots[idx];
        const tpl = BOT_TEMPLATES[idx % BOT_TEMPLATES.length];
        return {
          name: bot?.username || tpl.name,
          level: calculateLevel(bot?.rxp ?? 1500).level,
          lxp: bot?.rxp ?? 1500,
          rxp: bot?.rxp ?? 1500,
          avatar: tpl.avatar,
          color,
          position: CORNER_TO_POSITION[cc[color]],
          isAi: true,
          walletAddress: bot?.walletAddress || `ai-${color}`,
        };
      }),
    };

    const state: GameState = {
      ...INITIAL_GAME_STATE,
      matchId: `arena-${crypto.randomUUID()}`,
      playerCount: ex.matchShape,
      isStarted: true,
      status: 'playing',
      botDifficulty: 'pro',
      currentPlayer: activeColors[0],
      powerTileSeed,
      powerTiles: seededTiles,
      lastUpdate: Date.now(),
      initialBoardConfig,
    };

    const uniqueRoomCode = `${ex.roomCode}-${Date.now().toString(36).slice(-4).toUpperCase()}`;
    const existingRoomMatch = await sb
      .from('matches')
      .select('id')
      .eq('room_code', ex.roomCode)
      .maybeSingle();
    const roomCodeToUse = existingRoomMatch.data ? uniqueRoomCode : ex.roomCode;

    const match = await sb
      .from('matches')
      .insert({
        room_code: roomCodeToUse,
        game_mode: ex.gameMode,
        participants: activeColors.map((c) => `ai-${c}`),
        streaming_enabled: true,
        metadata: {
          arena_key: ex.arenaKey,
          ai: true,
          match_type: ex.matchShape,
          entryFee: ex.wager,
        },
      })
      .select('id')
      .single();

    if (match.error || !match.data) throw match.error || new Error('Failed to create arena match');
    const matchId = String(match.data.id);

    const { error: stateError } = await sb.from('match_states').insert({
      match_id: matchId,
      room_code: roomCodeToUse,
      host_address: wallet,
      seq: 0,
      state: { ...state, matchId } as unknown as NonNullable<Json>,
      color_corner: cc as unknown as NonNullable<Json>,
      player_seats: Object.fromEntries(activeColors.map((color) => [color, { kind: 'bot' }])) as unknown as NonNullable<Json>,
    });
    if (stateError) throw stateError;

    const bounds = computeBetWindowBounds(Date.now(), SPECTATOR_BET_WINDOW_DEFAULT_SEC);
    const nowIso = bounds.windowOpenedAt;
    const closeIso = bounds.windowClosedAt;
    const { error: liveError } = await sb.from('live_matches').insert({
      match_id: matchId,
      room_code: roomCodeToUse,
      host_address: wallet,
      arena_key: ex.arenaKey,
      bet_window_status: 'open',
      current_bet_type: 'winner',
      window_opened_at: nowIso,
      window_closed_at: closeIso,
      spectator_count: 1,
      created_at: nowIso,
      updated_at: nowIso,
    });

    if (liveError) {
      const raced = await sb
        .from('live_matches')
        .select('match_id, room_code')
        .eq('arena_key', ex.arenaKey)
        .maybeSingle();
      if (raced.data?.match_id) {
        return NextResponse.json({
          matchId: raced.data.match_id,
          roomCode: raced.data.room_code,
          arenaKey: ex.arenaKey,
        });
      }
      throw liveError;
    }

    return NextResponse.json({
      matchId,
      roomCode: roomCodeToUse,
      arenaKey: ex.arenaKey,
      created: true,
      isHost: true,
    });
  } catch (err) {
    console.error('Arena exhibition bootstrap failed:', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Arena unavailable' }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const { arenaKey, authorityId, walletAddress, sessionId } = await request.json();
    const ex = getDemoExhibitionByKey(arenaKey);
    if (!ex || !authorityId) {
      return NextResponse.json({ error: 'Missing or invalid authority payload' }, { status: 400 });
    }

    const wallet =
      (await requireSessionWallet(request, { scope: 'app', expectedWallet: walletAddress })) ||
      (await requireAppSession(walletAddress, sessionId));
    if (!wallet) return NextResponse.json({ error: 'Session required' }, { status: 401 });

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
      .eq('arena_key', ex.arenaKey)
      .maybeSingle();
    const matchId = arena?.match_id;
    if (!matchId) return NextResponse.json({ claimed: false });

    const host = await arenaHost(sb, matchId);
    if (host && host !== wallet) {
      return NextResponse.json({ claimed: false, reason: 'NOT_HOST' }, { status: 403 });
    }

    const now = new Date().toISOString();
    const serverAuthorityId = wallet;
    const claim = await sb
      .from('live_matches')
      .update({ authority_id: serverAuthorityId, authority_heartbeat: now, updated_at: now })
      .eq('match_id', matchId)
      .or(`authority_id.is.null,authority_heartbeat.lt.${new Date(Date.now() - 8000).toISOString()}`)
      .select('match_id')
      .maybeSingle();
    if (!claim.data) return NextResponse.json({ claimed: false });

    const row = await sb.from('match_states').select('seq, state, color_corner').eq('match_id', matchId).single();
    if (row.error || !row.data) return NextResponse.json({ claimed: true });
    const state = row.data.state as unknown as GameState;
    if (state.winner) {
      await sb.from('live_matches').update({ bet_window_status: 'closed', window_closed_at: now }).eq('match_id', matchId);
      await settleSpectatorMatchBets({
        matchId,
        matchShape: ex.matchShape,
        winnerRaw: String(state.winner),
      });
      return NextResponse.json({ claimed: true, ended: true });
    }

    // Hard-close expired betting window on tick progression so directory & UI stay synced.
    await sb
      .from('live_matches')
      .update({ bet_window_status: 'closed', updated_at: now })
      .eq('match_id', matchId)
      .eq('bet_window_status', 'open')
      .lt('window_closed_at', now);

    const activeColors = [...seatedColorsFor(ex.matchShape)];
    const color = state.currentPlayer as PlayerColor;
    const cc = row.data.color_corner as unknown as ColorCorner;
    const seq = Number(row.data.seq);

    const rollRand = lcg32(((state.powerTileSeed ?? 0) >>> 0) + seq * 7919);
    const roll = Math.floor(rollRand() * 6) + 1;

    const legal = getLegalTokenIndices(state.positions, color, roll, cc);
    let next: GameState;
    if (legal.length) {
      const choice = getBestMove(state.positions, color, roll, cc, ex.matchShape, state.powerTiles, state, 'pro')?.tokenIndex ?? legal[0];
      const resolved = resolveNetworkedMove({
        state: state as unknown as Parameters<typeof resolveNetworkedMove>[0]['state'],
        color,
        tokenIndex: choice,
        dice: roll,
        cc,
        playerCount: ex.matchShape,
        activeColors,
        now: Date.now(),
      });
      const fallbackNext = activeColors[(activeColors.indexOf(color) + 1) % activeColors.length];
      next = resolved.ok && resolved.state
        ? (resolved.state as unknown as GameState)
        : { ...state, currentPlayer: fallbackNext, activeShields: clearShieldsOnTurnChange(state.activeShields, color, fallbackNext), diceValue: null, gamePhase: 'rolling', lastUpdate: Date.now() };
    } else {
      const passNext = activeColors[(activeColors.indexOf(color) + 1) % activeColors.length];
      next = { ...state, currentPlayer: passNext, activeShields: clearShieldsOnTurnChange(state.activeShields, color, passNext), diceValue: null, gamePhase: 'rolling', lastUpdate: Date.now() };
    }

    const updated = await sb
      .from('match_states')
      .update({ state: next as unknown as NonNullable<Json>, seq: seq + 1, updated_at: now })
      .eq('match_id', matchId)
      .eq('seq', row.data.seq)
      .select('seq')
      .maybeSingle();

    if (next.winner) {
      await sb.from('live_matches').update({ bet_window_status: 'closed', window_closed_at: now }).eq('match_id', matchId);
      await settleSpectatorMatchBets({
        matchId,
        matchShape: ex.matchShape,
        winnerRaw: String(next.winner),
      });
    }

    return NextResponse.json({ claimed: true, advanced: !!updated.data, ended: Boolean(next.winner) });
  } catch (err) {
    console.error('Arena tick failed:', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Arena tick failed' }, { status: 500 });
  }
}
