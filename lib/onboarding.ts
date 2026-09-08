'use client';

// ─── First-run state: ToS consent + onboarding ──────────────────────────────
// Device-level keys (theme + token style are device-local prefs, so the
// first-run flow is per device): guests and wallets share them.

const TOS_KEY = 'ludo-tos-accepted-v1';
const ONBOARDED_KEY = 'ludo-onboarded-v1';

function read(key: string): boolean {
    try {
        return localStorage.getItem(key) === '1';
    } catch {
        return false;
    }
}

function write(key: string): void {
    try {
        localStorage.setItem(key, '1');
    } catch {
        /* storage unavailable — flows just re-ask next launch */
    }
}

/** Has this device accepted the Terms + Privacy Policy? */
export function hasAcceptedTos(): boolean {
    return read(TOS_KEY);
}

/** Persist ToS + Privacy acceptance for this device. */
export function acceptTos(): void {
    write(TOS_KEY);
}

/** Has this device completed the first-run setup (theme, …)? */
export function hasOnboarded(): boolean {
    return read(ONBOARDED_KEY);
}

/** Persist first-run setup completion for this device. */
export function completeOnboarding(): void {
    write(ONBOARDED_KEY);
}
