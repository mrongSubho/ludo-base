import { NextResponse } from 'next/server';
import { serviceDb } from '@/lib/serverAuth';

/**
 * GET /api/matchmaking/pools?gameMode=…&matchType=…
 * Public wager distribution of searching tickets (counts only, no PII).
 * matchmaking_queue player_ids are server-only under default-deny, so the
 * aggregate is computed service-side. No session required (world-readable).
 */
export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const gameMode = searchParams.get('gameMode');
        const matchType = searchParams.get('matchType');
        const excludeWallet = (searchParams.get('walletAddress') || '').toLowerCase() || null;
        if (!gameMode || !matchType) {
            return NextResponse.json({ error: 'gameMode and matchType are required' }, { status: 400 });
        }
        let query = serviceDb()
            .from('matchmaking_queue')
            .select('wager, player_id')
            .eq('status', 'searching')
            .eq('game_mode', gameMode)
            .eq('match_type', matchType)
            .limit(200);
        if (excludeWallet) query = query.neq('player_id', excludeWallet);
        const { data, error } = await query;
        if (error) throw error;
        const counts: Record<number, number> = {};
        for (const row of data || []) {
            const w = row.wager;
            if (w !== null && w !== undefined) counts[w] = (counts[w] || 0) + 1;
        }
        return NextResponse.json({ pools: counts });
    } catch (error) {
        return NextResponse.json({ error: (error as Error).message }, { status: 500 });
    }
}
