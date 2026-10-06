import { NextResponse } from 'next/server';
import { createHash, randomBytes } from 'crypto';
import { requireAppSession, serviceDb } from '@/lib/serverAuth';
import { checkRateLimit, rateKey, rateLimitHeaders } from '@/lib/rateLimit';

/**
 * POST /api/lobby/policy — declare which door this lobby admits (SEC-12).
 *
 * Until this existed, a hosted lobby had no server-side record at all, so
 * `lobby/join` could not know who was allowed in. `join_policy` supplies that:
 *
 *   matchmaking  the queue paired you, so the credential is the queue's
 *                `validation_token` and friendship is meaningless. sha256 of the
 *                token is stored in `join_secret_hash`.
 *   invite       an invite link. The guest must be an accepted friend of the
 *                host AND present the room secret.
 *   open         casual open-join by room code; a session is the only gate.
 *
 * Only the host may declare this, and only for a room it hosts.
 */
type Policy = 'matchmaking' | 'invite' | 'open';

const POLICIES: Policy[] = ['matchmaking', 'invite', 'open'];

function sha256Hex(s: string): string {
    return createHash('sha256').update(s).digest('hex');
}

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const roomCode = String(body.roomCode || '').trim().toUpperCase();
        const policy = String(body.joinPolicy || '') as Policy;
        const token = typeof body.validationToken === 'string' ? body.validationToken.trim() : '';
        const roomSecret = typeof body.roomSecret === 'string' ? body.roomSecret.trim() : '';

        if (!roomCode || roomCode.length < 3) {
            return NextResponse.json({ error: 'Invalid room code' }, { status: 400 });
        }
        if (!POLICIES.includes(policy)) {
            return NextResponse.json({ error: `joinPolicy must be one of ${POLICIES.join(', ')}` }, { status: 400 });
        }

        const wallet = await requireAppSession(body.walletAddress, body.sessionId);
        if (!wallet) return NextResponse.json({ error: 'Session required' }, { status: 401 });

        // The host declares this once per room; a misconfiguration loop should
        // not be able to rewrite the door.
        const limit = checkRateLimit(rateKey('lobby:policy', wallet), 10, 60_000);
        if (!limit.ok) {
            return NextResponse.json(
                { error: 'Too many requests', retryAfter: limit.retryAfterSec },
                { status: 429, headers: rateLimitHeaders(limit) },
            );
        }

        const sb = serviceDb();

        // Host authority: only the wallet that already registered this room may
        // change its door. A brand-new code is claimable by whoever asks first,
        // which is the same race the lobby code itself already has.
        const existing = await sb
            .from('lobby_join_policies')
            .select('host_address')
            .eq('room_code', roomCode)
            .maybeSingle();
        if (existing.data?.host_address) {
            const host = String(existing.data.host_address).toLowerCase();
            if (host !== wallet) {
                return NextResponse.json({ error: 'Not the room host' }, { status: 403 });
            }
        }

        // Credential digest per door. A matchmaking room is sealed by the queue
        // token it was handed; an invite room by a secret THIS SERVER mints, so
        // a host cannot choose a weak one (or omit the invite link entirely).
        // An open room is sealed by neither.
        const minted = policy === 'invite' && !roomSecret
            ? randomBytes(24).toString('base64url')
            : null;
        const credential = policy === 'matchmaking' ? token : policy === 'invite' ? (roomSecret || minted || '') : '';

        if (policy === 'matchmaking' && !credential) {
            return NextResponse.json(
                { error: 'A matchmaking room needs the queue validation_token' },
                { status: 400 },
            );
        }

        // One row per room code, in its own table. `live_matches.match_id` is
        // NOT NULL, so a pre-match lobby cannot be recorded there, and making it
        // nullable would change what every room_code/match_id query returns.
        const { error } = await sb.from('lobby_join_policies').upsert(
            {
                room_code: roomCode,
                host_address: wallet,
                join_policy: policy,
                credential_hash: credential ? sha256Hex(credential) : null,
                updated_at: new Date().toISOString(),
            },
            { onConflict: 'room_code' },
        );
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });

        // The minted secret goes back to the host so it can build the `?s=` link.
        return NextResponse.json({
            success: true,
            roomCode,
            joinPolicy: policy,
            isHost: true,
            roomSecret: policy === 'invite' ? (roomSecret || minted) : null,
        });
    } catch (err) {
        console.error('/api/lobby/policy', err);
        return NextResponse.json({ error: 'Could not set the lobby policy' }, { status: 500 });
    }
}
