"use client";

/**
 * R4 — Swap via CDP `useSwap` / `useGetSwapPrice` (same engine Coinbase
 * Wallet / Base app uses). **Base only.** No Uniswap-direct integration.
 * REAL_WALLET_PLAN §R4.
 */

import { useState } from "react";
import { useGetSwapPrice, useSwap } from "@coinbase/cdp-hooks";
import { usePlayerSigner } from "@/hooks/usePlayerSigner";
import { useMfaStepUp } from "@/hooks/useMfaStepUp";

/** Base mainnet WETH / USDC (Coinbase swap defaults). */
const WETH = "0x4200000000000000000000000000000000000006";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

export default function SwapSheet() {
    const player = usePlayerSigner();
    const mfa = useMfaStepUp();
    const [fromAmount, setFromAmount] = useState("");
    const [direction, setDirection] = useState<"eth2usdc" | "usdc2eth">("eth2usdc");
    const [slippageBps, setSlippageBps] = useState(100);

    const fromToken = direction === "eth2usdc" ? WETH : USDC;
    const toToken = direction === "eth2usdc" ? USDC : WETH;

    const quote = useGetSwapPrice({
        network: "base",
        fromToken,
        toToken,
        fromAmount,
        slippageBps,
    });
    const { swap, status, error } = useSwap();

    const price =
        quote.data && "toAmount" in quote.data ? (quote.data as { toAmount?: string }).toAmount : undefined;
    const issues =
        quote.data && "issues" in quote.data
            ? (quote.data as { issues?: unknown }).issues
            : undefined;

    return (
        <div className="space-y-3">
            <h4 className="text-[11px] font-black uppercase tracking-[0.25em] text-white/70">Swap</h4>
            <p className="text-[11px] text-white/45">
                Powered by Coinbase swap (same engine as Base / Coinbase Wallet). <strong>Base only.</strong>
            </p>
            <div className="flex gap-2">
                <button
                    type="button"
                    className="rounded-lg px-3 py-1.5 text-[11px] font-bold uppercase border border-white/15"
                    onClick={() => setDirection((d) => (d === "eth2usdc" ? "usdc2eth" : "eth2usdc"))}
                >
                    {direction === "eth2usdc" ? "ETH → USDC" : "USDC → ETH"} ↺
                </button>
            </div>
            <label className="block text-[10px] text-white/50 uppercase tracking-wider">
                Amount
                <input
                    className="mt-1 w-full rounded-lg border border-white/20 bg-black/40 px-2 py-2 font-mono text-[11px]"
                    inputMode="decimal"
                    placeholder="0.01"
                    value={fromAmount}
                    onChange={(e) => setFromAmount(e.target.value)}
                />
            </label>
            <label className="block text-[10px] text-white/50 uppercase tracking-wider">
                Slippage (bps)
                <input
                    className="mt-1 w-full rounded-lg border border-white/20 bg-black/40 px-2 py-2 font-mono text-[11px]"
                    inputMode="numeric"
                    value={String(slippageBps)}
                    onChange={(e) => setSlippageBps(Number(e.target.value) || 100)}
                />
            </label>
            {quote.status === "pending" && <p className="text-[11px] text-white/50">Fetching quote…</p>}
            {price && (
                <div className="rounded-xl border border-white/10 p-3 text-[11px]">
                    Expected out: <span className="font-mono">{price}</span>
                </div>
            )}
            {issues != null && (
                <div className="rounded-xl border border-amber-400/30 bg-amber-500/10 p-2 text-[11px] text-amber-100">
                    Quote issues: {JSON.stringify(issues).slice(0, 160)}
                </div>
            )}
            <button
                type="button"
                className="w-full rounded-lg bg-cyan-500/20 border border-cyan-400/40 px-3 py-2 text-[11px] font-bold uppercase"
                disabled={status === "pending" || !fromAmount || !player.address}
                onClick={async () => {
                    const ok = await mfa.stepUp();
                    if (!ok) return;
                    await swap({
                        network: "base",
                        fromToken,
                        toToken,
                        fromAmount,
                        slippageBps,
                    } as Parameters<typeof swap>[0]);
                }}
            >
                {status === "pending" ? "Swapping…" : "Swap"}
            </button>
            {error && <p className="text-[11px] text-red-300">{error.message}</p>}
            {status === "success" && <p className="text-[11px] text-emerald-300">Swap confirmed.</p>}
        </div>
    );
}
