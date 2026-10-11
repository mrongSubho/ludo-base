import { NextResponse } from 'next/server';
import { requireAppSession, serviceDb } from '@/lib/serverAuth';
import { checkRateLimit, rateKey, rateLimitHeaders } from '@/lib/rateLimit';
import { buildPurchaseIntentMessage } from '@/lib/purchaseIntent';
import { MARKETPLACE_PRICES as PRICES } from '@/lib/marketplacePrices';
import { isFreshIssuedAt } from '@/lib/matchProof';
import { verifyPersonalSign } from '@/lib/walletVerify';

/**
 * POST /api/marketplace/purchase — CHIPS marketplace rail.
 *
 * Coins are frozen (202609300001); this route spends escrowed CHIPS instead.
 * Prices are whole CHIPS from the shared `lib/marketplacePrices.ts` table
 * (the client builds its signed intent from the same table, so totals cannot
 * drift). Each purchase carries a buyer-signed purchase-intent message
 * (`lib/purchaseIntent.ts`) verified with `verifyPersonalSign`, fresh within
 * 10 minutes. The debit is `chips_escrow_spend_purchase`: config-gated,
 * conditional (no overdraft), treasury-credited, idempotent on `requestId` —
 * so a replayed intent returns the original balance instead of double-debiting.
 * Ownership stays local (`lib/inventory.ts`); the server row is proof-of-payment.
 */
const E18 = BigInt(10) ** BigInt(18);

export async function POST(request: Request) {
    try {
        const { walletAddress, sessionId, itemIds, requestId, message, signature, issuedAt } = await request.json();
        const wallet = await requireAppSession(walletAddress, sessionId);
        if (!wallet) return NextResponse.json({ error: 'Invalid session' }, { status: 401 });

        // A session is not a rate limit. `requestId` here is a genuine
        // idempotency key for a debit, so it stays client-supplied; what is
        // missing is a bound on how many purchases one wallet may attempt.
        const limit = checkRateLimit(rateKey('marketplace:purchase', wallet), 10, 60_000);
        if (!limit.ok) {
            return NextResponse.json(
                { error: 'Too many requests', retryAfter: limit.retryAfterSec },
                { status: 429, headers: rateLimitHeaders(limit) },
            );
        }

        const ids = Array.isArray(itemIds) ? [...new Set(itemIds.map(String))] : [];
        const id = String(requestId || '');
        if (!ids.length || ids.length > 30 || !id || ids.some(sku => !PRICES[sku])) {
            return NextResponse.json({ error: 'Invalid purchase' }, { status: 400 });
        }
        if (!message || !signature || !issuedAt) {
            return NextResponse.json({ error: 'Missing purchase intent signature' }, { status: 401 });
        }
        if (!isFreshIssuedAt(issuedAt)) {
            return NextResponse.json({ error: 'Purchase intent expired' }, { status: 401 });
        }

        const totalChips = ids.reduce((sum, sku) => sum + PRICES[sku], 0);
        const expected = buildPurchaseIntentMessage({
            buyer: wallet,
            itemIds: ids,
            totalChips,
            requestId: id.slice(0, 100),
            issuedAt,
        });
        if (message !== expected) {
            return NextResponse.json({ error: 'Message payload mismatch' }, { status: 401 });
        }
        const verdict = await verifyPersonalSign({ address: wallet, message, signature });
        if (!verdict.ok) {
            const error = verdict.code === 'ecrecover-invalid' ? 'Invalid signature' : 'Signer mismatch';
            return NextResponse.json({ error, code: verdict.code }, { status: 401 });
        }

        const totalBase = (BigInt(totalChips) * E18).toString();
        const { data, error } = await serviceDb().rpc('chips_escrow_spend_purchase' as never, {
            p_wallet: wallet, p_request_id: id.slice(0, 100), p_item_ids: ids,
            p_total_base: totalBase,
        } as never);
        if (error) {
            const msg = error.message || '';
            if (msg.includes('ESCROW_DISABLED')) {
                return NextResponse.json(
                    { error: 'CHIPS escrow is not armed yet; purchases are suspended' },
                    { status: 503 },
                );
            }
            if (msg.includes('INSUFFICIENT_ESCROW')) {
                return NextResponse.json(
                    { error: 'Insufficient escrowed CHIPS — deposit first' },
                    { status: 409 },
                );
            }
            return NextResponse.json({ error: msg }, { status: 409 });
        }
        return NextResponse.json({ success: true, balance: data?.balance, itemIds: ids });
    } catch (error) {
        return NextResponse.json({ error: (error as Error).message }, { status: 500 });
    }
}
