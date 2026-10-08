"use client";

/**
 * Security preferences (SMART_WALLET_PLANNING §5).
 * These preferences apply to the CDP in-game wallet only. External wallets
 * (MetaMask, Base Account, and other wagmi connectors) use their native
 * wallet authentication and confirmation UI.
 * - bootLock: require passkey / device bio every app boot for CDP
 * - txStepUp: "strict" = device bio required for CDP tx;
 *             "confirm" = our Confirm button only (CDP auto-approve)
 * - autoSign: silent CDP sign for app-session / match messages (no extra prompt)
 */

import { useCallback, useSyncExternalStore } from "react";

export type TxStepUpMode = "strict" | "confirm";

const KEYS = {
    bootLock: "ludo-security-boot-lock",
    txStepUp: "ludo-security-tx-step",
    autoSign: "ludo-security-auto-sign",
} as const;

type Snapshot = {
    bootLock: boolean;
    txStepUp: TxStepUpMode;
    autoSign: boolean;
};

let cache: Snapshot | null = null;
const listeners = new Set<() => void>();

function readSnapshot(): Snapshot {
    if (cache) return cache;
    try {
        cache = {
            // Boot lock default ON — only relaxed if the user turns it off.
            bootLock: localStorage.getItem(KEYS.bootLock) !== "0",
            txStepUp: localStorage.getItem(KEYS.txStepUp) === "confirm" ? "confirm" : "strict",
            autoSign: localStorage.getItem(KEYS.autoSign) !== "0",
        };
    } catch {
        cache = { bootLock: true, txStepUp: "strict", autoSign: true };
    }
    return cache;
}

function emit() {
    cache = null;
    listeners.forEach((l) => l());
}

function subscribe(fn: () => void) {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

export function useSecurityPrefs() {
    const snap = useSyncExternalStore(
        subscribe,
        () => readSnapshot(),
        () => readSnapshot(),
    );

    const setBootLock = useCallback((on: boolean) => {
        try {
            localStorage.setItem(KEYS.bootLock, on ? "1" : "0");
        } catch {
            /* ignore */
        }
        emit();
    }, []);

    const setTxStepUp = useCallback((mode: TxStepUpMode) => {
        try {
            localStorage.setItem(KEYS.txStepUp, mode === "confirm" ? "confirm" : "strict");
        } catch {
            /* ignore */
        }
        emit();
    }, []);

    const setAutoSign = useCallback((on: boolean) => {
        try {
            localStorage.setItem(KEYS.autoSign, on ? "1" : "0");
        } catch {
            /* ignore */
        }
        emit();
    }, []);

    return {
        bootLock: snap.bootLock,
        txStepUp: snap.txStepUp,
        autoSign: snap.autoSign,
        setBootLock,
        setTxStepUp,
        setAutoSign,
    };
}

/** Non-hook read (server / one-shot). Defaults strict. */
export function readSecurityPrefs(): Snapshot {
    return readSnapshot();
}
