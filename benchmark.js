const { performance } = require('perf_hooks');

const pathCells = Array.from({ length: 72 }, (_, i) => ({ row: Math.floor(i/5), col: i%5, cls: 'board-cell' }));
const colorCorner = { green: 'TL', red: 'TR', yellow: 'BR', blue: 'BL' };
const localGameState = {
    powerTiles: [{ r: 1, c: 1 }, { r: 2, c: 2 }, { r: 3, c: 3 }, { r: 4, c: 4 }],
    activeTraps: [{ r: 5, c: 5 }]
};
const CORNER_SLOTS = {
    TL: { arrowCell: { r: 1, c: 2 }, arrowDir: 'right' },
    TR: { arrowCell: { r: 2, c: 1 }, arrowDir: 'down' },
    BR: { arrowCell: { r: 3, c: 4 }, arrowDir: 'left' },
    BL: { arrowCell: { r: 4, c: 3 }, arrowDir: 'up' }
};

function cornerToColor(cc) {
    const inv = {};
    Object.entries(cc).forEach(([color, corner]) => {
        inv[corner] = color;
    });
    return inv;
}

function getGridCellInfo(r, c, cc) {
    const inv = cornerToColor(cc);
    return { type: 'path', color: inv['TL'] };
}

function original() {
    return pathCells.map(({ row, col, cls }) => {
        const cellInfo = getGridCellInfo(row, col, colorCorner);
        const isPower = localGameState.powerTiles.some((pt) => pt.r === row && pt.c === col);
        const trap = localGameState.activeTraps.find((t) => t.r === row && t.c === col);

        let arrows = (Object.entries(colorCorner)).map(([color, corner]) => {
            const slot = CORNER_SLOTS[corner];
            if (slot.arrowCell.r === row && slot.arrowCell.c === col) {
                return slot.arrowDir;
            }
            return null;
        }).filter(Boolean);
        return { cellInfo, isPower, trap, arrows };
    });
}

function optimized() {
    const inv = cornerToColor(colorCorner);
    const powerSet = new Set(localGameState.powerTiles.map(p => `${p.r}-${p.c}`));
    const trapMap = new Map(localGameState.activeTraps.map(t => [`${t.r}-${t.c}`, t]));
    const arrowMap = new Map();
    Object.entries(colorCorner).forEach(([color, corner]) => {
        const slot = CORNER_SLOTS[corner];
        arrowMap.set(`${slot.arrowCell.r}-${slot.arrowCell.c}`, slot.arrowDir);
    });

    return pathCells.map(({ row, col, cls }) => {
        const key = `${row}-${col}`;
        const cellInfo = { type: 'path', color: inv['TL'] }; // simplified
        const isPower = powerSet.has(key);
        const trap = trapMap.get(key);
        const arrow = arrowMap.get(key);
        return { cellInfo, isPower, trap, arrow };
    });
}

const iterations = 10000;
const startOrig = performance.now();
for(let i=0; i<iterations; i++) original();
const endOrig = performance.now();
console.log(`Original: ${endOrig - startOrig}ms`);

const startOpt = performance.now();
for(let i=0; i<iterations; i++) optimized();
const endOpt = performance.now();
console.log(`Optimized: ${endOpt - startOpt}ms`);
