"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import { useWalletSigner } from "@/hooks/useWalletSigner";
import { useCdpParentSigner } from "@/hooks/useCdpParentSigner";
import {
    readWalletMode,
    resolveActiveMode,
    subscribeWalletMode,
    writeWalletMode,
    type WalletMode,
} from "@/lib/walletMode";

/** Rejects when no wallet source is live (keeps the WalletSigner shape). */
async function disconnectedSigner(): Promise<`0x${string}`> {
    throw new Error("No wallet connected");
}

/**
 * Active-mode signer (SMART_WALLET_PLANNING §4).
 * External = wagmi (Base/MM/Phantom/WalletConnect). In-game = CDP parent Smart Account.
 * Identity = parent/smart only — never owner EOA / sub.
 *
 * `mode` is **resolved, not stored**: live connection state wins and the
 * stored preference only breaks ties when both sources are live. Null =
 * nothing connected. `needsReconnect` is true only when the preferred
 * in-game session lapsed with no fallback live.
 */
export function usePlayerSigner() {
    const external = useWalletSigner();
    const cdp = useCdpParentSigner();

    const stored = useSyncExternalStore(subscribeWalletMode, readWalletMode, () => null);
    const setMode = useCallback((m: WalletMode | null) => writeWalletMode(m), []);

    return useMemo(() => {
        const ingameLive = Boolean(cdp.address);
        const externalLive = Boolean(external.address);
        const active = resolveActiveMode(stored, { ingame: ingameLive, external: externalLive });
        const signer = active === "ingame" ? cdp : active === "external" ? external : null;
        return {
            mode: active,
            address: signer?.address,
            needsReconnect: stored === "ingame" && !ingameLive && !externalLive,
            signMessageAsync: signer?.signMessageAsync ?? disconnectedSigner,
            signTypedDataAsync: signer?.signTypedDataAsync ?? disconnectedSigner,
            setMode,
            ownerEoa: cdp.ownerEoa,
            isSignedInCdp: cdp.isSignedIn,
            ingameLive,
            externalLive,
        };
    }, [stored, cdp, external, setMode]);
}
