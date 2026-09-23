/**
 * E6 stable game-state digest for replays and host/guest diffs.
 * Ignores ephemeral UI fields (timers, rolling flags, peer maps).
 */

import type {
    AfkPlayerStats,
    ColorCorner,
    GameState,
    MatchCaptureStats,
    PlayerColor,
    PowerItem,
    PowerTile,
    PowerTilePublic,
} from '../types';

const COLORS: PlayerColor[] = ['green', 'red', 'yellow', 'blue'];

/** Deterministic JSON with sorted object keys. */
export function stableStringify(value: unknown): string {
    return JSON.stringify(normalize(value));
}

function normalize(value: unknown): unknown {
    if (value === null || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(normalize);
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(src).sort()) {
        const v = src[key];
        if (v === undefined) continue;
        out[key] = normalize(v);
    }
    return out;
}

/** FNV-1a 64-bit (two 32-bit lanes) as 16-char hex — isomorphic, no crypto async. */
export function hashString(input: string): string {
    let h1 = 0x811c9dc5;
    let h2 = 0xcbf29ce4;
    for (let i = 0; i < input.length; i++) {
        const c = input.charCodeAt(i);
        h1 ^= c;
        h1 = Math.imul(h1, 0x01000193) >>> 0;
        h2 ^= (c + i) & 0xff;
        h2 = Math.imul(h2, 0x01000193) >>> 0;
    }
    return (h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0'));
}

/** Rules-relevant projection of GameState (excludes timers, isRolling, peers, lastUpdate). */
export function gameStateDigest(state: GameState): Record<string, unknown> {
    const positions: Record<string, number[]> = {};
    for (const color of COLORS) {
        positions[color] = [...(state.positions[color] ?? [])];
    }

    const powerTiles = (state.powerTiles ?? []).map((t: PowerTile | PowerTilePublic) => ({
        r: t.r,
        c: t.c,
        // type is authority-only; include only when present so wire/authority hashes differ intentionally
        ...(('type' in t && t.type) ? { type: (t as PowerTile).type } : {}),
    })).sort((a, b) => a.r - b.r || a.c - b.c);

    const playerPowers: Record<string, string[]> = {};
    for (const color of COLORS) {
        const items = (state.playerPowers?.[color] ?? []) as PowerItem[];
        playerPowers[color] = items.map((p) => p.type).sort();
    }

    const strikes: Record<string, number> = {};
    const afk: Record<string, Pick<AfkPlayerStats, 'isKicked' | 'consecutiveTurns'>> = {};
    for (const color of COLORS) {
        strikes[color] = state.strikes?.[color] ?? 0;
        afk[color] = {
            isKicked: state.afkStats?.[color]?.isKicked ?? false,
            consecutiveTurns: state.afkStats?.[color]?.consecutiveTurns ?? 0,
        };
    }

    const matchStats = state.matchStats as MatchCaptureStats | undefined;
    const stats: Record<string, { kicks: number; gotKicked: number }> = {};
    for (const color of COLORS) {
        stats[color] = {
            kicks: matchStats?.[color]?.kicks ?? 0,
            gotKicked: matchStats?.[color]?.gotKicked ?? 0,
        };
    }

    const traps = [...(state.activeTraps ?? [])]
        .map((t) => ({ r: t.r, c: t.c, owner: t.owner }))
        .sort((a, b) => a.r - b.r || a.c - b.c);
    const shields = [...(state.activeShields ?? [])]
        .map((s) => ({ color: s.color, tokenIdx: s.tokenIdx }))
        .sort((a, b) => COLORS.indexOf(a.color) - COLORS.indexOf(b.color) || a.tokenIdx - b.tokenIdx);

    const corners = state.initialBoardConfig?.colorCorner as ColorCorner | undefined;

    return {
        positions,
        currentPlayer: state.currentPlayer,
        diceValue: state.diceValue ?? null,
        gamePhase: state.gamePhase,
        status: state.status,
        winner: state.winner ?? null,
        winners: [...(state.winners ?? [])],
        strikes,
        powerTiles,
        playerPowers,
        powerSpentThisTurn: !!state.powerSpentThisTurn,
        activeBoost: state.activeBoost ?? null,
        activeTraps: traps,
        activeShields: shields,
        consecutiveSixes: state.consecutiveSixes ?? 0,
        matchStats: stats,
        isStarted: !!state.isStarted,
        playerCount: state.playerCount,
        lastRollId: state.lastRollId ?? null,
        colorCorner: corners
            ? {
                green: corners.green,
                red: corners.red,
                yellow: corners.yellow,
                blue: corners.blue,
            }
            : null,
    };
}

export function hashGameState(state: GameState): string {
    return hashString(stableStringify(gameStateDigest(state)));
}
