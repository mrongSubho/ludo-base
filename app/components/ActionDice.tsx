"use client";

import React, { useState } from 'react';
import { motion, useAnimation, PanInfo } from 'framer-motion';

interface ActionDiceProps {
    onSelectQuickMatch: () => void;
    onSelectTeamUp: () => void;
    onSelectOfflineMatch: () => void;
}

const FACES = [
    { id: 'quick', label: 'QUICK MATCH', color: 'text-cyan-600', dotColor: 'bg-cyan-400', pips: 1 },
    { id: 'team', label: 'TEAM UP', color: 'text-purple-600', dotColor: 'bg-purple-400', pips: 2 },
    { id: 'offline', label: 'OFFLINE MATCH', color: 'text-emerald-600', dotColor: 'bg-emerald-400', pips: 3 },
    { id: 'team2', label: 'TEAM UP', color: 'text-purple-600', dotColor: 'bg-purple-400', pips: 4 },
];

export const ActionDice: React.FC<ActionDiceProps> = ({
    onSelectQuickMatch,
    onSelectTeamUp,
    onSelectOfflineMatch
}) => {
    const controls = useAnimation();
    const shadowControls = useAnimation();
    const [currentIndex, setCurrentIndex] = useState(0);

    // Initial resting tilt
    const baseRotateX = -15;
    const baseRotateY = -15;

    const handlePanEnd = (event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
        const threshold = 20;
        let newIndex = currentIndex;
        
        if (info.offset.x < -threshold) {
            // swiped left -> rotate right
            newIndex = currentIndex + 1;
        } else if (info.offset.x > threshold) {
            // swiped right -> rotate left
            newIndex = currentIndex - 1;
        }

        if (newIndex !== currentIndex) {
            setCurrentIndex(newIndex);
            
            // Animate Dice
            // We maintain the initial -15deg Y offset while rotating by 90deg increments
            controls.start({
                rotateY: (newIndex * -90) + baseRotateY,
                transition: { type: 'spring', stiffness: 150, damping: 20 }
            });
            
            // Animate Shadow (shrink and grow back to simulate tumbling)
            shadowControls.start({
                scale: [1, 0.4, 1],
                opacity: [0.6, 0.2, 0.6],
                transition: { duration: 0.5, ease: "easeInOut" }
            });
        }
    };

    const handleFaceClick = (index: number) => {
        const normalizedIndex = ((currentIndex % 4) + 4) % 4;
        
        // Prevent clicking faces that are not active/front
        if (index !== normalizedIndex && index !== -1) {
            return;
        }
        
        const activeFaceId = FACES[normalizedIndex].id;
        
        if (activeFaceId === 'quick') onSelectQuickMatch();
        else if (activeFaceId === 'team' || activeFaceId === 'team2') onSelectTeamUp();
        else if (activeFaceId === 'offline') onSelectOfflineMatch();
    };

    const getNormalized = () => ((currentIndex % 4) + 4) % 4;

    return (
        <div className="relative w-full flex flex-col items-center justify-center py-2" style={{ perspective: '1200px' }}>
            
            {/* Header Text */}
            <div className="absolute top-0 w-full text-center">
                <span className="text-white/50 text-[10px] uppercase font-bold tracking-[0.3em] drop-shadow-md">Swipe to Roll</span>
            </div>

            {/* Left Chevron */}
            <motion.div
                animate={{ x: [-5, 5, -5] }}
                transition={{ repeat: Infinity, duration: 1.5, ease: "easeInOut" }}
                className="absolute left-6 md:left-24 text-white/50 pointer-events-none z-10 drop-shadow-[0_0_8px_rgba(255,255,255,0.2)]"
            >
                <ChevronLeft />
            </motion.div>

            {/* 128x128px Solid Core Container */}
            <div className="relative w-32 h-32 mt-8 mb-4 cursor-grab active:cursor-grabbing [--tz:64px]">
                
                <motion.div
                    className="w-full h-full relative"
                    animate={controls}
                    initial={{ rotateX: baseRotateX, rotateY: baseRotateY, rotateZ: 0 }} 
                    onPanEnd={handlePanEnd}
                    style={{ transformStyle: 'preserve-3d' }}
                >
                    {/* Front Face */}
                    <DiceFace 
                        face={FACES[0]} 
                        transform="translateZ(var(--tz))" 
                        onClick={() => handleFaceClick(0)}
                        isActive={getNormalized() === 0}
                    />
                    {/* Right Face */}
                    <DiceFace 
                        face={FACES[1]} 
                        transform="rotateY(90deg) translateZ(var(--tz))" 
                        onClick={() => handleFaceClick(1)}
                        isActive={getNormalized() === 1}
                    />
                    {/* Back Face */}
                    <DiceFace 
                        face={FACES[2]} 
                        transform="rotateY(180deg) translateZ(var(--tz))" 
                        onClick={() => handleFaceClick(2)}
                        isActive={getNormalized() === 2}
                    />
                    {/* Left Face */}
                    <DiceFace 
                        face={FACES[3]} 
                        transform="rotateY(-90deg) translateZ(var(--tz))" 
                        onClick={() => handleFaceClick(3)}
                        isActive={getNormalized() === 3}
                    />
                    
                    {/* Top Face (Solid Plastic Cap) */}
                    <div 
                        className="absolute w-full h-full rounded-2xl bg-[#E2E8F0] border border-white shadow-[inset_0_-4px_10px_rgba(0,0,0,0.1),inset_0_4px_10px_rgba(255,255,255,1)]"
                        style={{ transform: "rotateX(90deg) translateZ(var(--tz))", backfaceVisibility: 'hidden' }}
                    />
                    
                    {/* Bottom Face (Solid Plastic Cap) */}
                    <div 
                        className="absolute w-full h-full rounded-2xl bg-[#CBD5E1] border border-gray-400 shadow-[inset_0_4px_10px_rgba(0,0,0,0.2)]"
                        style={{ transform: "rotateX(-90deg) translateZ(var(--tz))", backfaceVisibility: 'hidden' }}
                    />
                </motion.div>
            </div>

            {/* Table Drop Shadow */}
            <motion.div 
                animate={shadowControls}
                className="w-24 h-4 rounded-[100%] bg-black/80 blur-md pointer-events-none mt-2 transition-all" 
                style={{ opacity: 0.6 }}
            />

            {/* Right Chevron */}
            <motion.div
                animate={{ x: [5, -5, 5] }}
                transition={{ repeat: Infinity, duration: 1.5, ease: "easeInOut" }}
                className="absolute right-6 md:right-24 text-white/50 pointer-events-none z-10 drop-shadow-[0_0_8px_rgba(255,255,255,0.2)]"
            >
                <ChevronRight />
            </motion.div>
        </div>
    );
};

