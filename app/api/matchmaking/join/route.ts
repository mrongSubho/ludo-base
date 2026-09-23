/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars -- legacy types; tracked burn-down */
 
import { NextResponse } from 'next/server';
import { requireAppSession, serviceDb } from '@/lib/serverAuth';

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
        const minted = [...crypto.getRandomValues(new Uint8Array(16))]
            .map(b => b.toString(16).padStart(2, '0')).join('');
        // Guarded single-mint: only persist when the row is still tokenless.
        // On a lost race (0 rows updated) re-read the winner's token instead
        // of returning an unpersisted value the secret gate would reject.
        const { data: claimed, error } = await db
            .from('matchmaking_queue')
            .update({ validation_token: minted })
            .eq('id', ticket.id)
            .is('validation_token', null)
            .select('validation_token')
            .maybeSingle();
        if (error) throw error;
        if (claimed?.validation_token) {
            return { ...data, validation_token: claimed.validation_token };
        }
        // Lost the race after all: re-read whatever won.
        const { data: winner } = await db
            .from('matchmaking_queue')
            .select('validation_token')
            .eq('id', ticket.id)
            .maybeSingle();
        return { ...data, validation_token: winner?.validation_token ?? undefined };
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
        const wallet = await requireAppSession(playerId, sessionId);
        if (!wallet) return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
        playerId = wallet;

        console.log('📡 [Matchmaking] Player joining queue...', { playerId, gameMode, matchType, wager, wagerMin, wagerMax, roomCode, isHybrid });

        // Hybrid party fill: host advertises a room, guests match straight into it.
        // slotsNeeded is host-side bookkeeping only (the host tracks its seats).
        if (isHybrid) {
            const { data, error } = await supabase.rpc('join_matchmaking_hybrid', {
                p_player_id: playerId,
                p_game_mode: gameMode,
                p_match_type: matchType,
                p_wager: wager || 0,
                p_wager_min: wagerMin ?? null,
                p_wager_max: wagerMax ?? null,
                p_room_code: roomCode || null
            });

            if (error) {
                console.error('❌ [Matchmaking] Hybrid RPC Error:', error);
                return NextResponse.json({ error: error.message }, { status: 500 });
            }

            console.log('✅ [Matchmaking] Hybrid RPC Result:', data);
            return NextResponse.json(await withCallerToken(supabase, playerId, data));
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
        return NextResponse.json(await withCallerToken(supabase, playerId, data));
    } catch (err: any) {
        console.error('❌ [Matchmaking] Unexpected error:', err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
