/* eslint-disable @typescript-eslint/no-explicit-any -- lint burn-down quarantine 2026-09-23 */
"use client";

import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence, useAnimation, PanInfo } from 'framer-motion';
import { useSoundEffects } from '../hooks/useSoundEffects';
import { useAudio } from '../hooks/useAudio';
import { usePreferences } from '@/hooks/usePreferences';
import {
    ChevronGlyphIcon,
    QuickDeployIcon,
    SimBotIcon,
    SquadRoomIcon,
} from './icons';
import { DeploymentModeRail } from './DeploymentModeRail';

interface ActionDiceProps {
    onSelectQuickMatch: () => void;
    onSelectTeamUp: () => void;
    onSelectOfflineMatch: () => void;
}

// All possible actions
const BASE_ACTIONS = [
    { id: 'quick', label: 'QUICK MATCH', shortLabel: 'QUICK' },
    { id: 'team', label: 'TEAM UP', shortLabel: 'TEAM' },
    { id: 'offline', label: 'OFFLINE MATCH', shortLabel: 'OFFLINE' },
];

// Deterministic mode carousel: swipe right / up → next mode,
// swipe left / down → previous mode. No randomness — the cube always
// tumbles exactly one step and lands on the intended mode.

const MODE_ORDER = ['quick', 'team', 'offline'] as const;
type ModeId = typeof MODE_ORDER[number];

const MODE_BLURB: Record<ModeId, string> = {
    quick: 'Online matchmaking · entry fee applies',
    team: 'Private lobby · invite friends',
    offline: 'Practice vs AI · free',
};

const MODE_BLURB_3077: Record<ModeId, string> = {
    quick: 'RANKED ARENA · LIVE MATCHMAKING',
    team: 'SQUAD LOBBY · PRIVATE INVITE CODE',
    offline: 'SIMULATION · BOT PRACTICE FREE',
};

// Fixed face layout: each mode owns two opposite faces, so wherever the
// cube sits there is always a nearby face carrying the next/previous mode.
const FACE_MODE: ModeId[] = ['quick', 'team', 'offline', 'quick', 'team', 'offline'];

const MODE_DOT: Record<ModeId, string> = {
    quick: 'bg-blue-500',
    team: 'bg-amber-400',
    offline: 'bg-emerald-500',
};

const MODE_HEX_3077: Record<ModeId, string> = {
    quick: '#00E5FF',
    team: '#F59E0B',
    offline: '#00FF66',
};

const MODE_HEX_DAYBREAK: Record<ModeId, string> = {
    quick: '#0284C7',
    team: '#D97706',
    offline: '#059669',
};

// Canonical orientation bringing each face index to the front.
const FACE_ALIGN = [
    { rx: 0, ry: 0 },       // Front
    { rx: 0, ry: -90 },     // Right
    { rx: 0, ry: 180 },     // Back
    { rx: 0, ry: 90 },      // Left
    { rx: -90, ry: 0 },     // Top
    { rx: 90, ry: 0 },      // Bottom
];

const LAST_MODE_KEY = 'ludo-last-mode';

const readBootFace = (): number => {
    try {
        const last = localStorage.getItem(LAST_MODE_KEY);
        const idx = MODE_ORDER.indexOf(last as ModeId);
        const mode = idx >= 0 ? MODE_ORDER[idx] : MODE_ORDER[0];
        return Math.max(0, FACE_MODE.indexOf(mode));
    } catch {
        return 0;
    }
};

