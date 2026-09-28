/**
 * R3 / H1 — decode WalletConnect call payloads for informed consent.
 * REAL_WALLET_PLAN §7b H1. Never auto-approve; show value-at-risk + risk flags.
 */

import { formatUnits, getAddress, isAddress, type Hex } from "viem";
import { isUnlimitedOrHighRiskCalldata } from "./wcWallet";

export type DecodedCall = {
    to: string;
    valueWei: bigint;
    valueEth: string;
    /** Human summary: "Send 1 ETH" | "approve USDC (unlimited)" | "joinPool" | "Contract call" */
    summary: string;
    function?: string;
    unlimitedApprove: boolean;
    risk?: string;
};

const SELECTORS: Record<string, { name: string; decode: (data: Hex) => string }> = {
    // transfer(address,uint256)
    "0xa9059cbb": {
        name: "transfer",
        decode: (data) => {
            const to = getAddress(`0x${data.slice(34, 74)}`);
            const amount = BigInt(`0x${data.slice(74, 138)}`);
            return `Transfer to ${to.slice(0, 8)}… amount raw ${amount}`;
        },
    },
    // approve(address,uint256)
    "0x095ea7b3": {
        name: "approve",
        decode: (data) => {
            const spender = getAddress(`0x${data.slice(34, 74)}`);
            const amount = BigInt(`0x${data.slice(74, 138)}`);
            const unlimited = amount > BigInt("1000000") * BigInt(10) ** BigInt(18);
            return `Approve ${spender.slice(0, 8)}… ${unlimited ? "UNLIMITED" : amount.toString()}`;
        },
    },
    // joinPool(bytes32) — MatchPool
    "0x76671b51": {
        name: "joinPool",
        decode: () => "Join match pool (entry fee pulled per contract)",
    },
    // claimMatch(bytes32)
    "0x8b3c95d5": {
        name: "claimMatch",
        decode: () => "Claim match prize",
    },
};

export function decodeCall(call: {
    to?: string;
    value?: string | bigint | number;
    data?: string;
}): DecodedCall {
    const to = call.to || "—";
    const valueWei = BigInt(call.value != null ? call.value : 0);
    const data = (call.data || "0x") as Hex;
    const selector = data.slice(0, 10).toLowerCase();
    const risk = isUnlimitedOrHighRiskCalldata(data);
    const known = SELECTORS[selector];

    let summary: string;
    let fn: string | undefined;
    if (data === "0x" || data.length <= 10) {
        summary = valueWei > 0 ? `Send ${formatUnits(valueWei, 18)} ETH` : "Native transfer";
    } else if (known) {
        fn = known.name;
        summary = known.decode(data);
        if (risk.unlimitedApprove) summary += " · UNLIMITED APPROVAL";
    } else {
        fn = selector;
        summary = `Contract call ${selector}`;
    }

    return {
        to,
        valueWei,
        valueEth: formatUnits(valueWei, 18),
        summary,
        function: fn,
        unlimitedApprove: risk.unlimitedApprove,
        risk: risk.unlimitedApprove
            ? "Unlimited token approval — dapp can move your full balance. Reject unless you trust it."
            : undefined,
    };
}

export function decodeCallsList(
    calls: Array<{ to?: string; value?: string | bigint; data?: string }>,
): { decoded: DecodedCall[]; valueAtRiskEth: string; unlimited: boolean } {
    const decoded = calls.map(decodeCall);
    const total = decoded.reduce((s, c) => s + c.valueWei, BigInt(0));
    return {
        decoded,
        valueAtRiskEth: formatUnits(total, 18),
        unlimited: decoded.some((c) => c.unlimitedApprove),
    };
}

export function extractCalls(params: unknown): Array<{ to?: string; value?: string | bigint; data?: string }> {
    if (Array.isArray(params)) {
        // eth_sendTransaction: [tx] or tx object
        const first = params[0];
        if (first && typeof first === "object" && "to" in (first as object)) {
            return [first as { to?: string; value?: string | bigint; data?: string }];
        }
        if (Array.isArray(first)) {
            return first as Array<{ to?: string; value?: string | bigint; data?: string }>;
        }
        return params as Array<{ to?: string; value?: string | bigint; data?: string }>;
    }
    if (params && typeof params === "object") {
        const p = params as { calls?: Array<{ to?: string; value?: string | bigint; data?: string }> };
        if (Array.isArray(p.calls)) return p.calls;
    }
    return [];
}
