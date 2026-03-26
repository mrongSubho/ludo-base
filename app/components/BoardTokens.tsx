import React from 'react';
import { motion } from 'framer-motion';
import { PlayerColor } from '@/lib/types';
import { Player } from '@/hooks/useGameEngine';
import { Point } from '@/lib/boardLayout';
import { getTeammateColor } from '@/lib/gameLogic';

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

interface BoardTokensProps {
    players: Player[];
    localGameState: any;
    playerPaths: Record<string, Point[]>;
    address: string | undefined;
    playerCount: '1v1' | '4P' | '2v2';
    handleTokenClick: (color: PlayerColor, tokenIndex: number) => void;
}

export function BoardTokens({
    players,
    localGameState,
    playerPaths,
    address,
    playerCount,
    handleTokenClick
}: BoardTokensProps) {
    const coordGroups: Record<string, Record<PlayerColor, number[]>> = {};
    const pointMap: Record<string, Point> = {};

    (['green', 'red', 'blue', 'yellow'] as const).forEach((color) => {
        if (!players.some(p => p.color === color)) return;
        localGameState.positions[color].forEach((pos: number, idx: number) => {
            if (pos >= 0 && pos < 57) {
                const point = playerPaths[color][pos];
                if (!point) return;
                const coordKey = `${point.r}-${point.c}`;
                if (!coordGroups[coordKey]) {
                    coordGroups[coordKey] = { green: [], red: [], yellow: [], blue: [] };
                    pointMap[coordKey] = point;
                }
                coordGroups[coordKey][color].push(idx);
            }
        });
    });

    return (
        <>
            {Object.entries(coordGroups).map(([coordKey, colorSets]) => {
                const point = pointMap[coordKey];
                const activeColors = (Object.entries(colorSets) as [PlayerColor, number[]][])
                    .filter(([, tokens]) => tokens.length > 0);

                return (
                    <div
                        key={coordKey}
                        className="token-group-on-grid"
                        style={{
                            gridRow: point.r,
                            gridColumn: point.c,
                            display: 'flex',
                            alignItems: 'center',
                            justifyItems: 'center',
                            width: '100%',
                            height: '100%',
                            position: 'relative'
                        }}
                    >
                        {activeColors.map(([color, tokens], colorIdx) => {
                            const myPlayer = players.find(p => address && p.walletAddress?.toLowerCase() === address.toLowerCase()) || players.find(p => !p.isAi);
                            const myColor = myPlayer?.color;
                            const isItsMyTurn = localGameState.currentPlayer === myColor;

                            const teammate = getTeammateColor(myColor as PlayerColor, playerCount);
                            const isTeammateColor = teammate === color;
                            const posMap = localGameState.positions as Record<PlayerColor, number[]>;
                            const isSelfFinished = myColor ? posMap[myColor].every((p: number) => p === 57) : false;

                            const canHelpTeammate = isTeammateColor && isSelfFinished && playerCount === '2v2';
                            const isDraggable = isItsMyTurn && localGameState.gamePhase === 'moving' &&
                                (color === myColor || canHelpTeammate);
                            const count = tokens.length;
                            const isBlockade = count >= 2;

                            const isColorTurn = localGameState.currentPlayer === color;
                            const offsetStyle = activeColors.length > 1 ? {
                                transform: `scale(0.85) translate(${colorIdx * 10 - (activeColors.length - 1) * 5}px, ${colorIdx * 5 - (activeColors.length - 1) * 2.5}px)`,
                                zIndex: isColorTurn ? 30 : 10 + colorIdx,
                                position: 'absolute' as const
                            } : {
                                zIndex: isColorTurn ? 15 : 10
                            };

                            return (
                                <motion.div
                                    key={`${coordKey}-${color}`}
                                    layout
                                    initial={false}
                                    animate={isColorTurn ? { scale: [1, 1.05, 1] } : { scale: 1 }}
                                    transition={isColorTurn ? {
                                        scale: { repeat: Infinity, duration: 1.5, ease: "easeInOut" },
                                        layout: { type: "spring", stiffness: 300, damping: 30 }
                                    } : { type: "spring", stiffness: 300, damping: 30 }}
                                    style={{ ...offsetStyle, width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                                >
                                    <Token
                                        color={color}
                                        count={count}
                                        isBlockade={isBlockade}
                                        isDraggable={isDraggable}
                                        onClick={() => {
                                            if (isDraggable) {
                                                handleTokenClick(color, tokens[0]);
                                            }
                                        }}
                                    />
                                </motion.div>
                            );
                        })}
                    </div>
                );
            })}
        </>
    );
}
