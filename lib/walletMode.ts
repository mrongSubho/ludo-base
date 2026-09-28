/**
 * Wallet mode for dual-path (SMART_WALLET_PLANNING.md).
 * 'external' — Base / MM / Phantom (wagmi)
 * 'ingame'   — CDP Smart Account (in-game wallet)
 */

export type WalletMode = "external" | "ingame";

const KEY = "ludo-wallet-mode";
const EVENT = "ludo-wallet-mode-change";

export function isWalletMode(v: unknown): v is WalletMode {
    return v === "external" || v === "ingame";
}

export function readWalletMode(): WalletMode | null {
    try {
        const raw = localStorage.getItem(KEY);
        return isWalletMode(raw) ? raw : null;
    } catch {
        return null;
    }
}

export function writeWalletMode(mode: WalletMode | null): void {
    try {
        if (mode) localStorage.setItem(KEY, mode);
        else localStorage.removeItem(KEY);
    } catch {
        /* best-effort */
    }
    window.dispatchEvent(new CustomEvent(EVENT, { detail: mode }));
}

export function subscribeWalletMode(fn: () => void): () => void {
    window.addEventListener(EVENT, fn);
    return () => window.removeEventListener(EVENT, fn);
}

/** Gate CTA visibility — in-game only when explicitly enabled. */
export function isInGameWalletEnabled(): boolean {
    return process.env.NEXT_PUBLIC_WALLET_INGAME === "1";
}
