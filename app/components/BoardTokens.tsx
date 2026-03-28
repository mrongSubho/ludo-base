import React from 'react';
import { motion } from 'framer-motion';
import { PlayerColor } from '@/lib/types';
import { Player } from '@/hooks/useGameEngine';
import { Point, getBoardCoordinate, ColorCorner } from '@/lib/boardLayout';
import { getTeammateColor, getIntermediatePathCoords } from '@/lib/gameLogic';
import { BASE_INDEX } from '@/lib/constants';

interface BoardTokensProps {
    players: Player[];
    localGameState: any;
    colorCorner: ColorCorner;
    address: string | undefined;
    playerCount: '1v1' | '4P' | '2v2';
    handleTokenClick: (color: PlayerColor, tokenIndex: number) => void;
    counterRotationDeg?: number;
}

interface TokenProps {
    color: string;
    onClick?: () => void;
    isDraggable?: boolean;
    count?: number;
    isBlockade?: boolean;
    counterRotationDeg?: number;
}

export function Token({
    color,
    onClick,
    isDraggable,
    count = 1,
    isBlockade = false,
    counterRotationDeg = 0
}: TokenProps) {
    return (
        <motion.div
            layout
            initial={false}
            animate={{ rotate: counterRotationDeg }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className={`ludo-token ${color}-token ${isDraggable ? 'draggable' : ''} ${isBlockade ? 'token-blockade' : ''}`}
            onClick={onClick}
            whileHover={isDraggable ? { scale: 1.15, y: -4 } : { scale: 1.1 }}
            whileTap={{ scale: 0.95 }}
        >
            {count > 1 && (
                <div className="token-count-badge">
                    {count}
                </div>
            )}
            {isBlockade && (
                <div className="blockade-glow" />
            )}
        </motion.div>
    );
}

interface TokenPieceProps {
    color: PlayerColor;
    index: number;
    pos: number;
    targetPt: Point | null;
    offset: { x: number, y: number };
    isDraggable: boolean;
    isColorTurn: boolean;
    counterRotationDeg: number;
    colorCorner: ColorCorner;
    onClick: () => void;
}

function TokenPiece({
    color,
    index,
    pos,
    targetPt,
    offset,
    isDraggable,
    isColorTurn,
    counterRotationDeg,
    colorCorner,
    onClick
}: TokenPieceProps) {
    const [visualPt, setVisualPt] = React.useState<Point | null>(targetPt);
    const prevPosRef = React.useRef(pos);
    const isAnimatingRef = React.useRef(false);

    React.useEffect(() => {
        if (prevPosRef.current === pos) return;
        
        const oldPos = prevPosRef.current;
        prevPosRef.current = pos;

        // Teleport cases: BASE -> Board or Board -> BASE (Capture)
        if (oldPos === BASE_INDEX || pos === BASE_INDEX) {
            setVisualPt(targetPt);
            return;
        }

        // Hopping sequence
        if (pos > oldPos && !isAnimatingRef.current) {
            const intermediateCoords = getIntermediatePathCoords(oldPos, pos, color, colorCorner);
            if (intermediateCoords.length > 0) {
                isAnimatingRef.current = true;
                let step = 0;
                const interval = setInterval(() => {
                    setVisualPt(intermediateCoords[step]);
                    step++;
                    if (step >= intermediateCoords.length) {
                        clearInterval(interval);
                        isAnimatingRef.current = false;
                    }
                }, 250); // Match engine timing roughly
                return () => clearInterval(interval);
            }
        } else {
            setVisualPt(targetPt);
        }
    }, [pos, color, colorCorner, targetPt]);

    if (!visualPt) return null;

    return (
        <motion.div
            layout
            initial={false}
            animate={{ 
                gridRow: visualPt.r,
                gridColumn: visualPt.c,
                x: offset.x,
                y: offset.y,
                rotate: counterRotationDeg,
                scale: isColorTurn ? [1, 1.05, 1] : 1
            }}
            transition={{
                layout: { type: "spring", stiffness: 300, damping: 30 },
                scale: isColorTurn ? { repeat: Infinity, duration: 1.5, ease: "easeInOut" } : { duration: 0.2 },
                default: { duration: 0.3 }
            }}
            style={{ 
                width: '100%', 
                height: '100%', 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'center',
                position: 'absolute',
                zIndex: isAnimatingRef.current ? 50 : (isColorTurn ? 30 : 10 + index)
            }}
        >
            {/* The "Hop" animation wrapper */}
            <motion.div
                animate={isAnimatingRef.current ? { 
                    y: [0, -25, 0],
                    scale: [1, 1.2, 1]
                } : { y: 0, scale: 1 }}
                transition={isAnimatingRef.current ? { 
                    duration: 0.25,
                    repeat: Infinity // Repeat for each intermediate step in the interval
                } : { duration: 0.2 }}
            >
                <Token
                    color={color}
                    count={1}
                    isDraggable={isDraggable}
                    counterRotationDeg={0}
                    onClick={onClick}
                />
            </motion.div>
        </motion.div>
    );
}

export function BoardTokens({
    players,
    localGameState,
    colorCorner,
    address,
    playerCount,
    handleTokenClick,
    counterRotationDeg = 0
}: BoardTokensProps) {
    const myPlayer = players.find(p => address && p.walletAddress?.toLowerCase() === address.toLowerCase()) || players.find(p => !p.isAi);
    const myColor = myPlayer?.color;

    // 1. Calculate occupancy for stacking
    const occupancy: Record<string, { color: PlayerColor, index: number }[]> = {};
    const ALL_COLORS: PlayerColor[] = ['green', 'red', 'yellow', 'blue'];

    ALL_COLORS.forEach(color => {
        if (!players.some(p => p.color === color)) return;
        localGameState.positions[color].forEach((pos: number, index: number) => {
            if (pos >= 0 && pos < 57) {
                const pt = getBoardCoordinate(pos, color, colorCorner);
                if (pt) {
                    const key = `${pt.r}-${pt.c}`;
                    if (!occupancy[key]) occupancy[key] = [];
                    occupancy[key].push({ color, index });
                }
            }
        });
    });

    return (
        <>
            {ALL_COLORS.map(color => {
                if (!players.some(p => p.color === color)) return null;
                return localGameState.positions[color].map((pos: number, index: number) => {
                    const targetPt = getBoardCoordinate(pos, color, colorCorner);
                    
                    // Stacking offset calculation
                    let offset = { x: 0, y: 0 };
                    if (targetPt) {
                        const key = `${targetPt.r}-${targetPt.c}`;
                        const stack = occupancy[key] || [];
                        if (stack.length > 1) {
                            const myStackIdx = stack.findIndex(s => s.color === color && s.index === index);
                            if (myStackIdx >= 0) {
                                const angle = (myStackIdx * (360 / stack.length)) * (Math.PI / 180);
                                const radius = 5;
                                offset = { 
                                    x: Math.cos(angle) * radius, 
                                    y: Math.sin(angle) * radius 
                                };
                            }
                        }
                    }

                    const isItsMyTurn = localGameState.currentPlayer === myColor;
                    const teammate = getTeammateColor(myColor as PlayerColor, playerCount);
                    const isTeammateColor = teammate === color;
                    const posMap = localGameState.positions as Record<PlayerColor, number[]>;
                    const isSelfFinished = myColor ? posMap[myColor].every((p: number) => p === 57) : false;
                    const canHelpTeammate = isTeammateColor && isSelfFinished && playerCount === '2v2';
                    
                    const isDraggable = isItsMyTurn && localGameState.gamePhase === 'moving' &&
                        (color === myColor || canHelpTeammate);
                    
                    return (
                        <TokenPiece
                            key={`${color}-${index}`}
                            color={color}
                            index={index}
                            pos={pos}
                            targetPt={targetPt}
                            offset={offset}
                            isDraggable={isDraggable}
                            isColorTurn={localGameState.currentPlayer === color}
                            counterRotationDeg={counterRotationDeg}
                            colorCorner={colorCorner}
                            onClick={() => handleTokenClick(color, index)}
                        />
                    );
                });
            })}
        </>
    );
}
