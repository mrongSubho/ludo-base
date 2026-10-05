import { NextResponse } from 'next/server';
import { serviceDb, requireAppSession } from '@/lib/serverAuth';

const ADDRESS_RE = /^0x[a-f0-9]{40}$/i;

/**
 * POST /api/match/start
 * Creates the `matches` row that `/api/match/record` and `/api/match/stream`
 * treat as canonical.
 *
 * Security (SEC-06)
 * -----------------
 * This route used to accept an unauthenticated body and write `participants`
 * verbatim. Because `/api/match/record` derives the canonical host from
 * `participants[0]` and `/api/match/stream` verifies a host signature against
 * that same value, an anonymous caller could name themselves canonical host,
 * sign for themselves, and settle — minting progression for free and writing
 * arbitrary progression deltas to every address in `participants`.
 *
 * The offline/bot path cannot authenticate: page.tsx posts `['anonymous']`
 * with a `local-<ts>` room code because it filters out AI players and may run
 * before any SIWE session exists. So instead of forcing auth unconditionally,
 * this route records whether the host was PROVEN:
 *
 *   host_proven = true   — the caller held a session for participants[0]
 *   host_proven = false  — anonymous/local marker; the match is never settleable
 *
 * `/api/match/record` refuses to settle an unproven match, so an unauthenticated
 * caller can create junk rows but cannot settle them or move progression.
 *
 * Body: { roomCode, gameMode, participants[], walletAddress?, sessionId? }
 */
export async function POST(request: Request) {
    try {
        const supabase = serviceDb();
        const body = await request.json();
        const { roomCode, gameMode, participants, walletAddress, sessionId } = body ?? {};

        if (!roomCode || typeof roomCode !== 'string' || !Array.isArray(participants)) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
        }
        if (participants.length === 0 || participants.length > 4) {
            return NextResponse.json({ error: 'participants must have 1..4 entries' }, { status: 400 });
        }

        // Normalise and validate the roster. Each entry is either a real address
        // or the explicit anonymous marker; anything else is rejected so the
        // canonical-host slot can't hold arbitrary junk.
        const roster = participants.map((p: unknown) => String(p ?? '').trim().toLowerCase());
        for (const p of roster) {
            if (p === '') {
                return NextResponse.json({ error: 'empty participant entry' }, { status: 400 });
            }
            if (p !== 'anonymous' && !ADDRESS_RE.test(p)) {
                return NextResponse.json({ error: `invalid participant: ${p}` }, { status: 400 });
            }
        }
        const addresses = roster.filter((p) => ADDRESS_RE.test(p));
        if (new Set(addresses).size !== addresses.length) {
            return NextResponse.json({ error: 'duplicate participants' }, { status: 400 });
        }

        const canonicalHost = roster[0];
        const hostIsAddress = ADDRESS_RE.test(canonicalHost);

        // Proof of the canonical host. Only required when the host is a real
        // wallet; the anonymous/local path stays open but cannot settle.
        let hostProven = false;
        if (hostIsAddress) {
            if (!walletAddress || !sessionId) {
                return NextResponse.json(
                    {
                        error: 'host proof required for a wallet-addressed match',
                        hint: 'pass walletAddress + sessionId, or use the anonymous marker for local games',
                    },
                    { status: 401 },
                );
            }
            const session = await requireAppSession(String(walletAddress), String(sessionId));
            if (!session) {
                return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
            }
            if (session.toLowerCase() !== canonicalHost) {
                // The session must belong to the wallet being recorded as host,
                // otherwise this is the same "nominate anyone" bug in a new coat.
                return NextResponse.json(
                    { error: 'session does not match the canonical host' },
                    { status: 403 },
                );
            }
            hostProven = true;
        }

        console.log('🏁 [API] Starting match...', {
            roomCode,
            gameMode,
            participants: roster,
            hostProven,
        });

        const { data, error } = await supabase
            .from('matches')
            .insert({
                room_code: roomCode,
                game_mode: gameMode || 'classic',
                participants: roster,
                host_proven: hostProven,
            })
            .select('id, host_proven')
            .single();

        if (error || !data) {
            console.error('❌ [API] Error inserting match:', error);
            return NextResponse.json(
                { error: error?.message || 'Failed to create match' },
                { status: 500 },
            );
        }

        return NextResponse.json({
            success: true,
            matchId: data.id,
            // Surfaced so the client can tell whether progression is recordable.
            settleable: Boolean(data.host_proven),
        });
    } catch (err) {
        console.error('❌ [API] Unexpected error:', err);
        return NextResponse.json(
            { error: err instanceof Error ? err.message : 'unexpected error' },
            { status: 500 },
        );
    }
}
