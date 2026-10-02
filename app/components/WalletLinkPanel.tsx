"use client";

import { useCallback, useEffect, useState } from "react";
import { usePlayerSigner } from "@/hooks/usePlayerSigner";
import { readWalletMode, writeWalletMode, type WalletMode } from "@/lib/walletMode";
import { buildWalletLinkMessage } from "@/lib/walletLink";
import { useWalletSigner } from "@/hooks/useWalletSigner";

/**
 * W3 — Session wallet switcher + optional two-sig link.
 * Progression is never auto-merged. No funds move on link.
 */

function shortAddr(a?: string) {
    if (!a) return "—";
    return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

const ModeChip = ({
    active,
    label,
    hint,
    onClick,
    disabled,
}: {
    active: boolean;
    label: string;
    hint: string;
    onClick: () => void;
    disabled?: boolean;
}) => (
    <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-disabled={disabled}
        className={`flex-1 rounded-2xl border px-3 py-3 text-left transition-all disabled:opacity-45 disabled:cursor-not-allowed ${
            active && !disabled
                ? "border-cyan-400/50 bg-cyan-500/15 shadow-[0_0_18px_rgba(34,211,238,0.12)]"
                : "border-white/10 bg-white/[0.03] hover:bg-white/[0.06]"
        }`}
    >
        <div className="flex items-center gap-2">
            <span
                className={`w-2 h-2 rounded-full ${active ? "bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.8)]" : "bg-white/25"}`}
            />
            <span className="text-[12px] font-extrabold tracking-[0.06em] uppercase text-white">
                {label}
            </span>
        </div>
        <div className="mt-1 text-[10px] font-semibold text-white/40 leading-snug">{hint}</div>
    </button>
);

export default function WalletLinkPanel() {
    const player = usePlayerSigner();
    const external = useWalletSigner();
    const [busy, setBusy] = useState(false);
    const [msg, setMsg] = useState<string | null>(null);
    const [ok, setOk] = useState(false);
    const [linkedAddr, setLinkedAddr] = useState("");
    const [hasLinked, setHasLinked] = useState(false);

    const mode = readWalletMode();

    // External is only playable after a successful two-sig link.
    const refreshLinks = useCallback(async () => {
        const wallet = player.address?.toLowerCase();
        if (!wallet) {
            setHasLinked(false);
            return;
        }
        try {
            const res = await fetch(`/api/wallet-links?wallet=${wallet}`);
            const data = await res.json().catch(() => ({}));
            setHasLinked(Array.isArray(data?.links) && data.links.length > 0);
        } catch {
            setHasLinked(false);
        }
    }, [player.address]);

    useEffect(() => {
        void refreshLinks();
    }, [refreshLinks]);

    const switchMode = useCallback((m: WalletMode) => {
        writeWalletMode(m);
        setOk(m === "ingame");
        setMsg(m === "ingame" ? "Playing as in-game wallet" : "Playing as external wallet");
    }, []);

    const linkWallets = useCallback(async () => {
        setBusy(true);
        setMsg(null);
        setOk(false);
        try {
            const current = player.address;
            const other = linkedAddr.trim().toLowerCase();
            if (!current || !other) {
                setMsg("Enter the second wallet address first.");
                return;
            }
            if (current.toLowerCase() === other) {
                setMsg("That’s the same wallet — pick a different address.");
                return;
            }
            const issuedAt = new Date().toISOString();
            const message = buildWalletLinkMessage({ primary: current, linked: other, issuedAt });

            const primarySignature = await player.signMessageAsync({
                account: current as `0x${string}`,
                message,
            });
            const otherSigner = external.address?.toLowerCase() === other ? external : player;
            const linkedSignature = await otherSigner.signMessageAsync({
                account: other as `0x${string}`,
                message,
            });

            const res = await fetch("/api/wallet-links", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    primary: current,
                    linked: other,
                    issuedAt,
                    primarySignature,
                    linkedSignature,
                }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                setMsg(data.error || `Link failed (${res.status})`);
                return;
            }
            setOk(true);
            setHasLinked(true);
            setMsg("Wallets linked. Stats stay separate — switch above to play as either.");
        } catch (e) {
            setMsg(e instanceof Error ? e.message : String(e));
        } finally {
            setBusy(false);
        }
    }, [player, external, linkedAddr]);

    return (
        <div className="wl-root">
            {/* Play as */}
            <div className="wl-block">
                <div className="wl-eyebrow">Active wallet</div>
                <div className="wl-mode-grid">
                    <ModeChip
                        active={mode === "ingame"}
                        label="In-game"
                        hint="CDP smart · Ludo UI"
                        onClick={() => switchMode("ingame")}
                    />
                    <ModeChip
                        active={(mode === "external" || !mode) && hasLinked}
                        label="External"
                        hint={hasLinked ? "Base · MetaMask · Phantom" : "Link a wallet to unlock"}
                        disabled={!hasLinked}
                        onClick={() => {
                            if (!hasLinked) return;
                            switchMode("external");
                        }}
                    />
                </div>
                <div className="wl-addr-chip">
                    <span className="wl-addr-label">Now</span>
                    <span className="wl-addr mono">{shortAddr(player.address)}</span>
                </div>
            </div>

            {/* Link */}
            <div className="wl-block">
                <div className="wl-eyebrow">Link a wallet</div>
                <p className="wl-lead">
                    Sign with both wallets once. Scores stay separate. Nothing moves on-chain.
                </p>
                <div className="wl-link-row">
                    <textarea
                        className="wl-input resize-none overflow-hidden"
                        rows={1}
                        placeholder="0x…"
                        value={linkedAddr}
                        onChange={(e) => setLinkedAddr(e.target.value)}
                        spellCheck={false}
                        autoComplete="off"
                        autoCorrect="off"
                        autoCapitalize="none"
                        enterKeyHint="done"
                    />
                    <button
                        type="button"
                        className="wl-btn"
                        disabled={busy || !linkedAddr.trim()}
                        onClick={linkWallets}
                    >
                        {busy ? "…" : "Link"}
                    </button>
                </div>
            </div>

            {msg && (
                <div className={`wl-toast ${ok ? "ok" : "bad"}`} role="status">
                    {msg}
                </div>
            )}
        </div>
    );
}
