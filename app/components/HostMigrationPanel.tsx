"use client";

import React from 'react';
import { motion } from 'framer-motion';

interface HostMigrationPanelProps {
    onQuit: () => void;
}

export const HostMigrationPanel = ({ onQuit }: HostMigrationPanelProps) => {
    return (
        <>
            {/* Backdrop with standard Top/Bottom Gaps */}
            <div className="fixed inset-0 z-[1000] flex justify-center pointer-events-none">
                <div className="w-full max-w-[500px] relative h-full">
                    <div
                        className="pointer-events-auto absolute top-[64px] bottom-[80px] left-[8px] right-[8px] border border-white/10 rounded-[32px] flex flex-col shadow-2xl overflow-hidden"
                        style={{ 
                            background: 'var(--ludo-bg-cosmic)', 
                            backgroundColor: 'rgba(13,13,13,0.95)', 
                            backdropFilter: 'blur(32px)' 
                        }}
                    >
                        {/* Cosmic Orbs */}
                        <div className="absolute top-[-20%] left-[-20%] w-full h-full cosmic-orb cosmic-orb-1 opacity-20 scale-150 pointer-events-none" />
                        <div className="absolute bottom-[-20%] right-[-20%] w-full h-full cosmic-orb cosmic-orb-2 opacity-15 scale-150 pointer-events-none" />

                        {/* Header */}
                        <div className="px-6 py-6 border-b border-white/10 relative z-10">
                            <h2 className="text-2xl font-bold text-white flex items-center gap-3 italic">
                                <span className="p-2 rounded-xl bg-amber-500/20 text-amber-400">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-5 h-5">
                                        <path d="M13 10V3L4 14h7v7l9-11h-7z" />
                                    </svg>
                                </span>
                                Host Migrating
                            </h2>
                        </div>

                        {/* Main Content */}
                        <div className="flex-1 flex flex-col items-center justify-center p-8 relative z-10">
                            {/* Radar Loader (Consistent with QuickMatchPanel) */}
                            <div className="relative w-48 h-48 flex items-center justify-center mb-8">
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
                                    <span className="text-[10px] font-black text-cyan-400 uppercase tracking-widest">Wager is Sage</span>
                                </div>
                            </div>
                        </div>

                        {/* Footer / Actions */}
                        <div className="px-6 py-8 border-t border-white/5 bg-black/20 backdrop-blur-sm relative z-10">
                            <button
                                onClick={onQuit}
                                className="w-full py-4 rounded-2xl bg-white/5 border border-white/10 text-white font-bold hover:bg-white/10 transition-all flex items-center justify-center gap-2 group"
                            >
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-4 h-4 text-white/40 group-hover:text-white"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                                Quit Match
                            </button>
                            <p className="text-center mt-4 text-[9px] text-white/20 uppercase font-black tracking-widest">
                                Your position will be saved for 60s
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </>
    );
};
