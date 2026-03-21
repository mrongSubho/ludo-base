import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

export async function POST(request: Request) {
    try {
        const { playerId, gameMode, matchType, wager, wagerMin, wagerMax } = await request.json();

        if (!playerId || !gameMode || !matchType) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
        }

        console.log('📡 [Matchmaking] Player joining queue...', { playerId, gameMode, matchType, wager, wagerMin, wagerMax });

        // Call the atomic join RPC
        const { data, error } = await supabase.rpc('join_matchmaking', {
            p_player_id: playerId,
            p_game_mode: gameMode,
            p_match_type: matchType,
            p_wager: wager || 0,
            p_wager_min: wagerMin,
            p_wager_max: wagerMax
        });

        if (error) {
            console.error('❌ [Matchmaking] RPC Error:', error);
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        console.log('✅ [Matchmaking] RPC Result:', data);
        return NextResponse.json(data);
    } catch (err: any) {
        console.error('❌ [Matchmaking] Unexpected error:', err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
