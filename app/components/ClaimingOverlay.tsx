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
                    className="ludo-claiming-overlay absolute inset-0 z-30 rounded-2xl backdrop-blur-md flex flex-col items-center justify-center p-4 overflow-hidden pointer-events-auto"
                    style={{
                        backgroundColor: 'var(--claiming-overlay-bg, rgba(0, 0, 0, 0.82))',
                        borderColor: 'var(--claiming-overlay-border, rgba(34, 211, 238, 0.50))',
                        borderWidth: '1px',
                        borderStyle: 'solid',
                        boxShadow: 'var(--claiming-overlay-shadow, 0 0 30px rgba(34, 211, 238, 0.25))',
                    }}
                >
                    {/* Background Rotary Radar Sweep */}
                    <div className="absolute inset-0 pointer-events-none flex items-center justify-center overflow-hidden">
                        <motion.div
                            animate={{ rotate: 360 }}
                            transition={{ duration: 3, repeat: Infinity, ease: 'linear' }}
                            className="w-[220px] h-[220px] rounded-full opacity-40"
                            style={{
                                background:
                                    'conic-gradient(from 0deg, transparent 0deg, transparent 270deg, var(--claiming-overlay-radar, rgba(34, 211, 238, 0.45)) 360deg)',
                            }}
                        />
                        {/* Concentric Sonar Rings */}
                        <div
                            className="w-24 h-24 rounded-full border absolute pointer-events-none"
                            style={{ borderColor: 'var(--claiming-overlay-ring-1, rgba(34, 211, 238, 0.25))' }}
                        />
                        <div
                            className="w-36 h-36 rounded-full border absolute pointer-events-none"
                            style={{ borderColor: 'var(--claiming-overlay-ring-2, rgba(34, 211, 238, 0.15))' }}
                        />
                    </div>

                    {/* Central Hero: 64px ThinkingOrb + Tactical Pulse Ring */}
                    <div className="relative z-10 flex flex-col items-center gap-2">
                        <div className="relative flex items-center justify-center">
                            <motion.div
                                animate={{ scale: [0.95, 1.25, 0.95], opacity: [0.3, 0.7, 0.3] }}
                                transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
                                className="absolute w-20 h-20 rounded-full border pointer-events-none"
                                style={{
                                    borderColor: 'var(--claiming-overlay-pulse-border, rgba(34, 211, 238, 0.40))',
                                    backgroundColor: 'var(--claiming-overlay-pulse-bg, rgba(34, 211, 238, 0.10))',
                                }}
                            />
                            <ThinkingOrb state="solving" size={64} tone="accent" />
                        </div>
                        <div className="flex flex-col items-center text-center">
                            <span
                                className="text-xs font-mono font-black tracking-widest uppercase animate-pulse"
                                style={{ color: 'var(--claiming-overlay-title, #67e8f9)' }}
                            >
                                {title}
                            </span>
                            <span
                                className="text-ludo-xs font-mono tracking-wider uppercase mt-0.5"
                                style={{ color: 'var(--claiming-overlay-subtitle, rgba(255, 255, 255, 0.50))' }}
                            >
                                {subtitle}
                            </span>
                        </div>
                    </div>

                    {/* Laser Scanning Beam (Top to Bottom) */}
                    <motion.div
                        initial={{ translateY: '0%' }}
                        animate={{ translateY: '3500%' }}
                        transition={{ duration: 1.8, repeat: Infinity, ease: 'linear' }}
                        className="absolute inset-x-0 top-0 h-[2px] pointer-events-none"
                        style={{
                            background:
                                'linear-gradient(to right, transparent, var(--claiming-overlay-laser, #22d3ee), transparent)',
                            boxShadow: 'var(--claiming-overlay-laser-shadow, 0 0 8px #22d3ee)',
                        }}
                    />
                </motion.div>
            )}
        </AnimatePresence>
    );
}

export default ClaimingOverlay;
