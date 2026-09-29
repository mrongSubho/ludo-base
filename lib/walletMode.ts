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

/**
 * Gate CTA visibility for the in-game wallet.
 * On when explicitly `=1`, or when CDP is configured and the flag is not `=0`.
 * (Vercel often ships without NEXT_PUBLIC_WALLET_INGAME — don’t hide the row.)
 */
export function isInGameWalletEnabled(): boolean {
    const flag = process.env.NEXT_PUBLIC_WALLET_INGAME;
    if (flag === "1") return true;
    if (flag === "0") return false;
    return Boolean(process.env.NEXT_PUBLIC_CDP_PROJECT_ID);
}
