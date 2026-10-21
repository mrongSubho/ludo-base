/* eslint-disable @typescript-eslint/no-explicit-any -- lint burn-down quarantine 2026-09-23 */
import { NextResponse } from 'next/server';
import { buildMatchRecordMessage, isFreshIssuedAt } from '@/lib/matchProof';
import { verifyPersonalSign } from '@/lib/walletVerify';
import { serviceDb, requireSession } from '@/lib/serverAuth';
import { reportProgress } from '@/lib/missionOracle';
import { rateKey, rateLimitHeaders } from '@/lib/rateLimit';
import { checkRateLimitShared } from '@/lib/rateLimitShared';

async function updateMissionProgress(walletAddress: string, missionId: string, increment: number) {
    // Signature-gated settlement (canonical host wallet-signs the payload).
    // Service role bypasses default-deny RLS; throws loudly when unconfigured.
    const supabase = serviceDb();
    const lowAddr = walletAddress.toLowerCase();
    const now = new Date();
    const startOfToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0));

    // Fetch existing mission state
    const { data: mission, error } = await supabase
        .from('player_missions')
        .select('*')
        .eq('player_id', lowAddr)
        .eq('mission_id', missionId)
        .single();

    if (error && error.code !== 'PGRST116') {
        console.error(`Error fetching mission ${missionId}:`, error);
        return;
    }

    if (!mission) {
        // Create new mission record
        await supabase.from('player_missions').insert({
            player_id: lowAddr,
            mission_id: missionId,
            progress: increment,
            is_claimed: false,
            last_updated: now.toISOString()
        });
    } else {
        const lastUpdated = new Date(mission.last_updated);
        const shouldReset = lastUpdated < startOfToday;

        await supabase.from('player_missions').update({
            progress: shouldReset ? increment : (mission.progress || 0) + increment,
            is_claimed: shouldReset ? false : mission.is_claimed,
            last_updated: now.toISOString()
        }).eq('id', mission.id);
    }
}

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

        // SA-5: this route writes progression, so its budget must not multiply by
        // instance count. Keyed per participant wallet; the shared counter is the
        // real ceiling, the in-process one is the cheap first pass inside it.
        const limiterKey = rateKey('match:record', String(participants[0] ?? 'unknown').toLowerCase());
        const sharedLimit = await checkRateLimitShared(limiterKey, 20, 60_000);
        if (!sharedLimit.ok) {
            return NextResponse.json(
                { error: 'Too many result submissions', retryAfter: sharedLimit.retryAfterSec },
                { status: 429, headers: rateLimitHeaders(sharedLimit) },
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

        // 2. Update winner stats, XP, RP, and COINS
        // Coin pot is intentionally NOT paid from this path — wager settlement
        // is a separate, server-owned flow. This route awards progression only.
        // SA-2: Cap wager scaling to prevent progression inflation exploits
        const MAX_PROGRESSION_WAGER = 10_000;
        const effectiveWager = Math.min(Math.max(0, wager), MAX_PROGRESSION_WAGER);
        const winLxpGain = 150 + Math.floor(effectiveWager * 0.1);
        const winRxpGain = 30;

        const { data: player, error: fetchError } = winnerAddress ? await supabase
            .from('players')
            .select('total_wins, classic_played, power_played, lxp, rxp, season_id')
            .ilike('wallet_address', winnerAddress)
            .single() : { data: null, error: null };

        if (!fetchError && player) {
            const isNewSeason = (player.season_id || 0) < currentSeasonId;
            const currentRxp = isNewSeason ? 0 : (player.rxp || 0);
            // DB-22: total_games is a stored generated column
            // (classic_played + power_played + ai_played) — an UPDATE that names
            // it fails with 428C9. Count the game on its mode counter instead.
            const playedCounter = gameMode === 'power'
                ? { power_played: (player.power_played || 0) + 1 }
                : { classic_played: (player.classic_played || 0) + 1 };

            await supabase
                .from('players')
                .update({
                    total_wins: (player.total_wins || 0) + 1,
                    ...playedCounter,
                    lxp: (player.lxp || 0) + winLxpGain,
                    rxp: currentRxp + winRxpGain,
                    season_id: currentSeasonId,
                    last_played_at: new Date().toISOString()
                })
                .ilike('wallet_address', winnerAddress);

            // Mission: daily_win_1 + weekly_win_3 (on-chain mirror per period)
            await updateMissionProgress(winnerAddress, 'daily_win_1', 1);
            void reportProgress(winnerAddress, 'daily_win_1', 1); // on-chain mirror (no-op until configured)
            void reportProgress(winnerAddress, 'weekly_win_3', 1); // on-chain mirror (no-op until configured)
        }

        // 3. Update other participants (Loss) — progression only, no coin drain
        const others = participants.filter((p: string) => !winnerAddress || p.toLowerCase() !== winnerAddress.toLowerCase());
        // R1: the loser branch must use the SAME capped wager as the winner branch.
        // Using the raw body `wager` here left the inflation hole open from the other
        // side — a losing participant could declare wager=1e9 and collect ~50M LXP.
        const baseLxpGain = 50 + Math.floor(effectiveWager * 0.05);
        const lossRxpPenalty = 15;

        for (const addr of others) {
            const { data: op, error: ef } = await supabase
                .from('players')
                .select('classic_played, power_played, lxp, rxp, season_id')
                .ilike('wallet_address', addr)
                .single();

            if (!ef && op) {
                const isNewSeason = (op.season_id || 0) < currentSeasonId;
                const currentRxp = isNewSeason ? 0 : (op.rxp || 0);
                // total_games is generated (see the winner branch above).
                const playedCounter = gameMode === 'power'
                    ? { power_played: (op.power_played || 0) + 1 }
                    : { classic_played: (op.classic_played || 0) + 1 };

                await supabase
                    .from('players')
                    .update({
                        ...playedCounter,
                        lxp: (op.lxp || 0) + baseLxpGain,
                        rxp: Math.max(0, currentRxp - lossRxpPenalty),
                        season_id: currentSeasonId,
                        last_played_at: new Date().toISOString()
                    })
                    .ilike('wallet_address', addr);
            }
        }

        // Mission: daily_play_3 + weekly_play_10 (ALL participants); weekly_pvp_2 when PvP.
        const isPvpMatch = lowerParts.length >= 2; // versus match (not the solo/AI path)
        for (const addr of participants) {
            await updateMissionProgress(addr, 'daily_play_3', 1);
            void reportProgress(addr, 'daily_play_3', 1); // on-chain mirror (no-op until configured)
            void reportProgress(addr, 'weekly_play_10', 1); // on-chain mirror (no-op until configured)
            if (isPvpMatch) void reportProgress(addr, 'weekly_pvp_2', 1); // on-chain mirror (no-op until configured)
        }

        // Mission: daily_capture_2 + weekly_capture_10 from the signature-attested
        // per-player capture counts. Only wallets with at least one kick are
        // reported; a zero-count entry means "no captures" and is skipped.
        for (const [addr, count] of Object.entries(captures)) {
            if (count <= 0) continue;
            void reportProgress(addr, 'daily_capture_2', count); // on-chain mirror (no-op until configured)
            void reportProgress(addr, 'weekly_capture_10', count); // on-chain mirror (no-op until configured)
            // Legacy DB mirror for the daily mission only. Weekly rows in
            // `player_missions` are reset on the daily interval by
            // `updateMissionProgress`, which would corrupt a 7-day mission — so
            // the weekly mission lives on-chain alone.
            await updateMissionProgress(addr, 'daily_capture_2', count);
        }

        // Onboarding tracks (server-owned progress; claims stay pull-based).
        try {
            const { recordMatchOnboarding } = await import('@/lib/onboardingProgressWriter');
            await recordMatchOnboarding(supabase, {
                participants: lowerParts,
                gameMode: gameMode || 'classic',
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
