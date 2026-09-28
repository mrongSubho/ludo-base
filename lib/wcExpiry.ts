/**
 * WC session expiry helpers — live countdown for WalletConnect sessions.
 * Expiry is unix seconds (WC spec).
 */

export type ExpiryParts = {
    expired: boolean;
    totalMs: number;
    days: number;
    hours: number;
    minutes: number;
    seconds: number;
    /** Compact human string: "2d 4h" / "12m 3s" / "expired". */
    label: string;
    /** true when < 1 hour remains (UI: amber). */
    urgent: boolean;
};

export function sessionExpiryParts(expiryUnix: number | undefined, nowMs: number = Date.now()): ExpiryParts | null {
    if (expiryUnix == null || !Number.isFinite(expiryUnix)) return null;
    const totalMs = expiryUnix * 1000 - nowMs;
    const expired = totalMs <= 0;
    const abs = Math.max(0, totalMs);
    const days = Math.floor(abs / 86_400_000);
    const hours = Math.floor((abs % 86_400_000) / 3_600_000);
    const minutes = Math.floor((abs % 3_600_000) / 60_000);
    const seconds = Math.floor((abs % 60_000) / 1000);

    let label: string;
    if (expired) label = "expired";
    else if (days > 0) label = `${days}d ${hours}h`;
    else if (hours > 0) label = `${hours}h ${minutes}m`;
    else if (minutes > 0) label = `${minutes}m ${seconds}s`;
    else label = `${seconds}s`;

    return {
        expired,
        totalMs,
        days,
        hours,
        minutes,
        seconds,
        label,
        urgent: !expired && totalMs < 3_600_000,
    };
}

/** Wall-clock fallback when a session has no expiry field. */
export function formatExpiryClock(expiryUnix: number): string {
    return new Date(expiryUnix * 1000).toLocaleString();
}
