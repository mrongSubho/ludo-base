/* eslint-disable @typescript-eslint/no-unused-vars -- lint burn-down quarantine 2026-09-23 */
import { NextResponse } from 'next/server';
import { buildStreamMessage, isFreshIssuedAt } from '@/lib/matchProof';
import { verifyPersonalSign } from '@/lib/walletVerify';
import { serviceDb } from '@/lib/serverAuth';

/** Service-role DB — host proof is a wallet signature, not an app session. Throws loudly when unconfigured. */
function db() {
    return serviceDb();
}

/** Bound hanging Supabase calls so the route cannot stall the platform. */
async function withTimeout<T>(p: PromiseLike<T>, ms: number, label: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            Promise.resolve(p),
            new Promise<never>((_, reject) => {
                timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
            }),
        ]);
    } finally {
        if (timer) clearTimeout(timer);
    }
}

/**
 * Host go-live / stop-live.
 * Live DB primary key is match_id (room_code is required text, not unique).
 * Stream on  → upsert live row + matches.streaming_enabled
 * Stream off → delete live row + streaming_enabled false
 */
export async function POST(request: Request) {
    try {
        const { matchId, roomCode, hostAddress, enabled, message, signature, issuedAt } = await request.json();

        if (!matchId) {
            return NextResponse.json({ error: 'Missing matchId' }, { status: 400 });
        }
        if (!roomCode) {
            return NextResponse.json({ error: 'Missing roomCode' }, { status: 400 });
        }

        const sb = db();
        const { data: match, error: matchLookupError } = await sb.from('matches')
            .select('id, room_code, participants')
            .eq('id', matchId).maybeSingle();
        if (matchLookupError) return NextResponse.json({ error: matchLookupError.message }, { status: 500 });
        if (!match) return NextResponse.json({ error: 'Match not found' }, { status: 404 });
        if (String(match.room_code || '') !== String(roomCode)) {
            return NextResponse.json({ error: 'Room does not match canonical match' }, { status: 403 });
        }
        const canonicalHost = String(match.participants?.[0] || '').toLowerCase();
        if (!canonicalHost || !hostAddress || String(hostAddress).toLowerCase() !== canonicalHost ||
            !message || !signature || !issuedAt || !isFreshIssuedAt(issuedAt) ||
            message !== buildStreamMessage({ matchId: String(matchId), roomCode: String(roomCode), hostAddress: canonicalHost, enabled: !!enabled, issuedAt })) {
            return NextResponse.json({ error: 'Invalid host proof' }, { status: 401 });
        }
        // 6492-aware host proof (EOA ecrecover + 1271/6492 on Base 8453).
        const verdict = await verifyPersonalSign({
            address: canonicalHost,
            message,
            signature,
        });
        if (!verdict.ok) {
            return NextResponse.json(
                { error: 'Invalid host signature', code: verdict.code },
                { status: 401 },
            );
        }
        const recovered = canonicalHost;

        const { error: matchError } = await withTimeout(
            sb.from('matches')
                .update({ streaming_enabled: !!enabled })
                .eq('id', matchId),
            12_000,
            'matches.update'
        );

        if (matchError) {
            console.error('❌ [API] matches.streaming_enabled:', matchError);
            return NextResponse.json({ error: matchError.message }, { status: 500 });
        }

        if (enabled) {
            // Live DB PK is match_id (not room_code). Upsert on match_id.
            const { error: liveError } = await withTimeout(
                sb.from('live_matches')
                    .upsert({
                        match_id: matchId,
                        room_code: String(roomCode),
                        host_address: hostAddress ? String(hostAddress).toLowerCase() : null,
                        bet_window_status: 'closed',
                        spectator_count: 0,
                        created_at: new Date().toISOString(),
                        updated_at: new Date().toISOString(),
                    }, { onConflict: 'match_id' }),
                12_000,
                'live_matches.upsert'
            );

            if (liveError) {
                console.error('❌ [API] live_matches upsert:', liveError);
                return NextResponse.json({ error: liveError.message }, { status: 500 });
            }
        } else {
            const { error: liveError } = await withTimeout(
                sb.from('live_matches').delete().eq('match_id', matchId),
                12_000,
                'live_matches.delete'
            );
            if (liveError) {
                console.error('❌ [API] live_matches delete:', liveError);
            }
        }

        return NextResponse.json({ success: true, enabled: !!enabled, roomCode, matchId });
    } catch (err) {
        console.error('❌ [API] Unexpected error in /api/match/stream:', err);
        return NextResponse.json({ error: (err as Error).message }, { status: 500 });
    }
}
