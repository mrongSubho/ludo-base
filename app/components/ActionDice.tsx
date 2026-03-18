"use client";

import React, { useState, useEffect } from 'react';
import { motion, useAnimation, PanInfo } from 'framer-motion';

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

// Aesthetic palettes matching the game UI
const COLOR_PALETTES = [
    { text: 'text-cyan-400', dot: 'bg-cyan-400', border: 'border-cyan-400', shadow: 'shadow-[0_0_15px_rgba(0,255,255,0.4)]', bg: 'bg-cyan-900/20', hover: 'hover:bg-cyan-900/40' },
    { text: 'text-purple-400', dot: 'bg-purple-400', border: 'border-purple-400', shadow: 'shadow-[0_0_15px_rgba(168,85,247,0.4)]', bg: 'bg-purple-900/20', hover: 'hover:bg-purple-900/40' },
    { text: 'text-emerald-400', dot: 'bg-emerald-400', border: 'border-emerald-400', shadow: 'shadow-[0_0_15px_rgba(16,185,129,0.4)]', bg: 'bg-emerald-900/20', hover: 'hover:bg-emerald-900/40' },
    { text: 'text-amber-400', dot: 'bg-amber-400', border: 'border-amber-400', shadow: 'shadow-[0_0_15px_rgba(251,191,36,0.4)]', bg: 'bg-amber-900/20', hover: 'hover:bg-amber-900/40' },
    { text: 'text-rose-400', dot: 'bg-rose-400', border: 'border-rose-400', shadow: 'shadow-[0_0_15px_rgba(244,63,94,0.4)]', bg: 'bg-rose-900/20', hover: 'hover:bg-rose-900/40' },
    { text: 'text-indigo-400', dot: 'bg-indigo-400', border: 'border-indigo-400', shadow: 'shadow-[0_0_15px_rgba(99,102,241,0.4)]', bg: 'bg-indigo-900/20', hover: 'hover:bg-indigo-900/40' },
];

