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
        // Never silently switch identity. If mode is ingame but CDP is not ready,
        // report `needsReconnect` instead of falling back to external address.
        const wantsInGame = mode === "ingame";
        const ingameReady = wantsInGame && Boolean(cdp.address);
        const active = ingameReady ? cdp : wantsInGame ? cdp : external;
        return {
            mode: (wantsInGame ? "ingame" : "external") as WalletMode,
            address: active.address,
            needsReconnect: wantsInGame && !cdp.address,
            signMessageAsync: active.signMessageAsync,
            signTypedDataAsync: active.signTypedDataAsync,
            setMode,
            ownerEoa: cdp.ownerEoa,
            isSignedInCdp: cdp.isSignedIn,
        };
    }, [mode, cdp, external, setMode]);
}
