"use client";

/**
 * R4 — Swap via CDP `useSwap` / `useGetSwapPrice` (Coinbase swap engine).
 * Base-only token list (lib/swapTokens). CHIPS is not a swap asset (H2).
 */

import { useMemo, useState } from "react";
import { useGetSwapPrice, useSwap } from "@coinbase/cdp-hooks";
import { usePlayerSigner } from "@/hooks/usePlayerSigner";
import { useMfaStepUp } from "@/hooks/useMfaStepUp";
import {
    BASE_SWAP_TOKENS,
    searchSwapTokens,
    type SwapToken,
} from "@/lib/swapTokens";

export default function SwapSheet() {
    const player = usePlayerSigner();
    const mfa = useMfaStepUp();
    const [fromSymbol, setFromSymbol] = useState("ETH");
    const [toSymbol, setToSymbol] = useState("USDC");
    const [fromAmount, setFromAmount] = useState("");
    const [slippageBps, setSlippageBps] = useState(100);
    const [fromQuery, setFromQuery] = useState("");
    const [toQuery, setToQuery] = useState("");

    const fromMeta = BASE_SWAP_TOKENS.find((t) => t.symbol === fromSymbol) ?? BASE_SWAP_TOKENS[0];
    const toMeta = BASE_SWAP_TOKENS.find((t) => t.symbol === toSymbol) ?? BASE_SWAP_TOKENS[1];

    const fromOptions = useMemo(() => searchSwapTokens(fromQuery), [fromQuery]);
    const toOptions = useMemo(() => searchSwapTokens(toQuery, fromSymbol), [toQuery, fromSymbol]);

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
        setFromQuery("");
        setToQuery("");
    };

    const tokenLabel = (t: SwapToken) => `${t.symbol} · ${t.name}`;

    return (
        <div className="space-y-3">
            <h4 className="text-[11px] font-black uppercase tracking-[0.25em] text-white/70">Swap</h4>
            <p className="text-[11px] text-white/45">
                Coinbase swap engine · <strong>Base only</strong> · {BASE_SWAP_TOKENS.length} tokens ·
                CHIPS not listed (unpriced).
            </p>

            <div className="rounded-xl border border-white/10 p-2 space-y-2">
                <div className="text-[10px] uppercase tracking-wider text-white/40">From</div>
                <input
                    className="w-full rounded-lg border border-white/15 bg-black/30 px-2 py-1.5 text-[11px]"
                    placeholder="Search symbol / name"
                    value={fromQuery}
                    onChange={(e) => setFromQuery(e.target.value)}
                />
                <select
                    className="w-full rounded-lg border border-white/20 bg-black/40 px-2 py-2 text-[11px]"
                    value={fromSymbol}
                    onChange={(e) => {
                        const v = e.target.value;
                        setFromSymbol(v);
                        if (v === toSymbol) {
                            const alt = BASE_SWAP_TOKENS.find((t) => t.symbol !== v);
                            if (alt) setToSymbol(alt.symbol);
                        }
                    }}
                >
                    {fromOptions.map((t: SwapToken) => (
                        <option key={t.symbol} value={t.symbol}>
                            {tokenLabel(t)}
                        </option>
                    ))}
                </select>
                <input
                    className="w-full rounded-lg border border-white/20 bg-black/40 px-2 py-2 font-mono text-[11px]"
                    inputMode="decimal"
                    placeholder={`Amount (${fromSymbol})`}
                    value={fromAmount}
                    onChange={(e) => setFromAmount(e.target.value)}
                />
            </div>

            <div className="flex items-center gap-2">
                <button type="button" className="text-white/50 text-[11px] uppercase" onClick={flip}>
                    ↺ Flip
                </button>
                <div className="h-px flex-1 bg-white/10" />
                <span className="text-[10px] text-white/40">To</span>
            </div>

            <div className="rounded-xl border border-white/10 p-2 space-y-2">
                <input
                    className="w-full rounded-lg border border-white/15 bg-black/30 px-2 py-1.5 text-[11px]"
                    placeholder="Search symbol / name"
                    value={toQuery}
                    onChange={(e) => setToQuery(e.target.value)}
                />
                <select
                    className="w-full rounded-lg border border-white/20 bg-black/40 px-2 py-2 text-[11px]"
                    value={toSymbol}
                    onChange={(e) => setToSymbol(e.target.value)}
                >
                    {toOptions.map((t) => (
                        <option key={t.symbol} value={t.symbol}>
                            {tokenLabel(t)}
                        </option>
                    ))}
                </select>
            </div>

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
                disabled={status === "pending" || !fromAmount || !player.address || fromSymbol === toSymbol}
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