export const ActionDice: React.FC<ActionDiceProps> = ({
    onSelectQuickMatch,
    onSelectTeamUp,
    onSelectOfflineMatch
}) => {
    const controls = useAnimation();
    const shadowControls = useAnimation();
    
    // We track the raw rotation (which can be 360, 720, etc.)
    const [currentRotateY, setCurrentRotateY] = useState(0);
    // Which logical index (0 to 3) is currently facing front?
    const [activeIndex, setActiveIndex] = useState(0);

    // Initial resting tilt
    const baseRotateX = -15;
    const baseRotateY = -15;

    // State for exactly 6 randomized faces
    const [faces, setFaces] = useState<any[]>([]);

    useEffect(() => {
        // Generate random faces on mount
        const pips = [1, 2, 3, 4, 5, 6].sort(() => Math.random() - 0.5);
        const actions = [...BASE_ACTIONS, ...BASE_ACTIONS].sort(() => Math.random() - 0.5);
        const palettes = [...COLOR_PALETTES].sort(() => Math.random() - 0.5);

        const randomizedFaces = pips.map((pipCount, i) => ({
            pips: pipCount,
            id: actions[i].id,
            label: actions[i].label,
            palette: palettes[i]
        }));
        
        setFaces(randomizedFaces);
    }, []);

    const performRotation = (direction: -1 | 1) => {
        // Spin randomly 360+ degrees (1 turn = 90deg. so 4 to 7 turns = 360, 450, 540, 630)
        const turns = Math.floor(Math.random() * 4) + 4; // Between 4 and 7 face turns
        const totalTurnDegrees = turns * 90 * direction;
        
        const newRotateY = currentRotateY + totalTurnDegrees;
        setCurrentRotateY(newRotateY);
        
        // Calculate the logical index (0 to 3) for the 4 Y-axis faces
        // rotateY positive = left swipe (moves right face to front, technically index - 1)
        // A full 360 is 4 faces.
        let rawIndex = Math.round(newRotateY / -90);
        // Normalize to positive 0-3
        rawIndex = ((rawIndex % 4) + 4) % 4;
        setActiveIndex(rawIndex);
        
        // Animate Dice
        controls.start({
            rotateY: newRotateY + baseRotateY,
            transition: { type: 'spring', stiffness: 120, damping: 25 }
        });
        
        // Animate Shadow (shrink and grow back to simulate tumbling)
        shadowControls.start({
            scale: [1, 0.4, 0.4, 1],
            opacity: [0.6, 0.2, 0.2, 0.6],
            transition: { duration: 0.8, ease: "easeInOut" }
        });
    };

    const handleDragEnd = (event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
        const threshold = 30; // pixels
        
        if (info.offset.x < -threshold) {
            // dragged left -> rotate right
            performRotation(1);
        } else if (info.offset.x > threshold) {
            // dragged right -> rotate left
            performRotation(-1);
        } else {
            // snap back to current
            controls.start({
                rotateY: currentRotateY + baseRotateY,
                transition: { type: 'spring', stiffness: 300, damping: 25 }
            });
        }
    };

    const handleFaceClick = (index: number) => {
        // Only allow clicks if this face is the current active Y-axis face
        if (index !== activeIndex && index !== -1) return;
        
        const activeFaceId = faces[activeIndex].id;
        
        if (activeFaceId === 'quick') onSelectQuickMatch();
        else if (activeFaceId === 'team') onSelectTeamUp();
        else if (activeFaceId === 'offline') onSelectOfflineMatch();
    };

    if (faces.length === 0) return null; // Hydration guard

    return (
        <div className="relative w-full flex flex-col items-center justify-center py-2" style={{ perspective: '1200px' }}>
            
            {/* Header Text */}
            <div className="absolute top-0 w-full flex items-center justify-center gap-2">
                <span className="text-white/50 text-[10px] uppercase font-bold tracking-[0.3em] drop-shadow-md">Random Spin</span>
            </div>

            {/* Left Chevron (Clickable) */}
            <motion.div
                animate={{ x: [-5, 5, -5] }}
                transition={{ repeat: Infinity, duration: 1.5, ease: "easeInOut" }}
                className="absolute left-6 md:left-24 text-white/50 z-20 cursor-pointer drop-shadow-[0_0_8px_rgba(255,255,255,0.2)] hover:text-white hover:scale-110 active:scale-90 transition-all"
                onClick={() => performRotation(-1)}
            >
                <ChevronLeft />
            </motion.div>

            {/* 128x128px Solid Core Container */}
            <div className="relative w-32 h-32 mt-8 mb-4 cursor-grab active:cursor-grabbing [--tz:64px]">
                
                <motion.div
                    className="w-full h-full relative"
                    animate={controls}
                    initial={{ rotateX: baseRotateX, rotateY: baseRotateY, rotateZ: 0 }} 
                    drag="x"
                    dragConstraints={{ left: 0, right: 0 }}
                    dragElastic={0.1}
                    onDragEnd={handleDragEnd}
                    style={{ transformStyle: 'preserve-3d' }}
                >
                    {/* Front Face (0) */}
                    <DiceFace face={faces[0]} transform="translateZ(var(--tz))" onClick={() => handleFaceClick(0)} isActive={activeIndex === 0} />
                    {/* Right Face (1) */}
                    <DiceFace face={faces[1]} transform="rotateY(90deg) translateZ(var(--tz))" onClick={() => handleFaceClick(1)} isActive={activeIndex === 1} />
                    {/* Back Face (2) */}
                    <DiceFace face={faces[2]} transform="rotateY(180deg) translateZ(var(--tz))" onClick={() => handleFaceClick(2)} isActive={activeIndex === 2} />
                    {/* Left Face (3) */}
                    <DiceFace face={faces[3]} transform="rotateY(-90deg) translateZ(var(--tz))" onClick={() => handleFaceClick(3)} isActive={activeIndex === 3} />
                    
                    {/* Top Face (4) - Added dots and text per user request, but it's permanently on top (inactive interaction) */}
                    <DiceFace face={faces[4]} transform="rotateX(90deg) translateZ(var(--tz))" onClick={() => {}} isActive={false} />
                    
                    {/* Bottom Face (5) */}
                    <DiceFace face={faces[5]} transform="rotateX(-90deg) translateZ(var(--tz))" onClick={() => {}} isActive={false} />
                </motion.div>
            </div>

            {/* Table Drop Shadow */}
            <motion.div 
                animate={shadowControls}
                className="w-24 h-4 rounded-[100%] bg-black/80 blur-md pointer-events-none mt-2 transition-all" 
                style={{ opacity: 0.6 }}
            />

            {/* Right Chevron (Clickable) */}
            <motion.div
                animate={{ x: [5, -5, 5] }}
                transition={{ repeat: Infinity, duration: 1.5, ease: "easeInOut" }}
                className="absolute right-6 md:right-24 text-white/50 z-20 cursor-pointer drop-shadow-[0_0_8px_rgba(255,255,255,0.2)] hover:text-white hover:scale-110 active:scale-90 transition-all"
                onClick={() => performRotation(1)}
            >
                <ChevronRight />
            </motion.div>
        </div>
    );
};

