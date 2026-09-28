"use client";

import { useEffect, useState } from "react";
import { readWalletMode, subscribeWalletMode, type WalletMode } from "@/lib/walletMode";

/** Reactive wallet mode (external | ingame) for wallet surfaces. */
export function useWalletMode(): WalletMode {
    const [mode, setMode] = useState<WalletMode>(() => readWalletMode() ?? "external");
    useEffect(() => {
        setMode(readWalletMode() ?? "external");
        return subscribeWalletMode(() => setMode(readWalletMode() ?? "external"));
    }, []);
    return mode;
}

export type { WalletMode };
