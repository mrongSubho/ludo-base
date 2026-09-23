/**
 * Q6 — Edge deploy/data ops helpers.
 * Version tags every Edge response; client checks for stale builds.
 */

/** Bump on each Edge function deploy (keep in lockstep with CI tag). */
export const EDGE_API_VERSION = '2026-09-23.1';

export const EDGE_VERSION_HEADER = 'x-ludo-edge-version';

export type VersionCheckResult =
    | { ok: true }
    | { ok: false; reason: 'MISSING' | 'STALE' | 'MISMATCH'; client?: string; server: string };

/**
 * Client→function version check. Fails closed on STALE/MISMATCH when `strict`.
 * In non-strict mode, callers should surface a notice (G4) and retry.
 */
export function checkEdgeVersion(
    serverVersion: string | null | undefined,
    clientVersion: string = EDGE_API_VERSION,
    opts: { strict?: boolean } = {}
): VersionCheckResult {
    if (!serverVersion) {
        return opts.strict === false
            ? { ok: true }
            : { ok: false, reason: 'MISSING', server: '' };
    }
    if (serverVersion === clientVersion) return { ok: true };
    const stale = serverVersion < clientVersion;
    return {
        ok: false,
        reason: stale ? 'STALE' : 'MISMATCH',
        client: clientVersion,
        server: serverVersion,
    };
}

/** Monotonic-ish compare for calver `YYYY-MM-DD.N` strings. */
export function compareEdgeVersion(a: string, b: string): number {
    return a < b ? -1 : a > b ? 1 : 0;
}

/** Realtime load budget (Q6 targets — see docs/ops/DEPLOY_OPS.md). */
export const REALTIME_LOAD_TARGETS = {
    /** rooms in flight */
    maxRooms: 200,
    /** players per room */
    maxPlayersPerRoom: 4,
    /** broadcast messages per room per second (steady) */
    maxMsgPerRoomPerSec: 8,
    /** degraded mode: drop non-essential (emotes, presence) first */
    degradedDropOrder: ['emote', 'presence', 'lobby_sync', 'intent', 'action'] as const,
} as const;

export function shouldDegrade(load: {
    rooms: number;
    msgPerRoomPerSec: number;
}): { degrade: boolean; dropFirst?: string } {
    const t = REALTIME_LOAD_TARGETS;
    if (load.rooms > t.maxRooms || load.msgPerRoomPerSec > t.maxMsgPerRoomPerSec) {
        return { degrade: true, dropFirst: t.degradedDropOrder[0] };
    }
    return { degrade: false };
}
