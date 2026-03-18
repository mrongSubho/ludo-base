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

// Aesthetic palettes focusing strictly on cyan text (req 2), but random base dot colors.
const DOT_COLORS = [
    'bg-cyan-400', 'bg-purple-400', 'bg-emerald-400', 
    'bg-amber-400', 'bg-rose-400', 'bg-indigo-400'
];

export const ActionDice: React.FC<ActionDiceProps> = ({
    onSelectQuickMatch,
    onSelectTeamUp,
    onSelectOfflineMatch
}) => {
    const controls = useAnimation();
    const shadowControls = useAnimation();
    
    // We track total rotations to ensure spins continuously add up
    const [currentRotateX, setCurrentRotateX] = useState(0);
    const [currentRotateY, setCurrentRotateY] = useState(0);
    const [currentRotateZ, setCurrentRotateZ] = useState(0);

    const [activeIndex, setActiveIndex] = useState(0);

    // Initial resting tilt
    const baseRotateX = -15;
    const baseRotateY = -15;
    const baseRotateZ = 0;

    const [faces, setFaces] = useState<any[]>([]);

    const generateRandomFaces = () => {
        const pips = [1, 2, 3, 4, 5, 6].sort(() => Math.random() - 0.5);
        const actions = [...BASE_ACTIONS, ...BASE_ACTIONS].sort(() => Math.random() - 0.5);
        const dotColors = [...DOT_COLORS].sort(() => Math.random() - 0.5);
        
        return pips.map((pipCount, i) => ({
            pips: pipCount,
            id: actions[i].id,
            label: actions[i].label,
            dotColor: dotColors[i]
        }));
    };

    useEffect(() => {
        // Initial setup
        setFaces(generateRandomFaces());
        setCurrentRotateX(baseRotateX);
        setCurrentRotateY(baseRotateY);
        setCurrentRotateZ(baseRotateZ);
    }, []);

    const performRoll = (dragDirX: number, dragDirY: number) => {
        // Generate entirely new faces for the dice on every roll (req 1)
        const newFaces = generateRandomFaces();
        setFaces(newFaces);

        // Randomly target one of the 6 faces (0=front, 1=right, 2=back, 3=left, 4=top, 5=bottom)
        const newFaceIndex = Math.floor(Math.random() * 6);
        setActiveIndex(newFaceIndex);
        
        // Target orientations relative to the container for each face to be pointing Front (+Z) and Upright (-Y for text up)
        const align = [
            { rx: 0, ry: 0, rz: 0 },       // Front
            { rx: 0, ry: -90, rz: 0 },     // Right
            { rx: 0, ry: 180, rz: 0 },     // Back
            { rx: 0, ry: 90, rz: 0 },      // Left
            { rx: -90, ry: 0, rz: 180 },   // Top (tumble forward, spin 180 to upright)
            { rx: 90, ry: 0, rz: 180 }     // Bottom (tumble back, spin 180 to upright)
        ][newFaceIndex];

        // Ensure we preserve the isometric resting perspective
        const alignX = align.rx + baseRotateX;
        const alignY = align.ry + baseRotateY;
        const alignZ = align.rz + baseRotateZ;

        // Find the "nearest" angle so we seamlessly pick up where we left off
        const normalize = (current: number, target: number) => {
             let diff = (target - current) % 360;
             if (diff > 180) diff -= 360;
             if (diff < -180) diff += 360;
             return current + diff;
        };

        const nearestX = normalize(currentRotateX, alignX);
        const nearestY = normalize(currentRotateY, alignY);
        const nearestZ = normalize(currentRotateZ, alignZ);

        // 2/3/4 spins randomly in a single slide (req 6)
        const spinsX = Math.floor(Math.random() * 3) + 2; 
        const spinsY = Math.floor(Math.random() * 3) + 2;

        // Determine tumble directions (favor user drag if present, otherwise chaotic)
        const dirX = dragDirY !== 0 ? dragDirY : (Math.random() > 0.5 ? 1 : -1); 
        const dirY = dragDirX !== 0 ? dragDirX : (Math.random() > 0.5 ? 1 : -1);

        const targetX = nearestX + (360 * spinsX * dirX);
        const targetY = nearestY + (360 * spinsY * dirY);
        // Z only snaps to correct orientation; tumbling primarily occurs on X & Y
        const targetZ = nearestZ;

        setCurrentRotateX(targetX);
        setCurrentRotateY(targetY);
        setCurrentRotateZ(targetZ);

        // Animate Dice
        controls.start({
            rotateX: targetX,
            rotateY: targetY,
            rotateZ: targetZ,
            transition: { type: 'spring', stiffness: 50, damping: 20 }
        });
        
        // Animate Shadow
        shadowControls.start({
            scale: [1, 0.4, 0.4, 1],
            opacity: [0.6, 0.2, 0.2, 0.6],
            transition: { duration: 1.0, ease: "easeInOut" }
        });
    };

    const handleDragEnd = (event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
        const threshold = 20; // pixels
        
        const isHorizontal = Math.abs(info.offset.x) > Math.abs(info.offset.y);
        
        if (isHorizontal) {
             if (info.offset.x < -threshold) performRoll(1, 0);       // Swipe left
             else if (info.offset.x > threshold) performRoll(-1, 0);  // Swipe right
             else resetToCurrent();
        } else {
             if (info.offset.y < -threshold) performRoll(0, 1);       // Swipe up
             else if (info.offset.y > threshold) performRoll(0, -1);  // Swipe down
             else resetToCurrent();
        }
    };

    const resetToCurrent = () => {
        controls.start({
            rotateX: currentRotateX,
            rotateY: currentRotateY,
            rotateZ: currentRotateZ,
            transition: { type: 'spring', stiffness: 300, damping: 25 }
        });
    };

    const handleFaceClick = (index: number) => {
        // Only allow clicks if this face is the current active front-facing target
        if (index !== activeIndex && index !== -1) return;
        
        const activeFaceId = faces[activeIndex].id;
        
        if (activeFaceId === 'quick') onSelectQuickMatch();
        else if (activeFaceId === 'team') onSelectTeamUp();
        else if (activeFaceId === 'offline') onSelectOfflineMatch();
    };

    if (faces.length === 0) return null; // Hydration guard

    return (
        <div className="relative w-full flex flex-col items-center justify-center py-2" style={{ perspective: '1200px' }}>
            
            <div className="absolute top-0 w-full flex items-center justify-center gap-2">
                <span className="text-white/50 text-[10px] uppercase font-bold tracking-[0.3em] drop-shadow-md">Tumble Dice</span>
            </div>

            <motion.div
                animate={{ x: [-5, 5, -5] }}
                transition={{ repeat: Infinity, duration: 1.5, ease: "easeInOut" }}
                className="absolute left-6 md:left-24 text-white/50 z-20 cursor-pointer drop-shadow-[0_0_8px_rgba(255,255,255,0.2)] hover:text-white hover:scale-110 active:scale-90 transition-all"
                onClick={() => performRoll(-1, 0)}
            >
                <ChevronLeft />
            </motion.div>

            <div className="relative w-32 h-32 mt-8 mb-4 cursor-grab active:cursor-grabbing [--tz:64px]">
                
                <motion.div
                    className="w-full h-full relative"
                    animate={controls}
                    initial={{ rotateX: baseRotateX, rotateY: baseRotateY, rotateZ: baseRotateZ }} 
                    drag
                    dragConstraints={{ left: 0, right: 0, top: 0, bottom: 0 }}
                    dragElastic={0.2}
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
                    
                    {/* Top Face (4) */}
                    <DiceFace face={faces[4]} transform="rotateX(90deg) translateZ(var(--tz))" onClick={() => handleFaceClick(4)} isActive={activeIndex === 4} />
                    
                    {/* Bottom Face (5) */}
                    <DiceFace face={faces[5]} transform="rotateX(-90deg) translateZ(var(--tz))" onClick={() => handleFaceClick(5)} isActive={activeIndex === 5} />
                </motion.div>
            </div>

            <motion.div 
                animate={shadowControls}
                className="w-24 h-4 rounded-[100%] bg-black/80 blur-md pointer-events-none mt-2 transition-all" 
                style={{ opacity: 0.6 }}
            />

            <motion.div
                animate={{ x: [5, -5, 5] }}
                transition={{ repeat: Infinity, duration: 1.5, ease: "easeInOut" }}
                className="absolute right-6 md:right-24 text-white/50 z-20 cursor-pointer drop-shadow-[0_0_8px_rgba(255,255,255,0.2)] hover:text-white hover:scale-110 active:scale-90 transition-all"
                onClick={() => performRoll(1, 0)}
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
                <DiceDots count={face.pips} dotColor={face.dotColor} />
            </div>

            <button 
                onClick={(e) => {
                    if (isActive) {
                        e.stopPropagation();
                        onClick();
                    }
                }}
                className={`relative mt-1 rounded-full border transition-all duration-300 glass-panel flex flex-col items-center justify-center w-[96%] min-h-[44px] px-2 py-2 backdrop-blur-[1px] z-10
                    ${isActive 
                        ? 'border-cyan-400/80 shadow-[0_0_15px_rgba(0,255,255,0.3)] bg-cyan-900/10 hover:bg-cyan-900/20 hover:scale-[1.10] active:scale-95 cursor-pointer' 
                        : 'border-white/20 bg-gray-500/10 scale-[0.85] opacity-50 pointer-events-none'
                    }
                `}
            >
                <span className={`block text-[14px] md:text-base lg:text-lg font-black italic tracking-tighter leading-[1] whitespace-normal text-center drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)] text-cyan-400`}>
                    {face.label}
                </span>
            </button>
        </div>
    );
};

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