const DiceFace = ({ face, transform, onClick, isActive }: { face: any, transform: string, onClick: () => void, isActive: boolean }) => {
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
            {/* Dots Background */}
            <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                <DiceDots count={face.pips} dotColor={face.palette.dot} />
            </div>

            {/* Cyber-Glass Button precisely matching the GameLobby 'classic/power' selector style */}
            <button 
                onClick={(e) => {
                    if (isActive) {
                        e.stopPropagation();
                        onClick();
                    }
                }}
                className={`relative mt-1 rounded-full border transition-all duration-300 glass-panel flex flex-col items-center justify-center w-[96%] min-h-[44px] px-2 py-2 backdrop-blur-md drop-shadow-md z-10
                    ${isActive 
                        ? `${face.palette.border} ${face.palette.shadow} ${face.palette.bg} ${face.palette.hover} hover:scale-[1.10] active:scale-95 cursor-pointer` 
                        : 'border-white/20 bg-gray-500/20 scale-[0.85] opacity-60 pointer-events-none'
                    }
                `}
            >
                <span className={`block text-[14px] md:text-base lg:text-lg font-black italic tracking-tighter leading-[1] whitespace-normal text-center drop-shadow-md ${isActive ? face.palette.text : 'text-gray-200'}`}>
                    {face.label}
                </span>
            </button>
        </div>
    );
};

// Expanded DiceDots logic to support all 6 sides
const DiceDots = ({ count, dotColor }: { count: number, dotColor: string }) => {
    const dotClass = `w-[22px] h-[22px] rounded-full shadow-[inset_0_2px_4px_rgba(0,0,0,0.2)] ${dotColor} opacity-90`;
    
    if (count === 1) return <div className={dotClass} />;
    
    if (count === 2) return (
        <div className="flex w-full h-full p-4 justify-between items-center rotate-45">
            <div className={dotClass} /><div className={dotClass} />
        </div>
    );
    
    if (count === 3) return (
        <div className="flex w-full h-full p-3 justify-between rotate-45">
            <div className={`self-start ${dotClass}`} />
            <div className={`self-center ${dotClass}`} />
            <div className={`self-end ${dotClass}`} />
        </div>
    );
    
    if (count === 4) return (
        <div className="grid grid-cols-2 grid-rows-2 gap-3 p-4">
            <div className={dotClass} /><div className={dotClass} />
            <div className={dotClass} /><div className={dotClass} />
        </div>
    );

    if (count === 5) return (
        <div className="relative w-full h-full p-4">
            <div className="grid grid-cols-2 grid-rows-2 gap-3 h-full">
                <div className={dotClass} /><div className={dotClass} />
                <div className={dotClass} /><div className={dotClass} />
            </div>
            <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 ${dotClass}`} />
        </div>
    );

    if (count === 6) return (
        <div className="grid grid-cols-2 grid-rows-3 gap-y-1 gap-x-3 p-3">
            <div className={dotClass} /><div className={dotClass} />
            <div className={dotClass} /><div className={dotClass} />
            <div className={dotClass} /><div className={dotClass} />
        </div>
    );
    
    return null;
}

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
