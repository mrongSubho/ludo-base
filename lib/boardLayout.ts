import { PlayerColor } from './types';

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

/** Two valid diagonal axes for 2v2. Each entry = [axis corners for pair1, axis corners for pair2] */
const DIAGONAL_AXES: [readonly [Corner, Corner], readonly [Corner, Corner]][] = [
    [['BL', 'TR'], ['BR', 'TL']],  // Axis A
    [['BR', 'TL'], ['BL', 'TR']],  // Axis B (swapped)
];

/**
 * 2v2 mode: Strict team pairings — Green+Blue vs Red+Yellow.
 * Teammates always land on diagonally opposite corners.
 * Which diagonal axis each team gets is randomized per match.
 */
export function assignCorners2v2(): ColorCorner {
    // Fixed team pairings per spec
    const teamGB: [PlayerColor, PlayerColor] = ['green', 'blue'];
    const teamRY: [PlayerColor, PlayerColor] = ['red', 'yellow'];

    // Pick a random diagonal axis
    const axis = DIAGONAL_AXES[Math.floor(Math.random() * 2)];
    // Randomly assign which team gets which diagonal axis
    const [axisGB, axisRY] = Math.random() < 0.5 ? [axis[0], axis[1]] : [axis[1], axis[0]];

    // Within each axis, randomly assign which teammate gets which corner
    const cc: Partial<ColorCorner> = {};
    const [gb0, gb1] = Math.random() < 0.5 ? axisGB : [axisGB[1], axisGB[0]];
    cc[teamGB[0]] = gb0;
    cc[teamGB[1]] = gb1;
    const [ry0, ry1] = Math.random() < 0.5 ? axisRY : [axisRY[1], axisRY[0]];
    cc[teamRY[0]] = ry0;
    cc[teamRY[1]] = ry1;

    return cc as ColorCorner;
}

/**
 * 1v1 / 4P free-for-all: Full Fisher-Yates shuffle of corners — no pairing constraints.
 */
export function assignCornersFFA(playerCount: '1v1' | '4P' = '4P'): ColorCorner {
    const cc: Partial<ColorCorner> = {};
    const allColors: PlayerColor[] = ['green', 'red', 'yellow', 'blue'];
    const corners: Corner[] = ['BL', 'BR', 'TR', 'TL'];

    if (playerCount === '1v1') {
        // For 1v1, we MUST ensure the two active players (first two in LOBBY_COLORS)
        // are diagonally opposite. We'll pick one axis randomly.
        const axis = Math.random() < 0.5 ? ['BL', 'TR'] : ['BR', 'TL'];
        const otherAxis = axis[0] === 'BL' ? ['BR', 'TL'] : ['BL', 'TR'];
        
        // Randomly assign the first two colors to the chosen axis
        const [c0, c1] = Math.random() < 0.5 ? axis : [axis[1], axis[0]];
        cc[allColors[0]] = c0 as Corner; // Host (Green)
        cc[allColors[2]] = c1 as Corner; // Guest (Yellow)
        
        // Assign remaining colors to the other axis
        const [c2, c3] = Math.random() < 0.5 ? otherAxis : [otherAxis[1], otherAxis[0]];
        cc[allColors[1]] = c2 as Corner; // Red
        cc[allColors[3]] = c3 as Corner; // Blue
    } else {
        // Fisher-Yates shuffle corners for 4P
        for (let i = corners.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [corners[i], corners[j]] = [corners[j], corners[i]];
        }
        // Assign all 4 colors to corners
        allColors.forEach((color, i) => { cc[color] = corners[i]; });
    }

    return cc as ColorCorner;
}

/** @deprecated Use assignCornersFFA() or assignCorners2v2() instead */
export function shuffleColorCorner(): ColorCorner {
    return assignCornersFFA();
}

export function buildPlayerPaths(cc: ColorCorner): Record<string, Point[]> {
    const paths: Record<string, Point[]> = {};
    (['green', 'red', 'yellow', 'blue'] as PlayerColor[]).forEach(color => {
        const corner = cc[color];
        if (!corner) return;

        const slot = CORNER_SLOTS[corner];
        paths[color] = [
            ...rotatePath(SHARED_PATH, slot.startIdx).slice(0, 51), // 0-50
            SHARED_PATH[(slot.startIdx + 50) % 52], // 51: The gate cell (shared path) - unused in old static logic but let's keep array padded if UI depends on it?
            // Wait, to make FINISH 57 and HOME 52-56, we need 58 cells total in this mapped array if we want 1:1 mapping for the UI.
            // Let's pad index 51. The UI expects local positions. 
            // The math engine calculates nextPos abstractly.
            // Actually, we'll return the full 58 size array so `paths[color][pos]` handles indices up to 57!
            ...slot.homeCells, // 52-56
            slot.finishCell,   // 57
        ];
    });
    return paths;
}

