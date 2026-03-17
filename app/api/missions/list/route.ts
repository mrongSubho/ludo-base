import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

const DAILY_MISSIONS = [
    { id: 'daily_bonus', type: 'social', title: 'Daily Bonus', description: 'Claim your daily 100 coins!', target: 1, rewardType: 'coins', rewardAmount: 100 },
    { id: 'daily_play_3', type: 'play', title: 'Warm Up', description: 'Play 3 matches today.', target: 3, rewardType: 'coins', rewardAmount: 100 },
    { id: 'daily_win_1', type: 'win', title: 'Champion', description: 'Win at least one match today.', target: 1, rewardType: 'coins', rewardAmount: 100 },
    { id: 'daily_poke_back', type: 'social', title: 'Poke Back!', description: 'Poke back a friend who poked you.', target: 1, rewardType: 'coins', rewardAmount: 100 },
    { id: 'daily_capture_2', type: 'play', title: 'Token Hunter', description: 'Capture 2 opponent tokens in any match.', target: 2, rewardType: 'coins', rewardAmount: 50 }
];

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const walletAddress = searchParams.get('wallet')?.toLowerCase();

    if (!walletAddress) {
        return NextResponse.json({ error: 'Wallet address required' }, { status: 400 });
    }

    try {
        // 1. Calculate Start of Day in UTC (00:00:00)
        const now = new Date();
        const startOfToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0));

        // 2. Fetch User's Missions
        const { data: userMissions, error } = await supabase
            .from('player_missions')
            .select('*')
            .eq('player_id', walletAddress);

        if (error) throw error;

        // 3. Process and Reset Missions if needed
        const processedMissions = [];
        const updateBatch = [];

        for (const def of DAILY_MISSIONS) {
            const userMission = userMissions?.find(m => m.mission_id === def.id);
            
            if (!userMission) {
                // Initialize if not exists
                const newMission = {
                    player_id: walletAddress,
                    mission_id: def.id,
                    progress: 0,
                    is_claimed: false,
                    last_updated: new Date().toISOString()
                };
                processedMissions.push({ ...def, ...newMission });
                await supabase.from('player_missions').insert(newMission);
            } else {
                const lastUpdated = new Date(userMission.last_updated);
                
                if (lastUpdated < startOfToday) {
                    // RESET for new day
                    const resetMission = {
                        ...userMission,
                        progress: 0,
                        is_claimed: false,
                        last_updated: new Date().toISOString()
                    };
                    processedMissions.push({ ...def, ...resetMission });
                    updateBatch.push(supabase.from('player_missions').update({
                        progress: 0,
                        is_claimed: false,
                        last_updated: new Date().toISOString()
                    }).eq('id', userMission.id));
                } else {
                    processedMissions.push({ ...def, ...userMission });
                }
            }
        }

        if (updateBatch.length > 0) {
            await Promise.all(updateBatch);
        }

        return NextResponse.json(processedMissions);

    } catch (err: any) {
        console.error('Error fetching missions:', err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
