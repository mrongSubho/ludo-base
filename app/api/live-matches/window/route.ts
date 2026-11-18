import { NextResponse } from 'next/server';
import { requireAppSession, requireSessionWallet, serviceDb } from '@/lib/serverAuth';
import {
    SPECTATOR_BET_WINDOW_DEFAULT_SEC,
    computeBetWindowBounds,
    isBetWindowOpen,
} from '@/lib/spectatorBetting';

export async function POST(request: Request) {
    try {
        const { matchId, betType, status, hostAddress, sessionId, durationSec } = await request.json();
        const wallet =
            (await requireSessionWallet(request, { scope: 'app', expectedWallet: hostAddress })) ||
            (await requireAppSession(hostAddress, sessionId));

        const db = serviceDb();
        const { data: match } = await db
            .from('matches')
            .select('room_code, participants')
            .eq('id', matchId)
            .maybeSingle();

        const host = String(match?.participants?.[0] || '').toLowerCase();
        if (!wallet || !match || !host || wallet !== host) {
            return NextResponse.json({ error: 'Invalid host signature' }, { status: 401 });
        }

        // DB-22: live_matches.room_code is NOT NULL with no default — a match without
        // a room code cannot have a live window, so refuse it for every status.
        if (!match.room_code) {
            return NextResponse.json({ error: 'Match has no room code' }, { status: 400 });
        }

        const { data: existingLive } = await db
            .from('live_matches')
            .select('bet_window_status, current_bet_type, window_opened_at, window_closed_at, spectator_count')
            .eq('match_id', matchId)
            .maybeSingle();

        const nowMs = Date.now();
        const nowIso = new Date(nowMs).toISOString();

        if (status === 'register') {
            const hasWindow = Boolean(existingLive?.window_opened_at);
            const bounds = computeBetWindowBounds(nowMs, durationSec ?? SPECTATOR_BET_WINDOW_DEFAULT_SEC);
            const windowStatus = hasWindow
                ? existingLive?.bet_window_status === 'settled'
                    ? 'settled'
                    : isBetWindowOpen({
                          status: existingLive?.bet_window_status,
                          windowClosedAt: existingLive?.window_closed_at,
                          nowMs,
                      })
                      ? 'open'
                      : 'closed'
                : 'open';

            const update = {
                match_id: matchId,
                room_code: match.room_code,
                host_address: host,
                spectator_count: existingLive?.spectator_count ?? 0,
                bet_window_status: windowStatus,
                current_bet_type: existingLive?.current_bet_type || 'winner',
                window_opened_at: existingLive?.window_opened_at || bounds.windowOpenedAt,
                window_closed_at: existingLive?.window_closed_at || bounds.windowClosedAt,
                updated_at: nowIso,
            };
            const { error } = await db.from('live_matches').upsert(update, { onConflict: 'match_id' });
            if (error) return NextResponse.json({ error: error.message }, { status: 500 });
            return NextResponse.json({
                success: true,
                windowStatus,
                windowOpenedAt: update.window_opened_at,
                windowClosedAt: update.window_closed_at,
            });
        }

        if (status === 'open') {
            const normalizedType = String(betType || 'winner').trim().toLowerCase();
            if (normalizedType === 'winner' && existingLive?.window_opened_at) {
                const stillOpen = isBetWindowOpen({
                    status: existingLive.bet_window_status,
                    windowClosedAt: existingLive.window_closed_at,
                    nowMs,
                });
                if (!stillOpen) {
                    return NextResponse.json(
                        { error: 'Winner betting window has already closed for this match' },
                        { status: 409 },
                    );
                }
                return NextResponse.json({
                    success: true,
                    windowStatus: 'open',
                    windowOpenedAt: existingLive.window_opened_at,
                    windowClosedAt: existingLive.window_closed_at,
                });
            }

            const bounds =
                normalizedType === 'winner'
                    ? computeBetWindowBounds(nowMs, durationSec ?? SPECTATOR_BET_WINDOW_DEFAULT_SEC)
                    : {
                          windowOpenedAt: nowIso,
                          windowClosedAt: new Date(nowMs + 3000).toISOString(),
                      };

            const update = {
                match_id: matchId,
                room_code: match.room_code,
                host_address: host,
                bet_window_status: 'open',
                current_bet_type: normalizedType,
                window_opened_at: bounds.windowOpenedAt,
                window_closed_at: bounds.windowClosedAt,
                updated_at: nowIso,
            };
            const { error } = await db.from('live_matches').upsert(update, { onConflict: 'match_id' });
            if (error) return NextResponse.json({ error: error.message }, { status: 500 });
            return NextResponse.json({
                success: true,
                windowStatus: 'open',
                windowOpenedAt: bounds.windowOpenedAt,
                windowClosedAt: bounds.windowClosedAt,
            });
        }

        const update = {
            match_id: matchId,
            room_code: match.room_code,
            bet_window_status: 'closed',
            window_closed_at: nowIso,
            updated_at: nowIso,
        };
        const { error } = await db.from('live_matches').upsert(update, { onConflict: 'match_id' });
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json({ success: true, windowStatus: 'closed', windowClosedAt: nowIso });
    } catch (error) {
        return NextResponse.json({ error: (error as Error).message }, { status: 500 });
    }
}
