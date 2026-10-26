/* eslint-disable @typescript-eslint/no-explicit-any -- lint burn-down quarantine 2026-09-23 */
import { NextResponse } from 'next/server';
import { buildMatchRecordMessage, isFreshIssuedAt } from '@/lib/matchProof';
import { verifyPersonalSign } from '@/lib/walletVerify';
import { serviceDb, requireSession } from '@/lib/serverAuth';
import { rateKey, rateLimitHeaders } from '@/lib/rateLimit';
import { checkRateLimitShared } from '@/lib/rateLimitShared';

export async function POST(request: Request) {
    try {
        const supabase = serviceDb();
        const body = await request.json();
        const {
            winnerAddress,
            roomCode,
            gameMode,
            participants,
            wager = 0,
            matchId,
            message,
            signature,
            issuedAt,
        } = body;

        if (!participants || !Array.isArray(participants) || participants.length === 0 || !matchId) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
        }
        if (typeof wager !== 'number' || !Number.isFinite(wager) || wager < 0) {
            return NextResponse.json({ error: 'Invalid wager' }, { status: 400 });
        }

        // A single board is at most four seats — `/api/match/start` enforces the
        // same bound. Without this, `participants` is a client-chosen array and
        // every per-seat write below multiplies by an arbitrary N: the loops are
        // the amplification surface, not just a latency problem.
        const MAX_SEATS = 4;
        if (participants.length > MAX_SEATS) {
            return NextResponse.json(
                { error: `Too many participants (max ${MAX_SEATS})` },
                { status: 400 },
            );
        }

        // P6 & SA-2: Signature proof OR session-authenticated participant
        const hasSignatureProof = Boolean(message && signature && issuedAt);
        let authenticatedWallet: string | null = null;
        if (!hasSignatureProof) {
            const session = (await requireSession(request, { scope: 'match', matchId: String(matchId) })) ||
                            (await requireSession(request, { scope: 'app' }));
            if (!session) {
                return NextResponse.json({ error: 'Missing session or signature proof' }, { status: 401 });
            }
            authenticatedWallet = session.wallet.toLowerCase();
        } else if (!isFreshIssuedAt(issuedAt)) {
            return NextResponse.json({ error: 'Proof expired' }, { status: 401 });
        }

        // Resolve the participant seat set early: it is needed to validate the
        // (optional) capture counts below before the canonical message is built.
        const lowerParts = participants.map((p: string) => String(p).toLowerCase());
        const hostClaim = lowerParts[0] || '';

        // SA-5: this route writes progression, so its budget must not multiply by
        // instance count. Keyed on the AUTHENTICATED identity, not on
        // `participants[0]` — that field is caller-supplied, so keying on it let
        // anyone reset their own bucket by rotating the first element of the
        // array. For the signature path `hostClaim` is the only identity known
        // before verification; a forged one fails at `verifyPersonalSign` below,
        // and every amplified write is after that point.
        const limiterSubject = (authenticatedWallet || hostClaim || 'unknown').toLowerCase();
        const limiterKey = rateKey('match:record', limiterSubject);
        const sharedLimit = await checkRateLimitShared(limiterKey, 20, 60_000);
        if (!sharedLimit.ok) {
            return NextResponse.json(
                { error: 'Too many result submissions', retryAfter: sharedLimit.retryAfterSec },
                { status: 429, headers: rateLimitHeaders(sharedLimit) },
            );
        }

        // Optional per-player capture counts, host-attested. Only counts for
        // listed participants are accepted, and each is capped at what a single
        // four-player board can possibly produce, so an inflated count cannot be
        // smuggled in later either: the `captures:` line is part of the signed
        // message, so any other value fails the digest check below.
        const MAX_CAPTURES_PER_MATCH = 64;
        const rawCaptures = body.captures;
        const captures: Record<string, number> = {};
        if (rawCaptures !== undefined && rawCaptures !== null) {
            if (typeof rawCaptures !== 'object' || Array.isArray(rawCaptures)) {
                return NextResponse.json({ error: 'Invalid captures map' }, { status: 400 });
            }
            for (const [wallet, count] of Object.entries(rawCaptures as Record<string, unknown>)) {
                const lw = String(wallet).toLowerCase();
                if (!lowerParts.includes(lw)) {
                    return NextResponse.json({ error: 'Capture wallet is not a match participant' }, { status: 400 });
                }
                const n = typeof count === 'number' ? count : Number(count);
                if (!Number.isInteger(n) || n < 0 || n > MAX_CAPTURES_PER_MATCH) {
                    return NextResponse.json({ error: 'Invalid capture count' }, { status: 400 });
                }
                if (n > 0) captures[lw] = n;
            }
        }

        if (hasSignatureProof) {
            // Canonical message must match exactly what the client claims to have signed.
            const expected = buildMatchRecordMessage({
                winnerAddress: winnerAddress || null,
                roomCode,
                gameMode: gameMode || 'classic',
                participants,
                wager,
                matchId: matchId || null,
                issuedAt,
                captures,
            });
            if (message !== expected) {
                return NextResponse.json({ error: 'Message payload mismatch' }, { status: 401 });
            }

            // 6492-aware host proof (EOA ecrecover + 1271/6492 on Base 8453).
            const verdict = await verifyPersonalSign({ address: hostClaim, message, signature });
            if (!verdict.ok) {
                const error = verdict.code === 'ecrecover-invalid' ? 'Invalid signature' : 'Signer mismatch';
                console.error('❌ [API] Signature recovery failed:', verdict.code);
                return NextResponse.json({ error, code: verdict.code }, { status: 401 });
            }
        }
        const recovered: string = hostClaim;

        // If a winner wallet is claimed, it must be one of the participants.
        if (winnerAddress && !lowerParts.includes(String(winnerAddress).toLowerCase())) {
            return NextResponse.json({ error: 'Winner is not a match participant' }, { status: 403 });
        }

        // Results may only settle a canonical match, and every signed field must
        // agree with its stored identity.
        {
            const { data: existing, error: fetchMatchErr } = await supabase
                .from('matches')
                .select('id, winner_address, finished_at, room_code, game_mode, participants, host_proven, room_owner')
                .eq('id', matchId)
                .maybeSingle();
            if (fetchMatchErr) {
                return NextResponse.json({ error: fetchMatchErr.message }, { status: 500 });
            }
            if (!existing) {
                return NextResponse.json({ error: 'Match not found' }, { status: 404 });
            }
            const storedParts = (existing.participants || []).map((p: string) => p.toLowerCase()).sort();
            if (existing.room_code !== roomCode || existing.game_mode !== (gameMode || 'classic') ||
                JSON.stringify(storedParts) !== JSON.stringify([...lowerParts].sort())) {
                return NextResponse.json({ error: 'Match payload does not match canonical match' }, { status: 403 });
            }
            const canonicalHost = String(existing.participants?.[0] || '').toLowerCase();
            const roomOwner = (existing as { room_owner?: string }).room_owner?.toLowerCase();
            if (hasSignatureProof) {
                if (!canonicalHost || recovered !== canonicalHost) {
                    return NextResponse.json({ error: 'Only the canonical match host may record the result' }, { status: 403 });
                }
            } else {
                // SA-2: When recording without signature proof, caller must be room owner or a match participant
                if (!authenticatedWallet || (!lowerParts.includes(authenticatedWallet) && roomOwner !== authenticatedWallet)) {
                    return NextResponse.json({ error: 'Caller is not an authorized participant of this match' }, { status: 403 });
                }
            }
            if (!(existing as { host_proven?: boolean }).host_proven && !roomOwner) {
                return NextResponse.json(
                    {
                        error: 'Match host was never proven; this match cannot record progression',
                        code: 'HOST_UNPROVEN',
                    },
                    { status: 403 },
                );
            }
            if (existing.finished_at) {
                return NextResponse.json({ error: 'Match already settled' }, { status: 409 });
            }
        }

        // P1 & SA-2: Derive the authoritative winner from match_states.state.winner and reject mismatch
        let authoritativeWinnerAddress: string | null = null;
        {
            const { data: stateRow, error: stateErr } = await supabase
                .from('match_states')
                .select('state, color_corner, player_seats')
                .eq('match_id', matchId)
                .maybeSingle();

            if (stateErr) {
                console.warn('[match/record] match_states read warning:', stateErr.message);
            } else if (stateRow && stateRow.state) {
                const gameState = stateRow.state as { winner?: unknown; status?: unknown };
                const stateWinner = gameState.winner ? String(gameState.winner) : null;
                const seats = (stateRow.player_seats || {}) as Record<string, { kind?: string; wallet?: string }>;

                if (stateWinner) {
                    if (stateWinner.startsWith('0x')) {
                        authoritativeWinnerAddress = stateWinner.toLowerCase();
                    } else if (seats[stateWinner]?.wallet) {
                        authoritativeWinnerAddress = seats[stateWinner].wallet!.toLowerCase();
                    }
                }

                // If server-recorded authoritative winner exists, client claimed winnerAddress MUST match
                if (authoritativeWinnerAddress && winnerAddress) {
                    if (winnerAddress.toLowerCase() !== authoritativeWinnerAddress) {
                        return NextResponse.json(
                            {
                                error: 'Winner mismatch against server authoritative state',
                                code: 'WINNER_MISMATCH',
                                serverWinner: authoritativeWinnerAddress,
                                claimedWinner: winnerAddress,
                            },
                            { status: 403 },
                        );
                    }
                } else if (authoritativeWinnerAddress && !winnerAddress) {
                    return NextResponse.json(
                        {
                            error: 'Omitted winner contradicts server authoritative state',
                            code: 'WINNER_MISMATCH',
                            serverWinner: authoritativeWinnerAddress,
                        },
                        { status: 403 },
                    );
                }
            }

            // SA-2: Session-based settlement requires authoritative server winner recorded in match_states
            if (!hasSignatureProof) {
                if (!authoritativeWinnerAddress) {
                    return NextResponse.json(
                        {
                            error: 'Match has no server-recorded winner; cannot record progression without host signature',
                            code: 'SERVER_WINNER_REQUIRED',
                        },
                        { status: 403 },
                    );
                }
                if (!winnerAddress || winnerAddress.toLowerCase() !== authoritativeWinnerAddress) {
                    return NextResponse.json(
                        {
                            error: 'Claimed winner does not match authoritative server state',
                            code: 'WINNER_MISMATCH',
                            serverWinner: authoritativeWinnerAddress,
                            claimedWinner: winnerAddress,
                        },
                        { status: 403 },
                    );
                }
            }
        }

        console.log('📝 [API] Recording signed match result...', { winnerAddress, roomCode, gameMode, participants, matchId, signer: recovered });

        // 1. Record the match
        let matchError = null;
        {
            const { data: claimedMatch, error: updErr } = await supabase.from('matches')
                .update({
                    winner_address: winnerAddress,
                    finished_at: new Date().toISOString()
                })
                .eq('id', matchId)
                .is('finished_at', null)
                .select('id')
                .maybeSingle();
            matchError = updErr;
            if (!matchError && !claimedMatch) {
                return NextResponse.json({ error: 'Match already settled' }, { status: 409 });
            }
        }

        if (matchError) {
            console.error('❌ [API] Error saving match:', matchError);
            return NextResponse.json({ error: matchError.message }, { status: 500 });
        }

        // Helper to get current season ID (YYYYQ)
        const now = new Date();
        const currentYear = now.getFullYear();
        const currentQuarter = Math.floor(now.getMonth() / 3) + 1;
        const currentSeasonId = currentYear * 10 + currentQuarter;

        // 2. Progression for every participant in TWO round trips.
        //
        // This used to be a read-modify-write per participant, serially awaited
        // (2 round trips x N), and the write budget grew with `participants`
        // length. `players.wallet_address` carries
        // CHECK (wallet_address = lower(wallet_address)), so an exact `.in()` is
        // equivalent to the old case-insensitive `.ilike()` lookups.
        //
        // Coin pot is intentionally NOT paid from this path — wager settlement
        // is a separate, server-owned flow. This route awards progression only.
        // SA-2: Cap wager scaling to prevent progression inflation exploits
        const MAX_PROGRESSION_WAGER = 10_000;
        const effectiveWager = Math.min(Math.max(0, wager), MAX_PROGRESSION_WAGER);
        const winLxpGain = 150 + Math.floor(effectiveWager * 0.1);
        const winRxpGain = 30;
        // R1: the loser branch must use the SAME capped wager as the winner
        // branch. Using the raw body `wager` here left the inflation hole open
        // from the other side — a losing participant could declare wager=1e9
        // and collect ~50M LXP.
        const baseLxpGain = 50 + Math.floor(effectiveWager * 0.05);
        const lossRxpPenalty = 15;

        const winnerLower = winnerAddress ? String(winnerAddress).toLowerCase() : null;
        // Deduped, and restricted to well-formed wallets: a non-wallet seat can
        // never match a `players` row, so filtering it out of the query is
        // equivalent to the old per-address `.ilike()` that found nothing.
        const seatWallets = [...new Set(lowerParts)].filter((a) => /^0x[a-f0-9]{40}$/.test(a));

        type PlayerRow = {
            wallet_address: string;
            total_wins: number | null;
            classic_played: number | null;
            power_played: number | null;
            lxp: number | string | null;
            rxp: number | null;
            season_id: number | null;
            created_at: string | null;
            last_played_at: string | null;
        };

        const { data: playerRows, error: playersReadError } = seatWallets.length
            ? await supabase
                .from('players')
                .select('wallet_address, total_wins, classic_played, power_played, lxp, rxp, season_id, created_at, last_played_at')
                .in('wallet_address', seatWallets)
            : { data: [] as PlayerRow[], error: null };

        if (playersReadError) {
            // Progression is a mirror of the match row, which is already claimed.
            console.error('❌ [API] player progression read failed:', playersReadError);
        }

        const playerByWallet = new Map<string, PlayerRow>();
        for (const row of (playerRows ?? []) as PlayerRow[]) {
            playerByWallet.set(String(row.wallet_address).toLowerCase(), row);
        }
        // Pre-update snapshot: `recordReturnVisit` needs `last_played_at` as it
        // was BEFORE this settlement overwrites it. Reading it back afterwards —
        // the old shape — always saw "today" and never awarded day2/day3.
        const preUpdatePlayers = [...playerByWallet.values()].map((row) => ({
            wallet_address: String(row.wallet_address).toLowerCase(),
            created_at: row.created_at,
            last_played_at: row.last_played_at,
        }));

        if (playerByWallet.size > 0) {
            const lastPlayedAt = now.toISOString();
            const patches = [...playerByWallet.values()].map((row) => {
                const walletLower = String(row.wallet_address).toLowerCase();
                const isWinner = winnerLower !== null && walletLower === winnerLower;
                const isNewSeason = (row.season_id || 0) < currentSeasonId;
                const currentRxp = isNewSeason ? 0 : (row.rxp || 0);
                // DB-22: total_games is a stored generated column
                // (classic_played + power_played + ai_played) — a write that
                // names it fails with 428C9. Count the game on its mode counter.
                const playedCounter = gameMode === 'power'
                    ? { power_played: (row.power_played || 0) + 1 }
                    : { classic_played: (row.classic_played || 0) + 1 };
                return {
                    // Stored casing, so the conflict target matches exactly.
                    wallet_address: row.wallet_address,
                    ...playedCounter,
                    total_wins: isWinner ? (row.total_wins || 0) + 1 : (row.total_wins || 0),
                    lxp: Number(row.lxp || 0) + (isWinner ? winLxpGain : baseLxpGain),
                    rxp: isWinner ? currentRxp + winRxpGain : Math.max(0, currentRxp - lossRxpPenalty),
                    season_id: currentSeasonId,
                    last_played_at: lastPlayedAt,
                };
            });

            const { error: playerWriteError } = await supabase
                .from('players')
                .upsert(patches, { onConflict: 'wallet_address' });
            if (playerWriteError) {
                console.error('❌ [API] player progression write failed:', playerWriteError);
            }
        }

        const isPvpMatch = lowerParts.length >= 2; // versus match (not the solo/AI path)

        // 3. Mission progress — one catalog read, one progress read, one upsert.
        //
        // The old shape called `updateMissionProgress` once per (wallet, mission)
        // with a `select ... .single()` + insert/update pair: N+1, and wrong
        // after migration 202609300004 re-keyed `player_missions` on
        // (player_id, mission_id, period_id). `.single()` returns PGRST116 as
        // soon as a player has more than one period row, the code then took its
        // "create" branch, and the insert landed on the default
        // period_id = 'legacy' — a bucket /api/missions/list never reads. Mission
        // progress from settlement was being written into a row nobody sees.
        try {
            const { loadMissionCatalog, periodBucketFor } = await import('@/lib/missionCatalog');
            const defById = new Map((await loadMissionCatalog()).map((m) => [m.missionId, m]));

            // wallet -> missionId -> summed delta. Restricted to wallets that
            // actually have a `players` row: player_missions.player_id is FK'd.
            const wanted = new Map<string, Map<string, number>>();
            const addBump = (wallet: string, missionId: string, delta: number) => {
                const w = String(wallet).toLowerCase();
                if (!playerByWallet.has(w) || delta <= 0) return;
                const perMission = wanted.get(w) ?? new Map<string, number>();
                perMission.set(missionId, (perMission.get(missionId) ?? 0) + delta);
                wanted.set(w, perMission);
            };

            if (winnerLower) addBump(winnerLower, 'daily_win_1', 1);
            for (const addr of seatWallets) addBump(addr, 'daily_play_3', 1);
            for (const [addr, count] of Object.entries(captures)) addBump(addr, 'daily_capture_2', count);

            const bumps = [...wanted.entries()].flatMap(([wallet, perMission]) =>
                [...perMission.entries()].map(([missionId, delta]) => {
                    const def = defById.get(missionId);
                    // Unknown mission -> the column's own default bucket.
                    return {
                        wallet,
                        missionId,
                        periodId: def ? periodBucketFor(def, now) : 'legacy',
                        delta,
                    };
                }),
            );

            if (bumps.length > 0) {
                const { data: existingRows, error: missionReadError } = await supabase
                    .from('player_missions')
                    .select('player_id, mission_id, period_id, progress, is_claimed')
                    .in('player_id', [...new Set(bumps.map((b) => b.wallet))])
                    .in('mission_id', [...new Set(bumps.map((b) => b.missionId))])
                    .in('period_id', [...new Set(bumps.map((b) => b.periodId))]);
                if (missionReadError) throw missionReadError;

                const existingByKey = new Map<string, { progress: number; is_claimed: boolean }>();
                for (const row of existingRows ?? []) {
                    existingByKey.set(`${row.player_id}:${row.mission_id}:${row.period_id}`, {
                        progress: Number(row.progress || 0),
                        is_claimed: Boolean(row.is_claimed),
                    });
                }

                // A new period is a new row, so there is no date comparison to
                // get wrong — the daily reset this route used to perform is now
                // structural.
                const missionRows = bumps.map((b) => {
                    const prior = existingByKey.get(`${b.wallet}:${b.missionId}:${b.periodId}`);
                    return {
                        player_id: b.wallet,
                        mission_id: b.missionId,
                        period_id: b.periodId,
                        progress: (prior?.progress ?? 0) + b.delta,
                        is_claimed: prior?.is_claimed ?? false,
                        last_updated: now.toISOString(),
                    };
                });

                const { error: missionWriteError } = await supabase
                    .from('player_missions')
                    .upsert(missionRows, { onConflict: 'player_id,mission_id,period_id' });
                if (missionWriteError) throw missionWriteError;
            }
        } catch (missionErr) {
            // The match row is already claimed; mission progress is a mirror.
            console.error('[missions] match settlement progress failed:', missionErr);
        }

        // Option 3 Lazy Sync: Queue free match progress in player_free_matches
        // for players to batch-sync on-chain (paying gas) when they choose.
        try {
            const freeMatchRows = Array.from(new Set(lowerParts)).map((addr) => ({
                match_id: matchId,
                player_id: addr,
                won: addr === winnerLower,
                is_pvp: isPvpMatch,
                captures: Number(captures[addr] ?? 0),
                played_at: new Date().toISOString(),
                onchain_synced: false,
            }));
            if (freeMatchRows.length > 0) {
                const { error: queueErr } = await supabase
                    .from('player_free_matches')
                    .upsert(freeMatchRows, { onConflict: 'player_id,match_id' });
                if (queueErr) {
                    console.error('[matches] failed to queue free match for sync:', queueErr);
                }
            }
        } catch (queueErr) {
            console.error('[matches] free match queue unexpected error:', queueErr);
        }

        // Onboarding tracks (server-owned progress; claims stay pull-based).
        // `preUpdatePlayers` is the snapshot taken before the progression write
        // above — `recordReturnVisit` needs last_played_at as it was BEFORE this
        // settlement, or it always reads "today" and never awards day2/day3.
        try {
            const { recordMatchOnboarding } = await import('@/lib/onboardingProgressWriter');
            await recordMatchOnboarding(supabase, {
                participants: lowerParts,
                gameMode: gameMode || 'classic',
                preUpdatePlayers,
            });
        } catch (onbErr) {
            console.error('[onboarding] match writers failed:', onbErr);
        }

        return NextResponse.json({ success: true });
    } catch (err: any) {
        console.error('❌ [API] Unexpected error:', err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
