import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

export async function POST(request: Request) {
    try {
        const { ticketId, playerId } = await request.json();

        if (!ticketId && !playerId) {
            return NextResponse.json({ error: 'Missing ticketId or playerId' }, { status: 400 });
        }

        console.log('📡 [Matchmaking] Received cancellation request:', { ticketId, playerId });

        let query = supabase.from('matchmaking_queue').update({ status: 'cancelled' });

        if (ticketId) {
            query = query.eq('id', ticketId);
        } else if (playerId) {
            query = query.eq('player_id', playerId);
        }

        const { error } = await query.in('status', ['searching', 'expanding']);

        if (error) {
            console.error('❌ [Matchmaking] Cancel Error:', error);
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        return NextResponse.json({ success: true });
    } catch (err: any) {
        console.error('❌ [Matchmaking] Unexpected error:', err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
