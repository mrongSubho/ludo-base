"use client";

/**
 * R0/R1 — Send ETH · USDC · CHIPS (SMART_WALLET_PLANNING §3.2).
 * Max branches by gas path (M). CHIPS is Base-only + unpriced (H2).
 */

import { useState } from "react";
import { formatUnits, isAddress } from "viem";
import { useSendNative } from "@/hooks/useSendNative";
import { useSendToken, type SendTokenKey } from "@/hooks/useSendToken";
import { useWalletAssets } from "@/hooks/useWalletAssets";
import { recordWalletActivity } from "@/hooks/useWalletActivity";
import { useMfaStepUp } from "@/hooks/useMfaStepUp";

export type SendAsset = "eth" | SendTokenKey;

const ASSETS: { key: SendAsset; label: string; decimals: number; unpriced?: boolean; tint: string }[] = [
    { key: "eth", label: "ETH", decimals: 18, tint: "#627EEA" },
    { key: "usdc", label: "USDC", decimals: 6, tint: "#2775CA" },
    { key: "chips", label: "CHIPS", decimals: 18, unpriced: true, tint: "#0052FF" },
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
    const maxAmt =
        asset !== "eth"
            ? formatUnits(bal, meta.decimals)
            : mode === "ingame"
              ? formatUnits(bal, meta.decimals)
              : formatUnits(native.maxSelfPay(eth ?? BigInt(0)), meta.decimals);

    const status = asset === "eth" ? native.status : erc20.status;
    const error = asset === "eth" ? native.error : erc20.error;
    const txHash = asset === "eth" ? native.txHash : erc20.txHash;
    const toOk = isAddress(to.trim());
    const amountOk = amount !== "" && Number(amount) > 0;
    const canReview = toOk && amountOk && status !== "pending";

    if (needsReconnect) {
        return (
            <div className="cb-screen">
                <div className="cb-banner">Session expired — reconnect your wallet.</div>
            </div>
        );
    }

    return (
        <div className="cb-screen space-y-4">
            {/* Asset picker */}
            <section className="cb-section">
                <div className="cb-section-head">
                    <span>Asset</span>
                    <span className="cb-section-tag">
                        {formatUnits(bal, meta.decimals)} {meta.label}
                    </span>
                </div>
                <div className="cb-asset-pills" role="tablist" aria-label="Asset">
                    {ASSETS.map((a) => (
                        <button
                            key={a.key}
                            type="button"
                            role="tab"
                            aria-selected={asset === a.key}
                            className={`cb-asset-pill ${asset === a.key ? "active" : ""}`}
                            onClick={() => {
                                setAsset(a.key);
                                setConfirming(false);
                                native.reset();
                                erc20.reset();
                            }}
                        >
                            <span className="cb-asset-dot" style={{ background: a.tint }} />
                            {a.label}
                            {a.unpriced && <span className="cb-asset-pill-tag">unpriced</span>}
                        </button>
                    ))}
                </div>
            </section>

            {/* Recipient */}
            <section className="cb-section">
                <div className="cb-section-head">
                    <span>To</span>
                    {to && (
                        <span className={`cb-section-tag ${toOk ? "" : "danger"}`}>
                            {toOk ? shortAddr(to.trim()) : "Invalid address"}
                        </span>
                    )}
                </div>
                <div className="cb-card cb-pad">
                    <input
                        className={`cb-input ${to && !toOk ? "invalid" : ""}`}
                        placeholder="0x recipient address"
                        value={to}
                        onChange={(e) => setTo(e.target.value)}
                        autoComplete="off"
                        spellCheck={false}
                    />
                </div>
            </section>

            {/* Amount */}
            <section className="cb-section">
                <div className="cb-section-head">
                    <span>Amount</span>
                    <button type="button" className="cb-link" onClick={() => setAmount(maxAmt)}>
                        Max {formatUnits(bal, meta.decimals)} {meta.label}
                    </button>
                </div>
                <div className="cb-card cb-pad">
                    <div className="cb-amount-row">
                        <input
                            className="cb-amount-input"
                            inputMode="decimal"
                            placeholder="0.0"
                            value={amount}
                            onChange={(e) => {
                                setAmount(e.target.value);
                                setConfirming(false);
                            }}
                        />
                        <span className="cb-amount-ccy">{meta.label}</span>
                    </div>
                    {meta.unpriced && (
                        <p className="cb-warn">CHIPS is unpriced and Base-only — not in USD totals.</p>
                    )}
                </div>
            </section>

            {/* Review / confirm */}
            {confirming && status === "idle" && (
                <section className="cb-section">
                    <div className="cb-section-head">
                        <span>Review</span>
                        <span className="cb-section-tag">{mode === "ingame" ? "Smart wallet" : "External"}</span>
                    </div>
                    <div className="cb-card cb-pad">
                        <dl className="cb-review">
                            <div>
                                <dt>Amount</dt>
                                <dd>
                                    {amount} {meta.label}
                                </dd>
                            </div>
                            <div>
                                <dt>To</dt>
                                <dd className="font-mono">{shortAddr(to.trim())}</dd>
                            </div>
                            <div>
                                <dt>Network</dt>
                                <dd>Base</dd>
                            </div>
                        </dl>
                        <p className="cb-copy">This moves real value. You will sign in your wallet.</p>
                        <div className="cb-btn-row">
                            <button
                                type="button"
                                className="cb-btn primary"
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
                            <button type="button" className="cb-btn ghost" onClick={() => setConfirming(false)}>
                                Cancel
                            </button>
                        </div>
                    </div>
                </section>
            )}

            <button
                type="button"
                className="cb-btn primary block"
                disabled={!canReview}
                onClick={() => setConfirming(true)}
            >
                {status === "pending" ? "Sending…" : "Review"}
            </button>

            {status === "pending" && (
                <p className="cb-copy">Sending with {mode === "ingame" ? "smart wallet" : "your wallet"}…</p>
            )}
            {status === "success" && (
                <div className="cb-card cb-pad">
                    <p className="cb-copy ok">Sent.</p>
                    {txHash && <p className="cb-hash font-mono">{txHash}</p>}
                    {onDone && (
                        <button type="button" className="cb-link" onClick={onDone}>
                            View activity →
                        </button>
                    )}
                </div>
            )}
            {error && <p className="cb-error">{error}</p>}
        </div>
    );
}
