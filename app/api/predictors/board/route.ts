import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// Daily sharp board: today's settled spectator bets aggregated per predictor.
// Bets table is world-readable; usernames resolve via players.
export async function GET() {
    try {
        const now = new Date();
        const startOfToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0));

        const { data: bets, error } = await supabase
            .from('spectator_bets')
            .select('player_id, amount, potential_payout, status')
            .gte('resolved_at', startOfToday.toISOString())
            .in('status', ['won', 'lost']);

        if (error) throw error;

        const byPlayer = new Map<string, { wins: number; played: number; profit: number }>();
        for (const b of bets || []) {
            const cur = byPlayer.get(b.player_id) || { wins: 0, played: 0, profit: 0 };
            cur.played += 1;
            if (b.status === 'won') {
                cur.wins += 1;
                cur.profit += (b.potential_payout ?? 0) - (b.amount ?? 0);
            } else {
                cur.profit -= (b.amount ?? 0);
            }
            byPlayer.set(b.player_id, cur);
        }

        const ranked = [...byPlayer.entries()]
            .map(([player_id, s]) => ({ player_id, ...s }))
            .sort((a, b) => b.profit - a.profit || b.wins - a.wins)
            .slice(0, 10);

        const ids = ranked.map(r => r.player_id);
        let profiles: Record<string, { username: string | null; avatar_url: string | null }> = {};
        if (ids.length > 0) {
            const { data: players } = await supabase
                .from('players')
                .select('wallet_address, username, avatar_url')
                .in('wallet_address', ids);
            for (const p of players || []) {
                profiles[p.wallet_address.toLowerCase()] = { username: p.username, avatar_url: p.avatar_url };
            }
        }

        return NextResponse.json(
            ranked.map((r, i) => ({
                rank: i + 1,
                player_id: r.player_id,
                username: profiles[r.player_id.toLowerCase()]?.username || `User ${r.player_id.slice(0, 6).toUpperCase()}`,
                avatar_url: profiles[r.player_id.toLowerCase()]?.avatar_url || null,
                wins: r.wins,
                played: r.played,
                profit: r.profit,
            }))
        );
    } catch (err: any) {
        console.error('Predictor board error:', err.message || err);
        return NextResponse.json([]);
    }
}
