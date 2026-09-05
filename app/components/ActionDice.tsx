"use client";

import React, { useState, useMemo } from 'react';
import { motion, useAnimation, PanInfo } from 'framer-motion';
import { useSoundEffects } from '../hooks/useSoundEffects';
import { useAudio } from '../hooks/useAudio';

interface ActionDiceProps {
    onSelectQuickMatch: () => void;
    onSelectTeamUp: () => void;
    onSelectOfflineMatch: () => void;
}

// All possible actions
const BASE_ACTIONS = [
    { id: 'quick', label: 'QUICK MATCH' },
    { id: 'team', label: 'TEAM UP' },
    { id: 'offline', label: 'OFFLINE MATCH' }
];

// Deterministic mode carousel: swipe right / up → next mode,
// swipe left / down → previous mode. No randomness — the cube always
// tumbles exactly one step and lands on the intended mode.

// Fixed mode order around the carousel.
const MODE_ORDER = ['quick', 'team', 'offline'] as const;
type ModeId = typeof MODE_ORDER[number];

const MODE_BLURB: Record<ModeId, string> = {
    quick: 'Online matchmaking · entry fee applies',
    team: 'Private lobby · invite friends',
    offline: 'Practice vs bots · free',
};

// Fixed face layout: each mode owns two opposite faces, so wherever the
// cube sits there is always a nearby face carrying the next/previous mode.
const FACE_MODE: ModeId[] = ['quick', 'team', 'offline', 'quick', 'team', 'offline'];

