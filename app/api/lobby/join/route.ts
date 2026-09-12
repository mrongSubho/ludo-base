import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { createHash } from 'crypto';

let _sb: SupabaseClient | null = null;
function db(): SupabaseClient {
    if (_sb) return _sb;
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) throw new Error('Supabase is not configured');
    _sb = createClient(url, key);
    return _sb;
}

function sha256Hex(s: string): string {
    return createHash('sha256').update(s).digest('hex');
}

/**
 * Guest → host join request (works when PeerJS and realtime broadcast fail).
 * Body: { roomCode, wallet, username?, avatarUrl?, desiredSeat?, secret? }
 * Verifies secret hash when the host stored one on live_matches.
 */
export async function POST(request: Request) {
    try {
        const body = await request.json();
        const roomCode = String(body.roomCode || '').trim().toUpperCase();
        const wallet = String(body.wallet || '').trim().toLowerCase();
        const secret = typeof body.secret === 'string' ? body.secret : '';
        const desiredSeat = Number.isInteger(body.desiredSeat) ? body.desiredSeat : null;

        if (!roomCode || roomCode.length < 3) {
            return NextResponse.json({ error: 'Invalid room code' }, { status: 400 });
        }
        if (!wallet || wallet.length < 3) {
            return NextResponse.json({ error: 'Wallet required' }, { status: 401 });
        }

        const sb = db();

        // Prefer room row by room_code; fall back to match_id-keyed rows.
        const { data: room } = await sb
            .from('live_matches')
            .select('room_code, match_id, host_address, join_secret_hash')
            .eq('room_code', roomCode)
            .maybeSingle();

        if (room?.join_secret_hash) {
            if (!secret || sha256Hex(secret) !== room.join_secret_hash) {
                return NextResponse.json(
                    { error: 'Invalid invite secret. Paste the full invite link (s=…).' },
                    { status: 403 },
                );
            }
        }

        const { error: insErr } = await sb.from('lobby_join_requests').insert({
            room_code: roomCode,
            wallet_address: wallet,
            username: body.username ? String(body.username).slice(0, 64) : null,
            avatar_url: body.avatarUrl ? String(body.avatarUrl).slice(0, 512) : null,
            desired_seat: desiredSeat,
            validation_token: secret ? secret.trim().toLowerCase() : null,
        });
        if (insErr) {
            console.error('lobby_join_requests insert', insErr);
            return NextResponse.json({ error: insErr.message }, { status: 500 });
        }

        return NextResponse.json({ success: true, roomCode, wallet });
    } catch (err) {
        console.error('/api/lobby/join', err);
        return NextResponse.json({ error: (err as Error).message }, { status: 500 });
    }
}

/** Host: list pending join requests for a room (signed later; room code only for now). */
export async function GET(request: Request) {
    try {
        const url = new URL(request.url);
        const roomCode = (url.searchParams.get('roomCode') || '').trim().toUpperCase();
        if (!roomCode) {
            return NextResponse.json({ error: 'roomCode required' }, { status: 400 });
        }
        const sb = db();
        const { data, error } = await sb
            .from('lobby_join_requests')
            .select('id, room_code, wallet_address, username, avatar_url, desired_seat, validation_token, created_at')
            .eq('room_code', roomCode)
            .order('created_at', { ascending: true })
            .limit(20);
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json({ requests: data || [] });
    } catch (err) {
        return NextResponse.json({ error: (err as Error).message }, { status: 500 });
    }
}

/** Host: delete a processed join request. */
export async function DELETE(request: Request) {
    try {
        const body = await request.json();
        const id = String(body.id || '');
        if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
        const sb = db();
        await sb.from('lobby_join_requests').delete().eq('id', id);
        return NextResponse.json({ success: true });
    } catch (err) {
        return NextResponse.json({ error: (err as Error).message }, { status: 500 });
    }
}
