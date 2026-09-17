import { NextResponse } from 'next/server';
import { requireAppSession, serviceDb } from '@/lib/serverAuth';

export async function POST(request: Request) {
    try {
        const { matchId, betType, status, hostAddress, sessionId } = await request.json();
        const wallet = await requireAppSession(hostAddress, sessionId);
        const { data: match } = await serviceDb().from('matches').select('room_code, participants').eq('id', matchId).maybeSingle();
        const host = String(match?.participants?.[0] || '').toLowerCase();
        if (!wallet || !match || !host || wallet !== host)
            return NextResponse.json({ error: 'Invalid host signature' }, { status: 401 });
        const update = status === 'register'
            ? { match_id: matchId, host_address: host, spectator_count: 0, bet_window_status: 'closed' }
            : status === 'open'
            ? { bet_window_status: 'open', current_bet_type: betType, window_opened_at: new Date().toISOString() }
            : { bet_window_status: 'closed', window_closed_at: new Date().toISOString() };
        const { error } = await serviceDb().from('live_matches').upsert(update, { onConflict: 'match_id' });
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json({ success: true });
    } catch (error) { return NextResponse.json({ error: (error as Error).message }, { status: 500 }); }
}
