"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import { useWalletSigner } from "@/hooks/useWalletSigner";
import { useCdpParentSigner } from "@/hooks/useCdpParentSigner";
import {
    readWalletMode,
    subscribeWalletMode,
    writeWalletMode,
    type WalletMode,
} from "@/lib/walletMode";

/**
 * Active-mode signer (DUAL_PATH_WALLET_PLAN §4).
 * External = wagmi (Base/MM/Phantom). In-game = CDP parent Smart Account.
 * Identity = parent/smart only — never owner EOA / sub.
 */
export function usePlayerSigner() {
    const external = useWalletSigner();
    const cdp = useCdpParentSigner();

    const mode = useSyncExternalStore(subscribeWalletMode, readWalletMode, () => null);
    const setMode = useCallback((m: WalletMode | null) => writeWalletMode(m), []);

    return useMemo(() => {
        const ingameReady = mode === "ingame" && Boolean(cdp.address);
        const active = ingameReady ? cdp : external;
        return {
            mode: (ingameReady ? "ingame" : "external") as WalletMode,
            address: active.address,
            signMessageAsync: active.signMessageAsync,
            signTypedDataAsync: active.signTypedDataAsync,
            setMode,
            /** CDP diagnostics (in-game only). */
            ownerEoa: cdp.ownerEoa,
            isSignedInCdp: cdp.isSignedIn,
        };
    }, [mode, cdp, external, setMode]);
}
