/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { requireAppSession, requireSession } from '@/lib/serverAuth';
import { checkRateLimit, rateKey, rateLimitHeaders } from '@/lib/rateLimit';
import { issueVaultVoucher } from '@/lib/arenaVaultVoucher';
import {
    ArenaVaultError,
    creditVaultDeposit,
    getVaultSummary,
    markVaultClaimsExecuted,
    releaseMatchStake,
    requestVaultWithdrawal,
    reserveMatchStake,
    rollPrizeToVault,
} from '@/lib/arenaVaultService';

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const walletParam = searchParams.get('walletAddress') || undefined;
        const session = await requireSession(request, 'app');
        const wallet = session?.wallet || (walletParam && session ? walletParam : null);

        if (!wallet) {
            return NextResponse.json({ error: 'Unauthorized: valid app session required' }, { status: 401 });
        }

        const summary = await getVaultSummary(wallet);
        return NextResponse.json(summary);
    } catch (err: any) {
        console.error('[vault:GET]', err);
        return NextResponse.json({ error: err.message || 'Failed to load Match Vault' }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const body = await request.json().catch(() => ({}));
        const authed =
            (await requireSession(request, 'app'))?.wallet ||
            (body.walletAddress && body.sessionId
                ? await requireAppSession(body.walletAddress, body.sessionId)
                : null);

        if (!authed) {
            return NextResponse.json({ error: 'Unauthorized: valid app session required' }, { status: 401 });
        }

        const limit = checkRateLimit(rateKey('vault:post', authed), 30, 60_000);
        if (!limit.ok) {
            return NextResponse.json(
                { error: 'Too many vault requests', retryAfter: limit.retryAfterSec },
                { status: 429, headers: rateLimitHeaders(limit) },
            );
        }

        const { action } = body;

        if (action === 'deposit') {
            const { txHash, amountChips } = body;
            if (!txHash) return NextResponse.json({ error: 'txHash required' }, { status: 400 });
            const res = await creditVaultDeposit({
                walletAddress: authed,
                txHash: String(txHash),
                expectedAmountChips: amountChips ? Number(amountChips) : undefined,
            });
            return NextResponse.json({ success: true, ...res });
        }

        if (action === 'reserve') {
            const { matchKey, amountChips } = body;
            const res = await reserveMatchStake({
                walletAddress: authed,
                matchKey: String(matchKey || ''),
                amountChips: Number(amountChips),
            });
            return NextResponse.json({ success: true, ...res });
        }

        if (action === 'release') {
            const { matchKey } = body;
            if (!matchKey) return NextResponse.json({ error: 'matchKey required' }, { status: 400 });
            const res = await releaseMatchStake({
                walletAddress: authed,
                matchKey: String(matchKey),
            });
            return NextResponse.json({ success: true, ...res });
        }

        if (action === 'withdraw') {
            const { amountChips, chainId } = body;
            const res = await requestVaultWithdrawal({
                walletAddress: authed,
                amountChips: Number(amountChips),
                chainId: chainId ? Number(chainId) : undefined,
            });
            return NextResponse.json({ success: true, ...res });
        }

        if (action === 'issue_vouchers') {
            const ids: string[] = Array.isArray(body.claimIds)
                ? body.claimIds.map(String)
                : body.claimId
                  ? [String(body.claimId)]
                  : [];
            if (!ids.length) return NextResponse.json({ error: 'claimId(s) required' }, { status: 400 });
            const vouchers = await Promise.all(
                ids.map((id) =>
                    issueVaultVoucher({
                        claimId: id,
                        walletAddress: authed,
                        chainId: body.chainId ? Number(body.chainId) : undefined,
                    }),
                ),
            );
            return NextResponse.json({ success: true, vouchers });
        }

        if (action === 'confirm_claim') {
            const ids: string[] = Array.isArray(body.claimIds) ? body.claimIds.map(String) : [];
            const txHash = String(body.txHash || '');
            if (!ids.length || !txHash) {
                return NextResponse.json({ error: 'claimIds and txHash required' }, { status: 400 });
            }
            await markVaultClaimsExecuted({ walletAddress: authed, claimIds: ids, txHash });
            return NextResponse.json({ success: true });
        }

        if (action === 'roll_prize') {
            const claimId = String(body.claimId || '');
            if (!claimId) return NextResponse.json({ error: 'claimId required' }, { status: 400 });
            const res = await rollPrizeToVault({ walletAddress: authed, claimId });
            return NextResponse.json({ success: true, ...res });
        }

        return NextResponse.json({ error: `Unknown vault action: ${String(action)}` }, { status: 400 });
    } catch (err: any) {
        if (err instanceof ArenaVaultError) {
            return NextResponse.json({ error: err.message, code: err.code }, { status: err.statusCode });
        }
        console.error('[vault:POST]', err);
        return NextResponse.json({ error: err.message || 'Vault action failed' }, { status: 500 });
    }
}
