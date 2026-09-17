import { NextResponse } from 'next/server';
import { serviceDb } from '@/lib/serverAuth';

/**
 * GET /api/presence/online?page=0&limit=25&walletAddress=0x… (optional self-exclusion)
 * Public online-players directory for lobby discovery (invite sheets, global
 * tabs). last_seen_at is server-only under default-deny, so freshness is
 * enforced here and never exposed: only heartbeats within the last 2 minutes
 * are listed, with grant-safe profile columns.
 */
export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const page = Math.max(0, parseInt(searchParams.get('page') || '0', 10) || 0);
        const limit = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') || '25', 10) || 25));
        const exclude = (searchParams.get('walletAddress') || '').toLowerCase() || null;
        const freshSince = new Date(Date.now() - 2 * 60 * 1000).toISOString();

        let query = serviceDb()
            .from('players')
            .select('wallet_address, username, avatar_url, status')
            .eq('status', 'Online')
            .gt('last_seen_at', freshSince)
            .order('last_seen_at', { ascending: false })
            .range(page * limit, page * limit + limit - 1);
        if (excludeWallet(exclude)) query = query.neq('wallet_address', exclude as string);
        const { data, error } = await query;
        if (error) throw error;
        return NextResponse.json({ players: data || [], hasMore: (data || []).length === limit });
    } catch (error) {
        return NextResponse.json({ error: (error as Error).message }, { status: 500 });
    }
}

function excludeWallet(value: string | null): value is string {
    return !!value && value.length >= 3;
}
