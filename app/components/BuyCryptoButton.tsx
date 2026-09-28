"use client";

import { usePlayerSigner } from "@/hooks/usePlayerSigner";

/**
 * R4 — Buy crypto via Coinbase Onramp deep link (same as Coinbase Wallet).
 * R4 note: CDP domain allowlist required for production onramp origin.
 */
export default function BuyCryptoButton() {
    const player = usePlayerSigner();

    const openOnramp = () => {
        const address = player.address;
        if (!address) return;
        // Coinbase onramp: destination wallet + asset
        const url = new URL("https://pay.coinbase.com/buy/select-asset");
        url.searchParams.set("destinationWallets", JSON.stringify([{ address, assets: ["ETH", "USDC"] }]));
        url.searchParams.set("asset", "ETH");
        window.open(url.toString(), "_blank", "noopener,noreferrer");
    };

    return (
        <button
            type="button"
            className="w-full rounded-xl border border-white/15 py-3 text-[11px] font-black uppercase tracking-wider"
            disabled={!player.address}
            onClick={openOnramp}
        >
            Buy crypto (Coinbase)
        </button>
    );
}
