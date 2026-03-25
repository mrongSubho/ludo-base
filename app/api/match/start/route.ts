import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

export async function POST(request: Request) {
    try {
        const { roomCode, gameMode, participants } = await request.json();

        if (!roomCode || !participants || !Array.isArray(participants)) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
        }

        console.log('🏁 [API] Starting match...', { roomCode, gameMode, participants });

        const { data, error } = await supabase.from('matches').insert({
            room_code: roomCode,
            game_mode: gameMode || 'classic',
            participants: participants
        }).select('id').single();

        if (error || !data) {
            console.error('❌ [API] Error inserting match:', error);
            return NextResponse.json({ error: error?.message || 'Failed to create match' }, { status: 500 });
        }

        return NextResponse.json({ success: true, matchId: data.id });
    } catch (err: any) {
        console.error('❌ [API] Unexpected error:', err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
