/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { requireSession, requireAppSession } from '@/lib/serverAuth';
import { checkRateLimit, rateKey, rateLimitHeaders } from '@/lib/rateLimit';
import { getOpenWarBoard, matchClans } from '@/lib/clan/clanWarService';
import { ClanServiceError } from '@/lib/clan/clanService';

export async function GET(request: Request) {
    try {
        const session = await requireSession(request, 'app');
        if (!session?.wallet) {
            return NextResponse.json({ error: 'Unauthorized: valid app session required' }, { status: 401 });
        }

        const { searchParams } = new URL(request.url);
        const bracketParam = searchParams.get('bracket');
        const bracket = bracketParam ? Number(bracketParam) : undefined;

        const board = await getOpenWarBoard({ bracket });
        return NextResponse.json({ board });
    } catch (err: any) {
        console.error('[clans:war:board:GET]', err);
        return NextResponse.json({ error: err.message || 'Failed to fetch war board' }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const body = await request.json().catch(() => ({}));
        const authed =
            (await requireSession(request, 'app'))?.wallet ||
            (body.walletAddress && body.sessionId ? await requireAppSession(body.walletAddress, body.sessionId) : null);

        if (!authed) {
            return NextResponse.json({ error: 'Unauthorized: valid app session required' }, { status: 401 });
        }

        const limit = checkRateLimit(rateKey('clans:war:board', authed), 20, 60_000);
        if (!limit.ok) {
            return NextResponse.json(
                { error: 'Too many war board requests', retryAfter: limit.retryAfterSec },
                { status: 429, headers: rateLimitHeaders(limit) },
            );
        }

        const { callAId, callBId } = body;
        if (!callAId || !callBId) {
            return NextResponse.json({ error: 'callAId and callBId required' }, { status: 400 });
        }

        const war = await matchClans(callAId, callBId, authed);
        return NextResponse.json({ success: true, war });
    } catch (err: any) {
        if (err instanceof ClanServiceError) {
            return NextResponse.json({ error: err.message, code: err.code }, { status: err.statusCode });
        }
        console.error('[clans:war:board:POST]', err);
        return NextResponse.json({ error: err.message || 'Matching failed' }, { status: 500 });
    }
}
