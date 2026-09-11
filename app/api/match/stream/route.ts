import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

/** Lazy client — do not require secrets at module eval (Vercel collect). */
let _sb: SupabaseClient | null = null;
function db(): SupabaseClient {
    if (_sb) return _sb;
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) {
        throw new Error('Supabase is not configured');
    }
    _sb = createClient(url, key);
    return _sb;
}

/** Bound hanging Supabase calls so the route cannot stall the platform. */
async function withTimeout<T>(p: PromiseLike<T>, ms: number, label: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            Promise.resolve(p),
            new Promise<never>((_, reject) => {
                timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
            }),
        ]);
    } finally {
        if (timer) clearTimeout(timer);
    }
}

/**
 * Host go-live / stop-live.
 * Live DB primary key is match_id (room_code is required text, not unique).
 * Stream on  → upsert live row + matches.streaming_enabled
 * Stream off → delete live row + streaming_enabled false
 */
export async function POST(request: Request) {
    try {
        const { matchId, roomCode, hostAddress, enabled } = await request.json();

        if (!matchId) {
            return NextResponse.json({ error: 'Missing matchId' }, { status: 400 });
        }
        if (!roomCode) {
            return NextResponse.json({ error: 'Missing roomCode' }, { status: 400 });
        }

        console.log(`🎥 [API] streaming=${enabled} match=${matchId} room=${roomCode}`);
        const sb = db();

        const { error: matchError } = await withTimeout(
            sb.from('matches')
                .update({ streaming_enabled: !!enabled })
                .eq('id', matchId),
            12_000,
            'matches.update'
        );

        if (matchError) {
            console.error('❌ [API] matches.streaming_enabled:', matchError);
            return NextResponse.json({ error: matchError.message }, { status: 500 });
        }

        if (enabled) {
            // Live DB PK is match_id (not room_code). Upsert on match_id.
            const { error: liveError } = await withTimeout(
                sb.from('live_matches')
                    .upsert({
                        match_id: matchId,
                        room_code: String(roomCode),
                        host_address: hostAddress ? String(hostAddress).toLowerCase() : null,
                        bet_window_status: 'closed',
                        spectator_count: 0,
                        created_at: new Date().toISOString(),
                        updated_at: new Date().toISOString(),
                    }, { onConflict: 'match_id' }),
                12_000,
                'live_matches.upsert'
            );

            if (liveError) {
                console.error('❌ [API] live_matches upsert:', liveError);
                return NextResponse.json({ error: liveError.message }, { status: 500 });
            }
        } else {
            const { error: liveError } = await withTimeout(
                sb.from('live_matches').delete().eq('match_id', matchId),
                12_000,
                'live_matches.delete'
            );
            if (liveError) {
                console.error('❌ [API] live_matches delete:', liveError);
            }
        }

        return NextResponse.json({ success: true, enabled: !!enabled, roomCode, matchId });
    } catch (err) {
        console.error('❌ [API] Unexpected error in /api/match/stream:', err);
        return NextResponse.json({ error: (err as Error).message }, { status: 500 });
    }
}
