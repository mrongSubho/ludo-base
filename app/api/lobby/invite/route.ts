import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

let _sb: SupabaseClient | null = null;
function db(): SupabaseClient {
    if (_sb) return _sb;
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) throw new Error('Supabase is not configured');
    _sb = createClient(url, key);
    return _sb;
}

/** Host → guest invite insert (service role; wallet RLS cannot do this). */
export async function POST(request: Request) {
    try {
        const body = await request.json();
        const roomCode = String(body.roomCode || '').trim().toUpperCase();
        const host = String(body.hostAddress || '').trim().toLowerCase();
        const guest = String(body.guestAddress || '').trim().toLowerCase();
        if (!roomCode || !host || !guest) {
            return NextResponse.json({ error: 'roomCode, hostAddress, guestAddress required' }, { status: 400 });
        }
        const { error } = await db().from('game_invites').insert({
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
