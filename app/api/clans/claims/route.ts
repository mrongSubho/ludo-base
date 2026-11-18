/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { requireSession, requireAppSession } from '@/lib/serverAuth';
import { checkRateLimit, rateKey, rateLimitHeaders } from '@/lib/rateLimit';
import {
    getClaimableList,
    issueClanClaimVoucher,
    confirmClanClaimsExecuted,
} from '@/lib/clan/clanClaimVoucher';
import { ClanServiceError } from '@/lib/clan/clanService';

export async function GET(request: Request) {
    try {
        const session = await requireSession(request, 'app');
        if (!session?.wallet) {
            return NextResponse.json({ error: 'Unauthorized: valid app session required' }, { status: 401 });
        }

        const claims = await getClaimableList(session.wallet);
        return NextResponse.json({ claims });
    } catch (err: any) {
        console.error('[clans:claims:GET]', err);
        return NextResponse.json({ error: err.message || 'Failed to list claims' }, { status: 500 });
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

        const limit = checkRateLimit(rateKey('clans:claims', authed), 20, 60_000);
        if (!limit.ok) {
            return NextResponse.json(
                { error: 'Too many claim requests', retryAfter: limit.retryAfterSec },
                { status: 429, headers: rateLimitHeaders(limit) },
            );
        }

        const { action, claimId, claimIds, txHash, chainId } = body;

        if (action === 'confirm_claim') {
            const ids: string[] = Array.isArray(claimIds)
                ? claimIds.map(String)
                : claimId
                  ? [String(claimId)]
                  : [];
            if (!ids.length || !txHash) {
                return NextResponse.json({ error: 'claimIds and txHash required' }, { status: 400 });
            }
            const res = await confirmClanClaimsExecuted({
                walletAddress: authed,
                claimIds: ids,
                txHash: String(txHash),
            });
            return NextResponse.json({ success: true, ...res });
        }

        if (!claimId) {
            return NextResponse.json({ error: 'claimId required' }, { status: 400 });
        }

        const voucher = await issueClanClaimVoucher({
            claimId,
            walletAddress: authed,
            chainId: chainId ? Number(chainId) : 84532,
        });

        return NextResponse.json({ success: true, ...voucher });
    } catch (err: any) {
        if (err instanceof ClanServiceError) {
            return NextResponse.json({ error: err.message, code: err.code }, { status: err.statusCode });
        }
        console.error('[clans:claims:POST]', err);
        return NextResponse.json({ error: err.message || 'Failed to process claim request' }, { status: 500 });
    }
}
