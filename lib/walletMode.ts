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
 * Resolve the **active** wallet from live connection state.
 * Stored mode is only a preference / tiebreaker — live sources always win,
 * so users never have to hand-switch modes when one side lapses.
 *
 * - Preferred source live → it (no surprise switches).
 * - Preferred dead, other live → the live one (automatic failover).
 * - Both live → stored preference, default in-game.
 * - Neither live → null (signed out — prompt to connect, not a fake mode).
 */
export function resolveActiveMode(
    stored: WalletMode | null,
    lives: { ingame: boolean; external: boolean },
): WalletMode | null {
    if (stored === "ingame" && lives.ingame) return "ingame";
    if (stored === "external" && lives.external) return "external";
    if (lives.ingame && lives.external) return stored ?? "ingame";
    if (lives.ingame) return "ingame";
    if (lives.external) return "external";
    return null;
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
