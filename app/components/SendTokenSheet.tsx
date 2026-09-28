"use client";

/**
 * R0/R1 — Send ETH · USDC · CHIPS (SMART_WALLET_PLANNING §3.2).
 * Max branches by gas path (M). CHIPS is Base-only + unpriced (H2).
 */

import { useMemo, useState } from "react";
import { formatUnits, isAddress } from "viem";
import { useSendNative } from "@/hooks/useSendNative";
import { useSendToken, type SendTokenKey } from "@/hooks/useSendToken";
import { useWalletAssets } from "@/hooks/useWalletAssets";
import { recordWalletActivity } from "@/hooks/useWalletActivity";
import { useMfaStepUp } from "@/hooks/useMfaStepUp";

export type SendAsset = "eth" | SendTokenKey;

const ASSETS: { key: SendAsset; label: string; name: string; decimals: number; unpriced?: boolean; tint: string }[] = [
    { key: "eth", label: "ETH", name: "Ethereum", decimals: 18, tint: "#627EEA" },
    { key: "usdc", label: "USDC", name: "USD Coin", decimals: 6, tint: "#2775CA" },
    { key: "chips", label: "CHIPS", name: "Game token", decimals: 18, unpriced: true, tint: "#0052FF" },
];

const PCTS = [
    { pct: 25, label: "25%" },
    { pct: 50, label: "50%" },
    { pct: 75, label: "75%" },
    { pct: 100, label: "100%" },
];

