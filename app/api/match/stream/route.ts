import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * Host go-live / stop-live.
 * live_matches is keyed by room_code (not match_id).
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

        const { error: matchError } = await supabase
            .from('matches')
            .update({ streaming_enabled: !!enabled })
            .eq('id', matchId);

        if (matchError) {
            console.error('❌ [API] matches.streaming_enabled:', matchError);
            return NextResponse.json({ error: matchError.message }, { status: 500 });
        }

        if (enabled) {
            // Upsert on room_code PK. Keep bet window closed until gambling UI opens it.
            const { error: liveError } = await supabase
                .from('live_matches')
                .upsert({
                    room_code: String(roomCode),
                    match_id: matchId,
                    host_address: hostAddress ? String(hostAddress).toLowerCase() : null,
                    bet_window_status: 'closed',
                    spectator_count: 0,
                    created_at: new Date().toISOString(),
                }, { onConflict: 'room_code' });

            if (liveError) {
                console.error('❌ [API] live_matches upsert:', liveError);
                return NextResponse.json({ error: liveError.message }, { status: 500 });
            }
        } else {
            const { error: liveError } = await supabase
                .from('live_matches')
                .delete()
                .eq('room_code', String(roomCode));
            if (liveError) {
                console.error('❌ [API] live_matches delete:', liveError);
                // Non-fatal: match is already unstreamed
            }
        }

        return NextResponse.json({ success: true, enabled: !!enabled, roomCode, matchId });
    } catch (err) {
        console.error('❌ [API] Unexpected error in /api/match/stream:', err);
        return NextResponse.json({ error: (err as Error).message }, { status: 500 });
    }
}
