"use client";

import { useCallback, useState } from "react";
import { usePlayerSigner } from "@/hooks/usePlayerSigner";
import { readWalletMode, writeWalletMode, type WalletMode } from "@/lib/walletMode";
import { buildWalletLinkMessage } from "@/lib/walletLink";
import { useWalletSigner } from "@/hooks/useWalletSigner";

/**
 * W3 — Profile switcher + optional two-sig wallet link.
 * Session-scoped wallet_address only. Progression is never auto-merged.
 */
export default function WalletLinkPanel() {
    const player = usePlayerSigner();
    const external = useWalletSigner();
    const [busy, setBusy] = useState(false);
    const [msg, setMsg] = useState<string | null>(null);
    const [linkedAddr, setLinkedAddr] = useState("");

    const mode = readWalletMode();

    const switchMode = useCallback((m: WalletMode) => {
        writeWalletMode(m);
        setMsg(m === "ingame" ? "Switched to in-game wallet for this session" : "Switched to external wallet");
    }, []);

    const linkWallets = useCallback(async () => {
        setBusy(true);
        setMsg(null);
        try {
            const current = player.address;
            const other = linkedAddr.trim().toLowerCase();
            if (!current || !other) {
                setMsg("Need a current wallet and a second address");
                return;
            }
            if (current.toLowerCase() === other) {
                setMsg("Cannot link the same address");
                return;
            }
            const issuedAt = new Date().toISOString();
            const message = buildWalletLinkMessage({ primary: current, linked: other, issuedAt });

            // Sign as active player (primary)
            const primarySignature = await player.signMessageAsync({
                account: current as `0x${string}`,
                message,
            });
            // Sign as the other wallet (must be the other mode's signer when available)
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
            setMsg(
                "Linked. Profiles stay separate (no LXP/RXP merge). Switch mode above to play as either wallet.",
            );
        } catch (e) {
            setMsg(e instanceof Error ? e.message : String(e));
        } finally {
            setBusy(false);
        }
    }, [player, external, linkedAddr]);

    return (
        <div className="space-y-3">
            <div>
                <h4 className="text-[11px] font-black uppercase tracking-[0.25em] text-white/70">
                    Play as
                </h4>
                <p className="text-[11px] text-white/45 mt-1">
                    Session only — does not change saved history.
                </p>
                <div className="flex gap-2 mt-2">
                    <button
                        type="button"
                        className={`rounded-lg px-3 py-2 text-[11px] font-bold uppercase border ${mode === "ingame" ? "bg-cyan-500/25 border-cyan-400/50" : "border-white/15"}`}
                        onClick={() => switchMode("ingame")}
                    >
                        In-game
                    </button>
                    <button
                        type="button"
                        className={`rounded-lg px-3 py-2 text-[11px] font-bold uppercase border ${mode === "external" || !mode ? "bg-cyan-500/25 border-cyan-400/50" : "border-white/15"}`}
                        onClick={() => switchMode("external")}
                    >
                        External
                    </button>
                </div>
                <p className="text-[10px] text-white/40 font-mono mt-1 break-all">
                    {player.address || "—"}
                </p>
            </div>

            <div className="border-t border-white/10 pt-3">
                <h4 className="text-[11px] font-black uppercase tracking-[0.25em] text-white/70">
                    Link another wallet
                </h4>
                <p className="text-[11px] text-white/45 mt-1 leading-relaxed">
                    Optional. You sign with both wallets. Stats stay separate. No funds move.
                </p>
                <div className="flex gap-2 mt-2">
                    <input
                        className="flex-1 rounded-lg border border-white/20 bg-black/40 px-2 py-2 text-[11px] font-mono"
                        placeholder="0x other wallet"
                        value={linkedAddr}
                        onChange={(e) => setLinkedAddr(e.target.value)}
                    />
                    <button
                        type="button"
                        className="rounded-lg border border-white/15 px-3 py-2 text-[11px] uppercase font-bold"
                        disabled={busy}
                        onClick={linkWallets}
                    >
                        Link
                    </button>
                </div>
                {msg && <p className="text-[11px] text-white/60 mt-2">{msg}</p>}
            </div>
        </div>
    );
}
