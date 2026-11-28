import { stripPowerTypesForWire } from './engine/core';

/**
 * Wire sanitizers — never leak authority-only fields to guests/spectators.
 * Masks hidden power tiles, respawn seed, opponent hands, forfeited wallets,
 * kicked seat records, opponent/spectator AFK state, and bot phase hints.
 */
export function sanitizeGameStateForWire<
    T extends {
        powerTiles?: { r: number; c: number; type?: unknown }[];
        playerPowers?: Partial<Record<string, { type?: unknown; expiresAt?: number }[]>>;
        powerTileSeed?: unknown;
        afkStats?: Partial<Record<string, object | null | undefined>>;
        forfeitedWallets?: unknown;
        kickedSeats?: unknown;
        turnPhaseKind?: string | null;
        currentPlayer?: string;
    }
>(state: T, viewerColor?: string, actingColorHint?: string): T {
    return stripPowerTypesForWire(state, viewerColor, actingColorHint);
}