export function getBoardCoordinate(pos: number, color: PlayerColor, cc: ColorCorner): Point | null {
    if (pos < 0) return null; // Base or invalid
    if (pos < 52) {
        return SHARED_PATH[pos];
    }
    const corner = cc[color];
    if (!corner) return null;
    const slot = CORNER_SLOTS[corner];
    if (pos === 57) return slot.finishCell;
    if (pos >= 52 && pos <= 56) {
        return slot.homeCells[pos - 52];
    }
    return null;
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

type Position = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

const COLOR_SEATS: { color: PlayerColor; position: Position }[] = [
    { color: 'green', position: 'top-right' },
    { color: 'red', position: 'bottom-right' },
    { color: 'yellow', position: 'top-left' },
    { color: 'blue', position: 'bottom-left' },
];

export const CORNER_TO_POSITION: Record<Corner, Position> = {
    'TL': 'top-left',
    'TR': 'top-right',
    'BL': 'bottom-left',
    'BR': 'bottom-right',
};

export function shufflePlayers(
    playerCount: '1v1' | '4P' | '2v2' = '4P',
    isBotMatch: boolean = false,
    cc?: ColorCorner
) {
    // 1. Determine active colors from cc if provided, otherwise default to all
    const activeColors: PlayerColor[] = cc ? (Object.keys(cc) as PlayerColor[]) : ['green', 'red', 'blue', 'yellow'];

    // 2. Determine which indices are active based on playerCount (legacy fallback)
    const usePair1 = Math.random() > 0.5;
    const activeIndices = playerCount === '1v1' ? (usePair1 ? [0, 3] : [1, 2]) : [0, 1, 2, 3];

    const humanTemplate = PLAYER_TEMPLATES.find(p => !p.isAi)!;
    const botTemplates = PLAYER_TEMPLATES.filter(p => p.isAi);

    // If cc is provided, we ignore COLOR_SEATS and use the dynamic mapping
    if (cc) {
        let activeColorEntries = Object.entries(cc) as [PlayerColor, Corner][];

        // REFINEMENT: For 1v1, we MUST filter to exactly 2 diagonal players
        if (playerCount === '1v1') {
            const axis = DIAGONAL_AXES[Math.floor(Math.random() * 2)][0]; // ['BL', 'TR'] or ['BR', 'TL']
            activeColorEntries = activeColorEntries.filter(([, corner]) => axis.includes(corner));
        }

        let humanAssigned = false;
        let botIndex = 0;
        const templates = [...PLAYER_TEMPLATES].sort(() => Math.random() - 0.5);

        return activeColorEntries.map(([color, corner], i) => {
            let template;
            if (isBotMatch) {
                if (!humanAssigned) {
                    template = humanTemplate;
                    humanAssigned = true;
                } else {
                    template = botTemplates[botIndex % botTemplates.length];
                    botIndex++;
                }
            } else {
                template = templates[i % templates.length];
            }

            return {
                ...template,
                color,
                position: CORNER_TO_POSITION[corner],
                isAi: template.isAi
            };
        });
    }

    // Legacy fallback (preserving original logic for snakes or other modes not yet converted)
    if (isBotMatch) {
        let assignedHuman = false;
        let botIndex = 0;

        return COLOR_SEATS.map((seat, i) => {
            if (!activeIndices.includes(i)) return null;

            let template;
            if (!assignedHuman) {
                template = humanTemplate;
                assignedHuman = true;
            } else {
                template = botTemplates[botIndex % botTemplates.length];
                botIndex++;
            }

            return { ...template, ...seat, isAi: template.isAi };
        }).filter(Boolean);

    } else {
        const templates = [...PLAYER_TEMPLATES].sort(() => Math.random() - 0.5);
        return COLOR_SEATS.map((seat, i) => {
            if (!activeIndices.includes(i)) return null;
            return { ...templates[i], ...seat };
        }).filter(Boolean);
    }
}
