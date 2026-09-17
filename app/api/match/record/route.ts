import { NextResponse } from 'next/server';
import { recoverMessageAddress } from 'viem';
import { buildMatchRecordMessage, isFreshIssuedAt } from '@/lib/matchProof';
import { serviceDb } from '@/lib/serverAuth';

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
        if (!message || !signature || !issuedAt || typeof roomCode !== 'string' || !roomCode) {
            return NextResponse.json({ error: 'Missing signature proof' }, { status: 401 });
        }
        if (typeof wager !== 'number' || !Number.isFinite(wager) || wager < 0) {
            return NextResponse.json({ error: 'Invalid wager' }, { status: 400 });
        }
        if (!isFreshIssuedAt(issuedAt)) {
            return NextResponse.json({ error: 'Proof expired' }, { status: 401 });
        }

        // Canonical message must match exactly what the client claims to have signed.
        const expected = buildMatchRecordMessage({
            winnerAddress: winnerAddress || null,
            roomCode,
            gameMode: gameMode || 'classic',
            participants,
            wager,
            matchId: matchId || null,
            issuedAt,
        });
        if (message !== expected) {
            return NextResponse.json({ error: 'Message payload mismatch' }, { status: 401 });
        }

        const lowerParts = participants.map((p: string) => String(p).toLowerCase());
        let recovered: string;
        try {
            recovered = (await recoverMessageAddress({
                message,
                signature: signature as `0x${string}`,
            })).toLowerCase();
        } catch (err) {
            console.error('❌ [API] Signature recovery failed:', err);
            return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
        }

        // If a winner wallet is claimed, it must be one of the participants.
        if (winnerAddress && !lowerParts.includes(String(winnerAddress).toLowerCase())) {
            return NextResponse.json({ error: 'Winner is not a match participant' }, { status: 403 });
        }

        // Results may only settle a canonical match, and every signed field must
        // agree with its stored identity.
        {
            const { data: existing, error: fetchMatchErr } = await supabase
                .from('matches')
                .select('id, winner_address, finished_at, room_code, game_mode, participants')
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
            if (!canonicalHost || recovered !== canonicalHost) {
                return NextResponse.json({ error: 'Only the canonical match host may record the result' }, { status: 403 });
            }
            if (existing.finished_at) {
                return NextResponse.json({ error: 'Match already settled' }, { status: 409 });
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
        const winLxpGain = 150 + Math.floor(wager * 0.1);
        const winRxpGain = 30;

        const { data: player, error: fetchError } = winnerAddress ? await supabase
            .from('players')
            .select('total_wins, total_games, lxp, rxp, season_id')
            .ilike('wallet_address', winnerAddress)
            .single() : { data: null, error: null };

        if (!fetchError && player) {
            const isNewSeason = (player.season_id || 0) < currentSeasonId;
            const currentRxp = isNewSeason ? 0 : (player.rxp || 0);

            await supabase
                .from('players')
                .update({
                    total_wins: (player.total_wins || 0) + 1,
                    total_games: (player.total_games || 0) + 1,
                    lxp: (player.lxp || 0) + winLxpGain,
                    rxp: currentRxp + winRxpGain,
                    season_id: currentSeasonId,
                    last_played_at: new Date().toISOString()
                })
                .ilike('wallet_address', winnerAddress);

            // Mission: daily_win_1
            await updateMissionProgress(winnerAddress, 'daily_win_1', 1);
        }

        // 3. Update other participants (Loss) — progression only, no coin drain
        const others = participants.filter((p: string) => !winnerAddress || p.toLowerCase() !== winnerAddress.toLowerCase());
        const baseLxpGain = 50 + Math.floor(wager * 0.05);
        const lossRxpPenalty = 15;

        for (const addr of others) {
            const { data: op, error: ef } = await supabase
                .from('players')
                .select('total_games, lxp, rxp, season_id')
                .ilike('wallet_address', addr)
                .single();

            if (!ef && op) {
                const isNewSeason = (op.season_id || 0) < currentSeasonId;
                const currentRxp = isNewSeason ? 0 : (op.rxp || 0);

                await supabase
                    .from('players')
                    .update({
                        total_games: (op.total_games || 0) + 1,
                        lxp: (op.lxp || 0) + baseLxpGain,
                        rxp: Math.max(0, currentRxp - lossRxpPenalty),
                        season_id: currentSeasonId,
                        last_played_at: new Date().toISOString()
                    })
                    .ilike('wallet_address', addr);
            }
        }

        // Mission: daily_play_3 (Update for ALL participants)
        for (const addr of participants) {
            await updateMissionProgress(addr, 'daily_play_3', 1);
        }

        return NextResponse.json({ success: true });
    } catch (err: any) {
        console.error('❌ [API] Unexpected error:', err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
