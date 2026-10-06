import { NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { requireAppSession, serviceDb } from '@/lib/serverAuth';
import { checkRateLimit, rateKey, rateLimitHeaders } from '@/lib/rateLimit';

function sha256Hex(s: string): string {
    return createHash('sha256').update(s).digest('hex');
}

/**
 * SEC-12: is `guest` an accepted friend of `host`, in either direction?
 *
 * Two explicit `.eq()` queries merged in JS. Never interpolate into `.or()` —
 * that is a string format, not a query API (SEC-08).
 */
async function areAcceptedFriends(guest: string, host: string): Promise<boolean> {
    const sb = serviceDb();
    const [asUser, asFriend] = await Promise.all([
        sb.from('friendships')
            .select('id')
            .eq('status', 'accepted')
            .eq('user_address', guest)
            .eq('friend_address', host),
        sb.from('friendships')
            .select('id')
            .eq('status', 'accepted')
            .eq('user_address', host)
            .eq('friend_address', guest),
    ]);
    if (asUser.error || asFriend.error) return false;
    return (asUser.data?.length || 0) > 0 || (asFriend.data?.length || 0) > 0;
}

/**
 * Guest → host join request (works when PeerJS and realtime broadcast fail).
 * Body: { roomCode, sessionId, username?, avatarUrl?, desiredSeat?, secret? }
 *
 * SEC-12: the caller no longer declares who they are. `wallet_address` is derived
 * from the verified SIWE session, so a request cannot be filed against someone
 * else's wallet. The client-declared `coins` field is gone — it was written
 * straight into the row, so the host saw a number the guest chose.
 */
export async function POST(request: Request) {
    try {
        const body = await request.json();
        const roomCode = String(body.roomCode || '').trim().toUpperCase();
        const secret = typeof body.secret === 'string' ? body.secret : '';
        const desiredSeat = Number.isInteger(body.desiredSeat) ? body.desiredSeat : null;

        if (!roomCode || roomCode.length < 3) {
            return NextResponse.json({ error: 'Invalid room code' }, { status: 400 });
        }

        // SEC-12: a session is required, and it IS the wallet.
        const wallet = await requireAppSession(body.walletAddress ?? body.wallet, body.sessionId);
        if (!wallet) {
            return NextResponse.json({ error: 'Session required to join a lobby' }, { status: 401 });
        }

        // SEC-12: throttle per (wallet, room). One wallet must not be able to
        // flood a host's pending-join list with a single click held down.
        const limit = checkRateLimit(rateKey(`lobby:join:${roomCode}`, wallet), 5, 60_000);
        if (!limit.ok) {
            return NextResponse.json(
                { error: 'Too many join requests for this room', retryAfter: limit.retryAfterSec },
                { status: 429, headers: rateLimitHeaders(limit) },
            );
        }

        const sb = serviceDb();

        // ── SEC-12: which door is this room? ──────────────────────────────
        // The host declares this in `lobby_join_policies`. No row means 'open',
        // which is the pre-SEC-12 behaviour, so existing rooms keep working.
        const { data: policyRow } = await sb
            .from('lobby_join_policies')
            .select('host_address, join_policy, credential_hash')
            .eq('room_code', roomCode)
            .maybeSingle();

        const door = (policyRow?.join_policy || 'open') as 'matchmaking' | 'invite' | 'open';

        if (door === 'matchmaking') {
            // Strangers the queue paired: the credential is the queue's
            // `validation_token`. Friendship is exactly the wrong gate here.
            if (!policyRow?.credential_hash) {
                return NextResponse.json({ error: 'Room is not ready to accept joins' }, { status: 409 });
            }
            if (!secret || sha256Hex(secret.trim()) !== policyRow.credential_hash) {
                return NextResponse.json(
                    { error: 'Invalid matchmaking ticket. Re-run matchmaking.' },
                    { status: 403 },
                );
            }
        } else if (door === 'invite') {
            // An invite link: the host picked this guest, so friendship AND the
            // shareable secret are both required.
            const hostAddress = String(policyRow?.host_address || '').toLowerCase();
            if (!policyRow?.credential_hash) {
                return NextResponse.json({ error: 'Room is not ready to accept joins' }, { status: 409 });
            }
            if (!secret || sha256Hex(secret.trim()) !== policyRow.credential_hash) {
                return NextResponse.json(
                    { error: 'Invalid invite secret. Paste the full invite link (s=…).' },
                    { status: 403 },
                );
            }
            if (!hostAddress) {
                return NextResponse.json({ error: 'Room has no host' }, { status: 409 });
            }
            if (!(await areAcceptedFriends(wallet, hostAddress))) {
                return NextResponse.json(
                    { error: 'This lobby is invite-only. Add each other as friends to join.' },
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
            // SEC-12: `coins` is no longer accepted from the client. It was
            // persisted verbatim, so a guest could show the host any balance.
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
        const sb = serviceDb();
        const hostAddress = await requireAppSession(
            url.searchParams.get('hostAddress'),
            url.searchParams.get('sessionId'),
        );
        if (!hostAddress) return NextResponse.json({ error: 'Host session required' }, { status: 401 });
        const { data: room } = await sb.from('live_matches').select('match_id, host_address')
            .eq('room_code', roomCode).maybeSingle();
        let canonicalHost = String(room?.host_address || '').toLowerCase();
        if (room?.match_id && !canonicalHost) {
            const { data: match } = await sb.from('matches').select('participants')
                .eq('id', room.match_id).maybeSingle();
            canonicalHost = String(match?.participants?.[0] || '').toLowerCase();
        }
        if (!room?.match_id || canonicalHost !== hostAddress) {
            return NextResponse.json({ error: 'Not the room host' }, { status: 403 });
        }
        const { data, error } = await sb
            .from('lobby_join_requests')
            // No `coins`: it is never written now (SEC-12 removed the only writer),
            // so selecting it would advertise a value that is always null.
            .select('id, room_code, wallet_address, username, avatar_url, desired_seat, created_at')
            .eq('room_code', roomCode)
            .order('created_at', { ascending: true })
            .limit(20);
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json({ requests: data || [] });
    } catch (err) {
        return NextResponse.json({ error: (err as Error).message }, { status: 500 });
    }
}

/** Host: delete a processed join request (host-session gated). */
export async function DELETE(request: Request) {
    try {
        const body = await request.json();
        const id = String(body.id || '');
        if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
        const wallet = await requireAppSession(body.hostAddress ?? body.walletAddress, body.sessionId);
        if (!wallet) return NextResponse.json({ error: 'Host session required' }, { status: 401 });
        const sb = serviceDb();
        const { data: req } = await sb.from('lobby_join_requests')
            .select('room_code').eq('id', id).maybeSingle();
        if (!req) return NextResponse.json({ success: true });
        const { data: room } = await sb.from('live_matches')
            .select('match_id, host_address').eq('room_code', req.room_code).maybeSingle();
        let canonicalHost = String(room?.host_address || '').toLowerCase();
        if (room?.match_id && !canonicalHost) {
            const { data: match } = await sb.from('matches').select('participants')
                .eq('id', room.match_id).maybeSingle();
            canonicalHost = String(match?.participants?.[0] || '').toLowerCase();
        }
        if (!room?.match_id || canonicalHost !== wallet) {
            return NextResponse.json({ error: 'Not the room host' }, { status: 403 });
        }
        const { error } = await sb.from('lobby_join_requests').delete().eq('id', id);
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json({ success: true });
    } catch (err) {
        return NextResponse.json({ error: (err as Error).message }, { status: 500 });
    }
}
