"use client";

/**
 * Post-create onboarding state (SMART_WALLET_PLANNING §5).
 * Tracks first-time vs returning in-game wallets on this device.
 * No private-key surface at create — export stays in Security.
 */

const READY_KEY = "ludo-ingame-onboarded-v1";
const PROTECT_KEY = "ludo-ingame-protect-nudged-v1";
const THEME_KEY = "ludo-theme-nudge-v1";

export function markWalletCreated(address: string): void {
    try {
        const a = address.toLowerCase();
        localStorage.setItem(READY_KEY, a);
    } catch {
        /* private mode */
    }
}

/** True when this device has already seen the “wallet ready” step for this address. */
export function hasSeenWalletReady(address: string | undefined): boolean {
    if (!address) return false;
    try {
        return localStorage.getItem(READY_KEY) === address.toLowerCase();
    } catch {
        return false;
    }
}

export function markProtectNudged(address: string): void {
    try {
        localStorage.setItem(PROTECT_KEY, address.toLowerCase());
    } catch {
        /* private mode */
    }
}

export function hasSeenProtectNudge(address: string | undefined): boolean {
    if (!address) return false;
    try {
        return localStorage.getItem(PROTECT_KEY) === address.toLowerCase();
    } catch {
        return false;
    }
}

export function markThemeNudged(): void {
    try {
        localStorage.setItem(THEME_KEY, "1");
    } catch {
        /* private mode */
    }
}

export function hasSeenThemeNudge(): boolean {
    try {
        return localStorage.getItem(THEME_KEY) === "1";
    } catch {
        return false;
    }
}

/** Ladder state for the lobby chip: Wallet → Protect → Play. */
export type LadderState = {
    wallet: boolean;
    protect: boolean;
    play: boolean;
};

export function readLadder(address: string | undefined, hasPasskey: boolean): LadderState {
    return {
        wallet: hasSeenWalletReady(address),
        protect: hasPasskey || hasSeenProtectNudge(address),
        play: false,
    };
}
