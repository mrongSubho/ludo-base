/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars -- legacy types; tracked burn-down */
 
import { NextResponse } from 'next/server';
import { requireAppSession, serviceDb } from '@/lib/serverAuth';
import { rateKey, rateLimitHeaders } from '@/lib/rateLimit';
import { checkRateLimitShared } from '@/lib/rateLimitShared';

/**
 * Attach the caller's ticket validation_token to a direct-match response.
 * The RPCs never mint tokens, so without this the fast path dispatches
 * `undefined` while the poll path delivers owner-checked tokens — guests
 * would then fail the room-secret gate on private lobbies. Mint-on-read is
 * safe here: service role, session-bound caller, own ticket row only.
 */
async function withCallerToken(db: any, playerId: string, data: any) {
    if (!data || data.status !== 'matched' || !data.match_id) return data;
    if (data.validation_token) return data;
    try {
        const { data: ticket } = await db
            .from('matchmaking_queue')
            .select('id, validation_token')
            .eq('player_id', playerId)
            .eq('match_id', data.match_id)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
        if (!ticket) return data;
        if (ticket.validation_token) return { ...data, validation_token: ticket.validation_token };
        // Check if a sibling ticket for this match already has a validation_token
        const { data: sibling } = await db
            .from('matchmaking_queue')
            .select('validation_token')
            .eq('match_id', data.match_id)
            .not('validation_token', 'is', null)
            .limit(1)
            .maybeSingle();
        const minted = sibling?.validation_token ?? [...crypto.getRandomValues(new Uint8Array(16))]
            .map(b => b.toString(16).padStart(2, '0')).join('');
        // Guarded single-mint: persist across ALL tickets for this match atomically
        // so both Host and Guest always share the identical validation token.
        await db
            .from('matchmaking_queue')
            .update({ validation_token: minted })
            .eq('match_id', data.match_id)
            .is('validation_token', null);

        const { data: winner } = await db
            .from('matchmaking_queue')
            .select('validation_token')
            .eq('match_id', data.match_id)
            .not('validation_token', 'is', null)
            .limit(1)
            .maybeSingle();
        return { ...data, validation_token: winner?.validation_token ?? minted };
    } catch (err) {
        // Token is best-effort hardening: open rooms join fine without it.
        console.warn('⚠️ [Matchmaking] Token mint skipped:', (err as Error).message);
        return data;
    }
}

export async function POST(request: Request) {
    try {
        const supabase = serviceDb();
        const body = await request.json() as {
            playerId: string;
            sessionId: string;
            gameMode: string;
            matchType: string;
            wager: number;
            wagerMin: number;
            wagerMax: number;
            roomCode: string;
            slotsNeeded: number;
            isHybrid: boolean;
        };
        let playerId = body.playerId;
        const { sessionId, gameMode, matchType, wager, wagerMin, wagerMax, roomCode, slotsNeeded, isHybrid } = body;

        if (!playerId || !gameMode || !matchType) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
        }
        const ALLOWED_MODES = new Set(['classic', 'power']);
        const ALLOWED_TYPES = new Set(['1v1', '2v2', '4P']);
        if (!ALLOWED_MODES.has(gameMode) || !ALLOWED_TYPES.has(matchType)) {
            return NextResponse.json({ error: 'Invalid gameMode or matchType' }, { status: 400 });
        }
        const wallet = await requireAppSession(playerId, sessionId);
        if (!wallet) return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
        playerId = wallet;

        // SA-5: the join heartbeat runs every 5s per searching player, so this is
        // the one queue endpoint where an in-process budget is not a budget at all
        // (it multiplies by instance count). Shared counter, keyed per wallet.
        const shared = await checkRateLimitShared(rateKey('mm:join', wallet), 30, 60_000);
        if (!shared.ok) {
            return NextResponse.json(
                { error: 'Too many matchmaking requests', retryAfter: shared.retryAfterSec },
                { status: 429, headers: rateLimitHeaders(shared) },
            );
        }

        console.log('📡 [Matchmaking] Player joining queue...', { playerId, gameMode, matchType, wager, wagerMin, wagerMax, roomCode, isHybrid });

        // Hybrid party fill: host advertises a room, guests match straight into it.
        // slotsNeeded is host-side bookkeeping only (the host tracks its seats).
        if (isHybrid) {
            const { data, error } = await supabase.rpc('join_matchmaking_hybrid', {
                p_player_id: playerId,
                p_game_mode: gameMode,
                p_match_type: matchType,
                p_wager: wager || 0,
                p_wager_min: wagerMin ?? undefined,
                p_wager_max: wagerMax ?? undefined,
                p_room_code: roomCode || undefined
            });

            if (error) {
                console.error('❌ [Matchmaking] Hybrid RPC Error:', error);
                return NextResponse.json({ error: error.message }, { status: 500 });
            }

            console.log('✅ [Matchmaking] Hybrid RPC Result:', data);
            const hybridResult = await withCallerToken(supabase, playerId, data);
            if (hybridResult?.status === 'matched') {
                const guest = String(hybridResult.guest_id || '').toLowerCase();
                if (guest) {
                    void supabase.channel(`matchm-player-${guest}`).send({
                        type: 'broadcast',
                        event: 'match-found',
                        payload: { matchId: hybridResult.match_id, roomCode: hybridResult.room_code }
                    }).catch(() => {});
                }
            }
            return NextResponse.json(hybridResult);
        }

        // Call the atomic join RPC
        const { data, error } = await supabase.rpc('join_matchmaking', {
            p_player_id: playerId,
            p_game_mode: gameMode,
            p_match_type: matchType,
            p_wager: wager || 0,
            p_wager_min: wagerMin,
            p_wager_max: wagerMax
        });

        if (error) {
            console.error('❌ [Matchmaking] RPC Error:', error);
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        console.log('✅ [Matchmaking] RPC Result:', data);
        const resultData = await withCallerToken(supabase, playerId, data);
        if (resultData?.status === 'matched' && Array.isArray(resultData.participants)) {
            for (const p of resultData.participants) {
                const addr = String(p || '').toLowerCase();
                if (addr && addr !== playerId.toLowerCase()) {
                    void supabase.channel(`matchm-player-${addr}`).send({
                        type: 'broadcast',
                        event: 'match-found',
                        payload: { matchId: resultData.match_id, roomCode: resultData.room_code }
                    }).catch(() => {});
                }
            }
        }
        return NextResponse.json(resultData);
    } catch (err: any) {
        console.error('❌ [Matchmaking] Unexpected error:', err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
