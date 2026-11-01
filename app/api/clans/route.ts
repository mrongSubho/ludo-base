/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { requireSession, requireAppSession } from '@/lib/serverAuth';
import { searchClans, getClan, getPlayerClan, createClan, ClanServiceError } from '@/lib/clan/clanService';

/**
 * GET /api/clans
 * - ?mine=true: returns caller's clan and membership
 * - ?clanId=<id>: returns single clan dossier
 * - ?query=...&division=...: search & discover clans
 */
export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const mine = searchParams.get('mine') === 'true';
        const clanId = searchParams.get('clanId');
        const query = searchParams.get('query') || undefined;
        const division = searchParams.get('division') || undefined;
        const limit = Number(searchParams.get('limit') || 20);
        const offset = Number(searchParams.get('offset') || 0);

        if (mine) {
            const authed = (await requireSession(request, 'app'))?.wallet ||
                searchParams.get('wallet') || null;
            if (!authed) {
                return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
            }
            const data = await getPlayerClan(authed);
            return NextResponse.json({ clan: data?.clan || null, member: data?.member || null, levelConfig: data?.levelConfig || null });
        }

        if (clanId) {
            const clan = await getClan(clanId);
            if (!clan) return NextResponse.json({ error: 'Clan not found' }, { status: 404 });
            return NextResponse.json({ clan });
        }

        const result = await searchClans({ query, division, limit, offset });
        return NextResponse.json(result);
    } catch (err: any) {
        console.error('[clans:GET]', err);
        return NextResponse.json({ error: err.message || 'Internal error' }, { status: 500 });
    }
}

/**
 * POST /api/clans
 * Create a new clan. Atomically debits 10,000 CHIPS from escrow.
 */
export async function POST(request: Request) {
    try {
        const body = await request.json().catch(() => ({}));
        const authed =
            (await requireSession(request, 'app'))?.wallet ||
            (body.walletAddress && body.sessionId ? await requireAppSession(body.walletAddress, body.sessionId) : null);

        if (!authed) {
            return NextResponse.json({ error: 'Unauthorized: valid app session required' }, { status: 401 });
        }

        const { name, tag, bio, crest } = body;
        if (!name || !tag) {
            return NextResponse.json({ error: 'Clan name and tag are required' }, { status: 400 });
        }

        const { clanId } = await createClan({
            leaderWallet: authed,
            name,
            tag,
            bio,
            crest,
        });

        return NextResponse.json({ success: true, clanId });
    } catch (err: any) {
        if (err instanceof ClanServiceError) {
            return NextResponse.json({ error: err.message, code: err.code }, { status: err.statusCode });
        }
        console.error('[clans:POST]', err);
        return NextResponse.json({ error: err.message || 'Failed to create clan' }, { status: 500 });
    }
}
