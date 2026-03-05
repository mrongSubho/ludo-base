import { PlayerColor } from '../hooks/MultiplayerContext';

export type Point = { r: number; c: number };

export interface PathCell {
    row: number;
    col: number;
    cls: string;
}

export type Corner = 'BL' | 'TR' | 'BR' | 'TL';
export type ColorCorner = Record<PlayerColor, Corner>;

// ─── Path Constants ──────────────────────────────────────────────────────────

// Shared perimeter path (52 cells)
export const SHARED_PATH: Point[] = [
    // Top-Middle column 7 (bottom to top)
    { r: 6, c: 7 }, { r: 5, c: 7 }, { r: 4, c: 7 }, { r: 3, c: 7 }, { r: 2, c: 7 }, { r: 1, c: 7 },
    { r: 1, c: 8 }, { r: 1, c: 9 }, // Top edge
    { r: 2, c: 9 }, { r: 3, c: 9 }, { r: 4, c: 9 }, { r: 5, c: 9 }, { r: 6, c: 9 }, // Top-Middle column 9 (top to bottom)
    { r: 7, c: 10 }, { r: 7, c: 11 }, { r: 7, c: 12 }, { r: 7, c: 13 }, { r: 7, c: 14 }, { r: 7, c: 15 }, // Right-Middle row 7 (left to right)
    { r: 8, c: 15 }, { r: 9, c: 15 }, // Right edge
    { r: 9, c: 14 }, { r: 9, c: 13 }, { r: 9, c: 12 }, { r: 9, c: 11 }, { r: 9, c: 10 }, // Right-Middle row 9 (right to left)
    { r: 10, c: 9 }, { r: 11, c: 9 }, { r: 12, c: 9 }, { r: 13, c: 9 }, { r: 14, c: 9 }, { r: 15, c: 9 }, // Bottom-Middle column 9 (top to bottom)
    { r: 15, c: 8 }, { r: 15, c: 7 }, // Bottom edge
    { r: 14, c: 7 }, { r: 13, c: 7 }, { r: 12, c: 7 }, { r: 11, c: 7 }, { r: 10, c: 7 }, // Bottom-Middle column 7 (bottom to top)
    { r: 9, c: 6 }, { r: 9, c: 5 }, { r: 9, c: 4 }, { r: 9, c: 3 }, { r: 9, c: 2 }, { r: 9, c: 1 }, // Left-Middle row 9 (right to left)
    { r: 8, c: 1 }, { r: 7, c: 1 }, // Left edge
    { r: 7, c: 2 }, { r: 7, c: 3 }, { r: 7, c: 4 }, { r: 7, c: 5 }, { r: 7, c: 6 }, // Left-Middle row 7 (left to right)
];

// Helper to shift the shared path for each player's start point
export const rotatePath = (points: Point[], startIndex: number): Point[] => {
    return [...points.slice(startIndex), ...points.slice(0, startIndex)];
};

// ─── Corner Slot Definitions (fixed by board geometry) ──────────────────────
// Each physical corner has a fixed start index, home lane, grid area, and lane key.

export const CORNER_SLOTS: Record<Corner, {
    startIdx: number;
    homeCells: Point[];
    finishCell: Point;
    gridRow: string;
    gridCol: string;
    arrowDir: 'up' | 'down' | 'left' | 'right';
    arrowCell: Point;
}> = {
    BL: {
        startIdx: 34,
        homeCells: [{ r: 14, c: 8 }, { r: 13, c: 8 }, { r: 12, c: 8 }, { r: 11, c: 8 }, { r: 10, c: 8 }],
        finishCell: { r: 9, c: 8 },
        gridRow: '10 / 16', gridCol: '1 / 7',
        arrowDir: 'up', arrowCell: { r: 14, c: 8 },
    },
    TR: {
        startIdx: 8,
        homeCells: [{ r: 2, c: 8 }, { r: 3, c: 8 }, { r: 4, c: 8 }, { r: 5, c: 8 }, { r: 6, c: 8 }],
        finishCell: { r: 7, c: 8 },
        gridRow: '1 / 7', gridCol: '10 / 16',
        arrowDir: 'down', arrowCell: { r: 2, c: 8 },
    },
    BR: {
        startIdx: 21,
        homeCells: [{ r: 8, c: 14 }, { r: 8, c: 13 }, { r: 8, c: 12 }, { r: 8, c: 11 }, { r: 8, c: 10 }],
        finishCell: { r: 8, c: 9 },
        gridRow: '10 / 16', gridCol: '10 / 16',
        arrowDir: 'left', arrowCell: { r: 8, c: 14 },
    },
    TL: {
        startIdx: 47,
        homeCells: [{ r: 8, c: 2 }, { r: 8, c: 3 }, { r: 8, c: 4 }, { r: 8, c: 5 }, { r: 8, c: 6 }],
        finishCell: { r: 8, c: 7 },
        gridRow: '1 / 7', gridCol: '1 / 7',
        arrowDir: 'right', arrowCell: { r: 8, c: 2 },
    },
};

