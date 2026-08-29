import React from 'react';
import { motion } from 'framer-motion';
import { getGridCellInfo, getBoardCoordinate, PathCell, ColorCorner, Corner, CORNER_SLOTS, CellType, SHARED_PATH, SAFE_POSITIONS } from '@/lib/boardLayout';
import { PlayerColor } from '@/lib/types';
import { Player } from '@/hooks/useGameEngine';

interface BoardGridProps {
    pathCells: PathCell[];
    colorCorner: ColorCorner;
    localGameState: any;
    players?: Player[];
    activeColor?: string;
    children?: React.ReactNode;
    sweepProgress?: any; // MotionValue<number> (0 to 1)
    pointRotation?: any; // MotionValue<number>
    counterRotationDeg?: number;
}

const ZONE_HEX: Record<string, string> = {
    green: '#00ff88',
    red: '#ff3344',
    yellow: '#ffcc00',
    blue: '#00ccff',
};

const StarMarker = ({ color = "#eab308", counterRotationDeg = 0 }: { color?: string; counterRotationDeg?: number }) => (
    <svg viewBox="0 0 24 24" style={{ width: '96%', height: '96%', transform: `rotate(${counterRotationDeg}deg)` }}>
        <path fill={color} d="M12 2l2.9 6.26L22 9.27l-5 4.87L18.18 22 12 18.27 5.82 22 7 14.14 2 9.27l7.1-1.01L12 2z" />
    </svg>
);

function getZoneColorForSafeCell(r: number, c: number, cc: ColorCorner): string {
    const globalIdx = SHARED_PATH.findIndex(p => p.r === r && p.c === c);
    if (globalIdx === -1) return '#eab308';
    const colors = Object.keys(cc) as string[];
    for (const color of colors) {
        const corner = cc[color as keyof ColorCorner] as Corner | undefined;
        if (!corner) continue;
        const sc = CORNER_SLOTS[corner].startIdx;
        const d = (globalIdx - sc + 52) % 52;
        if (d < 13) return ZONE_HEX[color] || '#eab308';
    }
    return '#eab308';
}

const ArrowMarker = ({ dir, color = "#ffffff" }: { dir: 'up' | 'down' | 'left' | 'right', color?: string }) => {
    const rotation = { right: 0, down: 90, left: 180, up: 270 }[dir];
    return (
        <motion.div style={{ rotate: rotation }}>
            <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.6))' }}>
                <path fill={color} d="M12 4l-1.41 1.41L16.17 11H4v2h12.17l-5.58 5.59L12 20l8-8z" />
            </svg>
        </motion.div>
    );
};

