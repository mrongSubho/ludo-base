"use client";
import React from 'react';
import { AnimatePresence } from 'framer-motion';
import { PlayerColor, GameState } from '@/lib/types';
import { Player } from '@/hooks/useGameEngine';
import { Point, ColorCorner, getBoardCoordinate } from '@/lib/boardLayout';
import { getTeammateColor, calculateNextPosition, getIntermediatePathCoords } from '@/lib/gameLogic';
import { BASE_INDEX, BOARD_FINISH_INDEX } from '@/lib/constants';
import { usePreferences } from '@/hooks/usePreferences';
import { resolveDiceThemeId } from '@/lib/diceVisuals';
import { prefersReducedMotion } from '@/lib/motion';
import { computeHopCadence } from '@/lib/tokenMovement';
import { Token, ShatterFX, FinishFX, RunHomeGhost, colorMapSafe } from './board/TokenVisual';
import { TokenPiece } from './board/TokenPiece';

export { Token, TokenPiece };

export interface BoardTransitStatus {
    finishingKeys: string[];
    returningYardKeys: string[];
}

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
    onTokenHover?: (token: { color: PlayerColor; index: number } | null) => void;
    onTransitStatusChange?: (status: BoardTransitStatus) => void;
}

interface VictimHoldEntry {
    color: PlayerColor;
    index: number;
    pos: number;
}

interface StepRippleEntry {
    id: number;
    r: number;
    c: number;
    delayMs: number;
    hex: string;
    isFinal: boolean;
}

interface PendingCaptureEvent {
    id: number;
    key: string;
    color: PlayerColor;
    index: number;
    fromPos: number;
    pt: Point;
    arrivalMs: number;
    isNuke: boolean;
}

interface PendingFinishEvent {
    id: number;
    key: string;
    color: PlayerColor;
    pt: Point;
    landMs: number;
}

interface TrackedTransitionState {
    signature: string;
    positions: Record<PlayerColor, number[]>;
    seq: number;
    deployedKeys: Record<string, boolean>;
    teleportKeys: Record<string, boolean>;
    finishingKeys: Record<string, boolean>;
    finishingHomeHoldKeys: Record<string, boolean>;
    returningYardKeys: Record<string, boolean>;
    victimHolds: Record<string, VictimHoldEntry>;
    pendingCaptures: PendingCaptureEvent[];
    pendingFinishes: PendingFinishEvent[];
    pendingRipples: StepRippleEntry[];
}

const ALL_COLORS: PlayerColor[] = ['green', 'red', 'yellow', 'blue'];

function clonePositions(positions: GameState['positions']): Record<PlayerColor, number[]> {
    return {
        green: [...(positions?.green ?? [-1, -1, -1, -1])].map(Number),
        red: [...(positions?.red ?? [-1, -1, -1, -1])].map(Number),
        yellow: [...(positions?.yellow ?? [-1, -1, -1, -1])].map(Number),
        blue: [...(positions?.blue ?? [-1, -1, -1, -1])].map(Number),
    };
}

