"use client";

import { useCallback, useState } from "react";
import QRCode from "qrcode";
import { useWalletAssets } from "@/hooks/useWalletAssets";

/** R0 — Receive sheet (WALLET_PLAN §3.1). */
export default function ReceiveSheet() {
    const { address, needsReconnect } = useWalletAssets();
    const [qr, setQr] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);

    const ensureQr = useCallback(async () => {
        if (!address || qr) return;
        try {
            setQr(await QRCode.toDataURL(address, { margin: 1, width: 200 }));
        } catch {
            /* ignore */
        }
    }, [address, qr]);

    if (needsReconnect) {
        return (
            <p className="text-[11px] text-amber-200">Session expired — reconnect your wallet.</p>
        );
    }
    if (!address) {
        return <p className="text-[11px] text-white/50">Sign in to see your receive address.</p>;
    }

    return (
        <div className="space-y-3">
            <h4 className="text-[11px] font-black uppercase tracking-[0.25em] text-white/70">Receive</h4>
            <p className="text-[11px] text-white/45 leading-relaxed">
                Base / Base Sepolia address. In-game smart wallets are <strong>not</strong> your Base app
                address.
            </p>
            <button type="button" onClick={() => void ensureQr()} className="text-[11px] text-cyan-300 underline">
                Show QR
            </button>
            {qr && <img src={qr} alt="Receive QR" width={160} height={160} className="rounded-xl bg-white p-1" />}
            <div className="rounded-xl border border-white/10 bg-black/30 p-3">
                <div className="text-[10px] text-white/40 uppercase tracking-wider">Address</div>
                <div className="font-mono text-[11px] break-all text-white/85 mt-1">{address}</div>
            </div>
            <button
                type="button"
                className="rounded-lg bg-cyan-500/20 border border-cyan-400/40 px-3 py-2 text-[11px] font-bold uppercase"
                onClick={async () => {
                    try {
                        await navigator.clipboard.writeText(address);
                        setCopied(true);
                        setTimeout(() => setCopied(false), 1500);
                    } catch {
                        /* ignore */
                    }
                }}
            >
                {copied ? "Copied" : "Copy address"}
            </button>
        </div>
    );
}
