import { NextResponse } from 'next/server';
import { parseAbiItem, parseEventLogs, type Address } from 'viem';
import { requireAppSession, requireSessionWallet, serviceDb } from '@/lib/serverAuth';
import { checkRateLimit, rateKey, rateLimitHeaders } from '@/lib/rateLimit';
import { buildPurchaseIntentMessage } from '@/lib/purchaseIntent';
import {
    DEFAULT_CHIPS_ADDRESS,
    MARKET_CURRENCIES,
    MARKETPLACE_PRICES as PRICES,
    marketCurrencyAmountWei,
    treasuryWalletAddress,
    usdcAddress,
    type MarketCurrency,
} from '@/lib/marketplacePrices';
import { DEFAULT_CHAIN_ID } from '@/lib/chains';
import { chipsAddress } from '@/lib/chips';
import { isFreshIssuedAt } from '@/lib/matchProof';
import { getBaseSepoliaPublicClient, verifyErc20TransferLog, waitForConfirmedReceipt } from '@/lib/onchainReceipt';
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

class PurchaseHttpError extends Error {
    status: number;
    constructor(message: string, status = 400) {
        super(message);
        this.status = status;
    }
}

const USER_OP_EVENT = parseAbiItem(
    'event UserOperationEvent(bytes32 indexed userOpHash, address indexed sender, address indexed paymaster, uint256 nonce, bool success, uint256 actualGasCost, uint256 actualGasUsed)',
);

