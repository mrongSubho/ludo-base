import React, { useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { gsap } from 'gsap';
import { PlayerColor } from '@/lib/types';
import { Player } from '@/hooks/useGameEngine';
import { Point, getBoardCoordinate, ColorCorner, CORNER_SLOTS } from '@/lib/boardLayout';
import { getTeammateColor, getIntermediatePathCoords, calculateNextPosition } from '@/lib/gameLogic';
import { BASE_INDEX, BOARD_FINISH_INDEX } from '@/lib/constants';
import { ChessRank, ChessPiece, getTokenRank, RANK_ORDER, shade } from './ChessTokens';

interface BoardTokensProps {
    players: Player[];
    localGameState: any;
    colorCorner: ColorCorner;
    address: string | undefined;
    playerCount: '1v1' | '4P' | '2v2';
    handleTokenClick: (color: PlayerColor, tokenIndex: number) => void;
    counterRotationDeg?: number;
}

function alphaHex(hex: string, a: number): string {
    const n = parseInt(hex.replace('#', ''), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/* ── Promotion FX: expanding glow ring + flash + radial sparkles ── */
const PromoFX = ({ color }: { color: string }) => {
    const light = shade(colorMapSafe(color), 55);
    return (
        <>
            <motion.div
                className="absolute inset-0 pointer-events-none rounded-full"
                style={{ background: 'radial-gradient(circle, rgba(255,255,255,0.9) 0%, transparent 60%)' }}
                initial={{ scale: 0.4, opacity: 0.9 }}
                animate={{ scale: 1.9, opacity: 0 }}
                transition={{ duration: 0.3, ease: 'easeOut' }}
            />
            <motion.div
                className="absolute inset-[-30%] pointer-events-none rounded-full"
                style={{ border: `2.5px solid ${light}`, boxShadow: `0 0 14px ${light}, inset 0 0 10px ${alphaHex(light, 0.5)}` }}
                initial={{ scale: 0.35, opacity: 0.95 }}
                animate={{ scale: 2.15, opacity: 0 }}
                transition={{ duration: 0.65, ease: 'easeOut' }}
            />
            {Array.from({ length: 8 }).map((_, i) => {
                const ang = ((i * 45) + 15) * (Math.PI / 180);
                const dist = i % 2 === 0 ? 44 : 32;
                return (
                    <motion.span
                        key={i}
                        className="absolute left-1/2 top-1/2 pointer-events-none"
                        style={{
                            width: 7, height: 7,
                            background: '#ffffff',
                            boxShadow: `0 0 7px ${light}`,
                            clipPath: 'polygon(50% 0, 100% 50%, 50% 100%, 0 50%)',
                        }}
                        initial={{ x: '-50%', y: '-50%', opacity: 1, scale: 0.4, rotate: 0 }}
                        animate={{
                            x: `calc(-50% + ${Math.cos(ang) * dist}px)`,
                            y: `calc(-50% + ${Math.sin(ang) * dist}px)`,
                            opacity: 0, scale: 1.05, rotate: 170,
                        }}
                        transition={{ duration: 0.62, ease: 'easeOut', delay: i * 0.02 }}
                    />
                );
            })}
        </>
    );
};

const colorMapSafe = (color: string): string => {
    const map: Record<string, string> = { green: '#10b981', red: '#ef4444', yellow: '#eab308', blue: '#3b82f6' };
    return map[color] || '#10b981';
};

interface TokenProps {
    color: string;
    onClick?: () => void;
    isDraggable?: boolean;
    isValidMove?: boolean;
    count?: number;
    isBlockade?: boolean;
    counterRotationDeg?: number;
    rank?: ChessRank;
    pos?: number;
    skipRotation?: boolean;
}

export function Token({
    color,
    onClick,
    isDraggable,
    isValidMove = false,
    count = 1,
    isBlockade = false,
    counterRotationDeg = 0,
    rank = 'Pawn',
    pos = -1,
    skipRotation = false,
}: TokenProps) {
    const prevRef = useRef<{ rank: ChessRank; pos: number } | null>(null);
    const [showPromoFX, setShowPromoFX] = React.useState(false);

    React.useEffect(() => {
        const prev = prevRef.current;
        prevRef.current = { rank, pos };
        if (!prev) return;
        if (RANK_ORDER[rank] > RANK_ORDER[prev.rank]) {
            setShowPromoFX(true);
            const t = setTimeout(() => setShowPromoFX(false), 750);
            return () => clearTimeout(t);
        }
    }, [rank, pos]);

    const showValid = !!isValidMove && !!isDraggable;
    const isDimmed = !showValid && !!isDraggable && pos !== -1 && pos !== 57;
    // isDraggable is true when it's my turn & phase moving, but token can't actually move -> dim
    const shouldDim = isDraggable && !isValidMove;
    return (
        <motion.div
            initial={false}
            style={{
                rotate: skipRotation ? 0 : counterRotationDeg,
                display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}
            className={`ludo-token ${color}-token ${isBlockade ? 'token-blockade' : ''} ${showValid ? 'token-valid' : ''} ${shouldDim ? 'token-dimmed' : ''}`}
            onClick={onClick}
            // "Premium" Hover: Higher scale + lift + subtle bloom
            whileHover={isDraggable ? {
                scale: 1.25,
                y: -6,
                filter: 'brightness(1.1) drop-shadow(0px 8px 15px rgba(0,0,0,0.4))',
                transition: { duration: 0.15, ease: "easeOut" }
            } : { scale: 1.1 }}
            whileTap={{ scale: 0.9, y: 0 }}
        >
            {/* Pulse wrapper: draggable pulse lives here so CSS transform
                can never wipe the root's counter-rotation */}
            <div
                className={isDraggable ? 'ludo-token-pulse' : ''}
                style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
            <AnimatePresence mode="wait">
                <motion.div
                    key={rank}
                    initial={{ y: 26, scale: 0.4, opacity: 0, filter: 'brightness(280%)' }}
                    animate={{ y: 0, scale: [1.18, 0.96, 1], opacity: 1, filter: 'brightness(100%)' }}
                    exit={{
                        y: 30, scale: 0.3, rotate: -20, opacity: 0,
                        filter: 'blur(5px) brightness(65%)',
                        transition: { duration: 0.32, ease: 'backIn' }
                    }}
                    transition={{
                        y: { type: "spring", stiffness: 520, damping: 24 },
                        scale: { duration: 0.42, times: [0, 0.6, 1], ease: "easeOut" },
                        opacity: { duration: 0.16 },
                        filter: { duration: 0.5, ease: 'easeOut' },
                    }}
                    className="w-full h-full flex items-center justify-center p-0.5 relative"
                >
                    <ChessPiece color={color} rank={rank} />
                    {showPromoFX && <PromoFX color={color} />}
                    {showValid && (
                        <>
                            <motion.div
                                className="token-valid-ring"
                                style={{ borderColor: colorMapSafe(color) }}
                                initial={{ scale: 0.7, opacity: 0 }}
                                animate={{ scale: [0.7, 1.35], opacity: [0.9, 0] }}
                                transition={{ duration: 1.1, repeat: Infinity, ease: "easeOut" }}
                            />
                            <motion.div
                                className="token-valid-ring token-valid-ring--delayed"
                                style={{ borderColor: colorMapSafe(color) }}
                                initial={{ scale: 0.7, opacity: 0 }}
                                animate={{ scale: [0.7, 1.35], opacity: [0.9, 0] }}
                                transition={{ duration: 1.1, repeat: Infinity, ease: "easeOut", delay: 0.55 }}
                            />
                            <motion.div
                                className="token-valid-arrow"
                                style={{ color: colorMapSafe(color) }}
                                animate={{ y: [0, -6, 0] }}
                                transition={{ duration: 0.9, repeat: Infinity, ease: "easeInOut" }}
                            >
                                <svg width="14" height="10" viewBox="0 0 14 10" fill="none">
                                    <path d="M7 9L1 3L2.2 1.8L7 6.6L11.8 1.8L13 3L7 9Z" fill="currentColor" />
                                </svg>
                            </motion.div>
                        </>
                    )}
                </motion.div>
            </AnimatePresence>
            </div>
            {isBlockade && <div className="blockade-glow" />}
        </motion.div>
    );
}

/* ── Capture shatter: shards bursting from the last board cell ── */
const ShatterFX = ({ pt, color }: { pt: Point; color: PlayerColor }) => {
    const base = colorMapSafe(color);
    const light = shade(base, 45);
    const shards = [
        { x: -24, y: 26, r: -140, s: 9 },
        { x: 22, y: 32, r: 120, s: 11 },
        { x: -8, y: 38, r: 200, s: 7 },
        { x: 14, y: 22, r: -90, s: 8 },
        { x: 0, y: 44, r: 160, s: 10 },
    ];
    return (
        <div className="absolute inset-0 pointer-events-none z-[60]" style={{ gridRow: pt.r, gridColumn: pt.c }}>
            {shards.map((sh, i) => (
                <motion.span
                    key={i}
                    className="absolute left-1/2 top-1/2"
                    style={{
                        width: sh.s, height: sh.s,
                        background: `linear-gradient(135deg, ${light}, ${base})`,
                        clipPath: 'polygon(50% 0, 100% 70%, 20% 100%)',
                        boxShadow: `0 0 6px ${alphaHex(base, 0.8)}`,
                    }}
                    initial={{ x: '-50%', y: '-50%', opacity: 1, scale: 1, rotate: 0 }}
                    animate={{ x: `calc(-50% + ${sh.x}px)`, y: `calc(-50% + ${sh.y}px)`, opacity: 0, scale: 0.5, rotate: sh.r }}
                    transition={{ duration: 0.55, ease: 'easeIn', delay: i * 0.03 }}
                />
            ))}
            <motion.div
                className="absolute left-1/2 top-1/2 rounded-full"
                style={{ width: 26, height: 26, marginLeft: -13, marginTop: -13, border: `2px solid ${light}` }}
                initial={{ scale: 0.4, opacity: 0.9 }}
                animate={{ scale: 1.9, opacity: 0 }}
                transition={{ duration: 0.4, ease: 'easeOut' }}
            />
        </div>
    );
};

/* ── Capture run-home: a ghost token sprints backwards along the track ── */
const RunHomeGhost = ({ color, fromPos, cc, counterRotationDeg, onDone }: {
    color: PlayerColor;
    fromPos: number;
    cc: ColorCorner;
    counterRotationDeg: number;
    onDone: () => void;
}) => {
    const travelRef = React.useRef<HTMLDivElement | null>(null);
    const hopRef = React.useRef<HTMLDivElement | null>(null);
    // Stable callback: onDone gets a new identity every parent render, and
    // listing it in deps would restart (loop) the timeline forever.
    const doneRef = React.useRef(onDone);
    doneRef.current = onDone;

    React.useEffect(() => {
        const corner = cc[color];
        const startIdx = corner ? CORNER_SLOTS[corner].startIdx : 0;
        const startPt = getBoardCoordinate(startIdx, color, cc);
        const g = travelRef.current;
        if (!startPt || !g || !hopRef.current) { doneRef.current(); return; }

        // Reverse index walk: capture cell -> ... -> home entry cell
        const idxs: number[] = [];
        if (fromPos >= 52) {
            for (let i = fromPos; i >= 52; i--) idxs.push(i);
            const gate = (startIdx + 50) % 52;
            idxs.push(gate);
            for (let i = gate - 1; i >= startIdx; i--) idxs.push(i);
        } else {
            for (let i = fromPos; i >= startIdx; i--) idxs.push(i);
        }
        const cells = idxs
            .map(i => getBoardCoordinate(i, color, cc))
            .filter((p): p is Point => !!p);
        if (cells.length < 2) { doneRef.current(); return; }

        const xP = cells.map(p => (p.c - startPt.c) * 100);
        const yP = cells.map(p => (p.r - startPt.r) * 100);
        const m = cells.length - 1;
        const step = Math.min(0.09, 2.2 / m); // fast run, bounded total time

        gsap.set(travelRef.current, { xPercent: xP[0], yPercent: yP[0] });
        const tl = gsap.timeline({ onComplete: () => doneRef.current() });
        for (let i = 0; i < m; i++) {
            const t0 = i * step;
            tl.to(travelRef.current, { xPercent: xP[i + 1], yPercent: yP[i + 1], duration: step, ease: 'none' }, t0);
            tl.to(hopRef.current, { y: -12, duration: step * 0.4, ease: 'power2.out' }, t0)
              .to(hopRef.current, { y: 0, duration: step * 0.6, ease: 'power2.in' }, t0 + step * 0.4);
        }
        // dive into the base pad
        tl.to(hopRef.current, { opacity: 0, scale: 0.35, duration: 0.2, ease: 'power2.in' }, '>-=0.02');
        return () => { tl.kill(); };
    }, [color, fromPos, cc]);

    const corner = cc[color];
    const startPt = corner ? getBoardCoordinate(CORNER_SLOTS[corner].startIdx, color, cc) : null;
    if (!startPt) return null;
    return (
        <div
            style={{
                gridRow: startPt.r, gridColumn: startPt.c,
                width: '100%', height: '100%',
                position: 'relative', zIndex: 80, pointerEvents: 'none',
            }}
        >
            <div ref={travelRef} style={{ width: '100%', height: '100%' }}>
                <div
                    style={{
                        width: '100%', height: '100%',
                        transform: `rotate(${counterRotationDeg}deg)`,
                    }}
                >
                    <div
                        ref={hopRef}
                        className={`ludo-token ${color}-token`}
                        style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    >
                        <ChessPiece color={color} rank={getTokenRank(fromPos)} />
                    </div>
                </div>
            </div>
        </div>
    );
};

interface TokenPieceProps {
    color: PlayerColor;
    index: number;
    pos: number;
    targetPt: Point | null;
    offset: { x: number, y: number };
    isDraggable: boolean;
    isValidMove: boolean;
    isColorTurn: boolean;
    counterRotationDeg: number;
    colorCorner: ColorCorner;
    onClick: () => void;
}

export function TokenPiece({
    color,
    index,
    pos,
    targetPt,
    offset,
    isDraggable,
    isValidMove,
    isColorTurn,
    counterRotationDeg,
    colorCorner,
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

                // TEMP DEBUG: trace every animated move (console.log = visible by default)
                console.log('[move-debug]', c, `${oldPos}->${pos}`, {
                    rank: getTokenRank(pos),
                    path: all.map(p => `${p.r},${p.c}`),
                    cell: `${Math.round(cw)}x${Math.round(ch)}`,
                    from: `x${Math.round(xs[0])},y${Math.round(ys[0])}`,
                });

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
                scale: 1,
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
                zIndex: isAnimatingRef.current ? 50 : (isColorTurn ? 30 : 10 + index),
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
                        rank={getTokenRank(pos)}
                        pos={pos}
                        skipRotation
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
    const [runHomeGhosts, setRunHomeGhosts] = React.useState<{ id: number; fromPos: number; color: PlayerColor }[]>([]);
    const burstIdRef = React.useRef(0);

    React.useEffect(() => {
        const prev = prevPositionsRef.current;
        const bursts: { id: number; pt: Point; color: PlayerColor }[] = [];
        const ghosts: { id: number; fromPos: number; color: PlayerColor }[] = [];
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
            });
        });
        prevPositionsRef.current = JSON.parse(JSON.stringify(localGameState.positions));
        if (bursts.length === 0) return;
        setCaptureBursts(b => [...b, ...bursts]);
        setRunHomeGhosts(g => [...g, ...ghosts]);
        const timers = bursts.map(b => setTimeout(() => {
            setCaptureBursts(cur => cur.filter(x => x.id !== b.id));
        }, 700));
        return () => timers.forEach(clearTimeout);
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

    // Destination markers for valid moves — shows where the token will land
    const diceForDest: number | null = localGameState.diceValue ?? null;
    const isMovingPhase = localGameState.gamePhase === 'moving' && diceForDest !== null;
    const destMarkers: { key: string; pt: Point; color: PlayerColor }[] = [];
    if (isMovingPhase) {
        // On-board tokens
        activeTokens.forEach(({ color, pos, index }) => {
            const isItsMyTurn = localGameState.currentPlayer === myColor;
            const teammate = getTeammateColor(myColor as PlayerColor, playerCount);
            const isTeammateColor = teammate === color;
            const posMap = localGameState.positions as Record<PlayerColor, number[]>;
            const isSelfFinished = myColor ? posMap[myColor].every((p: number) => p === 57) : false;
            const canHelpTeammate = isTeammateColor && isSelfFinished && playerCount === '2v2';
            const isDraggable = isItsMyTurn && (color === myColor || canHelpTeammate);
            if (!isDraggable) return;
            const next = calculateNextPosition(pos, diceForDest!, color as PlayerColor, colorCorner);
            if (next === pos) return;
            const pt = getBoardCoordinate(next, color as PlayerColor, colorCorner);
            if (pt) destMarkers.push({ key: `${color}-${index}-dest`, pt, color });
        });
        // Home tokens that can enter (dice 6)
        if (diceForDest === 6) {
            (['green','red','yellow','blue'] as PlayerColor[]).forEach(color => {
                if (!players.some(p => p.color === color)) return;
                const isItsMyTurn = localGameState.currentPlayer === myColor;
                const isDraggable = isItsMyTurn && (color === myColor) && localGameState.gamePhase === 'moving';
                if (!isDraggable) return;
                const arr: number[] = localGameState.positions[color] || [];
                arr.forEach((pos, idx) => {
                    if (Number(pos) !== BASE_INDEX) return;
                    const next = calculateNextPosition(BASE_INDEX, 6, color, colorCorner);
                    const pt = getBoardCoordinate(next, color, colorCorner);
                    if (pt && !destMarkers.some(m => m.pt.r === pt.r && m.pt.c === pt.c)) {
                        destMarkers.push({ key: `${color}-home-${idx}-dest`, pt, color });
                    }
                });
            });
        }
    }

    return (
        <AnimatePresence>
            {/* Valid destination markers — subtle landing targets */}
            {isMovingPhase && destMarkers.map(({ key, pt, color }) => (
                <motion.div
                    key={key}
                    initial={{ scale: 0, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0, opacity: 0 }}
                    transition={{ duration: 0.25, ease: "easeOut" }}
                    className="token-destination-marker"
                    style={{
                        gridRow: pt.r,
                        gridColumn: pt.c,
                        borderColor: colorMapSafe(color),
                        boxShadow: `0 0 10px ${alphaHex(colorMapSafe(color), 0.8)}`,
                    }}
                >
                    <motion.div
                        className="token-destination-inner"
                        style={{ background: alphaHex(colorMapSafe(color), 0.18), borderColor: alphaHex(colorMapSafe(color), 0.45) }}
                        animate={{ scale: [1, 1.15, 1], opacity: [0.7, 1, 0.7] }}
                        transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
                    />
                </motion.div>
            ))}
            {activeTokens.map(({ color, index, pos }) => {
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

                const diceVal: number | null = localGameState.diceValue ?? null;
                const isValidMove = isDraggable && diceVal !== null
                    && calculateNextPosition(pos, diceVal, color as PlayerColor, colorCorner) !== pos;

                return (
                    <TokenPiece
                        key={`${color}-${index}`}
                        color={color}
                        index={index}
                        pos={pos}
                        targetPt={targetPt}
                        offset={offset}
                        isDraggable={isDraggable}
                        isValidMove={isValidMove}
                        isColorTurn={localGameState.currentPlayer === color}
                        counterRotationDeg={counterRotationDeg}
                        colorCorner={colorCorner}
                        onClick={() => handleTokenClick(color, index)}
                    />
                );
            })}
            {captureBursts.map(b => (
                <ShatterFX key={`burst-${b.id}`} pt={b.pt} color={b.color} />
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
