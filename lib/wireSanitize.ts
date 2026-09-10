/**
 * Wire sanitizers — never leak authority-only fields to guests/spectators.
 */

/** Strip hidden power-tile types before any network send. */
export function sanitizeGameStateForWire<
    T extends { powerTiles?: { r: number; c: number; type?: unknown }[] }
>(state: T): T {
    if (!state?.powerTiles?.length) return state;
    return {
        ...state,
        powerTiles: state.powerTiles.map(t => ({ r: t.r, c: t.c })),
    };
}