const DiceFace = ({ face, transform, onClick, isActive }: { face: any, transform: string, onClick: () => void, isActive: boolean }) => {
    return (
        <div
            onClick={isActive ? onClick : undefined}
            className={`absolute w-full h-full flex flex-col items-center justify-center p-2 rounded-2xl transition-all duration-300 select-none overflow-hidden
                bg-white border border-gray-100
                shadow-[inset_0_-8px_16px_rgba(0,0,0,0.08),inset_0_4px_8px_rgba(255,255,255,1),0_4px_12px_rgba(0,0,0,0.1)]
                ${isActive ? 'cursor-pointer' : ''}
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

            {/* Pill shaped text container for legibility over dots */}
            <div className={`relative z-10 mt-1 px-3 py-1.5 bg-white/95 backdrop-blur-sm rounded-full shadow-[0_2px_4px_rgba(0,0,0,0.1)] border border-gray-100 ${isActive ? 'scale-105' : 'scale-100'} transition-transform`}>
                <div className={`text-[11px] font-black uppercase tracking-tight text-center leading-none ${face.color}`}>
                    {face.label}
                </div>
            </div>
            
            {isActive ? (
                <div className="relative z-10 mt-2 px-2.5 py-1 rounded-full bg-gray-100 border border-gray-200 shadow-sm">
                    <span className="text-[7px] font-bold uppercase tracking-[0.2em] text-gray-500">
                        TAP TO START
                    </span>
                </div>
            ) : (
                <div className="relative z-10 mt-2 w-6 h-1 rounded-full bg-gray-200" />
            )}
        </div>
    );
};

const DiceDots = ({ count, dotColor }: { count: number, dotColor: string }) => {
    // Large, colored dots to act as the primary visual
    const dotClass = `w-7 h-7 rounded-full shadow-[inset_0_2px_4px_rgba(0,0,0,0.2)] ${dotColor} opacity-90`;
    
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
        <div className="grid grid-cols-2 grid-rows-2 gap-[1.2rem] p-4">
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
