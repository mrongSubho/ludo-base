"use client";

import React from 'react';
import { motion } from 'framer-motion';

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
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="fixed top-[64px] bottom-[80px] left-0 right-0 z-40 bg-transparent"
                onClick={onClose}
            />

            <motion.div
                initial={{ y: '100%' }}
                animate={{ y: 0 }}
                exit={{ y: '100%' }}
                transition={{ type: 'spring', damping: 25, stiffness: 200 }}
                /* Unified global panel layout: Cosmic Theme */
                className="fixed top-[15%] bottom-[15%] left-1/2 -translate-x-1/2 w-[calc(100%-32px)] max-w-[420px] border border-white/10 rounded-[40px] z-[110] flex flex-col shadow-2xl overflow-hidden p-8"
                style={{ background: 'var(--ludo-bg-cosmic)', backgroundColor: '#252733' }}
            >
                {/* Authentic Subdued Cosmic Orbs */}
                <div className="absolute top-[-20%] left-[-20%] w-full h-full cosmic-orb cosmic-orb-1 opacity-20 scale-150 pointer-events-none" />
                <div className="absolute bottom-[-20%] right-[-20%] w-full h-full cosmic-orb cosmic-orb-2 opacity-15 scale-150 pointer-events-none" />

                {/* Header */}
                <div className="flex items-center justify-between mb-8">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-2xl bg-white/10 flex items-center justify-center border border-white/10 shadow-inner">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5 text-white/70">
                                <path d="M12 2s-8 11.5-8 16c0 4.4 3.6 8 8 8s8-3.6 8-8c0-4.5-8-16-8-16z"></path>
                            </svg>
                        </div>
                        <h2 className="text-2xl font-black text-white italic tracking-tighter uppercase">Offline Play</h2>
                    </div>
                    <button
                        onClick={onClose}
                        className="w-10 h-10 flex items-center justify-center rounded-2xl bg-white/5 hover:bg-white/10 text-white/40 hover:text-white transition-all border border-white/5"
                    >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 space-y-8">
                    <div className="p-6 rounded-3xl bg-white/5 border border-white/10 space-y-4">
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

                    <div className="space-y-4 text-center px-4">
                        <p className="text-white/60 text-sm font-bold leading-relaxed">
                            Practice your strategy or play casually against AI opponents. Offline matches do not require a network connection or entry fee.
                        </p>
                    </div>
                </div>

                {/* Footer Action */}
                <div className="pt-8">
                    <motion.button
                        whileHover={{ scale: 1.02, y: -2 }}
                        whileTap={{ scale: 0.98 }}
                        onClick={onStartOfflineGame}
                        className="w-full py-5 bg-white text-black font-black italic tracking-tighter rounded-full text-xl shadow-[0_0_30px_rgba(255,255,255,0.3)] hover:shadow-[0_0_50px_rgba(255,255,255,0.5)] transition-all"
                    >
                        START OFFLINE MATCH
                    </motion.button>
                </div>
            </motion.div>
        </>
    );
};