export const ActionDice: React.FC<ActionDiceProps> = ({
    onSelectQuickMatch,
    onSelectTeamUp,
    onSelectOfflineMatch,
}) => {
    const { playDiceRoll, playDiceLand, playClick } = useSoundEffects();
    const { triggerHaptic } = useAudio();
    const { preferences } = usePreferences();
    const is3077 = preferences.theme === '3077';
    const isDaybreak = preferences.theme === 'light';
    const controls = useAnimation();
    const shadowControls = useAnimation();

    const [bootFace] = useState(() => readBootFace());
    const [currentRotateX, setCurrentRotateX] = useState(() => FACE_ALIGN[bootFace].rx);
    const [currentRotateY, setCurrentRotateY] = useState(() => FACE_ALIGN[bootFace].ry);

    const faces = useMemo(
        () =>
            [1, 2, 3, 4, 5, 6].map((pips, i) => {
                const id = FACE_MODE[i];
                const action = BASE_ACTIONS.find((a) => a.id === id)!;
                return { pips, id, label: action.label, dotColor: MODE_DOT[id], hex3077: MODE_HEX_3077[id] };
            }),
        [],
    );

    const [modeIndex, setModeIndex] = useState(() => MODE_ORDER.indexOf(FACE_MODE[bootFace]));
    const [activeIndex, setActiveIndex] = useState(() => bootFace);
    const [isRolling, setIsRolling] = useState(false);

    const tumbleToMode = (targetId: ModeId, dir: 1 | -1, axis: 'x' | 'y') => {
        if (isRolling) return;
        const nextModeIndex = MODE_ORDER.indexOf(targetId);
        if (nextModeIndex === modeIndex) return;

        playDiceRoll();
        triggerHaptic(40);
        setIsRolling(true);

        const normalize = (current: number, target: number) => {
            let diff = (target - current) % 360;
            if (diff > 180) diff -= 360;
            if (diff < -180) diff += 360;
            return current + diff;
        };

        let bestFace = activeIndex;
        let bestDist = Infinity;
        FACE_MODE.forEach((id, i) => {
            if (id !== targetId) return;
            const align = FACE_ALIGN[i];
            const dist =
                Math.abs(normalize(currentRotateX, align.rx)) +
                Math.abs(normalize(currentRotateY, align.ry));
            if (dist < bestDist) {
                bestDist = dist;
                bestFace = i;
            }
        });

        const align = FACE_ALIGN[bestFace];
        const baseX = normalize(currentRotateX, align.rx);
        const baseY = normalize(currentRotateY, align.ry);
        const tumble = (dir === 1 ? -360 : 360) * 2;
        const targetX = baseX + (axis === 'x' ? tumble : 0);
        const targetY = baseY + (axis === 'y' ? tumble : 0);

        setModeIndex(nextModeIndex);
        setActiveIndex(bestFace);
        try {
            localStorage.setItem(LAST_MODE_KEY, targetId);
        } catch {
            /* workers/private mode — memory lasts for this session only */
        }
        setCurrentRotateX(targetX);
        setCurrentRotateY(targetY);

        controls.start({
            rotateX: targetX,
            rotateY: targetY,
            rotateZ: 0,
            transition: { type: 'spring', stiffness: 50, damping: 20 },
        });

        if (!is3077) {
            shadowControls.start({
                scale: [1, 0.4, 0.4, 1],
                opacity: [0.6, 0.2, 0.2, 0.6],
                transition: { duration: 1.1, ease: 'easeInOut' },
            });
        }

        setTimeout(() => {
            playDiceLand();
            triggerHaptic([30, 50, 30]);
            setIsRolling(false);
        }, 1100);
    };

    const stepMode = (dir: 1 | -1, axis: 'x' | 'y') => {
        const nextModeIndex = (modeIndex + dir + MODE_ORDER.length) % MODE_ORDER.length;
        tumbleToMode(MODE_ORDER[nextModeIndex], dir, axis);
    };

    const jumpToMode = (targetId: ModeId) => {
        if (targetId === MODE_ORDER[modeIndex] || isRolling) return;
        const targetIdx = MODE_ORDER.indexOf(targetId);
        const forwardDist = (targetIdx - modeIndex + MODE_ORDER.length) % MODE_ORDER.length;
        const dir: 1 | -1 = forwardDist === 1 ? 1 : -1;
        tumbleToMode(targetId, dir, 'y');
    };

    const handleDragEnd = (_event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
        const threshold = 20;
        const isHorizontal = Math.abs(info.offset.x) > Math.abs(info.offset.y);

        if (isHorizontal) {
            if (info.offset.x > threshold) stepMode(1, 'y');
            else if (info.offset.x < -threshold) stepMode(-1, 'y');
            else resetToCurrent();
        } else {
            if (info.offset.y < -threshold) stepMode(1, 'x');
            else if (info.offset.y > threshold) stepMode(-1, 'x');
            else resetToCurrent();
        }
    };

    const resetToCurrent = () => {
        controls.start({
            rotateX: currentRotateX,
            rotateY: currentRotateY,
            rotateZ: 0,
            transition: { type: 'spring', stiffness: 300, damping: 25 },
        });
    };

    const handleFaceClick = (index: number) => {
        if (isRolling) return;
        if (index !== activeIndex && index !== -1) return;

        playClick();
        const activeFaceId = faces[activeIndex].id;
        if (activeFaceId === 'quick') onSelectQuickMatch();
        else if (activeFaceId === 'team') onSelectTeamUp();
        else if (activeFaceId === 'offline') onSelectOfflineMatch();
    };

    const activeId = FACE_MODE[activeIndex];
    const modeColorHex = MODE_HEX_3077[activeId];

    return (
        <div className="relative w-full flex flex-col items-center justify-center py-2" style={{ perspective: '1200px' }}>
            <div className="dice-swipe-hint w-full flex items-center justify-center gap-2 mb-5">
                <span
                    className={`text-ludo-xs uppercase font-bold text-center ${
                        is3077
                            ? 'font-mono text-ink-muted tracking-[0.22em]'
                            : 'text-ink-muted tracking-[0.3em] drop-shadow-md'
                    }`}
                >
                    {is3077 ? '// SWIPE OR SELECT DEPLOYMENT //' : 'Swipe to choose'}
                </span>
            </div>

            <div className="lobby-dice-cube relative w-28 h-28 mt-1 mb-3 dice-tier cursor-grab active:cursor-grabbing [--tz:56px] flex items-center justify-center">
                {is3077 ? (
                    <>
                        <button
                            type="button"
                            onClick={() => stepMode(-1, 'y')}
                            aria-label="Previous game mode"
                            className="hud-header-cluster absolute top-1/2 -translate-y-1/2 -left-16 sm:-left-20 min-w-[44px] min-h-[44px] flex items-center justify-center text-ink-muted hover:text-accent active:scale-95 transition-[color,border-color,transform] z-20 cursor-pointer"
                        >
                            <ChevronGlyphIcon direction="left" className="w-5 h-5" />
                        </button>
                        <button
                            type="button"
                            onClick={() => stepMode(1, 'y')}
                            aria-label="Next game mode"
                            className="hud-header-cluster absolute top-1/2 -translate-y-1/2 -right-16 sm:-right-20 min-w-[44px] min-h-[44px] flex items-center justify-center text-ink-muted hover:text-accent active:scale-95 transition-[color,border-color,transform] z-20 cursor-pointer"
                        >
                            <ChevronGlyphIcon direction="right" className="w-5 h-5" />
                        </button>
                    </>
                ) : (
                    <>
                        <motion.div
                            animate={{ x: [-5, 5, -5] }}
                            transition={{ repeat: Infinity, duration: 1.5, ease: 'easeInOut' }}
                            className="absolute top-1/2 -translate-y-1/2 -left-20 p-3 text-ink-muted z-20 cursor-pointer hover:text-ink-strong hover:scale-110 active:scale-90 transition-all"
                            onClick={() => stepMode(-1, 'y')}
                        >
                            <ChevronLeft />
                        </motion.div>
                        <motion.div
                            animate={{ x: [5, -5, 5] }}
                            transition={{ repeat: Infinity, duration: 1.5, ease: 'easeInOut' }}
                            className="absolute top-1/2 -translate-y-1/2 -right-20 p-3 text-ink-muted z-20 cursor-pointer hover:text-ink-strong hover:scale-110 active:scale-90 transition-all"
                            onClick={() => stepMode(1, 'y')}
                        >
                            <ChevronRight />
                        </motion.div>
                    </>
                )}

                {/* Victory / Mode Landing Aura */}
                <motion.div
                    className={`absolute w-28 h-28 rounded-[100%] blur-3xl pointer-events-none transition-colors duration-300 ${
                        is3077 ? '' : faces[activeIndex]?.dotColor || 'bg-cyan-400'
                    }`}
                    style={is3077 ? { backgroundColor: modeColorHex } : undefined}
                    animate={{
                        scale: isRolling ? 0.5 : is3077 ? 1.35 : 1.8,
                        opacity: isRolling ? 0 : is3077 ? 0.24 : 0.6,
                    }}
                    transition={{ duration: 0.8, ease: 'easeOut' }}
                />

                {/* TIER 2: The Tripod (Static Tilt) */}
                <div style={{ transform: 'rotateX(-15deg) rotateY(-15deg)', transformStyle: 'preserve-3d' }} className="w-full h-full absolute inset-0">
                    {/* TIER 3: The Motor (Animated Roll) */}
                    <motion.div
                        className="w-full h-full relative"
                        animate={controls}
                        initial={{ rotateX: FACE_ALIGN[bootFace].rx, rotateY: FACE_ALIGN[bootFace].ry, rotateZ: 0 }}
                        drag
                        dragConstraints={{ left: 0, right: 0, top: 0, bottom: 0 }}
                        dragElastic={0.2}
                        onDragEnd={handleDragEnd}
                        style={{ transformStyle: 'preserve-3d' }}
                    >
                        <DiceFace face={faces[0]} is3077={is3077} transform="translateZ(var(--tz))" onClick={() => handleFaceClick(0)} isActive={activeIndex === 0} isRolling={isRolling} />
                        <DiceFace face={faces[1]} is3077={is3077} transform="rotateY(90deg) translateZ(var(--tz))" onClick={() => handleFaceClick(1)} isActive={activeIndex === 1} isRolling={isRolling} />
                        <DiceFace face={faces[2]} is3077={is3077} transform="rotateY(180deg) translateZ(var(--tz))" onClick={() => handleFaceClick(2)} isActive={activeIndex === 2} isRolling={isRolling} />
                        <DiceFace face={faces[3]} is3077={is3077} transform="rotateY(-90deg) translateZ(var(--tz))" onClick={() => handleFaceClick(3)} isActive={activeIndex === 3} isRolling={isRolling} />
                        <DiceFace face={faces[4]} is3077={is3077} transform="rotateX(90deg) translateZ(var(--tz))" onClick={() => handleFaceClick(4)} isActive={activeIndex === 4} isRolling={isRolling} />
                        <DiceFace face={faces[5]} is3077={is3077} transform="rotateX(-90deg) translateZ(var(--tz))" onClick={() => handleFaceClick(5)} isActive={activeIndex === 5} isRolling={isRolling} />
                    </motion.div>
                </div>
            </div>

            {is3077 ? (
                /* 3077 Holographic Projection Pedestal */
                <div className="relative flex flex-col items-center justify-center pointer-events-none" aria-hidden="true">
                    <div className="action-dice-3077-pedestal w-32 h-14 flex items-center justify-center relative">
                        <svg
                            viewBox="0 0 120 120"
                            className="w-full h-full animate-hud-reticle-spin"
                            fill="none"
                            style={{ color: modeColorHex }}
                        >
                            <circle cx="60" cy="60" r="52" stroke="currentColor" strokeWidth="1.6" strokeDasharray="10 6 2 6" opacity="0.7" />
                            <circle cx="60" cy="60" r="38" stroke="currentColor" strokeWidth="1" opacity="0.35" />
                        </svg>
                        <svg
                            viewBox="0 0 120 120"
                            className="absolute inset-0 w-full h-full animate-hud-reticle-spin-rev"
                            fill="none"
                            style={{ color: modeColorHex }}
                        >
                            <circle cx="60" cy="60" r="24" stroke="currentColor" strokeWidth="1.6" strokeDasharray="6 6" opacity="0.85" />
                        </svg>
                    </div>
                    <div
                        className="w-24 h-2 -mt-6 rounded-full blur-md opacity-40"
                        style={{ backgroundColor: modeColorHex }}
                    />
                </div>
            ) : (
                <motion.div
                    animate={shadowControls}
                    className="w-24 h-3.5 rounded-[100%] blur-md pointer-events-none mt-1.5 transition-all"
                    style={{
                        backgroundColor: isDaybreak ? 'rgba(15, 23, 42, 0.28)' : 'rgba(0, 0, 0, 0.8)',
                        opacity: isDaybreak ? 0.55 : 0.6,
                    }}
                />
            )}

            {/* Mode Switcher: Curved Magnetic Shuttle Rail in 3077; 3-chip chamfered rail in Retro & Daybreak */}
            {is3077 ? (
                <DeploymentModeRail
                    activeMode={activeId}
                    disabled={isRolling}
                    sfxEnabled={preferences.sfx}
                    hapticsEnabled={preferences.haptics}
                    onSelectMode={jumpToMode}
                />
            ) : (
                <div
                    className="mt-2.5 flex items-center justify-center gap-1.5"
                    role="group"
                    aria-label="Deployment Mode Switcher"
                >
                    {BASE_ACTIONS.map((m) => {
                        const modeId = m.id as ModeId;
                        const selected = activeId === modeId;
                        const hex = isDaybreak ? MODE_HEX_DAYBREAK[modeId] : MODE_HEX_3077[modeId];
                        return (
                            <button
                                key={m.id}
                                type="button"
                                onClick={() => jumpToMode(modeId)}
                                aria-pressed={selected}
                                className={`px-3 py-1.5 rounded-lg text-ludo-xs font-mono font-bold uppercase tracking-wider border transition-[border-color,background-color,color,transform] active:scale-95 cursor-pointer flex items-center gap-1.5 ${
                                    selected
                                        ? 'bg-surface-active text-ink-strong border-line-strong'
                                        : 'bg-surface-recessed text-ink-muted border-line-soft hover:text-ink-strong hover:border-line-strong'
                                }`}
                                style={
                                    selected
                                        ? {
                                              borderColor: isDaybreak ? `${hex}80` : `${hex}99`,
                                              backgroundColor: isDaybreak ? `${hex}14` : `${hex}18`,
                                              color: hex,
                                              boxShadow: isDaybreak
                                                  ? `0 2px 8px ${hex}22`
                                                  : `0 0 12px ${hex}26, inset 0 1px 0 ${hex}33`,
                                          }
                                        : undefined
                                }
                            >
                                <span
                                    className="w-1.5 h-1.5 rounded-full shrink-0"
                                    style={{
                                        backgroundColor: selected ? hex : 'var(--ink-faint)',
                                        boxShadow: selected && !isDaybreak ? `0 0 6px ${hex}` : undefined,
                                    }}
                                    aria-hidden="true"
                                />
                                {m.shortLabel}
                            </button>
                        );
                    })}
                </div>
            )}

            {/* Active mode blurb */}
            <div className="mt-2 h-4 flex items-center justify-center pointer-events-none">
                <AnimatePresence mode="wait">
                    {!isRolling && (
                        <motion.span
                            key={`${activeId}-${is3077 ? '3077' : 'std'}`}
                            initial={{ opacity: 0, y: 3 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -3 }}
                            transition={{ duration: 0.16 }}
                            className={`text-ludo-xs uppercase font-bold text-center ${
                                is3077
                                    ? 'font-mono text-ink-muted tracking-[0.2em]'
                                    : 'text-ink-faint tracking-[0.25em]'
                            }`}
                        >
                            {is3077 ? MODE_BLURB_3077[activeId] : MODE_BLURB[activeId]}
                        </motion.span>
                    )}
                </AnimatePresence>
            </div>
        </div>
    );
};

