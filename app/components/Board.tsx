'use client';

// ─── Full-Screen 15×15 Ludo Board ────────────────────────────────────────────
// Diagonal-opposite pairs:  Green ↔ Blue  |  Red ↔ Yellow
// Layout:  Green (top-left)  —  Red (top-right)
//          Yellow (bottom-left) — Blue (bottom-right)

interface PathCell {
    row: number;
    col: number;
    cls: string;
}

// ─── Player Data ─────────────────────────────────────────────────────────────

interface Player {
    name: string;
    level: number;
    avatar: string;          // emoji or initials
    color: 'green' | 'red' | 'yellow' | 'blue';
    position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
}

const PLAYERS: Player[] = [
    { name: 'Alex', level: 12, avatar: '🟢', color: 'green', position: 'top-left' },
    { name: 'Maya', level: 8, avatar: '🔴', color: 'red', position: 'top-right' },
    { name: 'Jordan', level: 15, avatar: '🟡', color: 'yellow', position: 'bottom-left' },
    { name: 'Kai', level: 10, avatar: '🔵', color: 'blue', position: 'bottom-right' },
];

// ─── Icons ───────────────────────────────────────────────────────────────────

const StarMarker = () => (
    <svg className="star-svg" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2l2.9 6.26L22 9.27l-5 4.87L18.18 22 12 18.27 5.82 22 7 14.14 2 9.27l7.1-1.01L12 2z" />
    </svg>
);

// ─── Path builder ────────────────────────────────────────────────────────────
// Diagonal arrangement:  Green (TL) — Red (TR) — Yellow (BL) — Blue (BR)
// Finish lanes match the home in each corner.

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

                // Finish lanes leading toward center
                if (c === 8 && r >= 2 && r <= 6) cls += ' lane-green';       // top → center
                else if (r === 8 && c >= 10 && c <= 14) cls += ' lane-red';   // right → center  (was blue)
                else if (c === 8 && r >= 10 && r <= 14) cls += ' lane-blue';  // bottom → center (was red)
                else if (r === 8 && c >= 2 && c <= 6) cls += ' lane-yellow';  // left → center

                // Star / safe squares
                if (
                    (r === 7 && c === 2) || (r === 2 && c === 9) ||
                    (r === 9 && c === 14) || (r === 14 && c === 7)
                ) {
                    cls += ' star-cell';
                }

                cells.push({ row: r, col: c, cls });
            }
        }
    }

    return cells;
}

const PATH_CELLS = buildPathCells();

// ─── Home Block ──────────────────────────────────────────────────────────────

function HomeBlock({
    color,
    gridRow,
    gridCol,
}: {
    color: 'green' | 'red' | 'yellow' | 'blue';
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

// ─── Player Card ─────────────────────────────────────────────────────────────

function PlayerCard({ player }: { player: Player }) {
    return (
        <div className={`player-card ${player.position}`}>
            <div className={`player-avatar ${player.color}`}>
                <span>{player.avatar}</span>
            </div>
            <div className="player-info">
                <span className="player-name">{player.name}</span>
                <span className="player-level">Lv.{player.level}</span>
            </div>
        </div>
    );
}

// ─── Main Board ──────────────────────────────────────────────────────────────

export default function Board() {
    return (
        <div className="board-outer">
            {/* Player cards at each corner */}
            {PLAYERS.map((p) => (
                <PlayerCard key={p.color} player={p} />
            ))}

            <div className="board-wrapper">
                <div className="board-grid">
                    {/* ── Corner Homes — diagonal opposites ── */}
                    <HomeBlock color="green" gridRow="1 / 7" gridCol="1 / 7" />
                    <HomeBlock color="red" gridRow="1 / 7" gridCol="10 / 16" />
                    <HomeBlock color="yellow" gridRow="10 / 16" gridCol="1 / 7" />
                    <HomeBlock color="blue" gridRow="10 / 16" gridCol="10 / 16" />

                    {/* ── Cross-Path Cells ── */}
                    {PATH_CELLS.map(({ row, col, cls }) => (
                        <div
                            key={`${row}-${col}`}
                            className={cls}
                            style={{ gridRow: row, gridColumn: col }}
                        >
                            {cls.includes('star-cell') && <StarMarker />}
                        </div>
                    ))}

                    {/* ── Center Finish Zone ── */}
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
        </div>
    );
}
