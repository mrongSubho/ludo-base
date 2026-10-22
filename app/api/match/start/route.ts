import { NextResponse } from 'next/server';
import { serviceDb, requireAppSession, requireSessionWallet } from '@/lib/serverAuth';
import { GAME_MODE_CODE } from '@/lib/constants';
import { resolveRoomVersion } from '@/lib/serverAuthority';
import { assignAndPersistSeats } from '@/lib/matchSeats';

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
 * Body: { roomCode, gameMode, matchShape?, participants[], walletAddress?, sessionId? }
 *
 * ECO-08: `matchShape` ('1v1' | '2v2' | '4P') is persisted alongside the match.
 * The pool shape decides the payout split on-chain, and it used to be inferred
 * from seat colours — which is wrong for 4P, since LOBBY_COLORS['4P'] seats
 * players green,red,yellow,blue and MatchPool treats colours {1,4} as
 * teammates. A 4P game whose top two were green+blue was paid 50/50 instead of
 * the 75/25 podium. `gameModeCode` is the numeric form for the signed ticket.
 */
export async function POST(request: Request) {
    try {
        const supabase = serviceDb();
        const body = await request.json();
        const {
            roomCode,
            gameMode,
            matchShape,
            participants,
            walletAddress,
            sessionId,
        } = body ?? {};

        // ECO-08. Validate the shape up front: a bad value must not create a
        // match row that later silently signs a ticket with the wrong split.
        if (matchShape !== undefined && matchShape !== '1v1' && matchShape !== '2v2' && matchShape !== '4P') {
            return NextResponse.json({ error: 'matchShape must be 1v1, 2v2 or 4P' }, { status: 400 });
        }
        // Seat-count agreement is NOT enforced here: page.tsx posts only the
        // human roster (AI seats are filtered out), so a bot 4P match legitimately
        // arrives with fewer entries than the shape implies. The check belongs on
        // the money path instead — chips/lobby-ticket compares the stored roster
        // against the stored shape and refuses to sign a mismatched ticket.
        // Numeric game mode for MatchPool.LobbyTicket. Unknown modes stay NULL
        // so the ticket route fails closed instead of signing "classic".
        const gameModeCode = GAME_MODE_CODE[String(gameMode ?? 'classic')] ?? null;

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
        let roomOwner: string | null = null;
        if (hostIsAddress) {
            const session = (await requireSessionWallet(request, { scope: 'app', expectedWallet: walletAddress ? String(walletAddress) : undefined })) ||
                (await requireAppSession(String(walletAddress), String(sessionId)));
            if (!session) {
                return NextResponse.json(
                    {
                        error: 'host proof required for a wallet-addressed match',
                        hint: 'pass walletAddress + sessionId, or use the anonymous marker for local games',
                    },
                    { status: 401 },
                );
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
            roomOwner = session.toLowerCase();
        } else {
            const optionalSession = await requireSessionWallet(request, { scope: 'app' });
            if (optionalSession) roomOwner = optionalSession.toLowerCase();
        }

        console.log('🏁 [API] Starting match...', {
            roomCode,
            gameMode,
            participants: roster,
            hostProven,
            roomOwner,
        });

        // MO-4: quick match already has a canonical row for this room — `join_matchmaking`
        // inserts one with the paired roster so the queue can point at a match id. The
        // old unconditional insert therefore created a SECOND row for the same
        // `room_code`, which broke any `.eq('room_code', …).maybeSingle()` reader
        // (PGRST116, multiple rows) and left two candidate identities for settlement.
        // Enrich the existing row instead of adding another.
        const { data: existingRow, error: lookupError } = await supabase
            .from('matches')
            .select('id, participants')
            .eq('room_code', roomCode)
            .order('created_at', { ascending: true })
            .limit(1)
            .maybeSingle();
        if (lookupError) {
            console.error('❌ [API] Match lookup failed:', lookupError);
            return NextResponse.json({ error: lookupError.message }, { status: 500 });
        }

        if (existingRow) {
            // Keep the stored roster when the caller's roster is a subset (bot seats
            // are filtered out client-side); never let a start call silently shrink
            // the canonical participant list.
            const storedParts = ((existingRow.participants || []) as string[]).map(p => String(p).toLowerCase());
            const mergedRoster = storedParts.length >= roster.length ? storedParts : roster;
            const { data, error } = await supabase
                .from('matches')
                .update({
                    game_mode: gameMode || 'classic',
                    game_mode_code: gameModeCode,
                    match_shape: matchShape ?? null,
                    participants: mergedRoster,
                    host_proven: hostProven,
                    room_owner: roomOwner,
                })
                .eq('id', existingRow.id)
                .select('id, host_proven, room_owner')
                .single();
            if (error || !data) {
                console.error('❌ [API] Error updating match:', error);
                return NextResponse.json({ error: error?.message || 'Failed to start match' }, { status: 500 });
            }

            if (data.id && matchShape && mergedRoster.length > 0) {
                try {
                    await assignAndPersistSeats(data.id, matchShape, mergedRoster);
                } catch (e) {
                    console.warn('⚠️ [API] Seat assignment on update warning:', e);
                }
            }

            return NextResponse.json({
                success: true,
                matchId: data.id,
                roomVersion: resolveRoomVersion(),
                settleable: Boolean(data.host_proven),
                reused: true,
            });
        }

        const { data, error } = await supabase
            .from('matches')
            .insert({
                room_code: roomCode,
                game_mode: gameMode || 'classic',
                game_mode_code: gameModeCode,
                match_shape: matchShape ?? null,
                participants: roster,
                host_proven: hostProven,
                room_owner: roomOwner,
            })
            .select('id, host_proven, room_owner')
            .single();

        if (error || !data) {
            console.error('❌ [API] Error inserting match:', error);
            return NextResponse.json(
                { error: error?.message || 'Failed to create match' },
                { status: 500 },
            );
        }

        if (data.id && matchShape && roster.length > 0) {
            try {
                await assignAndPersistSeats(data.id, matchShape, roster);
            } catch (e) {
                console.warn('⚠️ [API] Seat assignment on insert warning:', e);
            }
        }

        const roomVersion = resolveRoomVersion();

        return NextResponse.json({
            success: true,
            matchId: data.id,
            roomVersion,
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
