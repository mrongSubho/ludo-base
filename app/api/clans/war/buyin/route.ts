/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { requireSession, requireAppSession } from '@/lib/serverAuth';
import { checkRateLimit, rateKey, rateLimitHeaders } from '@/lib/rateLimit';
import { buyInWarCall, startWarSearch } from '@/lib/clan/clanWarService';
import { ClanServiceError } from '@/lib/clan/clanService';

export async function POST(request: Request) {
    try {
        const body = await request.json().catch(() => ({}));
        const authed =
            (await requireSession(request, 'app'))?.wallet ||
            (body.walletAddress && body.sessionId ? await requireAppSession(body.walletAddress, body.sessionId) : null);

        if (!authed) {
            return NextResponse.json({ error: 'Unauthorized: valid app session required' }, { status: 401 });
        }

        const limit = checkRateLimit(rateKey('clans:war:buyin', authed), 20, 60_000);
        if (!limit.ok) {
            return NextResponse.json(
                { error: 'Too many war buy-in requests', retryAfter: limit.retryAfterSec },
                { status: 429, headers: rateLimitHeaders(limit) },
            );
        }

        const { clanId, action, stakeAmount, txHash } = body;
        if (!clanId) return NextResponse.json({ error: 'clanId required' }, { status: 400 });

        if (action === 'start_search') {
            await startWarSearch(clanId, authed);
            return NextResponse.json({ success: true, message: 'War search started' });
        }

        if (!stakeAmount || Number(stakeAmount) <= 0) {
            return NextResponse.json({ error: 'Positive stakeAmount required' }, { status: 400 });
        }
        if (typeof txHash !== 'string' || !txHash.trim()) {
            return NextResponse.json({ error: 'On-chain transaction hash (txHash) required' }, { status: 400 });
        }

        const stake = await buyInWarCall({
            clanId,
            walletAddress: authed,
            stakeAmount: Number(stakeAmount),
            txHash: txHash.trim(),
        });

        return NextResponse.json({ success: true, stake });
    } catch (err: any) {
        if (err instanceof ClanServiceError) {
            return NextResponse.json({ error: err.message, code: err.code }, { status: err.statusCode });
        }
        console.error('[clans:war:buyin]', err);
        return NextResponse.json({ error: err.message || 'War buy-in failed' }, { status: 500 });
    }
}
