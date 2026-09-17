import { NextResponse } from 'next/server';
import { requireAppSession, serviceDb } from '@/lib/serverAuth';

/** Host → guest invite insert (service role; wallet RLS cannot do this). Host-session gated. */
export async function POST(request: Request) {
    try {
        const body = await request.json();
        const roomCode = String(body.roomCode || '').trim().toUpperCase();
        const host = String(body.hostAddress || '').trim().toLowerCase();
        const guest = String(body.guestAddress || '').trim().toLowerCase();
        if (!roomCode || !host || !guest) {
            return NextResponse.json({ error: 'roomCode, hostAddress, guestAddress required' }, { status: 400 });
        }
        const wallet = await requireAppSession(body.hostAddress, body.sessionId);
        if (!wallet || wallet !== host) {
            return NextResponse.json({ error: 'Invalid host session' }, { status: 401 });
        }
        const { error } = await serviceDb().from('game_invites').insert({
            room_code: roomCode,
            host_address: host,
            guest_address: guest,
            match_type: body.matchType || null,
            entry_fee: body.entryFee ?? 0,
            status: 'pending',
            validation_token: body.validationToken ?? null,
        });
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json({ success: true });
    } catch (err) {
        return NextResponse.json({ error: (err as Error).message }, { status: 500 });
    }
}
