import { NextResponse } from 'next/server';
import { requireSessionWallet, requireAppSession, serviceDb } from '@/lib/serverAuth';

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { walletAddress, sessionId, matchIds, txHash } = body ?? {};

        const wallet =
            (await requireSessionWallet(request, { scope: 'app', expectedWallet: walletAddress })) ||
            (walletAddress && sessionId ? await requireAppSession(walletAddress, sessionId) : null);

        if (!wallet) return NextResponse.json({ error: 'Invalid session' }, { status: 401 });

        if (!Array.isArray(matchIds) || matchIds.length === 0 || !txHash) {
            return NextResponse.json({ error: 'Missing matchIds or txHash' }, { status: 400 });
        }

        const db = serviceDb();
        const { error } = await db
            .from('player_free_matches')
            .update({
                onchain_synced: true,
                sync_tx_hash: String(txHash),
            })
            .eq('player_id', wallet.toLowerCase())
            .in('match_id', matchIds);

        if (error) {
            console.error('[matches/sync-confirm] update failed:', error);
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        return NextResponse.json({ success: true, count: matchIds.length });
    } catch (err: unknown) {
        console.error('[matches/sync-confirm] unexpected error:', err);
        return NextResponse.json(
            { error: err instanceof Error ? err.message : 'failed to confirm match sync' },
            { status: 500 },
        );
    }
}
