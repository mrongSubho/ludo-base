"use client";
import React from 'react';
import { AnimatePresence } from 'framer-motion';
import { PlayerColor, GameState } from '@/lib/types';
import { Player } from '@/hooks/useGameEngine';
import { Point, ColorCorner, getBoardCoordinate, CORNER_SLOTS } from '@/lib/boardLayout';
import { getTeammateColor, calculateNextPosition } from '@/lib/gameLogic';
import { BASE_INDEX, BOARD_FINISH_INDEX } from '@/lib/constants';
import { ChessPiece, COLOR_PIECE, RANK_ORDER } from './ChessTokens';
import { Token, ShatterFX, FinishFX, RunHomeGhost } from './board/TokenVisual';
import { TokenPiece } from './board/TokenPiece';

// Back-compat re-exports for existing import sites (BoardHome, token-move-test).
export { Token, TokenPiece };

interface BoardTokensProps {
    players: Player[];
    localGameState: GameState;
    colorCorner: ColorCorner;
    address: string | undefined;
    playerCount: '1v1' | '4P' | '2v2';
    handleTokenClick: (color: PlayerColor, tokenIndex: number) => void;
    counterRotationDeg?: number;
    targetingColor?: PlayerColor | null;
    onTargetToken?: (color: PlayerColor, tokenIndex: number) => void;
}


