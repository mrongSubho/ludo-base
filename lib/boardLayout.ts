import { PlayerColor } from '../hooks/MultiplayerContext';

export type Point = { r: number; c: number };

export type CellType = 'path' | 'home-lane' | 'home-base' | 'finish' | 'safe' | 'empty';

export interface PathCell {
    row: number;
    col: number;
    cls: string;
}

export type Corner = 'BL' | 'TR' | 'BR' | 'TL';
export type ColorCorner = Record<PlayerColor, Corner>;

// ─── Path Constants ──────────────────────────────────────────────────────────

/**
 * Programmatically generates the 52-cell shared perimeter path.
 * This starts from the standard 'Green' entry point (r: 6, c: 7) and follows
 * the clock-wise flow around the 15x15 grid.
 */
export const SHARED_PATH: Point[] = [
    // Top-Middle column 7 (bottom to top: r 6->1)
    { r: 6, c: 7 }, { r: 5, c: 7 }, { r: 4, c: 7 }, { r: 3, c: 7 }, { r: 2, c: 7 }, { r: 1, c: 7 },
    // Top crossover (r 1, c 8->9)
    { r: 1, c: 8 }, { r: 1, c: 9 },
    // Top-Middle column 9 (top to bottom: r 2->6)
    { r: 2, c: 9 }, { r: 3, c: 9 }, { r: 4, c: 9 }, { r: 5, c: 9 }, { r: 6, c: 9 },
    // Right-Middle row 7 (left to right: c 10->15)
    { r: 7, c: 10 }, { r: 7, c: 11 }, { r: 7, c: 12 }, { r: 7, c: 13 }, { r: 7, c: 14 }, { r: 7, c: 15 },
    // Right crossover (r 8->9, c 15)
    { r: 8, c: 15 }, { r: 9, c: 15 },
    // Right-Middle row 9 (right to left: c 14->10)
    { r: 9, c: 14 }, { r: 9, c: 13 }, { r: 9, c: 12 }, { r: 9, c: 11 }, { r: 9, c: 10 },
    // Bottom-Middle column 9 (top to bottom: r 10->15)
    { r: 10, c: 9 }, { r: 11, c: 9 }, { r: 12, c: 9 }, { r: 13, c: 9 }, { r: 14, c: 9 }, { r: 15, c: 9 },
    // Bottom crossover (r 15, c 8->7)
    { r: 15, c: 8 }, { r: 15, c: 7 },
    // Bottom-Middle column 7 (bottom to top: r 14->10)
    { r: 14, c: 7 }, { r: 13, c: 7 }, { r: 12, c: 7 }, { r: 11, c: 7 }, { r: 10, c: 7 },
    // Left-Middle row 9 (right to left: c 6->1)
    { r: 9, c: 6 }, { r: 9, c: 5 }, { r: 9, c: 4 }, { r: 9, c: 3 }, { r: 9, c: 2 }, { r: 9, c: 1 },
    // Left crossover (r 8->7, c 1)
    { r: 8, c: 1 }, { r: 7, c: 1 },
    // Left-Middle row 7 (left to right: c 2->6)
    { r: 7, c: 2 }, { r: 7, c: 3 }, { r: 7, c: 4 }, { r: 7, c: 5 }, { r: 7, c: 6 },
];

// Helper to shift the shared path for each player's start point
export const rotatePath = (points: Point[], startIndex: number): Point[] => {
    return [...points.slice(startIndex), ...points.slice(0, startIndex)];
};

// ─── Corner Slot Definitions (fixed by board geometry) ──────────────────────

export const CORNER_SLOTS: Record<Corner, {
    startIdx: number;
    homeCells: Point[];
    finishCell: Point;
    gridRow: string;
    gridCol: string;
    arrowDir: 'up' | 'down' | 'left' | 'right';
    arrowCell: Point;
    startCell: Point;
}> = {
    BL: {
        startIdx: 34,
        homeCells: [{ r: 14, c: 8 }, { r: 13, c: 8 }, { r: 12, c: 8 }, { r: 11, c: 8 }, { r: 10, c: 8 }],
        finishCell: { r: 9, c: 8 },
        gridRow: '10 / 16', gridCol: '1 / 7',
        arrowDir: 'up', arrowCell: { r: 14, c: 8 },
        startCell: { r: 14, c: 7 },
    },
    TR: {
        startIdx: 8,
        homeCells: [{ r: 2, c: 8 }, { r: 3, c: 8 }, { r: 4, c: 8 }, { r: 5, c: 8 }, { r: 6, c: 8 }],
        finishCell: { r: 7, c: 8 },
        gridRow: '1 / 7', gridCol: '10 / 16',
        arrowDir: 'down', arrowCell: { r: 2, c: 8 },
        startCell: { r: 2, c: 9 },
    },
    BR: {
        startIdx: 21,
        homeCells: [{ r: 8, c: 14 }, { r: 8, c: 13 }, { r: 8, c: 12 }, { r: 8, c: 11 }, { r: 8, c: 10 }],
        finishCell: { r: 8, c: 9 },
        gridRow: '10 / 16', gridCol: '10 / 16',
        arrowDir: 'left', arrowCell: { r: 8, c: 14 },
        startCell: { r: 9, c: 14 },
    },
    TL: {
        startIdx: 47,
        homeCells: [{ r: 8, c: 2 }, { r: 8, c: 3 }, { r: 8, c: 4 }, { r: 8, c: 5 }, { r: 8, c: 6 }],
        finishCell: { r: 8, c: 7 },
        gridRow: '1 / 7', gridCol: '1 / 7',
        arrowDir: 'right', arrowCell: { r: 8, c: 2 },
        startCell: { r: 7, c: 2 },
    },
};

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

