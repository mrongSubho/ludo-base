'use client';

// ─── Minimalist 15×15 Pastel Ludo Board ──────────────────────────────────────
// Grid layout:
//   Rows 1-6  / Cols 1-6   → Home (Sage)     Rows 1-6  / Cols 10-15 → Home (Sky)
//   Rows 10-15 / Cols 1-6  → Home (Amber)    Rows 10-15 / Cols 10-15 → Home (Rose)
//   Cross paths (3-wide) connect the homes, center 3×3 is the finish zone.

interface PathCell {
    row: number;
    col: number;
    cls: string;
}

function buildPathCells(): PathCell[] {
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

                // Finish lanes (5 cells each, leading into center)
                if (c === 8 && r >= 2 && r <= 6) cls += ' lane-sage';
                else if (r === 8 && c >= 10 && c <= 14) cls += ' lane-sky';
                else if (c === 8 && r >= 10 && r <= 14) cls += ' lane-rose';
                else if (r === 8 && c >= 2 && c <= 6) cls += ' lane-amber';

                // Star / safe squares (entry points outside each home)
                if ((r === 7 && c === 2) || (r === 2 && c === 9) ||
                    (r === 9 && c === 14) || (r === 14 && c === 7)) {
                    cls += ' star-cell';
                }

                cells.push({ row: r, col: c, cls });
            }
        }
    }

    return cells;
}

// Pre-build the path cells once (static data)
const PATH_CELLS = buildPathCells();

// ─── Home Block ──────────────────────────────────────────────────────────────

function HomeBlock({
    color,
    gridRow,
    gridCol,
}: {
    color: 'sage' | 'sky' | 'amber' | 'rose';
    gridRow: string;
    gridCol: string;
}) {
    return (
        <div
            className={`board-home ${color}`}
            style={{ gridRow, gridColumn: gridCol }}
        >
            <div className="home-pad">
                <span className="token-dot" />
                <span className="token-dot" />
                <span className="token-dot" />
                <span className="token-dot" />
            </div>
        </div>
    );
}

// ─── Main Board ──────────────────────────────────────────────────────────────

export default function Board() {
    return (
        <div className="board-wrapper">
            <div className="board-grid">
                {/* ── Corner Homes (6×6 each) ── */}
                <HomeBlock color="sage" gridRow="1 / 7" gridCol="1 / 7" />
                <HomeBlock color="sky" gridRow="1 / 7" gridCol="10 / 16" />
                <HomeBlock color="amber" gridRow="10 / 16" gridCol="1 / 7" />
                <HomeBlock color="rose" gridRow="10 / 16" gridCol="10 / 16" />

                {/* ── Cross-Path Cells (72 individual cells) ── */}
                {PATH_CELLS.map(({ row, col, cls }) => (
                    <div
                        key={`${row}-${col}`}
                        className={cls}
                        style={{ gridRow: row, gridColumn: col }}
                    />
                ))}

                {/* ── Center Finish Zone (3×3 with four color triangles) ── */}
                <div
                    className="finish-center"
                    style={{ gridRow: '7 / 10', gridColumn: '7 / 10' }}
                >
                    <div className="tri tri-top" />
                    <div className="tri tri-right" />
                    <div className="tri tri-bottom" />
                    <div className="tri tri-left" />
                </div>
            </div>
        </div>
    );
}