export function BoardTokens({
    players,
    localGameState,
    colorCorner,
    address,
    playerCount,
    handleTokenClick,
    counterRotationDeg = 0,
    targetingColor = null,
    onTargetToken
}: BoardTokensProps) {
    const myPlayer = players.find(p => address && p.walletAddress?.toLowerCase() === address.toLowerCase()) || players.find(p => !p.isAi);
    const myColor = myPlayer?.color;

    // 1. Calculate occupancy for stacking
    const occupancy: Record<string, { color: PlayerColor, index: number }[]> = {};
    const ALL_COLORS: PlayerColor[] = ['green', 'red', 'yellow', 'blue'];

    ALL_COLORS.forEach(color => {
        if (!players.some(p => p.color === color)) return;
        const colorPositions = localGameState.positions[color] || [];
        colorPositions.forEach((pos: number, index: number) => {
            const numericPos = Number(pos);
            if (numericPos >= 0 && numericPos < 57) {
                const pt = getBoardCoordinate(numericPos, color, colorCorner);
                if (pt) {
                    const key = `${pt.r}-${pt.c}`;
                    if (!occupancy[key]) occupancy[key] = [];
                    occupancy[key].push({ color, index });
                }
            }
        });
    });

    // Capture detection: token vanished from the board (sent back to base)
    const prevPositionsRef = React.useRef<Record<string, number[]>>({});
    const [captureBursts, setCaptureBursts] = React.useState<{ id: number; pt: Point; color: PlayerColor }[]>([]);
    const [finishBursts, setFinishBursts] = React.useState<{ id: number; pt: Point; color: PlayerColor }[]>([]);
    const [runHomeGhosts, setRunHomeGhosts] = React.useState<{ id: number; fromPos: number; color: PlayerColor }[]>([]);
    const burstIdRef = React.useRef(0);

    React.useEffect(() => {
        const prev = prevPositionsRef.current;
        const bursts: { id: number; pt: Point; color: PlayerColor }[] = [];
        const ghosts: { id: number; fromPos: number; color: PlayerColor }[] = [];
        const finBursts: { id: number; pt: Point; color: PlayerColor }[] = [];
        ALL_COLORS.forEach(color => {
            const prevArr = prev[color];
            if (!prevArr) return;
            const nextArr = (localGameState.positions[color] || []).map((p: number) => Number(p));
            prevArr.forEach((pp, idx) => {
                if (pp >= 0 && pp < 57 && nextArr[idx] !== undefined && Number(nextArr[idx]) === BASE_INDEX) {
                    const pt = getBoardCoordinate(pp, color, colorCorner);
                    if (pt) bursts.push({ id: burstIdRef.current, pt, color });
                    ghosts.push({ id: burstIdRef.current++, fromPos: pp, color });
                }
                if (pp >= 0 && pp < 57 && nextArr[idx] !== undefined && Number(nextArr[idx]) === BOARD_FINISH_INDEX) {
                    const pt = getBoardCoordinate(pp, color, colorCorner);
                    if (pt) finBursts.push({ id: burstIdRef.current++, pt, color });
                }
            });
        });
        prevPositionsRef.current = JSON.parse(JSON.stringify(localGameState.positions));
        if (bursts.length === 0 && finBursts.length === 0) return;
        setCaptureBursts(b => [...b, ...bursts]);
        setRunHomeGhosts(g => [...g, ...ghosts]);
        setFinishBursts(b => [...b, ...finBursts]);
        const timers = bursts.map(b => setTimeout(() => {
            setCaptureBursts(cur => cur.filter(x => x.id !== b.id));
        }, 700));
        const finTimers = finBursts.map(b => setTimeout(() => {
            setFinishBursts(cur => cur.filter(x => x.id !== b.id));
        }, 800));
        return () => { timers.forEach(clearTimeout); finTimers.forEach(clearTimeout); };
    }, [localGameState.positions, colorCorner]);

    // 2. Flatten all active tokens for AnimatePresence to track correctly
    const activeTokens = ALL_COLORS.flatMap(color => {
        const playerForColor = players.find(p => p.color === color);
        if (!playerForColor) return [];
        const colorPositions = localGameState.positions[color] || [];

        return colorPositions.map((pos: number, index: number): { color: PlayerColor, index: number, pos: number } | null => {
            const numericPos = Number(pos);
            if (numericPos === BASE_INDEX || numericPos === BOARD_FINISH_INDEX) return null;
            return { color, index, pos: numericPos };
        }).filter((t: { color: PlayerColor, index: number, pos: number } | null): t is { color: PlayerColor, index: number, pos: number } => t !== null);
    }) as { color: PlayerColor, index: number, pos: number }[];

    // Sort so own tokens render last (on top in DOM order)
    const sortedTokens = [...activeTokens].sort((a, b) => (a.color === myColor ? 1 : 0) - (b.color === myColor ? 1 : 0));
    return (
        <AnimatePresence>
            {sortedTokens.map(({ color, index, pos }) => {
                const targetPt = getBoardCoordinate(pos, color, colorCorner);

                // Stacking — grid layout so each token is identifiable; own token prioritized on top
                let offset = { x: 0, y: 0 };
                let stackScale = 1;
                let stackZ = 0;
                if (targetPt) {
                    const key = `${targetPt.r}-${targetPt.c}`;
                    let stack = occupancy[key] || [];
                    if (stack.length > 1) {
                        // Sort so myColor is last (rendered on top) — stable for others
                        const sorted = [...stack].sort((a, b) => {
                            const aOwn = a.color === myColor ? 1 : 0;
                            const bOwn = b.color === myColor ? 1 : 0;
                            return aOwn - bOwn;
                        });
                        const myStackIdx = sorted.findIndex(s => s.color === color && s.index === index);
                        stackZ = myStackIdx;
                        stackScale = 0.88;
                        // Grid offsets per stack size (back → front order)
                        const grids: Record<number, { x: number; y: number }[]> = {
                            2: [{ x: -9, y: -4 }, { x: 9, y: 6 }],
                            3: [{ x: -10, y: -8 }, { x: 10, y: -8 }, { x: 0, y: 10 }],
                            4: [{ x: -9, y: -9 }, { x: 9, y: -9 }, { x: -9, y: 9 }, { x: 9, y: 9 }],
                        };
                        const pts = grids[sorted.length] || sorted.map((_, i) => {
                            const ang = (i * (360 / sorted.length)) * (Math.PI / 180);
                            return { x: Math.cos(ang) * 12, y: Math.sin(ang) * 12 };
                        });
                        offset = pts[myStackIdx] || { x: 0, y: 0 };
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

                const diceVal: number | null = localGameState.diceValue ?? null;
                const isValidMove = isDraggable && diceVal !== null
                    && calculateNextPosition(pos, diceVal, color as PlayerColor, colorCorner) !== pos;
                const shielded = (localGameState.activeShields || []).some((s: any) => s.color === color && s.tokenIdx === index);
                const targetable = !!targetingColor && color === targetingColor && pos >= 0 && pos < 52;
                const boosted = localGameState.boostTrail === color;

                return (
                    <TokenPiece
                        key={`${color}-${index}`}
                        color={color}
                        index={index}
                        pos={pos}
                        targetPt={targetPt}
                        offset={offset}
                        stackScale={stackScale}
                        stackZ={stackZ}
                        isDraggable={isDraggable}
                        isValidMove={isValidMove}
                        isColorTurn={localGameState.currentPlayer === color}
                        counterRotationDeg={counterRotationDeg}
                        colorCorner={colorCorner}
                        shielded={shielded}
                        targetable={targetable}
                        boosted={boosted}
                        onClick={() => targetable && onTargetToken ? onTargetToken(color, index) : handleTokenClick(color, index)}
                    />
                );
            })}
            {captureBursts.map(b => (
                <ShatterFX key={`burst-${b.id}`} pt={b.pt} color={b.color} />
            ))}
            {finishBursts.map(b => (
                <FinishFX key={`finish-${b.id}`} pt={b.pt} color={b.color} />
            ))}
            {runHomeGhosts.map(g => (
                <RunHomeGhost
                    key={`ghost-${g.id}`}
                    color={g.color}
                    fromPos={g.fromPos}
                    cc={colorCorner}
                    counterRotationDeg={counterRotationDeg}
                    onDone={() => setRunHomeGhosts(cur => cur.filter(x => x.id !== g.id))}
                />
            ))}
        </AnimatePresence>
    );
}
