'use client';

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ThinkingOrb } from './ThinkingOrb';

interface ClaimingOverlayProps {
    isClaiming: boolean;
    title?: string;
    subtitle?: string;
}

export function ClaimingOverlay({
    isClaiming,
    title = 'CLAIMING REWARD...',
    subtitle = 'CONFIRM IN WALLET',
}: ClaimingOverlayProps) {
    return (
        <AnimatePresence>
            {isClaiming && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="absolute inset-0 z-30 rounded-2xl backdrop-blur-md bg-black/80 flex flex-col items-center justify-center p-4 overflow-hidden border border-cyan-400/50 shadow-[0_0_30px_rgba(34,211,238,0.25)] pointer-events-auto"
                >
                    {/* Background Rotary Radar Sweep */}
                    <div className="absolute inset-0 pointer-events-none flex items-center justify-center overflow-hidden">
                        <motion.div
                            animate={{ rotate: 360 }}
                            transition={{ duration: 3, repeat: Infinity, ease: 'linear' }}
                            className="w-[220px] h-[220px] rounded-full opacity-40"
                            style={{
                                background:
                                    'conic-gradient(from 0deg, transparent 0deg, transparent 270deg, rgba(34, 211, 238, 0.45) 360deg)',
                            }}
                        />
                        {/* Concentric Sonar Rings */}
                        <div className="w-24 h-24 rounded-full border border-cyan-400/25 absolute" />
                        <div className="w-36 h-36 rounded-full border border-cyan-400/15 absolute" />
                    </div>

                    {/* Central Hero: 64px ThinkingOrb + Tactical Pulse Ring */}
                    <div className="relative z-10 flex flex-col items-center gap-2">
                        <div className="relative flex items-center justify-center">
                            <motion.div
                                animate={{ scale: [0.95, 1.25, 0.95], opacity: [0.3, 0.7, 0.3] }}
                                transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
                                className="absolute w-20 h-20 rounded-full border border-cyan-400/40 bg-cyan-400/10 pointer-events-none"
                            />
                            <ThinkingOrb state="solving" size={64} tone="accent" />
                        </div>
                        <div className="flex flex-col items-center text-center">
                            <span className="text-xs font-mono font-black tracking-widest text-cyan-300 uppercase animate-pulse">
                                {title}
                            </span>
                            <span className="text-[10px] font-mono text-white/50 tracking-wider uppercase mt-0.5">
                                {subtitle}
                            </span>
                        </div>
                    </div>

                    {/* Laser Scanning Beam (Top to Bottom) */}
                    <motion.div
                        initial={{ top: '0%' }}
                        animate={{ top: '100%' }}
                        transition={{ duration: 1.8, repeat: Infinity, ease: 'linear' }}
                        className="absolute inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-cyan-400 to-transparent pointer-events-none shadow-[0_0_8px_#22d3ee]"
                    />
                </motion.div>
            )}
        </AnimatePresence>
    );
}

export default ClaimingOverlay;
