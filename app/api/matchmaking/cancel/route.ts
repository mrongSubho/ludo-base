import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

export async function POST(request: Request) {
    try {
        const { ticketId } = await request.json();

        if (!ticketId) {
            return NextResponse.json({ error: 'Missing ticketId' }, { status: 400 });
        }

        console.log('📡 [Matchmaking] Cancelling search...', { ticketId });

        const { error } = await supabase
            .from('matchmaking_queue')
            .update({ status: 'cancelled' })
            .eq('id', ticketId)
            .eq('status', 'searching'); // Only cancel if still searching

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
