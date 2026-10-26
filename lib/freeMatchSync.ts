import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Backfills any free matches from `matches` table that are not yet in `player_free_matches`
 * for the given player. Ensures offline/casual/free matches are queued for lazy on-chain sync.
 */
export async function backfillPlayerFreeMatches(
    db: SupabaseClient,
    wallet: string,
): Promise<void> {
    try {
        const me = wallet.toLowerCase();
        const { data: rawMatches, error: matchesErr } = await db
            .from('matches')
            .select('id, created_at, finished_at, game_mode, match_shape, participants, winner_address, metadata')
            .overlaps('participants', [me])
            .order('created_at', { ascending: false })
            .limit(50);

        if (matchesErr || !rawMatches || rawMatches.length === 0) return;

        const rawIds = rawMatches.map((m) => m.id);

        // Identify which matches were paid pools (settled by relayer/contract, not free sync)
        const { data: paidPools } = await db
            .from('chips_pools')
            .select('match_id')
            .in('match_id', rawIds)
            .gt('entry_fee', 0);
        const paidSet = new Set((paidPools ?? []).map((p) => String(p.match_id)));

        // Fetch match_states for accurate matchStats / kicks
        const { data: states } = await db
            .from('match_states')
            .select('match_id, state, player_seats')
            .in('match_id', rawIds);

        const stateByMatchId = new Map(
            (states ?? []).map((s) => [String(s.match_id), s])
        );

        const toInsert = [];
        for (const m of rawMatches) {
            if (paidSet.has(m.id)) continue;

            const winnerLc = m.winner_address ? m.winner_address.toLowerCase() : null;
            const won = winnerLc === me;
            const partWallets: string[] = Array.from(
                new Set((m.participants ?? []).map((p: unknown) => String(p).toLowerCase()))
            );
            const isPvp =
                partWallets.filter((a) => /^0x[a-f0-9]{40}$/.test(a)).length >= 2 &&
                m.game_mode !== 'ai' &&
                m.game_mode !== 'offline';

            let captures = 0;
            const stateRow = stateByMatchId.get(m.id);
            if (stateRow) {
                let color: string | null = null;
                if (Array.isArray(stateRow.player_seats)) {
                    const seat = (stateRow.player_seats as Array<{ walletAddress?: string; color?: string }>).find(
                        (s) => String(s?.walletAddress || '').toLowerCase() === me
                    );
                    if (seat?.color) color = seat.color;
                } else if (stateRow.player_seats && typeof stateRow.player_seats === 'object') {
                    for (const [col, s] of Object.entries(stateRow.player_seats as Record<string, { wallet?: string }>)) {
                        if (String(s?.wallet || '').toLowerCase() === me) {
                            color = col;
                            break;
                        }
                    }
                }
                const matchStats = (stateRow.state as { matchStats?: Record<string, { kicks?: number }> } | undefined)?.matchStats;
                if (color && matchStats?.[color]?.kicks !== undefined) {
                    captures = Number(matchStats[color].kicks || 0);
                }
            }
            if (!captures) {
                const metaObj =
                    m.metadata && typeof m.metadata === 'object' && !Array.isArray(m.metadata)
                        ? (m.metadata as Record<string, unknown>)
                        : {};
                const metaCaptures =
                    metaObj.captures && typeof metaObj.captures === 'object'
                        ? Number((metaObj.captures as Record<string, unknown>)[me] ?? 0)
                        : 0;
                captures = metaCaptures;
            }

            toInsert.push({
                match_id: m.id,
                player_id: me,
                won,
                is_pvp: isPvp,
                captures,
                played_at: m.finished_at || m.created_at || new Date().toISOString(),
                onchain_synced: false,
            });
        }

        if (toInsert.length > 0) {
            await db.from('player_free_matches').upsert(toInsert, {
                onConflict: 'player_id,match_id',
                ignoreDuplicates: true,
            });
        }
    } catch (err) {
        console.warn('[freeMatchSync] backfill warning:', err);
    }
}