export async function POST(request: Request) {
    try {
        const {
            walletAddress,
            sessionId,
            itemIds,
            requestId,
            currency,
            txHash,
            message,
            signature,
            issuedAt,
        } = await request.json();
        const wallet =
            (await requireSessionWallet(request, { scope: 'app', expectedWallet: walletAddress })) ||
            (await requireAppSession(walletAddress, sessionId));
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
        const id = String(requestId || '').slice(0, 100);
        if (!ids.length || ids.length > 30 || !id || ids.some(sku => !PRICES[sku])) {
            return NextResponse.json({ error: 'Invalid purchase' }, { status: 400 });
        }

        const totalChips = ids.reduce((sum, sku) => sum + PRICES[sku], 0);

        // On-chain Base Sepolia payment path (CHIPS / USDC / ETH)
        if (txHash !== undefined && txHash !== null && String(txHash).trim() !== '') {
            const cleanTxHash = String(txHash).trim();
            if (!/^0x[0-9a-fA-F]{64}$/.test(cleanTxHash)) {
                return NextResponse.json({ error: 'Invalid transaction hash' }, { status: 400 });
            }
            const payCurrency = String(currency || '').toUpperCase() as MarketCurrency;
            if (!MARKET_CURRENCIES.includes(payCurrency)) {
                return NextResponse.json({ error: 'Unsupported payment currency' }, { status: 400 });
            }

            const db = serviceDb();
            const { data: existingReq } = await db
                .from('chips_marketplace_purchases')
                .select('wallet_address, item_ids')
                .eq('request_id', id)
                .maybeSingle();
            if (existingReq) {
                if (existingReq.wallet_address.toLowerCase() !== wallet.toLowerCase()) {
                    return NextResponse.json({ error: 'Request ID belongs to another wallet' }, { status: 409 });
                }
                return NextResponse.json({
                    success: true,
                    itemIds: ids,
                    currency: payCurrency,
                    txHash: cleanTxHash,
                    chainId: DEFAULT_CHAIN_ID,
                    idempotent: true,
                });
            }

            const { data: existingEvent } = await db
                .from('chips_events')
                .select('tx_hash')
                .eq('chain_id', DEFAULT_CHAIN_ID)
                .eq('tx_hash', cleanTxHash)
                .limit(1)
                .maybeSingle();
            if (existingEvent) {
                return NextResponse.json(
                    { error: 'Transaction hash has already been used for a purchase' },
                    { status: 409 },
                );
            }

            const makeError = (msg: string, status = 400) => new PurchaseHttpError(msg, status);
            const receipt = await waitForConfirmedReceipt(cleanTxHash, makeError);
            const treasury = treasuryWalletAddress();
            const expectedWei = marketCurrencyAmountWei(totalChips, payCurrency);

            if (payCurrency === 'CHIPS' || payCurrency === 'USDC') {
                const tokenContract: Address =
                    payCurrency === 'CHIPS'
                        ? ((chipsAddress() || DEFAULT_CHIPS_ADDRESS) as Address)
                        : usdcAddress();
                try {
                    verifyErc20TransferLog({
                        logs: receipt.logs,
                        tokenContract,
                        expectedFrom: wallet,
                        expectedTo: treasury,
                        minAmountWei: expectedWei,
                        makeError,
                    });
                } catch (err) {
                    const fallbackMsg = `Transaction logs do not show the required ${payCurrency} transfer to the protocol treasury`;
                    throw new PurchaseHttpError(
                        err instanceof PurchaseHttpError && payCurrency === 'CHIPS' ? err.message : fallbackMsg,
                        err instanceof PurchaseHttpError ? err.status : 400,
                    );
                }
            } else {
                const client = getBaseSepoliaPublicClient();
                const tx = await client.getTransaction({ hash: cleanTxHash as `0x${string}` });
                const walletLower = wallet.toLowerCase();
                const treasuryLower = treasury.toLowerCase();
                const directOk =
                    tx.from.toLowerCase() === walletLower &&
                    tx.to?.toLowerCase() === treasuryLower &&
                    tx.value >= expectedWei;

                let smartAccountOk = false;
                if (!directOk) {
                    const userOpLogs = parseEventLogs({
                        abi: [USER_OP_EVENT],
                        logs: receipt.logs,
                        eventName: 'UserOperationEvent',
                    });
                    const senderMatched = userOpLogs.some((ev) => {
                        const args = ev.args as { sender?: string; success?: boolean };
                        return args.sender?.toLowerCase() === walletLower && args.success === true;
                    });
                    const inputHex = tx.input.toLowerCase();
                    const paddedTreasury = treasuryLower.slice(2).padStart(64, '0');
                    const paddedWei = expectedWei.toString(16).padStart(64, '0');
                    smartAccountOk =
                        senderMatched &&
                        inputHex.includes(paddedTreasury) &&
                        inputHex.includes(paddedWei);
                }

                if (!directOk && !smartAccountOk) {
                    throw new PurchaseHttpError(
                        'Transaction does not show the required ETH transfer to the protocol treasury on Base Sepolia',
                        400,
                    );
                }
            }

            await db.from('chips_events').upsert(
                {
                    chain_id: DEFAULT_CHAIN_ID,
                    tx_hash: cleanTxHash,
                    log_index: 0,
                    event_name: `MarketplacePurchase${payCurrency}`,
                    wallet_address: wallet,
                    amount: Number(expectedWei),
                    payload: {
                        requestId: id,
                        itemIds: ids,
                        currency: payCurrency,
                        totalChips,
                        wei: expectedWei.toString(),
                        treasury,
                    },
                },
                { onConflict: 'chain_id,tx_hash,log_index' },
            );

            const { error: purchaseInsertErr } = await db
                .from('chips_marketplace_purchases')
                .insert({
                    request_id: id,
                    wallet_address: wallet,
                    item_ids: ids,
                    total_base: totalChips,
                });
            if (purchaseInsertErr && purchaseInsertErr.code !== '23505') {
                console.error('[marketplace/purchase] ledger insert error:', purchaseInsertErr.message);
            }

            return NextResponse.json({
                success: true,
                itemIds: ids,
                currency: payCurrency,
                txHash: cleanTxHash,
                chainId: DEFAULT_CHAIN_ID,
            });
        }

        // Legacy signed escrowed-CHIPS rail (zero-gas fallback)
        if (!message || !signature || !issuedAt) {
            return NextResponse.json({ error: 'Missing purchase intent signature' }, { status: 401 });
        }
        if (!isFreshIssuedAt(issuedAt)) {
            return NextResponse.json({ error: 'Purchase intent expired' }, { status: 401 });
        }

        const expected = buildPurchaseIntentMessage({
            buyer: wallet,
            itemIds: ids,
            totalChips,
            requestId: id,
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
        // Typed from the migration chain (DB-22 regen: the RPC now resolves in
        // types/database.types.ts, so the `as never` blanket cast is gone).
        const { data, error } = await serviceDb().rpc('chips_escrow_spend_purchase', {
            p_wallet: wallet, p_request_id: id, p_item_ids: ids,
            // numeric param; the value is 1e18-scale exact (string), a JSON
            // number would lose precision above 2^53.
            p_total_base: totalBase as unknown as number,
        });
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
        // The RPC returns jsonb `{balance, idempotent}` — the schema types the
        // return as Json, so narrow once at the boundary.
        const balance = (data as { balance?: number } | null)?.balance;
        return NextResponse.json({ success: true, balance, itemIds: ids });
    } catch (error) {
        if (error instanceof PurchaseHttpError) {
            return NextResponse.json({ error: error.message }, { status: error.status });
        }
        return NextResponse.json({ error: (error as Error).message }, { status: 500 });
    }
}