const ModeFaceGlyph = ({ id }: { id: ModeId }) => {
    if (id === 'quick') return <QuickDeployIcon className="w-3 h-3 shrink-0" />;
    if (id === 'team') return <SquadRoomIcon className="w-3 h-3 shrink-0" />;
    return <SimBotIcon className="w-3 h-3 shrink-0" />;
};

const DiceFace = ({
    face,
    is3077,
    transform,
    onClick,
    isActive,
    isRolling,
}: {
    face: any;
    is3077: boolean;
    transform: string;
    onClick: () => void;
    isActive: boolean;
    isRolling: boolean;
}) => {
    const faceHex: string = face.hex3077 || '#00E5FF';

    return (
        <div
            className={`absolute w-full h-full flex flex-col items-center justify-center p-2 select-none overflow-hidden transition-colors duration-300 ${
                is3077
                    ? 'rounded-xl border'
                    : 'rounded-2xl bg-white border border-gray-100 shadow-[inset_0_-8px_16px_rgba(0,0,0,0.08),inset_0_4px_8px_rgba(255,255,255,1),0_4px_12px_rgba(0,0,0,0.1)]'
            }`}
            style={{
                transform,
                backfaceVisibility: 'hidden',
                WebkitBackfaceVisibility: 'hidden',
                ...(is3077
                    ? {
                          background: 'linear-gradient(145deg, #161E2C 0%, #0A0E16 62%, #05070B 100%)',
                          borderColor: isActive ? `${faceHex}99` : 'rgba(0, 229, 255, 0.24)',
                          boxShadow: isActive
                              ? `inset 0 0 18px ${faceHex}22, 0 0 18px rgba(0, 0, 0, 0.75)`
                              : 'inset 0 0 12px rgba(0, 229, 255, 0.08)',
                      }
                    : {}),
            }}
        >
            {/* 3077 Corner Chamfer Accent Ticks */}
            {is3077 && (
                <div className="pointer-events-none absolute inset-1 border border-line-soft rounded-lg" aria-hidden="true" />
            )}

            <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                <DiceDots count={face.pips} dotColor={face.dotColor} is3077={is3077} hex3077={faceHex} />
            </div>

            {/* Dynamic Light Sheen - Sweeps across face while tumbling */}
            <motion.div
                className="absolute w-[200%] h-[200%] pointer-events-none bg-gradient-to-tr from-transparent via-white/30 to-transparent mix-blend-overlay z-0"
                initial={{ x: '-120%', y: '-120%' }}
                animate={isRolling ? { x: ['-120%', '120%'], y: ['-120%', '120%'] } : { x: '-120%', y: '-120%' }}
                transition={isRolling ? { repeat: Infinity, duration: 0.4, ease: 'linear' } : { duration: 0 }}
            />

            {/* Only show the Action Label Button on the ACTIVE face while NOT rolling */}
            {isActive && !isRolling && (
                <button
                    type="button"
                    onClick={(e) => {
                        e.stopPropagation();
                        onClick();
                    }}
                    className={`relative mt-0.5 flex flex-col items-center justify-center gap-0.5 z-10 cursor-pointer transition-transform ${
                        is3077
                            ? 'w-[78%] min-h-[36px] px-1.5 py-1 border font-bold'
                            : 'w-[94%] min-h-[44px] px-1.5 py-1 rounded-full border glass-panel backdrop-blur-[1px] border-cyan-400/80 shadow-[0_0_15px_rgba(34,211,238,0.3)] bg-black/40 hover:bg-black/50 hover:scale-[1.10] active:scale-95'
                    }`}
                >
                    {is3077 && (
                        <span className="inline-flex items-center shrink-0">
                            <ModeFaceGlyph id={face.id as ModeId} />
                        </span>
                    )}
                    <span
                        className={`block leading-[1.05] whitespace-normal text-center ${
                            is3077
                                ? 'text-ludo-xs sm:text-ludo-sm font-bold tracking-wider uppercase'
                                : 'text-ludo-lg md:text-base lg:text-lg font-extrabold italic tracking-tighter drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)] text-accent'
                        }`}
                    >
                        {face.label}
                    </span>
                </button>
            )}
        </div>
    );
};

