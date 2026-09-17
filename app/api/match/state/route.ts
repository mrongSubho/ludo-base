import { NextResponse } from 'next/server';
import { serviceDb } from '@/lib/serverAuth';

/**
 * GET /api/match/state?matchId=…
 * Public snapshot read for spectators. match_states has no anon SELECT
 * policy (server-only under default-deny), and live match state is
 * spectator-visible by design — so it reads through the service role.
 * No session required (world-readable output, no PII beyond board state).
 */
export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const matchId = searchParams.get('matchId');
        if (!matchId) return NextResponse.json({ error: 'matchId is required' }, { status: 400 });
        const { data, error } = await serviceDb()
            .from('match_states')
            .select('seq, state, color_corner')
            .eq('match_id', matchId)
            .maybeSingle();
        if (error) throw error;
        if (!data) return NextResponse.json({ error: 'Match not found', code: 'MATCH_NOT_FOUND' }, { status: 404 });
        return NextResponse.json(data);
    } catch (error) {
        return NextResponse.json({ error: (error as Error).message }, { status: 500 });
    }
}