export function BoardGrid({
    pathCells,
    colorCorner,
    localGameState,
    children,
    activeColor: propActiveColor,
    sweepProgress,
    pointRotation,
    counterRotationDeg
}: BoardGridProps) {
    const activeColor = localGameState?.currentPlayer || propActiveColor;
    
    // Fallback Hex Colors (from mockup)
    const COLOR_MAP: Record<string, string> = {
        green: '#22c55e',
        red: '#ef4444',
        blue: '#3b82f6',
        yellow: '#eab308'
    };

    // Calculate occupied cells to hide star markers
    const occupiedCells = new Set<string>();
    const ALL_COLORS: PlayerColor[] = ['green', 'red', 'yellow', 'blue'];
    if (localGameState?.positions) {
        ALL_COLORS.forEach(color => {
            const positions = localGameState.positions[color] || [];
            positions.forEach((pos: number) => {
                const numericPos = Number(pos);
                if (numericPos >= 0 && numericPos < 57) {
                    const pt = getBoardCoordinate(numericPos, color, colorCorner);
                    if (pt) occupiedCells.add(`${pt.r}-${pt.c}`);
                }
            });
        });
    }

    return (
        <div className="board-grid" style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(15, 1fr)',
            gridTemplateRows: 'repeat(15, 1fr)',
            width: '100%',
            aspectRatio: '1 / 1',
            gap: '1px',
            background: 'var(--ludo-bg, #000000)',
            padding: '1px',
            position: 'relative'
        }}>
            {/* ── Path Squares ── */}
            {(pathCells || []).map(({ row, col, cls }: PathCell) => {
                const cellInfo = getGridCellInfo(row, col, colorCorner);
                const isPower = localGameState?.powerTiles?.some((pt: any) => pt.r === row && pt.c === col);
                const trap = localGameState?.activeTraps?.find((t: any) => t.r === row && t.c === col);
                
                let bg = 'var(--ludo-path-bg)';
                if (cellInfo.type === 'home-lane' && cellInfo.color) {
                    const fallbackHex = COLOR_MAP[cellInfo.color as string] || '#000000';
                    bg = `var(--ludo-base-${cellInfo.color}, ${fallbackHex})`;
                }

                const isSafe = cellInfo.type === 'safe';
                const safeZoneColor = isSafe ? getZoneColorForSafeCell(row, col, colorCorner) : null;
                if (isSafe && safeZoneColor) {
                    bg = `${safeZoneColor}33`;
                }

                return (
                    <div
                        key={`${row}-${col}`}
                        className={`${cls} ${isPower ? 'power-cell' : ''}`}
                        style={{ 
                            gridRow: row, 
                            gridColumn: col,
                            backgroundColor: bg,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            position: 'relative'
                        }}
                    >
                        {isSafe && !occupiedCells.has(`${row}-${col}`) && <StarMarker color={safeZoneColor || '#eab308'} counterRotationDeg={counterRotationDeg} />}
                        {isPower && !trap && <span className="power-icon" style={{ fontSize: 16 }}>⚡</span>}
                        {trap && <span className="trap-icon" style={{ fontSize: 16 }}>💣</span>}
                        {(Object.entries(colorCorner) as [PlayerColor, Corner][]).map(([color, corner]) => {
                            const slot = CORNER_SLOTS[corner];
                            if (slot.arrowCell.r === row && slot.arrowCell.c === col) {
                                return <ArrowMarker key={corner} dir={slot.arrowDir} />;
                            }
                            return null;
                        })}
                    </div>
                );
            })}

            {/* ── Home Bases & Tokens (Children) ── */}
            {children}

            {/* ── Multi-Layered Finish Junction ── */}
            <div 
                className="finish-center"
                style={{
                    gridRow: '7 / 10',
                    gridColumn: '7 / 10',
                    zIndex: 10,
                    position: 'relative',
                    background: 'transparent',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    pointerEvents: 'none', // Ensure no clicks are blocked
                    transform: `rotate(${counterRotationDeg || 0}deg)`
                }}
            >
                {/* 1. Ambient Backdrop Pulse (Layer 1) */}
                <motion.div 
                    animate={{ 
                        opacity: activeColor ? [0.4, 0.8, 0.4] : 0 
                    }}
                    transition={{ repeat: Infinity, duration: 3 }}
                    style={{
                        position: 'absolute',
                        width: '140%',
                        height: '140%',
                        background: `radial-gradient(circle, ${COLOR_MAP[activeColor as string] || '#ffffff'}33 0%, transparent 70%)`,
                        borderRadius: '50%',
                        zIndex: 0
                    }}
                />

                {/* 2. Outer Ceramic Bezel (Layer 2) */}
                <div style={{
                    position: 'absolute',
                    inset: '-5%',
                    borderRadius: '50%',
                    background: 'linear-gradient(135deg, #1A1A2E 0%, #0F0F23 100%)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    boxShadow: '0 4px 20px rgba(0,0,0,0.8), inset 0 2px 5px rgba(255,255,255,0.05)',
                    zIndex: 1
                }} />

                {/* 3. The "Trench" - Glassmorphic Inset (Layer 3) */}
                <div style={{
                    position: 'absolute',
                    inset: '5%',
                    borderRadius: '50%',
                    background: 'rgba(255, 255, 255, 0.05)',
                    backdropFilter: 'blur(8px)',
                    border: '1px solid rgba(255, 255, 255, 0.05)',
                    boxShadow: 'inset 0 0 15px rgba(0,0,0,0.5)',
                    zIndex: 2,
                    overflow: 'hidden'
                }}>
                    {/* 4. Rotating Neon Energy Arc (Layer 4) */}
                    {activeColor && (
                        <motion.div
                            animate={{ rotate: 360 }}
                            transition={{ repeat: Infinity, duration: 4, ease: 'linear' }}
                            style={{
                                position: 'absolute',
                                inset: '-50%',
                                background: `conic-gradient(from 0deg, transparent 0%, ${COLOR_MAP[activeColor as string]} 10%, transparent 40%)`,
                                opacity: 0.6,
                                mixBlendMode: 'screen',
                                zIndex: 1
                            }}
                        />
                    )}
                </div>

                {/* 4.5. Timer Ring - Sweep Progress (Layer 4.5) */}
                {sweepProgress && (
                    <div style={{
                        position: 'absolute',
                        inset: '2%',
                        zIndex: 3,
                        transform: 'rotate(-90deg)'
                    }}>
                        <svg width="100%" height="100%" viewBox="0 0 100 100">
                             <motion.circle
                                 cx="50"
                                 cy="50"
                                 r="44"
                                 fill="transparent"
                                 stroke={COLOR_MAP[activeColor as string] || '#ffffff'}
                                 strokeWidth="3"
                                 strokeDasharray="276.46" // 2 * pi * 44
                                 style={{ pathLength: sweepProgress }}
                                 opacity={0.8}
                             />
                        </svg>
                    </div>
                )}

                {/* 5. Vacuum Core - The deepest void (Layer 5) */}
                <div style={{
                    position: 'absolute',
                    inset: '22%',
                    borderRadius: '50%',
                    background: '#000000',
                    boxShadow: `0 0 20px ${COLOR_MAP[activeColor as string] || '#ffffff'}33, inset 0 0 10px rgba(0,0,0,0.9)`,
                    border: `1px solid ${COLOR_MAP[activeColor as string] || 'rgba(255,255,255,0.1)'}33`,
                    zIndex: 4,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                }}>
                    {/* 6. The Heart - Star or Dice Value (Layer 6) */}
                    <motion.div
                        key={localGameState?.diceValue || 'star'}
                        initial={{ scale: 0, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0, opacity: 0 }}
                        transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                    >
                        {localGameState?.diceValue ? (
                             <motion.span 
                                animate={{ scale: [1, 1.2, 1] }}
                                transition={{ repeat: Infinity, duration: 1.5 }}
                                style={{
                                    fontSize: 48,
                                    fontFamily: "'Russo One', sans-serif",
                                    color: COLOR_MAP[activeColor as string] || '#ffffff',
                                    textShadow: `0 0 10px ${COLOR_MAP[activeColor as string]}aa, 0 0 20px ${COLOR_MAP[activeColor as string]}66`,
                                    display: 'inline-block'
                                }}
                             >
                                 {localGameState.diceValue}
                             </motion.span>
                          ) : (
                             <motion.div
                                 animate={{ scale: [1, 1.1, 1] }}
                                 transition={{ repeat: Infinity, duration: 2 }}
                                 style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                             >
                                 <svg viewBox="0 0 24 24" style={{ width: '55%', height: '55%' }}>
                                     <path fill={COLOR_MAP[activeColor as string] || '#eab308'} d="M12 2l2.9 6.26L22 9.27l-5 4.87L18.18 22 12 18.27 5.82 22 7 14.14 2 9.27l7.1-1.01L12 2z" />
                                 </svg>
                             </motion.div>
                         )}
                    </motion.div>
                </div>
            </div>
        </div>
    );
}
