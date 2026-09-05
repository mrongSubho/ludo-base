import React, { useState, useEffect } from 'react';
import { Wallet, ConnectWallet } from '@coinbase/onchainkit/wallet';
import LudoWalletModal from './LudoWalletModal';

// ─── Theme-agnostic contract (holds for current + future themes) ───────────
// Same vocabulary as the synced panels: white-ink + white-opacity surfaces +
// cyan accents on the shared dark-glass surface. No font-family is set
// (inherits the active theme's display font). Spacing inside
// `.ludo-wallet-scope` is re-asserted in globals.css (the global unlayered
// reset zeroes Tailwind utilities).

// Dice mark: white die face (replaces the emoji, keeps the entrance identity).
const DiceMark = () => (
    <svg viewBox="0 0 100 100" className="w-12 h-12 drop-shadow-[0_0_10px_rgba(255,255,255,0.5)]">
        <rect x="6" y="6" width="88" height="88" rx="20" fill="#fff" />
        {[[30, 30], [70, 30], [50, 50], [30, 70], [70, 70]].map(([cx, cy], i) => (
            <circle key={i} cx={cx} cy={cy} r="9" fill="#0b0b12" />
        ))}
    </svg>
);

interface WalletConnectCardProps {
    onConnect?: () => void;
    onGuest?: () => void;
}

export default function WalletConnectCard({ onConnect, onGuest }: WalletConnectCardProps) {
    const [mounted, setMounted] = useState(false);
    const [isModalOpen, setIsModalOpen] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    return (
        <div
            className="ludo-wallet-scope w-[calc(100%-32px)] max-w-[420px] rounded-[32px] border border-white/10 px-8 py-10 flex flex-col items-center gap-8 relative overflow-hidden group shadow-2xl"
            style={{ background: 'var(--panel-bg-image, var(--ludo-bg-cosmic))', backgroundColor: 'var(--panel-bg, rgba(13,13,13,0.92))', backdropFilter: 'blur(32px)' }}
        >
            {/* Animated Flare Decorators to match Lobby */}
            <div className="absolute -top-24 -left-24 w-48 h-48 bg-cyan-500/20 blur-[60px] rounded-full animate-pulse" />
            <div className="absolute -bottom-24 -right-24 w-48 h-48 bg-white/5 blur-[60px] rounded-full animate-pulse transition-all duration-1000 group-hover:bg-cyan-600/30" />

            {/* Dice Header Area */}
            <div className="relative flex flex-col items-center">
                <div className="absolute inset-x-0 inset-y-0 bg-white/20 blur-3xl rounded-full scale-150 animate-pulse" />
                <div className="w-24 h-24 rounded-[28px] bg-gradient-to-br from-black/50 to-black/35 flex items-center justify-center border border-white/30 shadow-[0_0_30px_rgba(255,255,255,0.2)] relative z-10 overflow-hidden group-hover:scale-105 transition-transform duration-500">
                    <DiceMark />
                </div>

                {/* Mode Label Style Title */}
                <div className="mt-8 inline-block px-6 py-2 bg-[rgba(0,0,0,0.35)] border border-white/10 rounded-full backdrop-blur-md relative z-10 shadow-lg">
                    <h3 className="text-white/90 text-[11px] font-black uppercase tracking-[0.3em] text-center drop-shadow-md">
                        Arena Entrance
                    </h3>
                </div>
            </div>

            {/* Content Section */}
            <div className="text-center flex flex-col gap-3 relative z-10">
                <h2 className="text-4xl font-black text-white tracking-tight drop-shadow-[0_0_15px_rgba(255,255,255,0.2)] uppercase">
                    Ludo <span className="text-cyan-400 drop-shadow-[0_0_10px_rgba(0,255,255,0.4)]">Base</span>
                </h2>
                <p className="text-white/60 text-sm font-medium leading-relaxed max-w-[280px] mx-auto">
                    Connect your Web3 identity to access global matchmaking and claim your victory rewards.
                </p>
            </div>

            {/* Wallet Integration Section */}
            <div className="w-full relative z-20 flex justify-center">
                {mounted ? (
                    <div className="group/btn relative w-full flex flex-col items-stretch">
                        {/* Custom Glow behind button */}
                        <div className="absolute inset-0 bg-gradient-to-r from-cyan-500 to-cyan-600 blur-xl opacity-20 group-hover/btn:opacity-40 transition-opacity pointer-events-none" />

                        <button
                            onClick={() => setIsModalOpen(true)}
                            className="w-full bg-white text-black text-lg font-black uppercase tracking-[0.2em] rounded-2xl py-5 transition-all shadow-[0_0_30px_rgba(255,255,255,0.2)] hover:shadow-[0_0_50px_rgba(255,255,255,0.4)] border-0 flex items-center justify-center h-auto cursor-pointer active:scale-95 whitespace-nowrap"
                        >
                            Sign in to start
                        </button>

                        {onGuest && (
                            <div className="mt-3 flex flex-col items-center gap-1.5">
                                <button
                                    onClick={onGuest}
                                    className="px-5 py-2 rounded-full bg-white/5 border border-white/10 text-white/50 text-[11px] font-black uppercase tracking-[0.2em] hover:bg-white/10 hover:text-white transition-all active:scale-95 whitespace-nowrap"
                                >
                                    Continue as Guest
                                </button>
                                <span className="text-[9px] font-bold text-white/25 tracking-wide">
                                    No wallet needed · practice vs bots
                                </span>
                            </div>
                        )}

                        <LudoWalletModal 
                            isOpen={isModalOpen}
                            onClose={() => setIsModalOpen(false)}
                        />
                    </div>
                ) : (
                    <div className="w-full h-16 bg-white/5 rounded-2xl animate-pulse border border-white/10" />
                )}
            </div>

            {/* Subtle Footer */}
            <div className="flex items-center gap-2 opacity-30 group-hover:opacity-50 transition-opacity">
                <div className="h-[1px] w-8 bg-white" />
                <span className="text-[10px] font-black tracking-widest uppercase">Safe & Secure</span>
                <div className="h-[1px] w-8 bg-white" />
            </div>
        </div>
    );
}

