import React from 'react';
import { motion, useTransform, MotionValue } from 'framer-motion';
import { StarMarker, ArrowMarker } from './BoardHome';
import { CORNER_SLOTS, getGridCellInfo, ColorCorner, Corner, Point } from '@/lib/boardLayout';
import { PlayerColor } from '@/lib/types';

interface BoardGridProps {
    pathCells: any[];
    colorCorner: ColorCorner;
    localGameState: any;
    activeColor: string;
    sweepProgress: MotionValue<number>;
    pointRotation: MotionValue<number>;
    counterRotationDeg: number;
    children?: React.ReactNode;
}

export function BoardGrid({
    pathCells,
    colorCorner,
    localGameState,
    activeColor,
    sweepProgress,
    pointRotation,
    counterRotationDeg,
    children
}: BoardGridProps) {
    return (
        <div className="board-grid">
            {/* ── Path Squares ── */}
            {pathCells.map(({ row, col, cls }: { row: number, col: number, cls: string }) => {
                const cellInfo = getGridCellInfo(row, col, colorCorner);
                const isPower = localGameState.powerTiles.some((pt: { r: number, c: number }) => pt.r === row && pt.c === col);
                const trap = localGameState.activeTraps.find((t: { r: number, c: number }) => t.r === row && t.c === col);

                return (
                    <div
                        key={`${row}-${col}`}
                        className={`${cls} ${isPower ? 'power-cell' : ''}`}
                        style={{ 
                            gridRow: row, 
                            gridColumn: col,
                            backgroundColor: cls.includes('lane-') ? undefined : 'var(--ludo-card)'
                        }}
                    >
                        {cellInfo.type === 'safe' && <StarMarker />}
                        {isPower && !trap && <span className="power-icon" style={{ fontSize: 16 }}>⚡</span>}
                        {trap && <span className="trap-icon" style={{ fontSize: 16 }}>💣</span>}
                        {(Object.entries(colorCorner) as [PlayerColor, Corner][]).map(([, corner]) => {
                            const slot = CORNER_SLOTS[corner];
                            if (slot.arrowCell.r === row && slot.arrowCell.c === col) {
                                return <ArrowMarker key={`arrow-${row}-${col}`} dir={slot.arrowDir} />;
                            }
                            return null;
                        })}
                    </div>
                );
            })}

            {/* ── Tokens ── */}
            {children}

            {/* ── Center Finish Zone ── */}
            <div
                className={`finish-center ${localGameState.invalidMove ? 'shake-feedback' : ''}`}
                style={{
                    position: 'absolute',
                    top: '50%',
                    left: '50%',
                    transform: `translate(-50%, -50%) rotate(${counterRotationDeg}deg)`,
                    width: '20%',
                    height: '20%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: '16px',
                    overflow: 'visible',
                    background: 'transparent',
                    boxShadow: 'none',
                    zIndex: 10,
                    ['--active-player-color' as any]: activeColor
                }}
                key={localGameState.currentPlayer}
            >
                <motion.div 
                    className="finish-center-corner-glimpse" 
                    animate={{ 
                        boxShadow: localGameState.winners.length > 0 ? [
                            "0 0 20px rgba(255,215,0,0.4)", 
                            "0 0 40px rgba(255,215,0,0.8)", 
                            "0 0 20px rgba(255,215,0,0.4)"
                        ] : "none" 
                    }}
                    transition={{ repeat: Infinity, duration: 2 }}
                    style={{
                        position: 'absolute',
                        inset: 0,
                        borderRadius: '16px',
                        opacity: 0.8,
                        overflow: 'hidden',
                        zIndex: 0
                    }}
                >
                    <div className="absolute top-[-20%] left-[-20%] w-full h-full cosmic-orb cosmic-orb-1 opacity-20 scale-150 pointer-events-none" />
                    <div className="absolute bottom-[-20%] right-[-20%] w-full h-full cosmic-orb cosmic-orb-2 opacity-15 scale-150 pointer-events-none" />
                </motion.div>

                <div className="finish-center-functional-core glass-panel" style={{
                    position: 'absolute',
                    inset: '1%',
                    borderRadius: '50%',
                    background: 'rgba(0, 0, 0, 0.35)',
                    backdropFilter: 'blur(20px)',
                    WebkitBackdropFilter: 'blur(20px)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    zIndex: 1,
                    overflow: 'hidden',
                    boxShadow: '0 0 50px rgba(0,0,0,0.8)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                }}>
                    <motion.div
                        animate={{ scale: [1, 1.05, 1], opacity: [0.05, 0.1, 0.05] }}
                        transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                        style={{
                            position: 'absolute',
                            inset: '15%',
                            borderRadius: '50%',
                            background: `radial-gradient(circle, white 0%, transparent 70%)`,
                            zIndex: 0
                        }}
                    />

                    <motion.div
                        animate={{ scale: [1, 1.15, 1], rotate: [0, 8, 0, -8, 0] }}
                        transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
                        style={{
                            position: 'absolute',
                            inset: '20%',
                            zIndex: 10,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                        }}
                    >
                        <div className="glass-core" style={{
                            width: '100%',
                            height: '100%',
                            borderRadius: '50%',
                            background: 'rgba(255, 255, 255, 0.05)',
                            backdropFilter: 'blur(8px)',
                            border: '1px solid rgba(255, 255, 255, 0.15)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: activeColor,
                            boxShadow: `0 0 30px -5px ${activeColor}66`
                        }}>
                            <StarMarker color={activeColor} />
                        </div>
                    </motion.div>
                </div>

                <div className="junction-timer-container" style={{
                    position: 'absolute',
                    inset: '6%',
                    width: '88%',
                    height: '88%',
                    pointerEvents: 'none',
                    zIndex: 2,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: '50%'
                }}>
                    <div className="junction-timer-track-css" />
                    <motion.div
                        className="junction-timer-color-ring"
                        style={{
                            background: useTransform(sweepProgress, (v) =>
                                `conic-gradient(#000000 0% ${v}%, ${activeColor} ${v + 0.2}% 100%)`
                            ),
                            zIndex: 2,
                            position: 'absolute',
                            inset: 0
                        }}
                    />
                    <motion.div
                        className="junction-timer-point"
                        style={{ rotate: pointRotation, position: 'absolute', inset: 0, zIndex: 10 }}
                    >
                        <div style={{
                            position: 'absolute',
                            right: '0px',
                            top: '50%',
                            marginTop: '-0.5px',
                            width: '1px',
                            height: '1px',
                            borderRadius: '50%',
                            backgroundColor: activeColor,
                            boxShadow: `0 0 8px 3px ${activeColor}`,
                        }} />
                    </motion.div>
                </div>
            </div>
        </div>
    );
}
