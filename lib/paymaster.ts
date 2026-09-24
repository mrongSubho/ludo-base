/**
 * CHIPS gas paymaster + scoped session-key interfaces (CHIPS_PLANNING 8.9).
 * Phase 1: interfaces + stubs. Funding / vibenet 8130 prototype is Phase 3.
 * Never ship the chunter-cb/viem fork to prod (track wevm/viem#5004).
 */

export type PaymasterFlow = "pool-join" | "claim" | "market-buy" | "settle";

export interface PaymasterRequest {
    from: `0x${string}`;
    to: `0x${string}`;
    data: `0x${string}`;
    flow: PaymasterFlow;
    chainId: number;
}

export interface PaymasterSponsorResult {
    ok: boolean;
    /** "send" mode returns a transaction hash after the payer submits. */
    transactionHash?: `0x${string}`;
    error?: "BUDGET_EXHAUSTED" | "SENDER_LIMIT_REACHED" | "actor is not bound" | string;
    retryHint?: boolean;
}

/**
 * Gas-only payer: covers gas, never CHIPS value. Value calls must be
 * wallet-wrapped (`encodeWalletCalls`).
 */
export async function requestSponsorship(req: PaymasterRequest): Promise<PaymasterSponsorResult> {
    const url = process.env.NEXT_PUBLIC_PAYMASTER_URL;
    if (!url) {
        return { ok: false, error: "paymaster not configured" };
    }
    try {
        const res = await fetch(`${url.replace(/\/$/, "")}/sponsor`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...req, context: { flow: req.flow } }),
        });
        const data = await res.json();
        return {
            ok: Boolean(res.ok && data?.transactionHash),
            transactionHash: data?.transactionHash,
            error: data?.error,
            retryHint: data?.error === "actor is not bound",
        };
    } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : "sponsor failed" };
    }
}

/** EIP-8130 actor scope sketch (vibenet prototype only). */
export interface ActorScope {
    tokenLimits?: { token: `0x${string}`; maxAmount: string; periodSec: number }[];
    callScopes?: { to: `0x${string}`; selector: `0x${string}` }[];
    expiry: number;
}