function shortAddr(a: string) {
    return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

export default function SendTokenSheet({ onDone }: { onDone?: () => void }) {
    const { tokens, eth, refresh, needsReconnect, address } = useWalletAssets();
    const native = useSendNative();
    const erc20 = useSendToken();
    const mfa = useMfaStepUp();
    const [asset, setAsset] = useState<SendAsset>("eth");
    const [to, setTo] = useState("");
    const [amount, setAmount] = useState("");
    const [confirming, setConfirming] = useState(false);

    const meta = ASSETS.find((a) => a.key === asset) ?? ASSETS[0];
    const bal =
        asset === "eth"
            ? eth ?? BigInt(0)
            : (tokens.find((t) => t.key === asset)?.raw ?? BigInt(0));
    const mode = native.mode;

    /** Gas-safe max (self-pay leaves a buffer). */
    const spendable = useMemo(() => {
        if (asset !== "eth") return bal;
        return mode === "ingame" ? bal : native.maxSelfPay(eth ?? BigInt(0));
    }, [asset, bal, eth, mode, native]);

    const status = asset === "eth" ? native.status : erc20.status;
    const error = asset === "eth" ? native.error : erc20.error;
    const txHash = asset === "eth" ? native.txHash : erc20.txHash;
    const toOk = isAddress(to.trim());
    const amountOk = amount !== "" && Number(amount) > 0;
    const canReview = toOk && amountOk && status !== "pending";

    const setPct = (pct: number) => {
        const raw = (spendable * BigInt(pct)) / BigInt(100);
        setAmount(formatUnits(raw, meta.decimals));
        setConfirming(false);
    };

    if (needsReconnect) {
        return (
            <div className="cb-screen">
                <div className="cb-banner">Session expired — reconnect your wallet.</div>
            </div>
        );
    }

    return (
        <div className="cb-screen send-sheet">
            {/* Asset chips */}
            <div className="tk-row" role="tablist" aria-label="Asset">
                {ASSETS.map((a) => (
                    <button
                        key={a.key}
                        type="button"
                        role="tab"
                        aria-selected={asset === a.key}
                        className={`tk-chip ${asset === a.key ? "on" : ""}`}
                        onClick={() => {
                            setAsset(a.key);
                            setConfirming(false);
                            setAmount("");
                            native.reset();
                            erc20.reset();
                        }}
                    >
                        <span className="tk-dot" style={{ background: a.tint }} />
                        <span className="tk-sym">{a.label}</span>
                    </button>
                ))}
            </div>

            {/* Amount card */}
            <div className="fld-card">
                <div className="fld-top">
                    <span className="fld-label">Amount</span>
                    <span className="fld-bal">
                        {formatUnits(bal, meta.decimals)} {meta.label}
                    </span>
                </div>
                <div className="fld-amt">
                    <input
                        className="fld-amt-input"
                        inputMode="decimal"
                        placeholder="0.0"
                        value={amount}
                        onChange={(e) => {
                            setAmount(e.target.value);
                            setConfirming(false);
                        }}
                        aria-label="Amount"
                    />
                    <span className="fld-ccy">{meta.label}</span>
                </div>
                <div className="pct-row">
                    {PCTS.map((p) => (
                        <button key={p.pct} type="button" className="pct-btn" onClick={() => setPct(p.pct)}>
                            {p.label}
                        </button>
                    ))}
                </div>
                {meta.unpriced && <p className="fld-note">CHIPS · unpriced · Base only</p>}
            </div>

            {/* Recipient card */}
            <div className="fld-card">
                <div className="fld-top">
                    <span className="fld-label">To</span>
                    {to.trim() && (
                        <span className={`fld-status ${toOk ? "ok" : "bad"}`}>
                            {toOk ? shortAddr(to.trim()) : "Invalid"}
                        </span>
                    )}
                </div>
                <input
                    className={`fld-text ${to.trim() && !toOk ? "bad" : ""}`}
                    placeholder="0x recipient address"
                    value={to}
                    onChange={(e) => {
                        setTo(e.target.value);
                        setConfirming(false);
                    }}
                    autoComplete="off"
                    spellCheck={false}
                />
            </div>

            {/* Review panel */}
            {confirming && status === "idle" && (
                <div className="rev-card">
                    <div className="rev-row">
                        <span>Amount</span>
                        <strong>
                            {amount} {meta.label}
                        </strong>
                    </div>
                    <div className="rev-row">
                        <span>To</span>
                        <strong className="font-mono">{shortAddr(to.trim())}</strong>
                    </div>
                    <div className="rev-row">
                        <span>Route</span>
                        <strong>{mode === "ingame" ? "Smart wallet" : "Your wallet"}</strong>
                    </div>
                    <p className="rev-note">This moves real value. You will sign in your wallet.</p>
                    <div className="rev-btns">
                        <button
                            type="button"
                            className="btn-main"
                            onClick={async () => {
                                const ok = await mfa.stepUp();
                                if (!ok) return;
                                const hash =
                                    asset === "eth"
                                        ? await native.send({ to, amountEth: amount })
                                        : await erc20.send({ token: asset, to, amount });
                                if (address) {
                                    recordWalletActivity(address, {
                                        id: hash || `local-${Date.now()}`,
                                        kind: "send",
                                        status: "pending",
                                        token: meta.label as "ETH" | "USDC" | "CHIPS",
                                        amount,
                                        counterparty: to,
                                        hash: hash ?? undefined,
                                        at: Date.now(),
                                    });
                                }
                                setConfirming(false);
                                void refresh();
                            }}
                        >
                            Confirm send
                        </button>
                        <button type="button" className="btn-ghost" onClick={() => setConfirming(false)}>
                            Back
                        </button>
                    </div>
                </div>
            )}

            {/* Primary CTA pinned after fields */}
            {!confirming && (
                <button
                    type="button"
                    className="btn-main block"
                    disabled={!canReview}
                    onClick={() => setConfirming(true)}
                >
                    {status === "pending" ? "Sending…" : "Review"}
                </button>
            )}

            {status === "pending" && <p className="fld-note">Waiting for wallet confirmation…</p>}
            {status === "success" && (
                <div className="ok-card">
                    <p className="ok-title">Sent</p>
                    {txHash && <p className="ok-hash font-mono">{txHash}</p>}
                    {onDone && (
                        <button type="button" className="lnk" onClick={onDone}>
                            View activity
                        </button>
                    )}
                </div>
            )}
            {error && <p className="err-text">{error}</p>}
        </div>
    );
}
