/**
 * Wire sanitizers — never leak authority-only fields to guests/spectators.
 */

/** Strip hidden power-tile types, seed, and opponent held powers before any network send. */
export function sanitizeGameStateForWire<
    T extends {
        powerTiles?: { r: number; c: number; type?: unknown }[];
        playerPowers?: Partial<Record<string, { type?: unknown; expiresAt?: number }[]>>;
        powerTileSeed?: unknown;
    }
>(state: T, viewerColor?: string): T {
    if (!state) return state;
    let res = state;
    if ('powerTileSeed' in res && res.powerTileSeed !== undefined) {
        const withoutSeed = { ...(res as Record<string, unknown>) };
        delete withoutSeed.powerTileSeed;
        res = withoutSeed as T;
    }
    if (state.powerTiles?.length) {
        res = {
            ...res,
            powerTiles: state.powerTiles.map(t => ({ r: t.r, c: t.c })),
        };
    }
    if (state.playerPowers) {
        const maskedPowers: Record<string, { type?: unknown; expiresAt?: number }[]> = {};
        for (const [color, items] of Object.entries(state.playerPowers)) {
            if (viewerColor && color === viewerColor) {
                maskedPowers[color] = items || [];
            } else {
                // PW-2 / PW-1: redact opponent power types so opponent hands are not broadcast in plaintext
                maskedPowers[color] = (items || []).map(p => ({
                    ...p,
                    type: undefined,
                }));
            }
        }
        res = {
            ...res,
            playerPowers: maskedPowers,
        };
    }
    return res;
}
