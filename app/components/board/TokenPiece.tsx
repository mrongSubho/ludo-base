"use client";
import React from 'react';
import { motion } from 'framer-motion';
import { gsap } from 'gsap';
import { measureHop, recordHopSample } from '@/lib/perf/budget';
import { PlayerColor } from '@/lib/types';
import { Point, getBoardCoordinate, ColorCorner } from '@/lib/boardLayout';
import { prefersReducedMotion } from '@/lib/motion';
import { getSoundEngine } from '@/lib/audio/SoundEngine';
import { usePreferences } from '@/hooks/usePreferences';
import { DOT_POSITIONS, resolveDiceThemeId, type DiceFaceNumber, type DiceThemeId } from '@/lib/diceVisuals';
import {
    classifyTokenTransition,
    computeHopCadence,
    computeScreenSpaceLeanDeg,
    computeYardSlotCoord,
} from '@/lib/tokenMovement';
import { shade } from '../ChessTokens';
import { Token, colorMapSafe, alphaHex } from './TokenVisual';

interface TokenPieceProps {
    color: PlayerColor;
    index: number;
    pos: number;
    targetPt: Point | null;
    offset: { x: number; y: number };
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
    boostArmed?: boolean;
    themeId?: DiceThemeId;
    justDeployed?: boolean;
    isTeleport?: boolean;
    isFinishing?: boolean;
    occupiedKeys?: ReadonlySet<string>;
    onClick: () => void;
    onHoverChange?: (hovering: boolean) => void;
}

const FACTION_HEX_BY_THEME: Record<DiceThemeId, Record<PlayerColor, string>> = {
    '3077': {
        green: '#00FF66',
        red: '#FF0055',
        yellow: '#FFD000',
        blue: '#0099FF',
    },
    retro: {
        green: '#34d399',
        red: '#fb7185',
        yellow: '#fbbf24',
        blue: '#5ce1ff',
    },
    daybreak: {
        green: '#16a34a',
        red: '#dc2626',
        yellow: '#ca8a04',
        blue: '#2563eb',
    },
};

/**
 * Floating 3D isometric miniature step-die hovering above a moving piece.
 * Displays remaining step pips (6..1) or overdrive counter (+7..+12) per theme.
 */
