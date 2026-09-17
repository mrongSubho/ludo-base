import { NextResponse } from 'next/server';
import { requireAppSession, serviceDb } from '@/lib/serverAuth';

export async function POST(request: Request) {
    try {
        // serviceDb() is called in-handler (never at module scope): module
        // eval at build time must not require secrets.
        const supabase = serviceDb();
        const { ticketId, playerId, sessionId } = await request.json();

        if (!ticketId && !playerId) {
            return NextResponse.json({ error: 'Missing ticketId or playerId' }, { status: 400 });
        }
        let owner = playerId;
        if (!owner && ticketId) {
            owner = (await supabase.from('matchmaking_queue').select('player_id').eq('id', ticketId).maybeSingle()).data?.player_id;
        }
        const wallet = await requireAppSession(owner, sessionId);
        if (!wallet) return NextResponse.json({ error: 'Invalid session' }, { status: 401 });

        console.log('📡 [Matchmaking] Received cancellation request:', { ticketId, playerId });

        let query = supabase.from('matchmaking_queue').update({ status: 'cancelled' });

        // Owner-scoped: the session wallet must own the ticket. Without this,
        // any valid session knowing a ticket UUID could cancel another player's search.
        query = query.eq('player_id', wallet);
        if (ticketId) {
            query = query.eq('id', ticketId);
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
