"use client";

import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';

// ─── Theme-agnostic contract (holds for current + future themes) ───────────
// Same as the other synced panels: this sheet always renders on the shared
// dark-glass sandwich shell, so content uses only white-ink + white-opacity
// surfaces + cyan/status accents (amber kept for the warning accent only).
// No font-family is set (inherits the active theme's display font). Spacing
// inside `.ludo-migrate-scope` is re-asserted in globals.css (the global
// unlayered reset zeroes Tailwind utilities).

// Icon tile: amber glow square (warning accent — the one exception to cyan).
const MigrateTile = () => (
    <div className="w-7 h-7 rounded-xl bg-amber-500/15 border border-amber-400/40 flex items-center justify-center shadow-[0_0_16px_rgba(251,191,36,0.25)]">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-4 h-4 text-amber-300">
            <path d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
    </div>
);

interface HostMigrationPanelProps {
    onQuit: () => void;
}

export const HostMigrationPanel = ({ onQuit }: HostMigrationPanelProps) => {
    // Snooze: hide for 45s to let a slow handshake finish instead of forcing quit.
    // If the connection recovers, the parent unmounts this panel anyway.
    const [snoozed, setSnoozed] = useState(false);
    useEffect(() => {
        if (!snoozed) return;
        const t = setTimeout(() => setSnoozed(false), 45000);
        return () => clearTimeout(t);
    }, [snoozed]);

    if (snoozed) return null;

    return (
        <>
            {/* Backdrop with standard Top/Bottom Gaps */}
            <div className="fixed inset-0 z-[1000] flex justify-center pointer-events-none">
                <div className="w-full max-w-[500px] relative h-full">
                    <div
                        className="ludo-migrate-scope pointer-events-auto absolute top-[64px] bottom-[80px] left-[8px] right-[8px] border border-white/10 rounded-[32px] flex flex-col shadow-2xl overflow-hidden"
                        style={{ 
                            background: 'var(--ludo-bg-cosmic)', 
                            backgroundColor: 'rgba(13,13,13,0.95)', 
                            backdropFilter: 'blur(32px)' 
                        }}
                    >
                        {/* Cosmic Orbs */}
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
                                    <MigrateTile />
                                    Host Migrating
                                </h2>
                            </div>
                            <div className="flex items-center gap-2 px-0.5">
                                <span className="text-[11px] font-black text-amber-300 tracking-wide uppercase">
                                    Connection lost
                                </span>
                                <span className="w-0.5 h-0.5 rounded-full bg-white/25" />
                                <span className="text-[11px] font-black text-white/70 tracking-wide uppercase">
                                    Wager is safe
                                </span>
                            </div>
                        </div>

                        {/* Main Content */}
                        <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar flex flex-col items-center justify-center px-5 pt-3 pb-4 relative z-10">
                            {/* Radar Loader (Consistent with QuickMatchPanel) */}
                            <div className="relative w-48 h-48 flex items-center justify-center mb-2">
                                <div className="absolute inset-0 border border-amber-500/10 rounded-full" />
                                <motion.div
                                    animate={{ rotate: 360 }}
                                    transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
                                    className="absolute inset-0 rounded-full"
                                    style={{
                                        background: 'conic-gradient(from 0deg, transparent 60%, rgba(251, 191, 36, 0.15) 100%)'
                                    }}
                                />
                                <div className="relative z-10 w-24 h-24 bg-white/5 rounded-full border border-white/10 flex items-center justify-center backdrop-blur-xl">
                                    <motion.div
                                        animate={{ opacity: [0.4, 1, 0.4] }}
                                        transition={{ duration: 2, repeat: Infinity }}
                                        className="text-amber-400"
                                    >
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-10 h-10">
                                            <path d="M13 10V3L4 14h7v7l9-11h-7z" />
                                        </svg>
                                    </motion.div>
                                </div>
                            </div>

                            <div className="text-center max-w-[280px]">
                                <p className="text-lg font-bold text-white mb-2 italic">Connection Lost</p>
                                <p className="text-sm text-white/50 leading-relaxed mb-6">
                                    Host disconnected. Re-assigning a new host to continue your match...
                                </p>
                                <div className="inline-flex items-center gap-2 px-4 py-2 bg-cyan-500/10 border border-cyan-500/20 rounded-xl">
                                    <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                                    <span className="text-[10px] font-black text-cyan-400 uppercase tracking-widest">Wager is Safe</span>
                                </div>
                            </div>
                        </div>

                        {/* Footer / Actions */}
                        <div className="px-5 pt-3 pb-5 border-t border-white/10 bg-black/20 backdrop-blur-sm relative z-10 flex flex-col gap-2">
                            <button
                                onClick={() => setSnoozed(true)}
                                className="w-full py-3 rounded-2xl bg-cyan-500/15 border border-cyan-500/30 text-cyan-300 text-sm font-black uppercase tracking-[0.2em] hover:bg-cyan-500/25 transition-all active:scale-95 flex items-center justify-center gap-2"
                            >
                                Keep Waiting
                            </button>
                            <button
                                onClick={onQuit}
                                className="w-full py-3 rounded-2xl bg-white/5 border border-white/10 text-white text-sm font-black uppercase tracking-[0.2em] hover:bg-white/10 transition-all active:scale-95 flex items-center justify-center gap-2 group"
                            >
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-4 h-4 text-white/40 group-hover:text-white"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                                Quit Match
                            </button>
                            <p className="text-center mt-1 text-[9px] text-white/20 uppercase font-black tracking-widest">
                                No coins are deducted if you leave
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </>
    );
};