// Fixed dot color per mode (was re-randomized every roll).
const MODE_DOT: Record<ModeId, string> = {
    quick: 'bg-blue-500',
    team: 'bg-amber-400',
    offline: 'bg-emerald-500',
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

// Face index to boot on: first face carrying the remembered mode
// (defaults to QUICK MATCH on the front face).
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
    onSelectOfflineMatch
}) => {
    const { playDiceRoll, playDiceLand, playClick } = useSoundEffects();
    const { triggerHaptic } = useAudio();
    const controls = useAnimation();
    const shadowControls = useAnimation();
    
    // ... rest of the component state ...
    
    // Boot face is read once — rotation, mode, and face all agree on mount.
    const [bootFace] = useState(() => readBootFace());

    // Track multi-axis tumbling (booted on the remembered mode's face).
    const [currentRotateX, setCurrentRotateX] = useState(() => FACE_ALIGN[bootFace].rx);
    const [currentRotateY, setCurrentRotateY] = useState(() => FACE_ALIGN[bootFace].ry);

    // Static faces (never regenerated) + remembered mode across visits.
    const faces = useMemo(() => [1, 2, 3, 4, 5, 6].map((pips, i) => {
        const id = FACE_MODE[i];
        const action = BASE_ACTIONS.find(a => a.id === id)!;
        return { pips, id, label: action.label, dotColor: MODE_DOT[id] };
    }), []);

    const [modeIndex, setModeIndex] = useState(() => MODE_ORDER.indexOf(FACE_MODE[bootFace]));
    const [activeIndex, setActiveIndex] = useState(() => bootFace);
    const [isRolling, setIsRolling] = useState(false);

    // Step exactly one mode forward (+1) or back (-1). The result is fully
    // determined by the swipe — the cube always tumbles one full turn in the
    // swipe direction and lands on the nearest face carrying that mode.
    const stepMode = (dir: 1 | -1, axis: 'x' | 'y') => {
        if (isRolling) return; // Prevent double steps

        playDiceRoll();

        // Haptic Feedback: Initial swipe/thwack
        triggerHaptic(40);

        setIsRolling(true);

        // 1. Determine the result logically first — pure carousel, no dice roll.
        const nextModeIndex = (modeIndex + dir + MODE_ORDER.length) % MODE_ORDER.length;
        const targetId = MODE_ORDER[nextModeIndex];

        // 2. Nearest face carrying the target mode (each mode owns two faces).
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
            const dist = Math.abs(normalize(currentRotateX, align.rx))
                + Math.abs(normalize(currentRotateY, align.ry));
            if (dist < bestDist) {
                bestDist = dist;
                bestFace = i;
            }
        });

        // 3. Snap to that face, plus a long run-up in the swipe direction:
        // two full tumbles before landing, so it feels like a real shuffle
        // while still deterministically arriving on the intended mode.
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
            rotateZ: 0, // Z remains unrotated to prevent sideways text
            transition: { type: 'spring', stiffness: 50, damping: 20 }
        });
        
        shadowControls.start({
            scale: [1, 0.4, 0.4, 1],
            opacity: [0.6, 0.2, 0.2, 0.6],
            transition: { duration: 1.1, ease: "easeInOut" }
        });

        // Landing impact after 1.1s matches the longer tumble + shadow sequence
        setTimeout(() => {
            playDiceLand();
            triggerHaptic([30, 50, 30]); // Thud-thud-thud
            setIsRolling(false);
        }, 1100);
    };

    const handleDragEnd = (event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
        const threshold = 20;
        const isHorizontal = Math.abs(info.offset.x) > Math.abs(info.offset.y);

        // Swipe right / up → next mode, swipe left / down → previous mode.
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
            transition: { type: 'spring', stiffness: 300, damping: 25 }
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

    return (
        <div className="relative w-full flex flex-col items-center justify-center py-2" style={{ perspective: '1200px' }}>
            {/* TIER 1: The Camera (Perspective) */}

            <div className="absolute top-0 w-full flex items-center justify-center gap-2">
                <span className="text-white/50 text-[10px] uppercase font-bold tracking-[0.3em] drop-shadow-md">Swipe to choose</span>
            </div>

            <motion.div
                animate={{ x: [-5, 5, -5] }}
                transition={{ repeat: Infinity, duration: 1.5, ease: "easeInOut" }}
                className="absolute left-6 md:left-24 text-white/50 z-20 cursor-pointer drop-shadow-[0_0_8px_rgba(255,255,255,0.2)] hover:text-white hover:scale-110 active:scale-90 transition-all"
                onClick={() => stepMode(-1, 'y')}
            >
                <ChevronLeft />
            </motion.div>

            <div className="relative w-32 h-32 mt-8 mb-4 cursor-grab active:cursor-grabbing [--tz:64px] flex items-center justify-center">
                
                {/* Victory Landing Aura */}
                <motion.div 
                    className={`absolute w-32 h-32 rounded-[100%] blur-3xl pointer-events-none transition-colors duration-300 ${faces[activeIndex]?.dotColor || 'bg-cyan-400'}`}
                    animate={{
                        scale: isRolling ? 0.5 : 1.8,
                        opacity: isRolling ? 0 : 0.6,
                    }}
                    transition={{ duration: 0.8, ease: "easeOut" }}
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
                        <DiceFace face={faces[0]} transform="translateZ(var(--tz))" onClick={() => handleFaceClick(0)} isActive={activeIndex === 0} isRolling={isRolling} />
                        <DiceFace face={faces[1]} transform="rotateY(90deg) translateZ(var(--tz))" onClick={() => handleFaceClick(1)} isActive={activeIndex === 1} isRolling={isRolling} />
                        <DiceFace face={faces[2]} transform="rotateY(180deg) translateZ(var(--tz))" onClick={() => handleFaceClick(2)} isActive={activeIndex === 2} isRolling={isRolling} />
                        <DiceFace face={faces[3]} transform="rotateY(-90deg) translateZ(var(--tz))" onClick={() => handleFaceClick(3)} isActive={activeIndex === 3} isRolling={isRolling} />
                        
                        {/* Top & Bottom explicitly flat - Motor 90deg snaps guarantee strictly upright orientations now! */}
                        <DiceFace face={faces[4]} transform="rotateX(90deg) translateZ(var(--tz))" onClick={() => handleFaceClick(4)} isActive={activeIndex === 4} isRolling={isRolling} />
                        <DiceFace face={faces[5]} transform="rotateX(-90deg) translateZ(var(--tz))" onClick={() => handleFaceClick(5)} isActive={activeIndex === 5} isRolling={isRolling} />
                    </motion.div>
                </div>
            </div>

            <motion.div 
                animate={shadowControls}
                className="w-24 h-4 rounded-[100%] bg-black/80 blur-md pointer-events-none mt-2 transition-all" 
                style={{ opacity: 0.6 }}
            />

            {/* Active mode blurb — what this choice means */}
            <div className="mt-2 h-4 flex items-center justify-center pointer-events-none">
                {!isRolling && (
                    <span className="text-white/40 text-[10px] uppercase font-bold tracking-[0.25em] text-center">
                        {MODE_BLURB[activeId]}
                    </span>
                )}
            </div>

            <motion.div
                animate={{ x: [5, -5, 5] }}
                transition={{ repeat: Infinity, duration: 1.5, ease: "easeInOut" }}
                className="absolute right-6 md:right-24 text-white/50 z-20 cursor-pointer drop-shadow-[0_0_8px_rgba(255,255,255,0.2)] hover:text-white hover:scale-110 active:scale-90 transition-all"
                onClick={() => stepMode(1, 'y')}
            >
                <ChevronRight />
            </motion.div>
        </div>
    );
};

