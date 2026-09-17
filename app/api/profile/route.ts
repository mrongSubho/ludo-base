import { NextResponse } from 'next/server';
import { requireAppSession, serviceDb } from '@/lib/serverAuth';

/**
 * GET /api/profile?walletAddress=0x…&sessionId=…
 * Own-profile read through the service role. This is the coins path: the
 * baseline players column grant does NOT include `coins` (or `peer_id`), so
 * anon reads go silently empty under default-deny. Session-gated, own row only.
 */
export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const wallet = await requireAppSession(
            searchParams.get('walletAddress'),
            searchParams.get('sessionId'),
        );
        if (!wallet) return NextResponse.json({ error: 'Invalid profile session' }, { status: 401 });
        const { data, error } = await serviceDb().from('players')
            .select('wallet_address, username, avatar_url, peer_id, lxp, rxp, coins, status, classic_played, power_played, ai_played, total_wins, total_games, rank_tier, last_played_at, created_at')
            .eq('wallet_address', wallet)
            .maybeSingle();
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        if (!data) return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
        return NextResponse.json(data);
    } catch (error) {
        return NextResponse.json({ error: (error as Error).message }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const { walletAddress, sessionId, username, avatarUrl, peerId } = await request.json();
        const authenticatedWallet = await requireAppSession(walletAddress, sessionId);
        if (!authenticatedWallet) return NextResponse.json({ error: 'Invalid profile session' }, { status: 401 });

        const updates: Record<string, string | null> = {};
        if (username !== undefined) updates.username = username === null ? null : String(username).slice(0, 80);
        if (avatarUrl !== undefined) updates.avatar_url = avatarUrl === null ? null : String(avatarUrl).slice(0, 500);
        if (peerId !== undefined) updates.peer_id = peerId === null ? null : String(peerId).slice(0, 200);
        if (Object.keys(updates).length === 0) return NextResponse.json({ success: true });

        const db = serviceDb();
        if (updates.username) {
            const { data: clash } = await db.from('players').select('wallet_address')
                .ilike('username', updates.username).neq('wallet_address', authenticatedWallet).limit(1);
            if (clash?.length) return NextResponse.json({ error: 'That name is taken' }, { status: 409 });
        }
        // Upsert (not update): first-time saves must create the row, and a
        // bare update would report success with 0 rows written.
        const { error } = await db.from('players')
            .upsert({ wallet_address: authenticatedWallet, ...updates }, { onConflict: 'wallet_address' });
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json({ success: true });
    } catch (error) {
        return NextResponse.json({ error: (error as Error).message }, { status: 500 });
    }
}