function TokenStepCrown({
    remaining,
    boosted,
    themeId,
    color,
}: {
    remaining: number;
    boosted: boolean;
    themeId: DiceThemeId;
    color: PlayerColor;
}) {
    const faceNum = Math.max(1, Math.min(6, remaining)) as DiceFaceNumber;
    const isOverdrive = remaining > 6;
    const factionHex = FACTION_HEX_BY_THEME[themeId]?.[color] ?? '#22d3ee';
    const pipAccent = themeId === 'daybreak'
        ? (faceNum === 1 ? '#dc2626' : '#18181b')
        : boosted
          ? '#fbbf24'
          : themeId === '3077'
            ? factionHex
            : '#f8fafc';

    return (
        <div
            className={`token-step-crown theme-${themeId} ${boosted || isOverdrive ? 'is-overdrive' : ''}`}
            data-dice-theme={themeId}
            aria-hidden="true"
        >
            <div className="token-step-crown-top" />
            <div className="token-step-crown-side" />
            <div className="token-step-crown-face">
                {isOverdrive ? (
                    <span className="token-crown-overdrive">+{remaining}</span>
                ) : (
                    DOT_POSITIONS[faceNum].map(([x, y], pipIdx) => (
                        <span
                            key={pipIdx}
                            className={`token-crown-pip ${faceNum === 1 ? 'is-ace' : ''}`}
                            style={{
                                left: `${x}%`,
                                top: `${y}%`,
                                backgroundColor: pipAccent,
                                boxShadow:
                                    themeId === 'daybreak'
                                        ? 'inset 0 1px 0 rgba(0,0,0,0.28)'
                                        : `0 0 5px ${pipAccent}`,
                            }}
                        />
                    ))
                )}
            </div>
        </div>
    );
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
    boostArmed = false,
    themeId: explicitThemeId,
    justDeployed = false,
    isTeleport = false,
    isFinishing = false,
    occupiedKeys,
    onClick,
    onHoverChange,
}: TokenPieceProps) {
    const { preferences } = usePreferences();
    const activeThemeId = explicitThemeId ?? resolveDiceThemeId(preferences?.theme);

    const [visualPt, setVisualPt] = React.useState<Point | null>(targetPt);
    const prevPosRef = React.useRef(pos);
    const isAnimatingRef = React.useRef(false);
    const cellRef = React.useRef<HTMLDivElement | null>(null);
    const glideRef = React.useRef<HTMLDivElement | null>(null);
    const hopRef = React.useRef<HTMLDivElement | null>(null);
    const shadowRef = React.useRef<HTMLDivElement | null>(null);
    const crownRef = React.useRef<HTMLDivElement | null>(null);

    const tlRef = React.useRef<gsap.core.Timeline | null>(null);
    const settleTlRef = React.useRef<gsap.core.Timeline | null>(null);
    const crownFadeRef = React.useRef<gsap.core.Tween | null>(null);
    const shockTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    const mountedRef = React.useRef(false);

    const [showShockwave, setShowShockwave] = React.useState(false);
    const [isMoving, setIsMoving] = React.useState(false);
    const [isFinishedHidden, setIsFinishedHidden] = React.useState(false);
    const [crownState, setCrownState] = React.useState<{ remaining: number; boosted: boolean } | null>(null);

    const triggerShockwave = React.useCallback((durationMs = 440) => {
        if (shockTimerRef.current) clearTimeout(shockTimerRef.current);
        setShowShockwave(true);
        shockTimerRef.current = setTimeout(() => {
            shockTimerRef.current = null;
            setShowShockwave(false);
        }, durationMs);
    }, []);

    // Pixel size of one grid cell in local un-rotated board coordinates.
    const measureCell = () => {
        const el = cellRef.current;
        return { w: el?.offsetWidth ?? 0, h: el?.offsetHeight ?? 0 };
    };

    const dismissCrown = React.useCallback((immediate = false) => {
        crownFadeRef.current?.kill();
        crownFadeRef.current = null;
        if (immediate || prefersReducedMotion() || !crownRef.current) {
            setCrownState(null);
            return;
        }
        crownFadeRef.current = gsap.to(crownRef.current, {
            y: -22,
            scale: 0.3,
            opacity: 0,
            duration: 0.16,
            ease: 'power2.in',
            onComplete: () => {
                crownFadeRef.current = null;
                setCrownState(null);
            },
        });
    }, []);

    const playLanding = React.useCallback((finishingEntry = false) => {
        triggerShockwave(finishingEntry ? 520 : 440);
        if (prefersReducedMotion()) {
            if (finishingEntry) setIsFinishedHidden(true);
            return;
        }

        settleTlRef.current?.kill();
        if (finishingEntry) {
            const finishTl = gsap.timeline({
                onComplete: () => {
                    setIsFinishedHidden(true);
                },
            });
            finishTl
                .to(hopRef.current, { scaleY: 0.84, scaleX: 1.18, y: 2.5, duration: 0.08, ease: 'power2.out' })
                .to(hopRef.current, { scaleX: 1.24, scaleY: 1.24, y: -14, opacity: 0, duration: 0.24, ease: 'power2.out' })
                .to(shadowRef.current, { opacity: 0, scaleX: 0.2, duration: 0.18 }, '<');
            settleTlRef.current = finishTl;
            return;
        }

        const settle = gsap.timeline()
            .to(hopRef.current, { scaleY: 0.84, scaleX: 1.16, y: 2.5, duration: 0.085, ease: 'power2.out' })
            .to(hopRef.current, { scaleY: 1.06, scaleX: 0.96, y: -1.5, duration: 0.095, ease: 'sine.inOut' })
            .to(hopRef.current, { scaleY: 1, scaleX: 1, y: 0, rotate: 0, duration: 0.11, ease: 'sine.out' });
        const shadeTl = gsap.timeline()
            .to(shadowRef.current, { opacity: 1, scaleX: 1.14, scaleY: 1.08, duration: 0.08 })
            .to(shadowRef.current, { opacity: 0.9, scaleX: 1, scaleY: 1, duration: 0.18 });
        settleTlRef.current = gsap.timeline().add(settle, 0).add(shadeTl, 0);
    }, [triggerShockwave]);

    const playDeploy = React.useCallback((destPt: Point, yardPt: Point) => {
        getSoundEngine().play('token_spawn');
        if (prefersReducedMotion()) {
            gsap.set(glideRef.current, { x: 0, y: 0 });
            gsap.set(hopRef.current, { y: 0, scaleX: 1, scaleY: 1, rotate: 0, opacity: 1 });
            gsap.set(shadowRef.current, { opacity: 0.9, scaleX: 1, scaleY: 1 });
            triggerShockwave(420);
            isAnimatingRef.current = false;
            setIsMoving(false);
            return;
        }

        const { w: cw0, h: ch0 } = measureCell();
        const cw = cw0 || 48;
        const ch = ch0 || 48;
        const startX = (yardPt.c - destPt.c) * cw;
        const startY = (yardPt.r - destPt.r) * ch;
        const leanDeg = computeScreenSpaceLeanDeg(yardPt, destPt, counterRotationDeg);

        isAnimatingRef.current = true;
        setIsMoving(true);
        setCrownState({ remaining: 6, boosted: false });

        gsap.set(glideRef.current, { x: startX, y: startY });
        gsap.set(hopRef.current, { y: 0, scaleX: 0.85, scaleY: 0.85, rotate: -leanDeg * 0.5, opacity: 1 });
        gsap.set(shadowRef.current, { opacity: 0.75, scaleX: 0.85, scaleY: 0.85 });

        tlRef.current?.kill();
        const tl = gsap.timeline({
            onComplete: () => {
                isAnimatingRef.current = false;
                setIsMoving(false);
                dismissCrown(false);
                playLanding(false);
            },
        });
        tlRef.current = tl;

        const peakY = -Math.min(36, Math.max(26, ch * 0.82));
        tl.to(glideRef.current, { x: 0, y: 0, duration: 0.42, ease: 'power2.out' }, 0);
        tl.to(hopRef.current, { y: peakY, scaleX: 0.92, scaleY: 1.14, rotate: leanDeg, duration: 0.21, ease: 'power2.out' }, 0)
          .to(hopRef.current, { y: 0, scaleX: 1.12, scaleY: 0.88, rotate: 0, duration: 0.21, ease: 'power2.in' }, 0.21);
        tl.to(shadowRef.current, { opacity: 0.28, scaleX: 0.48, scaleY: 0.48, duration: 0.21, ease: 'power2.out' }, 0)
          .to(shadowRef.current, { opacity: 0.92, scaleX: 1.12, scaleY: 1.05, duration: 0.21, ease: 'power2.in' }, 0.21);
        if (crownRef.current) {
            tl.fromTo(
                crownRef.current,
                { y: 6, scale: 0.35, opacity: 0 },
                { y: -4, scale: 1.1, opacity: 1, duration: 0.16, ease: 'back.out(1.8)' },
                0.02,
            ).to(crownRef.current, { y: -10, scale: 1, duration: 0.24, ease: 'sine.inOut' }, 0.18);
        }
    }, [counterRotationDeg, dismissCrown, playLanding, triggerShockwave]);

    const playTeleportArrival = React.useCallback(() => {
        if (prefersReducedMotion()) {
            triggerShockwave(420);
            gsap.set([glideRef.current, hopRef.current], { x: 0, y: 0, scaleX: 1, scaleY: 1, opacity: 1 });
            gsap.set(shadowRef.current, { opacity: 0.9, scaleX: 1, scaleY: 1 });
            if (ctxRef.current.isFinishing) setIsFinishedHidden(true);
            return;
        }
        isAnimatingRef.current = true;
        setIsMoving(true);
        gsap.set(glideRef.current, { x: 0, y: 0 });
        gsap.set(hopRef.current, { scaleX: 0.25, scaleY: 2.0, y: -18, opacity: 0 });
        gsap.set(shadowRef.current, { opacity: 0, scaleX: 0.25 });
        tlRef.current?.kill();
        const tl = gsap.timeline({
            onComplete: () => {
                isAnimatingRef.current = false;
                setIsMoving(false);
                playLanding(ctxRef.current.isFinishing);
            },
        });
        tlRef.current = tl;
        tl.call(() => triggerShockwave(520), undefined, 0.22);
        tl.to(
            hopRef.current,
            { scaleX: 1, scaleY: 1, y: 0, opacity: 1, duration: 0.32, ease: 'back.out(1.9)' },
            0.22,
        );
        tl.to(
            shadowRef.current,
            { opacity: 0.9, scaleX: 1, scaleY: 1, duration: 0.26, ease: 'power2.out' },
            0.22,
        );
    }, [playLanding, triggerShockwave]);

    const finishNow = React.useCallback(() => {
        tlRef.current?.kill();
        tlRef.current = null;
        settleTlRef.current?.kill();
        settleTlRef.current = null;
        crownFadeRef.current?.kill();
        crownFadeRef.current = null;
        if (shockTimerRef.current) {
            clearTimeout(shockTimerRef.current);
            shockTimerRef.current = null;
        }
        gsap.killTweensOf([glideRef.current, hopRef.current, shadowRef.current, crownRef.current]);
        gsap.set([glideRef.current, hopRef.current], { x: 0, y: 0, scaleX: 1, scaleY: 1, rotate: 0, opacity: 1 });
        gsap.set(shadowRef.current, { opacity: 0.9, scaleX: 1, scaleY: 1 });
        setCrownState(null);
        setIsMoving(false);
    }, []);

    React.useEffect(() => () => {
        tlRef.current?.kill();
        settleTlRef.current?.kill();
        crownFadeRef.current?.kill();
        if (shockTimerRef.current) clearTimeout(shockTimerRef.current);
        gsap.killTweensOf([glideRef.current, hopRef.current, shadowRef.current, crownRef.current]);
    }, []);

    const ctxRef = React.useRef({
        color,
        colorCorner,
        targetPt,
        boosted,
        activeThemeId,
        justDeployed,
        isTeleport,
        isFinishing,
        occupiedKeys,
        counterRotationDeg,
    });
    ctxRef.current = {
        color,
        colorCorner,
        targetPt,
        boosted,
        activeThemeId,
        justDeployed,
        isTeleport,
        isFinishing,
        occupiedKeys,
        counterRotationDeg,
    };

    React.useLayoutEffect(() => {
        const {
            color: c,
            colorCorner: cc,
            targetPt: tp,
            boosted: isBoosted,
            activeThemeId: themeId,
            justDeployed: deployedOnMount,
            isTeleport: teleported,
            isFinishing: finishing,
            occupiedKeys: occKeys,
            counterRotationDeg: counterDeg,
        } = ctxRef.current;

        if (!mountedRef.current) {
            mountedRef.current = true;
            prevPosRef.current = pos;
            if (!tp) return;
            setVisualPt(tp);
            if (deployedOnMount && cc[c]) {
                playDeploy(tp, computeYardSlotCoord(cc[c], index));
            }
            return;
        }

        if (!tp || prevPosRef.current === pos) return;

        const oldPos = Number(prevPosRef.current);
        prevPosRef.current = pos;

        if (isAnimatingRef.current) {
            finishNow();
            isAnimatingRef.current = false;
        }
        setIsFinishedHidden(false);

        const transition = classifyTokenTransition({
            oldPos,
            newPos: Number(pos),
            color: c,
            colorCorner: cc,
            tokenIndex: index,
            isTeleport: teleported,
        });

        if (transition.kind === 'none') return;

        if (transition.kind === 'deploy') {
            setVisualPt(transition.targetPt);
            playDeploy(transition.targetPt, transition.yardPt);
            return;
        }

        if (transition.kind === 'capture') {
            setVisualPt(tp);
            playLanding(false);
            return;
        }

        if (transition.kind === 'teleport') {
            setVisualPt(transition.targetPt);
            playTeleportArrival();
            return;
        }

        if (transition.kind === 'hop') {
            const startPt = getBoardCoordinate(oldPos, c, cc);
            const all = startPt ? [startPt, ...transition.waypoints] : [...transition.waypoints];
            if (all[all.length - 1].r !== tp.r || all[all.length - 1].c !== tp.c) {
                all.push(tp);
            }
            const final = all[all.length - 1];
            const n = all.length - 1;
            if (n <= 0) {
                setVisualPt(final);
                return;
            }

            isAnimatingRef.current = true;
            const { w: cw0, h: ch0 } = measureCell();
            const cw = cw0 || 48;
            const ch = ch0 || 48;
            const xs = all.map((p) => (p.c - final.c) * cw);
            const ys = all.map((p) => (p.r - final.r) * ch);

            setVisualPt(final);
            gsap.set(glideRef.current, { x: xs[0], y: ys[0] });

            if (prefersReducedMotion()) {
                gsap.set(glideRef.current, { x: 0, y: 0 });
                gsap.set(hopRef.current, { x: 0, y: 0, scaleX: 1, scaleY: 1, rotate: 0, opacity: 1 });
                getSoundEngine().play('token_land');
                isAnimatingRef.current = false;
                setIsMoving(false);
                if (finishing || transition.isFinishEntry) {
                    setIsFinishedHidden(true);
                }
                return;
            }

            const cadence = computeHopCadence(n, isBoosted, themeId);
            const willFinish = finishing || transition.isFinishEntry;

            void measureHop(`token-hop:${n}c`, () => {
                tlRef.current?.kill();
                const tl = gsap.timeline({
                    onComplete: () => {
                        isAnimatingRef.current = false;
                        setIsMoving(false);
                        dismissCrown(false);
                        playLanding(willFinish);
                    },
                });
                tlRef.current = tl;

                const glide = glideRef.current;
                const hop = hopRef.current;
                const shadow = shadowRef.current;

                setIsMoving(true);
                setCrownState({ remaining: n, boosted: isBoosted });

                // Brief anticipation crouch before launching into step 1
                tl.to(
                    hop,
                    { scaleX: 1.14, scaleY: 0.86, y: 2, duration: cadence.anticipationSec, ease: 'power1.in' },
                    0,
                );
                if (crownRef.current) {
                    tl.fromTo(
                        crownRef.current,
                        { y: 6, scale: 0.35, opacity: 0 },
                        { y: -2, scale: 1.22, opacity: 1, duration: 0.14, ease: 'back.out(2)' },
                        0,
                    );
                }

                for (let i = 0; i < n; i++) {
                    const t0 = cadence.anticipationSec + i * cadence.cellDur;
                    const fromCell = all[i];
                    const toCell = all[i + 1];
                    const cellOccupied = Boolean(occKeys?.has(`${toCell.r}-${toCell.c}`) && i < n - 1);
                    const isFinalFinishJump = willFinish && i === n - 1;
                    const baseJump = Math.min(30, Math.max(18, ch * cadence.jumpScale));
                    const hopHeight =
                        baseJump *
                        (isFinalFinishJump ? 1.45 : cellOccupied ? 1.38 : 1) *
                        (isBoosted ? 1.1 : 1);
                    const leanDeg = computeScreenSpaceLeanDeg(fromCell, toCell, counterDeg);
                    const remainingOnStep = n - i;

                    tl.call(
                        () => {
                            setCrownState({ remaining: remainingOnStep, boosted: isBoosted });
                            getSoundEngine().play('token_hop', {
                                step: i,
                                totalSteps: n,
                                boosted: isBoosted,
                            });
                            if (crownRef.current) {
                                gsap.fromTo(
                                    crownRef.current,
                                    { scale: 1.18, y: -7, rotate: i % 2 === 0 ? -9 : 9 },
                                    { scale: 1, y: -1, rotate: 0, duration: Math.min(0.14, cadence.cellDur * 0.8), ease: 'power2.out' },
                                );
                            }
                        },
                        undefined,
                        t0,
                    );

                    // Horizontal glide across one grid cell in linear continuous progression
                    tl.to(glide, { x: xs[i + 1], y: ys[i + 1], duration: cadence.upSec + cadence.downSec, ease: 'none' }, t0);

                    // Vertical parabolic leap -> impact squash -> quick elastic recover
                    tl.to(
                        hop,
                        { y: -hopHeight, scaleX: 0.89, scaleY: 1.15, rotate: leanDeg, duration: cadence.upSec, ease: 'power2.out' },
                        t0,
                    )
                        .to(
                            hop,
                            { y: 0, scaleX: 1.16, scaleY: 0.85, rotate: -leanDeg * 0.35, duration: cadence.downSec, ease: 'power2.in' },
                            t0 + cadence.upSec,
                        )
                        .to(
                            hop,
                            { scaleX: 1, scaleY: 1, rotate: 0, duration: cadence.recoverSec, ease: 'sine.out' },
                            t0 + cadence.upSec + cadence.downSec,
                        );

                    // Dynamic shadow contraction & dim during peak flight
                    tl.to(
                        shadow,
                        { opacity: 0.26, scaleX: 0.52, scaleY: 0.52, duration: cadence.upSec, ease: 'power2.out' },
                        t0,
                    ).to(
                        shadow,
                        { opacity: 0.92, scaleX: 1.14, scaleY: 1.08, duration: cadence.downSec, ease: 'power2.in' },
                        t0 + cadence.upSec,
                    );
                }
            }).then((m) => recordHopSample(m));
            return;
        }

        setVisualPt(transition.targetPt ?? tp);
    }, [pos, index, dismissCrown, finishNow, playDeploy, playLanding, playTeleportArrival]);

    if (!visualPt) return null;

    const finishExit = isFinishing || isFinishedHidden;

    return (
        <motion.div
            ref={cellRef}
            onMouseEnter={() => isValidMove && onHoverChange?.(true)}
            onMouseLeave={() => onHoverChange?.(false)}
            onFocus={() => isValidMove && onHoverChange?.(true)}
            onBlur={() => onHoverChange?.(false)}
            initial={{ opacity: justDeployed ? 1 : 0, scale: justDeployed ? 1 : 0.6 }}
            animate={{
                opacity: isFinishedHidden ? 0 : 1,
                scale: isMoving ? 1 : stackScale,
                x: isMoving ? 0 : offset.x,
                y: isMoving ? 0 : offset.y,
            }}
            exit={
                finishExit
                    ? {
                          scale: 0.25,
                          y: -10,
                          opacity: 0,
                          transition: { duration: 0.2, ease: 'easeOut' },
                      }
                    : {
                          y: 36,
                          scale: 0.3,
                          opacity: 0,
                          rotate: -16,
                          filter: 'blur(5px) brightness(65%)',
                          transition: { duration: 0.38, ease: 'backIn' },
                      }
            }
            transition={{
                x: { duration: isMoving ? 0 : 0.16, ease: 'easeOut' },
                y: { duration: isMoving ? 0 : 0.16, ease: 'easeOut' },
                default: { duration: 0.18 },
            }}
            style={{
                gridRow: visualPt.r,
                gridColumn: visualPt.c,
                width: '100%',
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: isMoving || isAnimatingRef.current ? 65 : 20 + stackZ * 2 + (isColorTurn ? 10 : 0),
                position: 'relative',
            }}
        >
            {/* Path glide: GSAP carries piece, ground shadow, shockwave, and step-crown in board grid space */}
            <div
                ref={glideRef}
                style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
                {/* Upright screen-space wrapper: cancels board rotation so shadow stays below and hops go vertically UP */}
                <div
                    style={{
                        width: '100%',
                        height: '100%',
                        position: 'relative',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        transform: `rotate(${counterRotationDeg}deg)`,
                    }}
                >
                    {/* Grounded drop shadow: travels with glideRef and scales dynamically on hop apex/landing */}
                    <div
                        ref={shadowRef}
                        className="absolute left-1/2 bottom-[2px] pointer-events-none"
                        style={{
                            width: '64%',
                            height: 10,
                            marginLeft: '-32%',
                            borderRadius: '50%',
                            background: 'radial-gradient(ellipse, rgba(0,0,0,0.52) 0%, rgba(0,0,0,0.18) 55%, transparent 75%)',
                            opacity: 0.9,
                        }}
                    />

                    {showShockwave && (
                        <motion.div
                            className="absolute left-1/2 bottom-[2px] pointer-events-none rounded-full"
                            style={{
                                width: 30,
                                height: 12,
                                marginLeft: -15,
                                border: `2px solid ${shade(colorMapSafe(color), 50)}`,
                                boxShadow: `0 0 10px ${alphaHex(colorMapSafe(color), 0.7)}`,
                            }}
                            initial={{ scale: 0.4, opacity: 0.9, y: 0 }}
                            animate={{ scale: 2.0, opacity: 0, y: 3 }}
                            transition={{ duration: 0.42, ease: 'easeOut' }}
                        />
                    )}

                    {/* Floating 3D Step-Crown Mini-Die */}
                    {crownState && (
                        <div ref={crownRef} className="token-step-crown-anchor">
                            <TokenStepCrown
                                remaining={crownState.remaining}
                                boosted={crownState.boosted}
                                themeId={activeThemeId}
                                color={color}
                            />
                        </div>
                    )}

                    {/* Idle breathing for the active player (suppressed mid-hop) */}
                    <motion.div
                        style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                        animate={isColorTurn && !isMoving && !isFinishedHidden ? { scale: [1, 1.05, 1] } : { scale: 1 }}
                        transition={isColorTurn && !isMoving ? { repeat: Infinity, duration: 1.5, ease: 'easeInOut' } : { duration: 0.2 }}
                    >
                        {/* Hop / landing: GSAP y & rotate operate cleanly in screen space */}
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
                                boostArmed={boostArmed}
                            />
                        </div>
                    </motion.div>
                </div>
            </div>
        </motion.div>
    );
}
