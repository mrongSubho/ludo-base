/**
 * G2 — local room / pass-and-play helpers.
 * One-device hot-seat + share-link room (`?s=` room secret). No extra SDKs.
 */

export type PassPlaySeats = '1v1' | '2v2' | '4P';

export function seatCount(matchType: PassPlaySeats): number {
    return matchType === '1v1' ? 2 : 4;
}

export function passPlayLabels(matchType: PassPlaySeats): string[] {
    const n = seatCount(matchType);
    return Array.from({ length: n }, (_, i) => `Player ${i + 1}`);
}

/** Human-readable turn handoff copy for hot-seat. */
export function passToCopy(nextName: string): string {
    return `Pass the device to ${nextName}`;
}

export function buildLocalShareUrl(opts: {
    roomCode: string;
    roomSecret?: string | null;
    seat?: number;
    origin?: string;
}): string {
    const origin =
        opts.origin ??
        (typeof window !== 'undefined' ? window.location.origin : 'https://ludo-base.vercel.app');
    const params = new URLSearchParams({ room: opts.roomCode });
    if (opts.roomSecret) params.set('s', opts.roomSecret);
    if (typeof opts.seat === 'number') params.set('seat', String(opts.seat));
    return `${origin}/?${params.toString()}`;
}

export async function copyLocalShareUrl(opts: {
    roomCode: string;
    roomSecret?: string | null;
    seat?: number;
}): Promise<{ ok: boolean; url: string }> {
    const url = buildLocalShareUrl(opts);
    try {
        if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(url);
            return { ok: true, url };
        }
    } catch {
        /* fall through */
    }
    return { ok: false, url };
}

/**
 * Seat labels for hot-seat mode — all humans, no AI.
 * Used when OfflineMatchPanel starts Pass & Play.
 */
export function buildPassPlayRoster(matchType: PassPlaySeats): Array<{ name: string; isAi: false }> {
    return passPlayLabels(matchType).map((name) => ({ name, isAi: false as const }));
}
