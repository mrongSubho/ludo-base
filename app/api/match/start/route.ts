/* eslint-disable @typescript-eslint/no-explicit-any -- lint burn-down quarantine 2026-09-23 */
import { NextResponse } from 'next/server';
import { serviceDb } from '@/lib/serverAuth';

export async function POST(request: Request) {
    try {
        // Server-owned insert (service role bypasses default-deny RLS).
        // Deliberately session-optional: local/offline games and pre-login hosts
        // call this before any SIWE session exists; the canonical host proof
        // is enforced downstream at /api/match/record settlement time.
        const supabase = serviceDb();
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
