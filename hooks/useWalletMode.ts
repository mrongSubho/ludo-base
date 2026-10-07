"use client";

import { useSyncExternalStore } from "react";
import { useAccount } from "wagmi";
import { useCurrentUser } from "@coinbase/cdp-hooks";
import {
    readWalletMode,
    resolveActiveMode,
    subscribeWalletMode,
    type WalletMode,
} from "@/lib/walletMode";

/**
 * Reactive **resolved** wallet mode (external | ingame | null).
 * Live connection state wins; the stored `ludo-wallet-mode` is only the
 * tiebreaker when both sources are live. Null = nothing connected.
 */
export function useWalletMode(): WalletMode | null {
    const stored = useSyncExternalStore(subscribeWalletMode, readWalletMode, () => null);
    const { address: externalAddress } = useAccount();
    const { currentUser } = useCurrentUser();
    const smart = currentUser?.evmSmartAccountObjects?.[0]?.address;
    return resolveActiveMode(stored, {
        ingame: Boolean(smart),
        external: Boolean(externalAddress),
    });
}

export type { WalletMode };