const DiceFace = ({ face, transform, onClick, isActive, isRolling }: { face: any, transform: string, onClick: () => void, isActive: boolean, isRolling: boolean }) => {
    return (
        <div
            className={`absolute w-full h-full flex flex-col items-center justify-center p-2 rounded-2xl transition-all duration-300 select-none overflow-hidden
                bg-white border border-gray-100
                shadow-[inset_0_-8px_16px_rgba(0,0,0,0.08),inset_0_4px_8px_rgba(255,255,255,1),0_4px_12px_rgba(0,0,0,0.1)]
            `}
            style={{ 
                transform,
                backfaceVisibility: 'hidden', 
                WebkitBackfaceVisibility: 'hidden' 
            }}
        >
            <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                <DiceDots count={face.pips} dotColor={face.dotColor} />
            </div>

            {/* Dynamic Light Sheen - Sweeps across face while tumbling */}
            <motion.div 
                className="absolute w-[200%] h-[200%] pointer-events-none bg-gradient-to-tr from-transparent via-white/50 to-transparent mix-blend-overlay z-0"
                initial={{ x: '-120%', y: '-120%' }}
                animate={isRolling ? { x: ['-120%', '120%'], y: ['-120%', '120%'] } : { x: '-120%', y: '-120%' }}
                transition={isRolling ? { repeat: Infinity, duration: 0.4, ease: "linear" } : { duration: 0 }}
            />

            {/* Only show the Action Label Button on the ACTIVE face while NOT rolling */}
            {isActive && !isRolling && (
                <button 
                    onClick={(e) => {
                        e.stopPropagation();
                        onClick();
                    }}
                    className="relative mt-1 rounded-full border transition-all duration-300 glass-panel flex flex-col items-center justify-center w-[96%] min-h-[44px] px-2 py-2 backdrop-blur-[1px] z-10
                        border-cyan-400/80 shadow-[0_0_15px_rgba(34,211,238,0.3)] bg-black/40 hover:bg-black/50 hover:scale-[1.10] active:scale-95 cursor-pointer
                    "
                >
                    <span className="block text-[14px] md:text-base lg:text-lg font-black italic tracking-tighter leading-[1] whitespace-normal text-center drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)] text-cyan-400">
                        {face.label}
                    </span>
                </button>
            )}
        </div>
    );
};

// Perfect standard center-aligned dice pip geometry using absolute percentages
const DiceDots = ({ count, dotColor }: { count: number, dotColor: string }) => {
    const dotClass = `absolute w-[20px] h-[20px] rounded-full shadow-[inset_0_2px_4px_rgba(0,0,0,0.2)] ${dotColor} opacity-80`;
    
    // Abstract dot placement component
    const Dot = ({ t, l }: { t: string, l: string }) => (
        <div className={dotClass} style={{ top: t, left: l, transform: 'translate(-50%, -50%)' }} />
    );

    // Standard dice positions
    const C = '50%';
    const L = '22%'; const R = '78%';
    const T = '22%'; const B = '78%';
    const M = '50%';

    return (
        <div className="absolute inset-0 pointer-events-none">
            {count === 1 && <Dot t={C} l={C} />}
            {count === 2 && <><Dot t={T} l={L} /><Dot t={B} l={R} /></>}
            {count === 3 && <><Dot t={T} l={L} /><Dot t={C} l={C} /><Dot t={B} l={R} /></>}
            {count === 4 && <><Dot t={T} l={L} /><Dot t={T} l={R} /><Dot t={B} l={L} /><Dot t={B} l={R} /></>}
            {count === 5 && <><Dot t={T} l={L} /><Dot t={T} l={R} /><Dot t={C} l={C} /><Dot t={B} l={L} /><Dot t={B} l={R} /></>}
            {count === 6 && <><Dot t={T} l={L} /><Dot t={T} l={R} /><Dot t={M} l={L} /><Dot t={M} l={R} /><Dot t={B} l={L} /><Dot t={B} l={R} /></>}
        </div>
    );
};

const ChevronLeft = () => (
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="15 18 9 12 15 6"></polyline>
        <polyline points="21 18 15 12 21 6" className="opacity-40"></polyline>
    </svg>
);

const ChevronRight = () => (
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="9 18 15 12 9 6"></polyline>
        <polyline points="3 18 9 12 3 6" className="opacity-40"></polyline>
    </svg>
);
