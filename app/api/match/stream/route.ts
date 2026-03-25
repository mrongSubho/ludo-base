import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

export async function POST(request: Request) {
    try {
        const { matchId, enabled } = await request.json();

        if (!matchId) {
            return NextResponse.json({ error: 'Missing matchId' }, { status: 400 });
        }

        console.log(`🎥 [API] Setting streaming to ${enabled} for match ${matchId}`);

        // Update the match record
        const { error: matchError } = await supabase
            .from('matches')
            .update({ streaming_enabled: enabled })
            .eq('id', matchId);

        if (matchError) {
            console.error('❌ [API] Error updating match streaming status:', matchError);
            return NextResponse.json({ error: matchError.message }, { status: 500 });
        }

        if (enabled) {
            // Upsert into live_matches
            const { error: liveError } = await supabase
                .from('live_matches')
                .upsert({
                    match_id: matchId,
                    status: 'live'
                }, { onConflict: 'match_id' });

            if (liveError) {
                console.error('❌ [API] Error upserting live_match:', liveError);
                return NextResponse.json({ error: liveError.message }, { status: 500 });
            }
        } else {
            // If disabling, update status to ended
            const { error: liveError } = await supabase
                .from('live_matches')
                .update({ status: 'ended' })
                .eq('match_id', matchId);

            if (liveError && liveError.code !== 'PGRST116') {
                console.error('❌ [API] Error ending live_match:', liveError);
            }
        }

        return NextResponse.json({ success: true, enabled });
    } catch (err: any) {
        console.error('❌ [API] Unexpected error in /api/match/stream:', err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
