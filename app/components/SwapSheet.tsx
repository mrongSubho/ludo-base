"use client";

/**
 * R4 — Swap via CDP `useSwap` / `useGetSwapPrice` (Coinbase swap engine).
 * CDP swap is **Base mainnet** only — parked while the app runs on Base Sepolia.
 * CHIPS is not a swap asset (H2).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useGetSwapPrice, useSwap } from "@coinbase/cdp-hooks";
import { usePlayerSigner } from "@/hooks/usePlayerSigner";
import { useMfaStepUp } from "@/hooks/useMfaStepUp";
import {
    BASE_SWAP_TOKENS,
    searchSwapTokens,
    type SwapToken,
} from "@/lib/swapTokens";

function TokenPicker({
    value,
    onChange,
    exclude,
    id,
}: {
    value: string;
    onChange: (s: string) => void;
    exclude?: string;
    id: string;
}) {
    const [open, setOpen] = useState(false);
    const [q, setQ] = useState("");
    const boxRef = useRef<HTMLDivElement | null>(null);
    const meta = BASE_SWAP_TOKENS.find((t) => t.symbol === value) ?? BASE_SWAP_TOKENS[0];
    const options = useMemo(() => searchSwapTokens(q, exclude), [q, exclude]);

    useEffect(() => {
        if (!open) return;
        const onDown = (e: MouseEvent) => {
            if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener("mousedown", onDown);
        return () => document.removeEventListener("mousedown", onDown);
    }, [open]);

    return (
        <div className="tkpick" ref={boxRef}>
            <button
                type="button"
                id={id}
                className="tkpick-btn"
                aria-haspopup="listbox"
                aria-expanded={open}
                onClick={() => {
                    setOpen((v) => !v);
                    setQ("");
                }}
            >
                <span className="tkpick-sym">{meta.symbol}</span>
                <svg viewBox="0 0 24 24" className="tkpick-chev" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M6 9l6 6 6-6" />
                </svg>
            </button>
            {open && (
                <div className="tkpick-menu" role="listbox" aria-labelledby={id}>
                    <textarea
                        className="tkpick-search"
                        rows={1}
                        placeholder="Search"
                        value={q}
                        onChange={(e) => setQ(e.target.value)}
                        autoComplete="off"
                        autoCorrect="off"
                        autoCapitalize="none"
                        spellCheck={false}
                        enterKeyHint="search"
                        autoFocus
                    />
                    <div className="tkpick-list">
                        {options.map((t: SwapToken) => (
                            <button
                                key={t.symbol}
                                type="button"
                                role="option"
                                aria-selected={t.symbol === value}
                                className={`tkpick-item ${t.symbol === value ? "on" : ""}`}
                                onClick={() => {
                                    onChange(t.symbol);
                                    setOpen(false);
                                }}
                            >
                                <span className="tkpick-item-sym">{t.symbol}</span>
                                <span className="tkpick-item-name">{t.name}</span>
                            </button>
                        ))}
                        {options.length === 0 && <p className="tkpick-empty">No matches</p>}
                    </div>
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
    };

    const setFrom = (v: string) => {
        setFromSymbol(v);
        if (v === toSymbol) {
            const alt = BASE_SWAP_TOKENS.find((t) => t.symbol !== v);
            if (alt) setToSymbol(alt.symbol);
        }
    };

    return (
        <div className="cb-screen swap-sheet">
            {/* Sell */}
            <div className="sw-card">
                <div className="sw-top">
                    <span className="sw-label">Sell</span>
                    <TokenPicker id="sw-from" value={fromSymbol} onChange={setFrom} />
                </div>
                <div className="sw-amt">
                    <input
                        className="sw-amt-input"
                        inputMode="decimal"
                        placeholder="0.0"
                        value={fromAmount}
                        onChange={(e) => setFromAmount(e.target.value)}
                        aria-label="Sell amount"
                    />
                </div>
            </div>

            <button type="button" className="sw-flip" onClick={flip} aria-label="Flip tokens">
                <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M8 4v16M8 20l-3-3M8 20l3-3M16 20V4M16 4l-3 3M16 4l3 3" />
                </svg>
            </button>

            {/* Buy */}
            <div className="sw-card">
                <div className="sw-top">
                    <span className="sw-label">Buy</span>
                    <TokenPicker
                        id="sw-to"
                        value={toSymbol}
                        onChange={setToSymbol}
                        exclude={fromSymbol}
                    />
                </div>
                <div className="sw-amt">
                    <span className={`sw-out ${price ? "has" : ""}`} aria-live="polite">
                        {quote.status === "pending" ? "…" : price || "0.0"}
                    </span>
                </div>
            </div>

            {/* Quote strip */}
            <div className="sw-meta">
                <div className="sw-meta-row">
                    <span>Expected</span>
                    <span>
                        {price ? `${price} ${toSymbol}` : quote.status === "pending" ? "Fetching…" : "—"}
                    </span>
                </div>
                <div className="sw-meta-row">
                    <span>Slippage</span>
                    <button type="button" className="lnk" onClick={() => setShowAdvanced((v) => !v)}>
                        {(slippageBps / 100).toFixed(2)}%
                    </button>
                </div>
                {showAdvanced && (
                    <div className="sw-meta-row">
                        <span>Max slippage (bps)</span>
                        <input
                            className="sw-slip"
                            inputMode="numeric"
                            value={String(slippageBps)}
                            onChange={(e) => setSlippageBps(Number(e.target.value) || 100)}
                        />
                    </div>
                )}
            </div>

            {issues != null && (
                <div className="cb-banner">Quote issues: {JSON.stringify(issues).slice(0, 140)}</div>
            )}

            <button
                type="button"
                className="btn-main block"
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

            {error && <p className="err-text">{error.message}</p>}
            {status === "success" && <p className="ok-inline">Swap confirmed</p>}
            <p className="sw-foot">Coinbase swap engine · Base only · CHIPS not listed</p>
        </div>
    );
}
