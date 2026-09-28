"use client";

import { useCallback, useEffect, useState } from "react";
import QRCode from "qrcode";
import { useWalletAssets } from "@/hooks/useWalletAssets";
import { useNetworkLabel } from "@/hooks/useNetworkLabel";

/** R0 — Receive sheet (SMART_WALLET_PLANNING §5). */
export default function ReceiveSheet() {
    const { address, needsReconnect } = useWalletAssets();
    const network = useNetworkLabel();
    const [qr, setQr] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);

    const ensureQr = useCallback(async () => {
        if (!address || qr) return;
        try {
            setQr(await QRCode.toDataURL(address, { margin: 1, width: 220 }));
        } catch {
            /* ignore */
        }
    }, [address, qr]);

    useEffect(() => {
        void ensureQr();
    }, [ensureQr]);

    if (needsReconnect) {
        return (
            <div className="cb-screen">
                <div className="cb-banner">Session expired — reconnect your wallet.</div>
            </div>
        );
    }
    if (!address) {
        return (
            <div className="cb-screen">
                <div className="cb-empty-state">
                    <p className="cb-empty-title">No address yet</p>
                    <p className="cb-empty-hint">Sign in to see your receive address.</p>
                </div>
            </div>
        );
    }

    return (
        <div className="cb-screen space-y-4">
            <section className="cb-section">
                <div className="cb-section-head">
                    <span>Your address</span>
                    <span className="cb-section-tag">{network.label}</span>
                </div>
                <div className="cb-card cb-receive">
                    <div className="cb-qr-wrap">
                        {qr ? (
                            <img src={qr} alt="Receive QR code" width={200} height={200} className="cb-qr" />
                        ) : (
                            <button type="button" className="cb-qr-placeholder" onClick={() => void ensureQr()}>
                                Show QR
                            </button>
                        )}
                    </div>
                    <p className="cb-copy center">{network.label} · only send assets on this network</p>
                    <div className="cb-addr-block">
                        <div className="cb-addr-label">Address</div>
                        <div className="cb-addr-value font-mono">{address}</div>
                    </div>
                    <button
                        type="button"
                        className="cb-btn primary block"
                        onClick={async () => {
                            try {
                                await navigator.clipboard.writeText(address);
                                setCopied(true);
                                setTimeout(() => setCopied(false), 1600);
                            } catch {
                                /* clipboard blocked */
                            }
                        }}
                    >
                        {copied ? "Copied" : "Copy address"}
                    </button>
                </div>
            </section>

            <div className="cb-banner">
                In-game smart wallets are <strong>not</strong> your Base app address. Check the network before
                sending.
            </div>
        </div>
    );
}