// Center-aligned dice pip geometry using absolute percentages
const DiceDots = ({
    count,
    dotColor,
    is3077,
    hex3077,
}: {
    count: number;
    dotColor: string;
    is3077: boolean;
    hex3077: string;
}) => {
    const Dot = ({ t, l }: { t: string; l: string }) =>
        is3077 ? (
            <div
                className="absolute w-[14px] h-[14px] rounded-full border border-line-strong"
                style={{
                    top: t,
                    left: l,
                    transform: 'translate(-50%, -50%)',
                    backgroundColor: hex3077,
                    opacity: 0.85,
                    boxShadow: `0 0 8px ${hex3077}, inset 0 1px 2px rgba(255,255,255,0.6)`,
                }}
            />
        ) : (
            <div
                className={`absolute w-[20px] h-[20px] rounded-full shadow-[inset_0_2px_4px_rgba(0,0,0,0.2)] ${dotColor} opacity-80`}
                style={{ top: t, left: l, transform: 'translate(-50%, -50%)' }}
            />
        );

    const C = '50%';
    const L = '22%';
    const R = '78%';
    const T = '22%';
    const B = '78%';
    const M = '50%';

    return (
        <div className="absolute inset-0 pointer-events-none">
            {count === 1 && <Dot t={C} l={C} />}
            {count === 2 && (
                <>
                    <Dot t={T} l={L} />
                    <Dot t={B} l={R} />
                </>
            )}
            {count === 3 && (
                <>
                    <Dot t={T} l={L} />
                    <Dot t={C} l={C} />
                    <Dot t={B} l={R} />
                </>
            )}
            {count === 4 && (
                <>
                    <Dot t={T} l={L} />
                    <Dot t={T} l={R} />
                    <Dot t={B} l={L} />
                    <Dot t={B} l={R} />
                </>
            )}
            {count === 5 && (
                <>
                    <Dot t={T} l={L} />
                    <Dot t={T} l={R} />
                    <Dot t={C} l={C} />
                    <Dot t={B} l={L} />
                    <Dot t={B} l={R} />
                </>
            )}
            {count === 6 && (
                <>
                    <Dot t={T} l={L} />
                    <Dot t={T} l={R} />
                    <Dot t={M} l={L} />
                    <Dot t={M} l={R} />
                    <Dot t={B} l={L} />
                    <Dot t={B} l={R} />
                </>
            )}
        </div>
    );
};

const ChevronLeft = () => (
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="15 18 9 12 15 6" />
        <polyline points="21 18 15 12 21 6" className="opacity-40" />
    </svg>
);

const ChevronRight = () => (
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="9 18 15 12 9 6" />
        <polyline points="3 18 9 12 3 6" className="opacity-40" />
    </svg>
);