function positionSignature(positions: GameState['positions']): string {
    return ALL_COLORS.map((c) => (positions?.[c] ?? []).map(Number).join(',')).join('|');
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
    onTargetToken,
    onTokenHover,
    onTransitStatusChange,
}: BoardTokensProps) {
    const { preferences } = usePreferences();
    const themeId = resolveDiceThemeId(preferences?.theme);
    const reduced = prefersReducedMotion();

    const myPlayer =
        players.find((p) => address && p.walletAddress?.toLowerCase() === address.toLowerCase()) ||
        players.find((p) => !p.isAi);
    const myColor = myPlayer?.color;

    const currentSignature = positionSignature(localGameState.positions);

    const [tracked, setTracked] = React.useState<TrackedTransitionState>(() => ({
        signature: currentSignature,
        positions: clonePositions(localGameState.positions),
        seq: 0,
        deployedKeys: {},
        teleportKeys: {},
        finishingKeys: {},
        finishingHomeHoldKeys: {},
        returningYardKeys: {},
        victimHolds: {},
        pendingCaptures: [],
        pendingFinishes: [],
        pendingRipples: [],
    }));

    // Synchronously classify position diffs BEFORE DOM commit so finishing tokens
    // stay mounted for their center hop, deployed tokens know their Yard slot on
    // first mount, and captured victims hold until the attacker lands.
    if (currentSignature !== tracked.signature) {
        const nextPositions = clonePositions(localGameState.positions);
        const nextSeq = tracked.seq + 1;
        const msg = localGameState.captureMessage || '';
        const isTeleportMsg = /TELEPORT!/i.test(msg);
        const isNukeMsg = (localGameState.nukeFlash?.length ?? 0) > 0 || /NUKE!/i.test(msg);
        const isBoostedMove = Boolean(localGameState.boostTrail || localGameState.activeBoost || localGameState.boostPendingDice != null);

        const nextDeployed: Record<string, boolean> = {};
        const nextTeleport: Record<string, boolean> = {};
        const nextFinishing = { ...tracked.finishingKeys };
        const nextFinishingHomeHold = { ...tracked.finishingHomeHoldKeys };
        const nextReturningYard = { ...tracked.returningYardKeys };
        const nextVictimHolds = { ...tracked.victimHolds };

        const moverLandings: { key: string; pt: Point | null; walkMs: number }[] = [];
        const newPendingFinishes: PendingFinishEvent[] = [];
        const newRipples: StepRippleEntry[] = [];

        let rippleOffset = 0;

        ALL_COLORS.forEach((color) => {
            if (!players.some((p) => p.color === color)) return;
            const prevArr = tracked.positions[color] || [];
            const nextArr = nextPositions[color] || [];
            prevArr.forEach((oldPos, idx) => {
                const newPos = nextArr[idx];
                if (newPos === undefined || oldPos === newPos) return;
                const key = `${color}-${idx}`;

                if (oldPos === BASE_INDEX && newPos >= 0 && newPos < BOARD_FINISH_INDEX) {
                    nextDeployed[key] = true;
                    const landPt = getBoardCoordinate(newPos, color, colorCorner);
                    const walkMs = reduced ? 0 : 420;
                    moverLandings.push({ key, pt: landPt, walkMs });
                    return;
                }

                if (oldPos >= 0 && oldPos < BOARD_FINISH_INDEX && newPos > BASE_INDEX && newPos <= BOARD_FINISH_INDEX) {
                    if (isTeleportMsg) {
                        nextTeleport[key] = true;
                    }
                    const destPt = getBoardCoordinate(newPos, color, colorCorner);
                    const waypoints = isTeleportMsg ? [] : getIntermediatePathCoords(oldPos, newPos, color, colorCorner);
                    const steps = waypoints.length;
                    const cadence = computeHopCadence(Math.max(1, steps), isBoostedMove, themeId);
                    const walkMs = reduced ? 0 : isTeleportMsg ? 560 : cadence.totalWalkMs;

                    if (destPt) {
                        moverLandings.push({ key, pt: destPt, walkMs });
                    }

                    if (!reduced && !isTeleportMsg && waypoints.length > 0) {
                        const hex = colorMapSafe(color);
                        waypoints.forEach((wp, stepIdx) => {
                            if (newPos === BOARD_FINISH_INDEX && stepIdx === waypoints.length - 1) return;
                            const landMs = Math.round((cadence.anticipationSec + (stepIdx + 1) * cadence.cellDur - 0.02) * 1000);
                            newRipples.push({
                                id: nextSeq * 100 + rippleOffset++,
                                r: wp.r,
                                c: wp.c,
                                delayMs: Math.max(0, landMs),
                                hex,
                                isFinal: stepIdx === waypoints.length - 1,
                            });
                        });
                    }

                    if (newPos === BOARD_FINISH_INDEX && destPt) {
                        nextFinishing[key] = true;
                        nextFinishingHomeHold[key] = true;
                        newPendingFinishes.push({
                            id: nextSeq * 100 + rippleOffset++,
                            key,
                            color,
                            pt: destPt,
                            landMs: walkMs,
                        });
                    }
                }
            });
        });

        const newPendingCaptures: PendingCaptureEvent[] = [];
        ALL_COLORS.forEach((color) => {
            if (!players.some((p) => p.color === color)) return;
            const prevArr = tracked.positions[color] || [];
            const nextArr = nextPositions[color] || [];
            prevArr.forEach((oldPos, idx) => {
                const newPos = nextArr[idx];
                if (oldPos >= 0 && oldPos < BOARD_FINISH_INDEX && newPos === BASE_INDEX) {
                    const pt = getBoardCoordinate(oldPos, color, colorCorner);
                    if (!pt) return;
                    const key = `${color}-${idx}`;
                    const matchingMover = moverLandings.find((m) => m.pt && m.pt.r === pt.r && m.pt.c === pt.c);
                    const arrivalMs = reduced
                        ? 0
                        : matchingMover
                          ? Math.max(0, matchingMover.walkMs - 30)
                          : isNukeMsg
                            ? 880
                            : 0;

                    if (arrivalMs > 0) {
                        nextVictimHolds[key] = { color, index: idx, pos: oldPos };
                    }
                    nextReturningYard[key] = true;
                    newPendingCaptures.push({
                        id: nextSeq * 1000 + newPendingCaptures.length + 1,
                        key,
                        color,
                        index: idx,
                        fromPos: oldPos,
                        pt,
                        arrivalMs,
                        isNuke: isNukeMsg,
                    });
                }
            });
        });

        setTracked({
            signature: currentSignature,
            positions: nextPositions,
            seq: nextSeq,
            deployedKeys: nextDeployed,
            teleportKeys: nextTeleport,
            finishingKeys: nextFinishing,
            finishingHomeHoldKeys: nextFinishingHomeHold,
            returningYardKeys: nextReturningYard,
            victimHolds: nextVictimHolds,
            pendingCaptures: newPendingCaptures,
            pendingFinishes: newPendingFinishes,
            pendingRipples: newRipples,
        });
    }

    const [captureBursts, setCaptureBursts] = React.useState<{ id: number; pt: Point; color: PlayerColor }[]>([]);
    const [finishBursts, setFinishBursts] = React.useState<{ id: number; pt: Point; color: PlayerColor }[]>([]);
    const [runHomeGhosts, setRunHomeGhosts] = React.useState<{ id: number; fromPos: number; index: number; color: PlayerColor }[]>([]);
    const [stepRipples, setStepRipples] = React.useState<StepRippleEntry[]>([]);

    const lastProcessedSeqRef = React.useRef(0);
    const timersRef = React.useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

    const scheduleTimer = React.useCallback((fn: () => void, ms: number) => {
        const id = setTimeout(() => {
            timersRef.current.delete(id);
            fn();
        }, ms);
        timersRef.current.add(id);
        return id;
    }, []);

    React.useEffect(() => {
        const timers = timersRef.current;
        return () => {
            timers.forEach((id) => clearTimeout(id));
            timers.clear();
        };
    }, []);

    // Report finishing + returning-to-yard holds cleanly to Board -> HomeBlock
    const lastStatusStrRef = React.useRef('');
    React.useEffect(() => {
        if (!onTransitStatusChange) return;
        const finishingKeys = Object.keys(tracked.finishingHomeHoldKeys).filter((k) => tracked.finishingHomeHoldKeys[k]);
        const returningYardKeys = Object.keys(tracked.returningYardKeys).filter((k) => tracked.returningYardKeys[k]);
        const serialized = `${finishingKeys.join(',')}::${returningYardKeys.join(',')}`;
        if (serialized === lastStatusStrRef.current) return;
        lastStatusStrRef.current = serialized;
        onTransitStatusChange({ finishingKeys, returningYardKeys });
    }, [tracked.finishingHomeHoldKeys, tracked.returningYardKeys, onTransitStatusChange]);

    // Schedule synchronized landing VFX, step ripples, and delayed capture runs per transition seq
    React.useEffect(() => {
        if (tracked.seq === 0 || tracked.seq === lastProcessedSeqRef.current) return;
        lastProcessedSeqRef.current = tracked.seq;

        if (tracked.pendingRipples.length > 0) {
            const batchIds = new Set(tracked.pendingRipples.map((r) => r.id));
            const maxDelay = Math.max(...tracked.pendingRipples.map((r) => r.delayMs));
            setStepRipples((cur) => [...cur, ...tracked.pendingRipples]);
            scheduleTimer(() => {
                setStepRipples((cur) => cur.filter((x) => !batchIds.has(x.id)));
            }, maxDelay + 420);
        }

        if (Object.keys(tracked.deployedKeys).length > 0) {
            const deployKeysCopy = { ...tracked.deployedKeys };
            scheduleTimer(() => {
                setTracked((cur) => {
                    const updated = { ...cur.deployedKeys };
                    for (const k of Object.keys(deployKeysCopy)) delete updated[k];
                    return { ...cur, deployedKeys: updated };
                });
            }, 520);
        }

        tracked.pendingFinishes.forEach((fin) => {
            scheduleTimer(() => {
                setFinishBursts((cur) => [...cur, { id: fin.id, pt: fin.pt, color: fin.color }]);
                setTracked((cur) => {
                    const nextHomeHold = { ...cur.finishingHomeHoldKeys };
                    delete nextHomeHold[fin.key];
                    return { ...cur, finishingHomeHoldKeys: nextHomeHold };
                });
                scheduleTimer(() => {
                    setFinishBursts((cur) => cur.filter((x) => x.id !== fin.id));
                }, 840);
            }, fin.landMs);

            scheduleTimer(() => {
                setTracked((cur) => {
                    const nextFinishing = { ...cur.finishingKeys };
                    delete nextFinishing[fin.key];
                    return { ...cur, finishingKeys: nextFinishing };
                });
            }, fin.landMs + 280);
        });

        tracked.pendingCaptures.forEach((cap) => {
            scheduleTimer(() => {
                setTracked((cur) => {
                    const nextHolds = { ...cur.victimHolds };
                    delete nextHolds[cap.key];
                    return { ...cur, victimHolds: nextHolds };
                });
                if (!cap.isNuke) {
                    setCaptureBursts((cur) => [...cur, { id: cap.id, pt: cap.pt, color: cap.color }]);
                    scheduleTimer(() => {
                        setCaptureBursts((cur) => cur.filter((x) => x.id !== cap.id));
                    }, 680);
                }
                setRunHomeGhosts((cur) => [
                    ...cur,
                    { id: cap.id, fromPos: cap.fromPos, index: cap.index, color: cap.color },
                ]);
                // Fallback safety if ghost finishes abnormally
                scheduleTimer(() => {
                    setTracked((cur) => {
                        if (!cur.returningYardKeys[cap.key]) return cur;
                        const nextRet = { ...cur.returningYardKeys };
                        delete nextRet[cap.key];
                        return { ...cur, returningYardKeys: nextRet };
                    });
                }, 650);
            }, cap.arrivalMs);
        });
    }, [tracked, scheduleTimer]);

    // 1. Build occupancy map for stacking + vault-over-obstacle awareness
    const occupancy: Record<string, { color: PlayerColor; index: number }[]> = {};
    const occupiedKeys = new Set<string>();

    ALL_COLORS.forEach((color) => {
        if (!players.some((p) => p.color === color)) return;
        const colorPositions = localGameState.positions[color] || [];
        colorPositions.forEach((pos: number, index: number) => {
            const hold = tracked.victimHolds[`${color}-${index}`];
            const numericPos = hold ? hold.pos : Number(pos);
            if (numericPos >= 0 && numericPos < BOARD_FINISH_INDEX) {
                const pt = getBoardCoordinate(numericPos, color, colorCorner);
                if (pt) {
                    const key = `${pt.r}-${pt.c}`;
                    occupiedKeys.add(key);
                    if (!occupancy[key]) occupancy[key] = [];
                    occupancy[key].push({ color, index });
                }
            }
        });
    });

    // 2. Flatten board tokens (including holds for in-flight finishing tokens & delayed victims)
    const activeTokens = ALL_COLORS.flatMap((color) => {
        const playerForColor = players.find((p) => p.color === color);
        if (!playerForColor) return [];
        const colorPositions = localGameState.positions[color] || [];

        return colorPositions
            .map((rawPos: number, index: number) => {
                const key = `${color}-${index}`;
                const hold = tracked.victimHolds[key];
                const finishing = Boolean(tracked.finishingKeys[key]);
                const numericPos = hold ? hold.pos : Number(rawPos);
                if (numericPos === BASE_INDEX) return null;
                if (numericPos === BOARD_FINISH_INDEX && !finishing) return null;
                return {
                    color,
                    index,
                    pos: numericPos,
                    finishing,
                    justDeployed: Boolean(tracked.deployedKeys[key]),
                    isTeleport: Boolean(tracked.teleportKeys[key]),
                };
            })
            .filter(
                (
                    t,
                ): t is {
                    color: PlayerColor;
                    index: number;
                    pos: number;
                    finishing: boolean;
                    justDeployed: boolean;
                    isTeleport: boolean;
                } => t !== null,
            );
    });

    const sortedTokens = [...activeTokens].sort((a, b) => (a.color === myColor ? 1 : 0) - (b.color === myColor ? 1 : 0));

    return (
        <AnimatePresence>
            {stepRipples.map((rp) => (
                <div
                    key={`ripple-${rp.id}`}
                    className={`token-step-ripple ${rp.isFinal ? 'is-final' : ''}`}
                    style={
                        {
                            gridRow: rp.r,
                            gridColumn: rp.c,
                            animationDelay: `${rp.delayMs}ms`,
                            '--ripple-color': rp.hex,
                        } as React.CSSProperties
                    }
                    aria-hidden="true"
                />
            ))}
            {sortedTokens.map(({ color, index, pos, finishing, justDeployed, isTeleport }) => {
                const targetPt = getBoardCoordinate(pos, color, colorCorner);

                let offset = { x: 0, y: 0 };
                let stackScale = 1;
                let stackZ = 0;
                if (targetPt && !finishing) {
                    const key = `${targetPt.r}-${targetPt.c}`;
                    const stack = occupancy[key] || [];
                    if (stack.length > 1) {
                        const sorted = [...stack].sort((a, b) => (a.color === myColor ? 1 : 0) - (b.color === myColor ? 1 : 0));
                        const myStackIdx = sorted.findIndex((s) => s.color === color && s.index === index);
                        stackZ = Math.max(0, myStackIdx);
                        stackScale = sorted.length === 2 ? 0.6 : sorted.length === 3 ? 0.5 : 0.45;
                        const grids: Record<number, { x: number; y: number }[]> = {
                            2: [{ x: -12, y: -6 }, { x: 12, y: 6 }],
                            3: [{ x: -12, y: 8 }, { x: 12, y: 8 }, { x: 0, y: -10 }],
                            4: [{ x: -12, y: -9 }, { x: 12, y: -9 }, { x: -12, y: 9 }, { x: 12, y: 9 }],
                        };
                        const pts =
                            grids[sorted.length] ||
                            sorted.map((_, i) => {
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
                const isSelfFinished = myColor ? posMap[myColor].every((p: number) => p === BOARD_FINISH_INDEX) : false;
                const canHelpTeammate = isTeammateColor && isSelfFinished && playerCount === '2v2';

                const isDraggable =
                    !finishing &&
                    isItsMyTurn &&
                    localGameState.gamePhase === 'moving' &&
                    (color === myColor || canHelpTeammate);

                const diceVal: number | null = localGameState.diceValue ?? null;
                const effectiveSteps: number | null = diceVal;
                const isValidMove =
                    isDraggable &&
                    effectiveSteps !== null &&
                    calculateNextPosition(pos, effectiveSteps, color, colorCorner) !== pos;
                const shielded = (localGameState.activeShields || []).some(
                    (s) => s.color === color && s.tokenIdx === index,
                );
                const targetable = !!targetingColor && color === targetingColor && pos >= 0 && pos < 52;
                const boosted = localGameState.boostTrail === color;
                const boostArmed =
                    localGameState.activeBoost === color ||
                    (localGameState.currentPlayer === color && localGameState.boostPendingDice != null);

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
                        boostArmed={boostArmed}
                        themeId={themeId}
                        justDeployed={justDeployed}
                        isTeleport={isTeleport}
                        isFinishing={finishing}
                        occupiedKeys={occupiedKeys}
                        onHoverChange={(hovering) => onTokenHover?.(hovering ? { color, index } : null)}
                        onClick={() => (targetable && onTargetToken ? onTargetToken(color, index) : handleTokenClick(color, index))}
                    />
                );
            })}
            {captureBursts.map((b) => (
                <ShatterFX key={`burst-${b.id}`} pt={b.pt} color={b.color} />
            ))}
            {finishBursts.map((b) => (
                <FinishFX key={`finish-${b.id}`} pt={b.pt} color={b.color} counterRotationDeg={counterRotationDeg} />
            ))}
            {runHomeGhosts.map((g) => (
                <RunHomeGhost
                    key={`ghost-${g.id}`}
                    color={g.color}
                    fromPos={g.fromPos}
                    tokenIndex={g.index}
                    cc={colorCorner}
                    counterRotationDeg={counterRotationDeg}
                    onDone={() => {
                        setRunHomeGhosts((cur) => cur.filter((x) => x.id !== g.id));
                        const key = `${g.color}-${g.index}`;
                        setTracked((cur) => {
                            if (!cur.returningYardKeys[key]) return cur;
                            const nextRet = { ...cur.returningYardKeys };
                            delete nextRet[key];
                            return { ...cur, returningYardKeys: nextRet };
                        });
                    }}
                />
            ))}
        </AnimatePresence>
    );
}
