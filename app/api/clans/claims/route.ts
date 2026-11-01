/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { requireSession, requireAppSession } from '@/lib/serverAuth';
import { getClaimableList, issueClanClaimVoucher } from '@/lib/clan/clanClaimVoucher';
import { ClanServiceError } from '@/lib/clan/clanService';

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const authed = (await requireSession(request, 'app'))?.wallet ||
            searchParams.get('wallet') || null;

        if (!authed) {
            return NextResponse.json({ error: 'Unauthorized: valid app session required' }, { status: 401 });
        }

        const claims = await getClaimableList(authed);
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

        const { claimId, chainId } = body;
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
        return NextResponse.json({ error: err.message || 'Failed to issue voucher' }, { status: 500 });
    }
}