// The 4 valid arrangements: green↔blue always share one diagonal, red↔yellow the other.
export const VALID_COLOR_ARRANGEMENTS: ColorCorner[] = [
    { green: 'BL', blue: 'TR', red: 'BR', yellow: 'TL' }, // A (default)
    { green: 'TR', blue: 'BL', red: 'BR', yellow: 'TL' }, // B (swap green/blue)
    { green: 'BL', blue: 'TR', red: 'TL', yellow: 'BR' }, // C (swap red/yellow)
    { green: 'TR', blue: 'BL', red: 'TL', yellow: 'BR' }, // D (swap both)
];

export function shuffleColorCorner(): ColorCorner {
    return VALID_COLOR_ARRANGEMENTS[Math.floor(Math.random() * 4)];
}

export function buildPlayerPaths(cc: ColorCorner): Record<string, Point[]> {
    const paths: Record<string, Point[]> = {};
    (['green', 'red', 'yellow', 'blue'] as PlayerColor[]).forEach(color => {
        const slot = CORNER_SLOTS[cc[color]];
        paths[color] = [
            ...rotatePath(SHARED_PATH, slot.startIdx),
            ...slot.homeCells,
            slot.finishCell,
        ];
    });
    return paths;
}

// Inverse map: corner → color (for lane/arrow rendering)
export function cornerToColor(cc: ColorCorner): Record<Corner, PlayerColor> {
    const inv = {} as Record<Corner, PlayerColor>;
    (Object.entries(cc) as [PlayerColor, Corner][]).forEach(([color, corner]) => {
        inv[corner] = color;
    });
    return inv;
}

// Keep SAFE_POSITIONS BEFORE buildPathCellsDynamic so it's in scope when called
export const SAFE_POSITIONS: Point[] = [
    { r: 7, c: 2 }, { r: 2, c: 9 }, { r: 9, c: 14 }, { r: 14, c: 7 },
    { r: 3, c: 7 }, { r: 7, c: 13 }, { r: 13, c: 9 }, { r: 9, c: 3 },
];

export const PLAYER_TEMPLATES = [
    { name: 'Alex', level: 12, avatar: '🎮', isAi: false },
    { name: 'Gemini', level: 8, avatar: '🤖', isAi: true },
    { name: 'Sarah', level: 15, avatar: '⭐', isAi: false },
    { name: 'Mike', level: 5, avatar: '🎯', isAi: false },
    { name: 'Nexus', level: 20, avatar: '⚡', isAi: true },
    { name: 'Emma', level: 10, avatar: '🦊', isAi: false },
];

export function shufflePlayers(countMode: '1v1' | '4P' | '2v2', isBotMatch: boolean): any[] {
    const seats = ['bottom-left', 'top-left', 'top-right', 'bottom-right'];
    const colors = ['green', 'red', 'blue', 'yellow'];

    // For 1v1, only use 2 players
    const numPlayers = countMode === '1v1' ? 2 : 4;

    const selected = [...PLAYER_TEMPLATES]
        .sort(() => Math.random() - 0.5)
        .slice(0, numPlayers);

    // If bot match, force non-Alex players to be AI
    if (isBotMatch) {
        selected.forEach(p => {
            if (p.name !== 'Alex') p.isAi = true;
        });
    }

    return selected.map((p, i) => ({
        ...p,
        position: seats[i] as any,
        color: colors[i] as any,
    }));
}

export function buildPathCellsDynamic(cc: ColorCorner): PathCell[] {
    const inv = cornerToColor(cc);
    const cells: PathCell[] = [];

    for (let r = 1; r <= 15; r++) {
        for (let c = 1; c <= 15; c++) {
            const inVert = c >= 7 && c <= 9;
            const inHoriz = r >= 7 && r <= 9;
            const isHome =
                (r <= 6 && c <= 6) ||
                (r <= 6 && c >= 10) ||
                (r >= 10 && c <= 6) ||
                (r >= 10 && c >= 10);
            const isCenter = inVert && inHoriz;

            if ((inVert || inHoriz) && !isHome && !isCenter) {
                let cls = 'board-cell';

                // Lane coloring — driven by which color occupies each corner
                if (c === 8 && r >= 2 && r <= 6) cls += ` lane-${inv['TR']}`; // TR home lane
                else if (r === 8 && c >= 10 && c <= 14) cls += ` lane-${inv['BR']}`; // BR home lane
                else if (c === 8 && r >= 10 && r <= 14) cls += ` lane-${inv['BL']}`; // BL home lane
                else if (r === 8 && c >= 2 && c <= 6) cls += ` lane-${inv['TL']}`; // TL home lane

                if (SAFE_POSITIONS.some(p => p.r === r && p.c === c)) {
                    cls += ' star-cell';
                }

                cells.push({ row: r, col: c, cls });
            }
        }
    }
    return cells;
}
