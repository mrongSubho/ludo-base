import { NextResponse } from 'next/server';
import { requireSessionWallet, requireAppSession, serviceDb } from '@/lib/serverAuth';
import { getClanTagsForWallets } from '@/lib/clan/clanService';

/**
 * GET /api/profile?walletAddress=0x…
 * Own-profile read through the service role. This is the coins path: the
 * baseline players column grant does NOT include `coins` (or `peer_id`), so
 * anon reads go silently empty under default-deny. Session-gated, own row only.
 */
export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const expectedWallet = searchParams.get('walletAddress') || undefined;
        const wallet = await requireSessionWallet(request, { scope: 'app', expectedWallet });
        if (!wallet) return NextResponse.json({ error: 'Invalid profile session' }, { status: 401 });

        const db = serviceDb();
        const baseCols = 'wallet_address, username, avatar_url, peer_id, lxp, rxp, coins, status, classic_played, power_played, ai_played, total_wins, total_games, rank_tier, last_played_at, created_at';
        let { data, error } = await db.from('players')
            .select(`${baseCols}, is_public, allow_requests`)
            .eq('wallet_address', wallet)
            .maybeSingle();

        // Fallback if privacy columns haven't been pushed to the remote DB yet
        if (error && /is_public|allow_requests|column/i.test(error.message)) {
            const fallback = await db.from('players')
                .select(baseCols)
                .eq('wallet_address', wallet)
                .maybeSingle();
            if (fallback.error) return NextResponse.json({ error: fallback.error.message }, { status: 500 });
            data = fallback.data
                ? { ...fallback.data, is_public: true, allow_requests: true }
                : null;
            error = null;
        }

        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        if (!data) return NextResponse.json({ error: 'Profile not found' }, { status: 404 });

        const clanMap = await getClanTagsForWallets([wallet]);
        const clanInfo = clanMap[wallet.toLowerCase()];
        return NextResponse.json({
            ...data,
            is_public: data.is_public !== false,
            allow_requests: data.allow_requests !== false,
            clan_tag: clanInfo?.tag ?? null,
            clan_id: clanInfo?.clanId ?? null,
            clan_name: clanInfo?.name ?? null,
        });
    } catch (error) {
        return NextResponse.json({ error: (error as Error).message }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const { walletAddress, sessionId, username, avatarUrl, peerId, isPublic, allowRequests } = await request.json();
        const authenticatedWallet =
            (await requireSessionWallet(request, { scope: 'app', expectedWallet: walletAddress })) ||
            (await requireAppSession(walletAddress, sessionId));
        if (!authenticatedWallet) return NextResponse.json({ error: 'Invalid profile session' }, { status: 401 });

        const updates: Record<string, string | boolean | null> = {};
        if (username !== undefined) updates.username = username === null ? null : String(username).slice(0, 80);
        if (avatarUrl !== undefined) updates.avatar_url = avatarUrl === null ? null : String(avatarUrl).slice(0, 500);
        if (peerId !== undefined) updates.peer_id = peerId === null ? null : String(peerId).slice(0, 200);
        if (typeof isPublic === 'boolean') updates.is_public = isPublic;
        if (typeof allowRequests === 'boolean') updates.allow_requests = allowRequests;
        if (Object.keys(updates).length === 0) return NextResponse.json({ success: true });

        const db = serviceDb();
        if (typeof updates.username === 'string' && updates.username.length > 0) {
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
