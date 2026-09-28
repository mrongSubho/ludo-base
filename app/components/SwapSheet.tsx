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

function TokenSelect({
    label,
    symbol,
    query,
    onQuery,
    onPick,
    exclude,
}: {
    label: string;
    symbol: string;
    query: string;
    onQuery: (v: string) => void;
    onPick: (s: string) => void;
    exclude?: string;
}) {
    const options = useMemo(() => searchSwapTokens(query, exclude), [query, exclude]);
    return (
        <div className="cb-swap-leg">
            <div className="cb-swap-leg-head">
                <span>{label}</span>
                <span className="cb-section-tag">{symbol}</span>
            </div>
            <select
                className="cb-input"
                value={symbol}
                onChange={(e) => onPick(e.target.value)}
                aria-label={`${label} token`}
            >
                {(exclude ? searchSwapTokens("", exclude) : BASE_SWAP_TOKENS).map((t: SwapToken) => (
                    <option key={t.symbol} value={t.symbol}>
                        {t.symbol} · {t.name}
                    </option>
                ))}
            </select>
            <input
                className="cb-input"
                placeholder="Search symbol / name"
                value={query}
                onChange={(e) => onQuery(e.target.value)}
                aria-label={`Search ${label} tokens`}
            />
            {query && (
                <div className="cb-swap-results">
                    {options.slice(0, 6).map((t) => (
                        <button
                            key={t.symbol}
                            type="button"
                            className="cb-swap-result"
                            onClick={() => {
                                onPick(t.symbol);
                                onQuery("");
                            }}
                        >
                            <span className="cb-swap-result-sym">{t.symbol}</span>
                            <span className="cb-swap-result-name">{t.name}</span>
                        </button>
                    ))}
                    {options.length === 0 && <p className="cb-empty">No tokens match.</p>}
                </div>
            )}
        </div>
    );
}

export default function SwapSheet() {
    const player = usePlayerSigner();
    const mfa = useMfaStepUp();
    const [fromSymbol, setFromSymbol] = useState("ETH");
    const [toSymbol, setToSymbol] = useState("USDC");
    const [fromAmount, setFromAmount] = useState("");
    const [slippageBps, setSlippageBps] = useState(100);
    const [fromQuery, setFromQuery] = useState("");
    const [toQuery, setToQuery] = useState("");
    const [showAdvanced, setShowAdvanced] = useState(false);

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
        setFromQuery("");
        setToQuery("");
    };

    const setFrom = (v: string) => {
        setFromSymbol(v);
        if (v === toSymbol) {
            const alt = BASE_SWAP_TOKENS.find((t) => t.symbol !== v);
            if (alt) setToSymbol(alt.symbol);
        }
    };

    return (
        <div className="cb-screen space-y-4">
            <section className="cb-section">
                <div className="cb-section-head">
                    <span>Swap</span>
                    <span className="cb-section-tag">Base · {BASE_SWAP_TOKENS.length} tokens</span>
                </div>

                <div className="cb-swap-stack">
                    <div className="cb-card cb-pad">
                        <div className="cb-amount-row">
                            <input
                                className="cb-amount-input"
                                inputMode="decimal"
                                placeholder="0.0"
                                value={fromAmount}
                                onChange={(e) => setFromAmount(e.target.value)}
                                aria-label="From amount"
                            />
                            <span className="cb-amount-ccy">{fromSymbol}</span>
                        </div>
                        <TokenSelect
                            label="From"
                            symbol={fromSymbol}
                            query={fromQuery}
                            onQuery={setFromQuery}
                            onPick={setFrom}
                        />
                    </div>

                    <button type="button" className="cb-swap-flip" onClick={flip} aria-label="Flip tokens">
                        <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M7 7h11l-3-3M17 17H6l3 3" />
                        </svg>
                    </button>

                    <div className="cb-card cb-pad">
                        <TokenSelect
                            label="To"
                            symbol={toSymbol}
                            query={toQuery}
                            onQuery={setToQuery}
                            onPick={setToSymbol}
                            exclude={fromSymbol}
                        />
                        {quote.status === "pending" && <p className="cb-copy">Fetching quote…</p>}
                        {price && (
                            <div className="cb-quote">
                                <span>Expected out</span>
                                <strong>
                                    {price} {toSymbol}
                                </strong>
                            </div>
                        )}
                    </div>
                </div>
            </section>

            {issues != null && (
                <div className="cb-banner">Quote issues: {JSON.stringify(issues).slice(0, 160)}</div>
            )}

            <button
                type="button"
                className="cb-link"
                onClick={() => setShowAdvanced((v) => !v)}
                aria-expanded={showAdvanced}
            >
                {showAdvanced ? "Hide advanced" : "Advanced · slippage"}
            </button>
            {showAdvanced && (
                <section className="cb-section">
                    <div className="cb-card cb-pad">
                        <label className="cb-label" htmlFor="slippage">
                            Slippage (bps)
                        </label>
                        <input
                            id="slippage"
                            className="cb-input"
                            inputMode="numeric"
                            value={String(slippageBps)}
                            onChange={(e) => setSlippageBps(Number(e.target.value) || 100)}
                        />
                    </div>
                </section>
            )}

            <button
                type="button"
                className="cb-btn primary block"
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

            {error && <p className="cb-error">{error.message}</p>}
            {status === "success" && <p className="cb-copy ok">Swap confirmed.</p>}
            <p className="cb-more-lead">Coinbase swap engine · CHIPS not listed (unpriced).</p>
        </div>
    );
}