export function cornerToColor(cc: ColorCorner): Record<Corner, PlayerColor> {
    const inv = {} as Record<Corner, PlayerColor>;
    (Object.entries(cc) as [PlayerColor, Corner][]).forEach(([color, corner]) => {
        inv[corner] = color;
    });
    return inv;
}

export const SAFE_POSITIONS: Point[] = [
    { r: 7, c: 2 }, { r: 2, c: 9 }, { r: 9, c: 14 }, { r: 14, c: 7 },
    { r: 3, c: 7 }, { r: 7, c: 13 }, { r: 13, c: 9 }, { r: 9, c: 3 },
];

/**
 * Returns detailed information about a grid cell at (r, c).
 * This is the central source of truth for board geometry.
 */
export function getGridCellInfo(r: number, c: number, cc: ColorCorner) {
    const inv = cornerToColor(cc);

    const inVert = c >= 7 && c <= 9;
    const inHoriz = r >= 7 && r <= 9;
    const isHomeBase =
        (r <= 6 && c <= 6) ||
        (r <= 6 && c >= 10) ||
        (r >= 10 && c <= 6) ||
        (r >= 10 && c >= 10);
    const isCenter = inVert && inHoriz;

    if (isHomeBase) return { type: 'home-base' as CellType };
    if (isCenter) return { type: 'finish' as CellType };
    if (!inVert && !inHoriz) return { type: 'empty' as CellType };

    // Path or Home Lane
    let type: CellType = 'path';
    let color: PlayerColor | null = null;

    // Home Lane logic
    if (c === 8 && r >= 2 && r <= 6) { type = 'home-lane'; color = inv['TR']; }
    else if (r === 8 && c >= 10 && c <= 14) { type = 'home-lane'; color = inv['BR']; }
    else if (c === 8 && r >= 10 && r <= 14) { type = 'home-lane'; color = inv['BL']; }
    else if (r === 8 && c >= 2 && c <= 6) { type = 'home-lane'; color = inv['TL']; }

    // Safe cell logic
    const isSafe = SAFE_POSITIONS.some(p => p.r === r && p.c === c);
    if (isSafe && type === 'path') type = 'safe';

    return { type, color };
}

export function buildPathCellsDynamic(cc: ColorCorner): PathCell[] {
    const cells: PathCell[] = [];

    for (let r = 1; r <= 15; r++) {
        for (let c = 1; c <= 15; c++) {
            const info = getGridCellInfo(r, c, cc);

            if (info.type === 'home-base' || info.type === 'finish' || info.type === 'empty') {
                continue;
            }

            let cls = 'board-cell';
            if (info.type === 'home-lane') cls += ` lane-${info.color}`;
            if (info.type === 'safe') cls += ' star-cell';

            cells.push({ row: r, col: c, cls });
        }
    }
    return cells;
}

export const PLAYER_TEMPLATES = [
    { name: 'Alex', level: 12, avatar: '🎮', isAi: false },
    { name: 'Gemini', level: 8, avatar: '🤖', isAi: true },
    { name: 'Sarah', level: 15, avatar: '⭐', isAi: false },
    { name: 'Mike', level: 5, avatar: '🎯', isAi: false },
    { name: 'Nexus', level: 20, avatar: '⚡', isAi: true },
    { name: 'Emma', level: 10, avatar: '🦊', isAi: false },
];

export function shufflePlayers(countMode: '1v1' | '4P' | '2v2', isBotMatch: boolean): any[] {
    const seats = ['bottom-left', 'top-left', 'top-right', 'bottom-right'] as const;
    const colors = ['green', 'red', 'blue', 'yellow'] as const;

    const numPlayers = countMode === '1v1' ? 2 : 4;

    const selected = [...PLAYER_TEMPLATES]
        .sort(() => Math.random() - 0.5)
        .slice(0, numPlayers);

    if (isBotMatch) {
        selected.forEach(p => {
            if (p.name !== 'Alex') p.isAi = true;
        });
    }

    return selected.map((p, i) => ({
        ...p,
        position: seats[i],
        color: colors[i],
    }));
}
