import { NextResponse } from 'next/server';
import { requireAppSession, serviceDb } from '@/lib/serverAuth';

export async function POST(request: Request) {
    try {
        const { walletAddress, sessionId, status, currentRoomCode, peerId } = await request.json();
        const wallet = await requireAppSession(walletAddress, sessionId);
        if (!wallet) return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
        const allowed = ['Online', 'Offline', 'In Match'];
        if (!allowed.includes(String(status))) return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
        const updates: Record<string, string | null> = {
            status: String(status), last_seen_at: new Date().toISOString(),
            current_room_code: status === 'In Match' ? String(currentRoomCode || '').slice(0, 80) || null : null,
        };
        if (peerId !== undefined) updates.peer_id = peerId === null ? null : String(peerId).slice(0, 200);
        const { error } = await serviceDb().from('players').update(updates).eq('wallet_address', wallet);
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json({ success: true });
    } catch (error) {
        return NextResponse.json({ error: (error as Error).message }, { status: 500 });
    }
}
