"use client";
import React from 'react';
import { motion } from 'framer-motion';
import { gsap } from 'gsap';
import { PlayerColor, GameState } from '@/lib/types';
import { Point, getBoardCoordinate, ColorCorner } from '@/lib/boardLayout';
import { getIntermediatePathCoords, calculateNextPosition } from '@/lib/gameLogic';
import { BASE_INDEX, BOARD_FINISH_INDEX } from '@/lib/constants';
import { ChessRank, ChessPiece, COLOR_PIECE, RANK_ORDER, shade } from '../ChessTokens';
import { Token, ShatterFX, RunHomeGhost, colorMapSafe, alphaHex } from './TokenVisual';


interface TokenPieceProps {
    color: PlayerColor;
    index: number;
    pos: number;
    targetPt: Point | null;
    offset: { x: number, y: number };
    stackScale?: number;
    stackZ?: number;
    isDraggable: boolean;
    isValidMove: boolean;
    isColorTurn: boolean;
    counterRotationDeg: number;
    colorCorner: ColorCorner;
    shielded?: boolean;
    targetable?: boolean;
    boosted?: boolean;
    onClick: () => void;
}

export function TokenPiece({
    color,
    index,
    pos,
    targetPt,
    offset,
    stackScale = 1,
    stackZ = 0,
    isDraggable,
    isValidMove,
    isColorTurn,
    counterRotationDeg,
    colorCorner,
    shielded = false,
    targetable = false,
    boosted = false,
    onClick
}: TokenPieceProps) {
    const [visualPt, setVisualPt] = React.useState<Point | null>(targetPt);
    const prevPosRef = React.useRef(pos);
    const isAnimatingRef = React.useRef(false);
    const cellRef = React.useRef<HTMLDivElement | null>(null);
    const glideRef = React.useRef<HTMLDivElement | null>(null);
    const hopRef = React.useRef<HTMLDivElement | null>(null);
    const shadowRef = React.useRef<HTMLDivElement | null>(null);
    const tlRef = React.useRef<gsap.core.Timeline | null>(null);
    const mountedRef = React.useRef(false);
    const [showShockwave, setShowShockwave] = React.useState(false);
    const [isMoving, setIsMoving] = React.useState(false);

    // Entrance for tokens coming OUT of the base: drop in + squash landing
    const playSpawn = React.useCallback(() => {
        console.log('[move-debug] spawn', color, 'at pos', pos);
        setShowShockwave(true);
        setTimeout(() => setShowShockwave(false), 450);
        gsap.fromTo(hopRef.current,
            { y: -46, scaleX: 0.9, scaleY: 1.18, opacity: 0 },
            { y: 0, scaleX: 1, scaleY: 1, opacity: 1, duration: 0.5, ease: 'back.out(1.5)' });
        gsap.fromTo(shadowRef.current, { opacity: 0 }, { opacity: 0.9, duration: 0.45 });
    }, [color, pos]);

    // Pixel size of one grid cell — layout units (offsetWidth/Height), NOT
    // getBoundingClientRect: rects are post-transform, and GSAP translates
    // in local pre-transform space. Mixing the two scales the path wrong.
    const measureCell = () => {
        const el = cellRef.current;
        return { w: el?.offsetWidth ?? 0, h: el?.offsetHeight ?? 0 };
    };

    const playLanding = React.useCallback(() => {
        setShowShockwave(true);
        setTimeout(() => setShowShockwave(false), 450);
        // Settle: squash -> recover -> rest
        gsap.timeline()
            .to(hopRef.current, { scaleY: 0.84, scaleX: 1.16, y: 3, duration: 0.12, ease: 'power2.out' })
            .to(hopRef.current, { scaleY: 1.05, scaleX: 0.97, y: -2, duration: 0.14, ease: 'sine.inOut' })
            .to(hopRef.current, { scaleY: 1, scaleX: 1, y: 0, duration: 0.16, ease: 'sine.out' });
        gsap.timeline()
            .to(shadowRef.current, { opacity: 1, duration: 0.1 })
            .to(shadowRef.current, { opacity: 0.9, duration: 0.25 });
    }, []);

    // Fast-forward any in-flight movement to its end state so a new move
    // can start cleanly (no orphaned tweens fighting over transforms).
    const finishNow = React.useCallback(() => {
        tlRef.current?.kill();
        tlRef.current = null;
        gsap.killTweensOf([glideRef.current, hopRef.current, shadowRef.current]);
        gsap.set([glideRef.current, hopRef.current], { x: 0, y: 0, scaleX: 1, scaleY: 1 });
        gsap.set(shadowRef.current, { opacity: 0.9 });
        setIsMoving(false);
    }, []);

    // Latest render context, readable from the pos-only effect below without
    // re-triggering it (targetPt is a fresh object every parent render).
    const ctxRef = React.useRef({ color, colorCorner, targetPt });
    ctxRef.current = { color, colorCorner, targetPt };

    // Layout effect: slot-commit (setVisualPt) and the GSAP offset-set must
    // land in the same paint — useEffect would paint the mismatched frame.
    React.useLayoutEffect(() => {
        const { color: c, colorCorner: cc, targetPt: tp } = ctxRef.current;
        if (!tp || prevPosRef.current === pos) {
            // First mount of a board token = it just left the base
            if (!mountedRef.current && tp) {
                mountedRef.current = true;
                playSpawn();
            }
            return;
        }
        mountedRef.current = true;

        const oldPos = prevPosRef.current;
        prevPosRef.current = pos;

        // End any running move before deciding how to play this one.
        if (isAnimatingRef.current) {
            finishNow();
            isAnimatingRef.current = false;
        }

        // Teleport cases: BASE -> Board or Board -> BASE (Capture)
        if (Number(oldPos) === BASE_INDEX || Number(pos) === BASE_INDEX) {
            console.log('[move-debug]', c, Number(pos) === BASE_INDEX ? 'captured -> base' : 'base-exit', `${oldPos} -> ${pos}`);
            setVisualPt(tp);
            playLanding();
            return;
        }

        // Movement: ONE tween across all waypoints (no per-cell restarts).
        // Grid snaps once to the destination; a keyframed offset walks the
        // exact pixel path at constant speed while a rhythmic bob rides on top.
        if (Number(pos) > Number(oldPos)) {
            const pts = getIntermediatePathCoords(Number(oldPos), Number(pos), c, cc);
            if (pts.length > 0) {
                isAnimatingRef.current = true;
                const { w: cw0, h: ch0 } = measureCell();
                const cw = cw0 || 48, ch = ch0 || 48;
                const startPt = getBoardCoordinate(Number(oldPos), c, cc);
                const all = startPt ? [startPt, ...pts] : [...pts];
                // Guarantee the walk terminates exactly at the real destination
                if (all[all.length - 1].r !== tp.r || all[all.length - 1].c !== tp.c) {
                    all.push(tp);
                }
                const final = all[all.length - 1];
                const n = all.length - 1; // number of cells travelled
                // Uniform total time: every move (1..6) takes the same wall time
                const TOTAL = 1.3;
                const cellDur = TOTAL / n;

                // Waypoint offsets relative to the final cell (single snap).
                // The element's grid slot IS the final cell, so the offset for
                // waypoint p must be (p - final) — start lands at (start-final).
                const xs = all.map(p => (p.c - final.c) * cw);
                const ys = all.map(p => (p.r - final.r) * ch);

                setVisualPt(final);

                // Immediate write: the offset MUST be on the element before
                // this paint, or the token flashes at its destination cell.
                // (tl.set would defer to the timeline's first tick — too late.)
                gsap.set(glideRef.current, { x: xs[0], y: ys[0] });

                // ONE GSAP timeline: DISCRETE cell-by-cell hops.
                // Each cell = leap (travel while airborne) -> land -> beat.
                tlRef.current?.kill();
                const tl = gsap.timeline({
                    onComplete: () => {
                        isAnimatingRef.current = false;
                        setIsMoving(false);
                        playLanding();
                    },
                });
                tlRef.current = tl;

                const glide = glideRef.current, hop = hopRef.current, shadow = shadowRef.current;
                const LEAP = cellDur * 0.79;   // airborne travel per cell
                const BEAT = cellDur * 0.21;   // grounded pause between cells
                const UP = cellDur * 0.32;
                const DOWN = cellDur * 0.47;

                setIsMoving(true);
                for (let i = 0; i < n; i++) {
                    const t0 = i * cellDur;
                    // constant-velocity travel: no decel/re-accel pulse at corners
                    tl.to(glide, { x: xs[i + 1], y: ys[i + 1], duration: LEAP, ease: 'none' }, t0);
                    // leap up, then fall (vertical only — no lateral wobble)
                    tl.to(hop, { y: -18, duration: UP, ease: 'power2.out' }, t0)
                      .to(hop, { y: 0, duration: DOWN, ease: 'power2.in' }, t0 + UP);
                    // shadow dims while airborne, restores on touchdown
                    tl.to(shadow, { opacity: 0.5, duration: UP, ease: 'power2.out' }, t0)
                      .to(shadow, { opacity: 0.9, duration: DOWN, ease: 'power2.in' }, t0 + UP);
                }
            } else {
                setVisualPt(tp);
            }
        } else {
            setVisualPt(tp);
        }
    }, [pos]);

    if (!visualPt) return null;

    return (
        <motion.div
            ref={cellRef}
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{
                opacity: 1,
                scale: stackScale,
                x: offset.x,
                y: offset.y,
            }}
            exit={{
                y: 36,
                scale: 0.3,
                opacity: 0,
                rotate: -16,
                filter: 'blur(5px) brightness(65%)',
                transition: { duration: 0.38, ease: 'backIn' }
            }}
            transition={{
                x: { duration: 0 },
                y: { duration: 0 },
                default: { duration: 0.2 },
            }}
            style={{
                gridRow: visualPt.r,
                gridColumn: visualPt.c,
                width: '100%',
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: isAnimatingRef.current ? 60 : 20 + stackZ * 2 + (isColorTurn ? 10 : 0),
                position: 'relative',
            }}
        >
            {/* Grounded drop shadow: dims while airborne (GSAP-driven) */}
            <div
                ref={shadowRef}
                className="absolute left-1/2 bottom-[2px] pointer-events-none"
                style={{
                    width: '62%',
                    height: 10,
                    marginLeft: '-31%',
                    borderRadius: '50%',
                    background: 'radial-gradient(ellipse, rgba(0,0,0,0.5) 0%, rgba(0,0,0,0.18) 55%, transparent 75%)',
                    opacity: 0.9,
                }}
            />
            {/* Path glide: GSAP carries the piece across real pixel distance (board-local) */}
            <div
                ref={glideRef}
                style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
            {/* Upright wrapper: counterRotationDeg is already negative (-boardRotation),
                so rotating by it cancels the board's rotation — everything inside
                lives in SCREEN space and the hop below is a true vertical hop */}
            <div
                style={{
                    width: '100%', height: '100%',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    transform: `rotate(${counterRotationDeg}deg)`,
                }}
            >
            {/* Idle breathing for the active player */}
            <motion.div
                style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                animate={(isColorTurn && !isMoving) ? { scale: [1, 1.05, 1] } : { scale: 1 }}
                transition={isColorTurn ? { repeat: Infinity, duration: 1.5, ease: "easeInOut" } : { duration: 0.2 }}
            >
                {/* Hop / landing: GSAP y is now SCREEN-vertical */}
                <div
                    ref={hopRef}
                    style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                    <Token
                        color={color}
                        count={1}
                        isDraggable={isDraggable}
                        isValidMove={isValidMove}
                        counterRotationDeg={counterRotationDeg}
                        onClick={onClick}
                        pos={pos}
                        skipRotation
                        shielded={shielded}
                        targetable={targetable}
                        boosted={boosted}
                    />
                </div>
            </motion.div>
            </div>
            </div>
            {showShockwave && (
                <motion.div
                    className="absolute left-1/2 bottom-[2px] pointer-events-none rounded-full"
                    style={{
                        width: 30, height: 12, marginLeft: -15,
                        border: `2px solid ${shade(colorMapSafe(color), 50)}`,
                        boxShadow: `0 0 10px ${alphaHex(colorMapSafe(color), 0.7)}`,
                    }}
                    initial={{ scale: 0.4, opacity: 0.85, y: 0 }}
                    animate={{ scale: 1.8, opacity: 0, y: 4 }}
                    transition={{ duration: 0.42, ease: 'easeOut' }}
                />
            )}
        </motion.div>
    );
}
