/* eslint-disable @typescript-eslint/no-explicit-any -- legacy wire/UI types */
'use client';

import React, { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useIsMobileView } from '@/hooks/useIsMobileView';
import { LiveArenaContent, LiveTile } from './LiveArenaDirectory';
import { LuX } from 'react-icons/lu';

// ─── Live Arena only (missions moved to MissionPanel) ──────────────────────
// Theme-agnostic sandwich shell — same contract as marketplace/settings.

interface ArenaPanelProps {
    isOpen: boolean;
    onClose: () => void;
    onSwitchTab?: (tab: any) => void;
    onWatchMatch?: (roomCode: string) => void;
}

export default function ArenaPanel({ isOpen, onClose, onWatchMatch }: ArenaPanelProps) {
    const isMobile = useIsMobileView();
    const [liveStats, setLiveStats] = useState({ live: 0, watching: 0, vol: 0 });
    const handleLiveStats = useCallback((live: number, watching: number, vol: number) => {
        setLiveStats((prev) =>
            prev.live === live && prev.watching === watching && prev.vol === vol
                ? prev
                : { live, watching, vol }
        );
    }, []);

    return (
        <AnimatePresence initial={false}>
            {isOpen && (
                <>
                    <div
                        className="fixed top-[64px] bottom-[80px] left-0 right-0 z-40 bg-transparent"
                        onClick={onClose}
                    />
                    <div className="fixed inset-0 z-[110] flex justify-center pointer-events-none">
                        <motion.div
                            initial={isMobile ? false : { opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={isMobile ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, y: 20 }}
                            transition={
                                isMobile
                                    ? { duration: 0 }
                                    : { type: 'tween', duration: 0.22, ease: [0.22, 1, 0.36, 1] }
                            }
                            className="w-full max-w-[500px] relative h-full pointer-events-auto panel-motion-host"
                        >
                            <div
                                className="ludo-arena-scope absolute top-[64px] bottom-[80px] left-[8px] right-[8px] border border-white/10 rounded-[32px] flex flex-col shadow-2xl overflow-hidden"
                                style={{
                                    background: 'var(--panel-bg-image, var(--ludo-bg-cosmic))',
                                    backgroundColor: 'var(--panel-bg, rgba(13, 13, 13, 0.92))',
                                    backdropFilter: 'blur(32px)',
                                }}
                            >
                                <div className="absolute top-[-20%] left-[-20%] w-full h-full cosmic-orb cosmic-orb-1 opacity-20 scale-150 pointer-events-none" />
                                <div className="absolute bottom-[-20%] right-[-20%] w-full h-full cosmic-orb cosmic-orb-2 opacity-15 scale-150 pointer-events-none" />

                                <div className="w-full flex justify-center pt-2 pb-1 relative z-10">
                                    <div className="w-12 h-1.5 bg-white/20 rounded-full" />
                                </div>

                                <div className="px-5 pb-3 border-b border-white/10 relative z-10">
                                    <div className="flex items-center justify-between mb-1 mt-1">
                                        <h2 className="text-xl font-bold text-white flex items-center gap-2">
                                            <LiveTile />
                                            Live Arena
                                        </h2>
                                        <button
                                            onClick={onClose}
                                            aria-label="Close arena"
                                            className="w-11 h-11 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white/70 hover:text-white transition-all ring-1 ring-white/10 shadow-sm shrink-0"
                                        >
                                            <LuX className="w-4 h-4" />
                                        </button>
                                    </div>
                                    <div className="flex items-center gap-2 px-0.5">
                                        {liveStats.live > 0 && (
                                            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                                        )}
                                        <span className="text-[11px] font-black text-white/70 tracking-wide uppercase tabular-nums">
                                            {liveStats.live} live
                                        </span>
                                        <span className="w-0.5 h-0.5 rounded-full bg-white/25" />
                                        <span className="text-[11px] font-black text-white/70 tracking-wide uppercase tabular-nums">
                                            {liveStats.watching.toLocaleString()} watching
                                        </span>
                                        <span className="w-0.5 h-0.5 rounded-full bg-white/25" />
                                        <span className="text-[11px] font-black text-cyan-300 tracking-wide uppercase tabular-nums">
                                            {liveStats.vol.toLocaleString()} vol
                                        </span>
                                    </div>
                                </div>

                                <LiveArenaContent onWatchMatch={onWatchMatch} onStats={handleLiveStats} />
                            </div>
                        </motion.div>
                    </div>
                </>
            )}
        </AnimatePresence>
    );
}
