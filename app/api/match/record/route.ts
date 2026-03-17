import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function updateMissionProgress(walletAddress: string, missionId: string, increment: number) {
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
        const { winnerAddress, roomCode, gameMode, participants, wager = 0 } = await request.json();

        if (!winnerAddress || !participants || !Array.isArray(participants)) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
        }

        console.log('📝 [API] Recording match result...', { winnerAddress, roomCode, gameMode, participants });

        // 1. Record the match
        const { error: matchError } = await supabase.from('matches').insert({
            winner_address: winnerAddress,
            room_code: roomCode,
            game_mode: gameMode || 'classic',
            participants: participants
        });

        if (matchError) {
            console.error('❌ [API] Error inserting match:', matchError);
            return NextResponse.json({ error: matchError.message }, { status: 500 });
        }

        // Helper to get current season ID (YYYYQ)
        const now = new Date();
        const currentYear = now.getFullYear();
        const currentQuarter = Math.floor(now.getMonth() / 3) + 1;
        const currentSeasonId = currentYear * 10 + currentQuarter;

        // 2. Update winner stats, XP, RP, and COINS
        const winXpGain = 150 + Math.floor(wager * 0.1);
        const winRpGain = 30;
        
        // Winner takes the pot (assuming everyone paid at match start, but here we'll just award the calculated prize)
        // For classic matches, pot = participants.length * wager
        const prizePool = participants.length * wager;

        const { data: player, error: fetchError } = await supabase
            .from('players')
            .select('total_wins, total_games, xp, rating, coins, season_id')
            .ilike('wallet_address', winnerAddress)
            .single();

        if (!fetchError && player) {
            const isNewSeason = (player.season_id || 0) < currentSeasonId;
            const currentRating = isNewSeason ? 0 : (player.rating || 0);

            await supabase
                .from('players')
                .update({
                    total_wins: (player.total_wins || 0) + 1,
                    total_games: (player.total_games || 0) + 1,
                    xp: (player.xp || 0) + winXpGain,
                    rating: currentRating + winRpGain,
                    coins: (player.coins || 0) + prizePool,
                    season_id: currentSeasonId,
                    last_played_at: new Date().toISOString()
                })
                .ilike('wallet_address', winnerAddress);

            // Mission: daily_win_1
            await updateMissionProgress(winnerAddress, 'daily_win_1', 1);
        }

        // 3. Update other participants (Loss)
        const others = participants.filter(p => p.toLowerCase() !== winnerAddress.toLowerCase());
        const baseXpGain = 50 + Math.floor(wager * 0.05);
        const lossRpPenalty = 15;

        for (const addr of others) {
            const { data: op, error: ef } = await supabase
                .from('players')
                .select('total_games, xp, rating, coins, season_id')
                .ilike('wallet_address', addr)
                .single();

            if (!ef && op) {
                const isNewSeason = (op.season_id || 0) < currentSeasonId;
                const currentRating = isNewSeason ? 0 : (op.rating || 0);

                await supabase
                    .from('players')
                    .update({
                        total_games: (op.total_games || 0) + 1,
                        xp: (op.xp || 0) + baseXpGain,
                        rating: Math.max(0, currentRating - lossRpPenalty),
                        // Note: Entry fee deduction should ideally happen at start, 
                        // but if we are doing it at end for simplicity:
                        coins: Math.max(0, (op.coins || 0) - wager), 
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
