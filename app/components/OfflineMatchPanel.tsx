"use client";

import React from 'react';
import { motion } from 'framer-motion';

// ─── Theme-agnostic contract (holds for current + future themes) ───────────
// Same as the other synced panels: this sheet always renders on the shared
// dark-glass sandwich shell, so content uses only white-ink + white-opacity
// surfaces + cyan/status accents. No font-family is set (inherits the active
// theme's display font). Spacing inside `.ludo-offline-scope` is re-asserted
// in globals.css (the global unlayered reset zeroes Tailwind utilities).

// Icon tile: cyan glow square shared with the other synced panels.
const OfflineTile = () => (
    <div className="w-7 h-7 rounded-xl bg-cyan-500/15 border border-cyan-400/40 flex items-center justify-center shadow-[0_0_16px_rgba(34,211,238,0.25)]">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 text-cyan-300">
            <path d="M12 2s-8 11.5-8 16c0 4.4 3.6 8 8 8s8-3.6 8-8c0-4.5-8-16-8-16z"></path>
        </svg>
    </div>
);

// Section label: pill + gradient rule (marketplace vocabulary)
const SectionLabel = ({ children }: { children: React.ReactNode }) => (
    <div className="mt-1 mb-1 flex items-center gap-2.5">
        <span className="px-2 py-0.5 rounded-md bg-white/[0.07] border border-white/10 text-[10px] font-black tracking-[0.18em] text-white/60 font-mono uppercase">
            {children}
        </span>
        <div className="flex-1 h-px bg-gradient-to-r from-white/15 to-transparent" />
    </div>
);

interface OfflineMatchPanelProps {
    gameMode: 'classic' | 'power';
    matchType: '1v1' | '2v2' | '4P';
    onClose: () => void;
    onStartOfflineGame: () => void;
}

export const OfflineMatchPanel = ({
    gameMode,
    matchType,
    onClose,
    onStartOfflineGame
}: OfflineMatchPanelProps) => {
    return (
        <>
            {/* Backdrop */}
            <div
                className="fixed top-[64px] bottom-[80px] left-0 right-0 z-40 bg-transparent"
                onClick={onClose}
            />

            {/* Clipped Container */}
            <div className="fixed inset-0 z-[110] flex justify-center pointer-events-none">
                <div className="w-full max-w-[500px] relative h-full">
                    <div
                        /* Unified global panel layout: top-64, bottom-80 sandwich */
                        className="ludo-offline-scope pointer-events-auto absolute top-[64px] bottom-[80px] left-[8px] right-[8px] border border-white/10 rounded-[32px] flex flex-col shadow-2xl overflow-hidden"
                        style={{ background: 'var(--panel-bg-image, var(--ludo-bg-cosmic))', backgroundColor: 'var(--panel-bg, rgba(13,13,13,0.92))', backdropFilter: 'blur(32px)' }}
                    >
                    {/* Authentic Subdued Cosmic Orbs */}
                    <div className="absolute top-[-20%] left-[-20%] w-full h-full cosmic-orb cosmic-orb-1 opacity-20 scale-150 pointer-events-none" />
                    <div className="absolute bottom-[-20%] right-[-20%] w-full h-full cosmic-orb cosmic-orb-2 opacity-15 scale-150 pointer-events-none" />

                    {/* Handle Bar */}
                    <div className="w-full flex justify-center pt-2 pb-1 relative z-10">
                        <div className="w-12 h-1.5 bg-white/20 rounded-full" />
                    </div>

                    {/* Header */}
                    <div className="px-5 pb-3 border-b border-white/10 relative z-10">
                        <div className="flex items-center justify-between mb-1 mt-1">
                            <h2 className="text-xl font-bold text-white flex items-center gap-2">
                                <OfflineTile />
                                Offline Play
                            </h2>
                            <button
                                onClick={onClose}
                                aria-label="Close offline play"
                                className="w-8 h-8 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white/70 hover:text-white transition-all ring-1 ring-white/10 shadow-sm shrink-0"
                            >
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                            </button>
                        </div>
                        <div className="flex items-center gap-2 px-0.5">
                            <span className="text-[11px] font-black text-white/70 tracking-wide uppercase">
                                {gameMode}
                            </span>
                            <span className="w-0.5 h-0.5 rounded-full bg-white/25" />
                            <span className="text-[11px] font-black text-cyan-300 tracking-wide uppercase">
                                {matchType} • Bots / Local
                            </span>
                        </div>
                    </div>

                    {/* Content Area */}
                    <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar px-5 pt-3 pb-4 relative z-10 flex flex-col gap-2">
                        <SectionLabel>Setup</SectionLabel>
                        <div className="p-5 rounded-2xl bg-white/[0.04] border border-white/10 flex flex-col gap-4">
                            <div className="flex justify-between items-center text-xs font-black uppercase tracking-[0.2em] text-white/40">
                                <span>Selected Mode</span>
                                <span className="text-cyan-400">{gameMode}</span>
                            </div>
                            <div className="flex justify-between items-center text-xs font-black uppercase tracking-[0.2em] text-white/40">
                                <span>Match Type</span>
                                <span className="text-cyan-400">{matchType}</span>
                            </div>
                            <div className="flex justify-between items-center text-xs font-black uppercase tracking-[0.2em] text-white/40">
                                <span>Opponents</span>
                                <span className="text-cyan-400">Bots / Local</span>
                            </div>
                        </div>

                        <div className="flex flex-col gap-4 text-center px-4 py-16">
                            <p className="text-white/60 text-sm font-bold leading-relaxed">
                                Practice your strategy or play casually against AI opponents. Offline matches do not require a network connection or entry fee.
                            </p>
                        </div>
                    </div>

                    {/* Footer Action */}
                    <div className="px-5 pt-3 pb-5 border-t border-white/10 relative z-10">
                        <button
                            onClick={onStartOfflineGame}
                            className="w-full py-3 bg-white text-black font-black uppercase tracking-[0.2em] rounded-2xl text-sm shadow-[0_0_30px_rgba(255,255,255,0.3)] hover:shadow-[0_0_50px_rgba(255,255,255,0.5)] transition-all active:scale-95"
                        >
                            Start Offline Match
                        </button>
                    </div>
                    </div>
                </div>
            </div>
        </>
    );
}
