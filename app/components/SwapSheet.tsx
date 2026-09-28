"use client";

/**
 * R4 — Swap via CDP `useSwap` / `useGetSwapPrice` (Coinbase swap engine).
 * Base-only token list (lib/swapTokens). CHIPS is not a swap asset (H2).
 */

import { useState } from "react";
import { useGetSwapPrice, useSwap } from "@coinbase/cdp-hooks";
import { usePlayerSigner } from "@/hooks/usePlayerSigner";
import { useMfaStepUp } from "@/hooks/useMfaStepUp";
import { BASE_SWAP_TOKENS, type SwapToken } from "@/lib/swapTokens";

export default function SwapSheet() {
    const player = usePlayerSigner();
    const mfa = useMfaStepUp();
    const [fromSymbol, setFromSymbol] = useState("ETH");
    const [toSymbol, setToSymbol] = useState("USDC");
    const [fromAmount, setFromAmount] = useState("");
    const [slippageBps, setSlippageBps] = useState(100);

    const fromMeta = BASE_SWAP_TOKENS.find((t) => t.symbol === fromSymbol) ?? BASE_SWAP_TOKENS[0];
    const toMeta = BASE_SWAP_TOKENS.find((t) => t.symbol === toSymbol) ?? BASE_SWAP_TOKENS[1];

    const quote = useGetSwapPrice({
        network: "base",
        fromToken: fromMeta.address,
        toToken: toMeta.address,
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

    const flip = () => {
        setFromSymbol(toSymbol);
        setToSymbol(fromSymbol);
    };

    return (
        <div className="space-y-3">
            <h4 className="text-[11px] font-black uppercase tracking-[0.25em] text-white/70">Swap</h4>
            <p className="text-[11px] text-white/45">
                Coinbase swap engine · <strong>Base only</strong> · CHIPS not listed (unpriced).
            </p>
            <div className="flex items-center gap-2">
                <select
                    className="flex-1 rounded-lg border border-white/20 bg-black/40 px-2 py-2 text-[11px]"
                    value={fromSymbol}
                    onChange={(e) => {
                        const v = e.target.value;
                        setFromSymbol(v);
                        if (v === toSymbol) setToSymbol(BASE_SWAP_TOKENS.find((t) => t.symbol !== v)!.symbol);
                    }}
                >
                    {BASE_SWAP_TOKENS.map((t: SwapToken) => (
                        <option key={t.symbol} value={t.symbol}>
                            {t.symbol}
                        </option>
                    ))}
                </select>
                <button type="button" className="text-white/50 text-[11px]" onClick={flip}>
                    ↺
                </button>
                <select
                    className="flex-1 rounded-lg border border-white/20 bg-black/40 px-2 py-2 text-[11px]"
                    value={toSymbol}
                    onChange={(e) => setToSymbol(e.target.value)}
                >
                    {BASE_SWAP_TOKENS.filter((t) => t.symbol !== fromSymbol).map((t) => (
                        <option key={t.symbol} value={t.symbol}>
                            {t.symbol}
                        </option>
                    ))}
                </select>
            </div>
            <input
                className="w-full rounded-lg border border-white/20 bg-black/40 px-2 py-2 font-mono text-[11px]"
                inputMode="decimal"
                placeholder={`Amount (${fromSymbol})`}
                value={fromAmount}
                onChange={(e) => setFromAmount(e.target.value)}
            />
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
                    Expected out: <span className="font-mono">{price}</span> {toSymbol}
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
                        fromToken: fromMeta.address,
                        toToken: toMeta.address,
                        fromAmount,
                        slippageBps,
                    } as Parameters<typeof swap>[0]);
                }}
            >
                {status === "pending" ? "Swapping…" : `Swap ${fromSymbol} → ${toSymbol}`}
            </button>
            {error && <p className="text-[11px] text-red-300">{error.message}</p>}
            {status === "success" && <p className="text-[11px] text-emerald-300">Swap confirmed.</p>}
        </div>
    );
}
