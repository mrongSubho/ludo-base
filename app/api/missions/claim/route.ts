import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function POST(request: Request) {
    try {
        const { walletAddress, missionId } = await request.json();

        if (!walletAddress || !missionId) {
            return NextResponse.json({ error: 'Missing parameters' }, { status: 400 });
        }

        const lowAddr = walletAddress.toLowerCase();

        // 1. Fetch Mission Status
        const { data: mission, error: missionError } = await supabase
            .from('player_missions')
            .select('*')
            .eq('player_id', lowAddr)
            .eq('mission_id', missionId)
            .single();

        if (missionError || !mission) {
            return NextResponse.json({ error: 'Mission not found' }, { status: 404 });
        }

        if (mission.is_claimed) {
            return NextResponse.json({ error: 'Already claimed' }, { status: 400 });
        }

        // 2. Map Mission ID to Rewards (Static for now to match list API)
        const REWARDS: Record<string, number> = {
            'daily_bonus': 100,
            'daily_play_3': 100,
            'daily_win_1': 100,
            'daily_poke_back': 100,
            'daily_capture_2': 50
        };

        const rewardAmount = REWARDS[missionId] || 0;

        // Special check for daily_bonus: it's always "completable" just by claiming
        if (missionId === 'daily_bonus') {
            // Already initialized at progress 0, we can just claim it
        } else if (mission.progress < 1) { // Assuming progress threshold of at least some value for others
            // For target-based missions, we should check thresholds. 
            // In a real system, we'd fetch the mission definition from a DB or shared config.
            const TARGETS: Record<string, number> = {
                'daily_play_3': 3,
                'daily_win_1': 1,
                'daily_poke_back': 1,
                'daily_capture_2': 2
            };
            
            if (mission.progress < (TARGETS[missionId] || 1)) {
                return NextResponse.json({ error: 'Mission not completed' }, { status: 400 });
            }
        }

        // 3. ATOMIC TRANSACTION: Mark claimed and add coins
        // (Using RPC for atomicity if available, but since this is a simple app, sequential is okay for now)
        const { error: updateError } = await supabase
            .from('player_missions')
            .update({ is_claimed: true })
            .eq('id', mission.id);

        if (updateError) throw updateError;

        // Fetch current coins
        const { data: player, error: playerError } = await supabase
            .from('players')
            .select('coins')
            .ilike('wallet_address', lowAddr)
            .single();

        if (playerError) throw playerError;

        const { error: coinError } = await supabase
            .from('players')
            .update({ coins: (player.coins || 0) + rewardAmount })
            .ilike('wallet_address', lowAddr);

        if (coinError) throw coinError;

        return NextResponse.json({ success: true, reward: rewardAmount });

    } catch (err: any) {
        console.error('Claim Error:', err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
