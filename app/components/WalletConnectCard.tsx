import React from 'react';
import { motion } from 'framer-motion';

interface WalletConnectCardProps {
    onConnect?: () => void;
}

export default function WalletConnectCard({ onConnect }: WalletConnectCardProps) {
    return (
        <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
            className="flex flex-col items-center justify-center p-8 bg-white/10 backdrop-blur-md rounded-[32px] border border-white/20 shadow-2xl max-w-sm w-[90%] mx-auto z-50 relative overflow-hidden"
        >
            {/* Background Decorators */}
            <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/20 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
            <div className="absolute bottom-0 left-0 w-32 h-32 bg-teal-500/20 rounded-full blur-3xl translate-y-1/2 -translate-x-1/2" />

            <div className="w-20 h-20 mb-6 relative z-10">
                <div className="absolute inset-0 bg-gradient-to-tr from-indigo-500 to-teal-400 rounded-3xl opacity-30 blur-lg animate-pulse" />
                <div className="absolute inset-0 bg-gradient-to-tr from-indigo-500 to-teal-400 rounded-2xl shadow-[0_0_20px_rgba(99,102,241,0.3)] flex items-center justify-center border border-white/30">
                    <span className="text-4xl drop-shadow-md">🎲</span>
                </div>
            </div>

            <h2 className="text-3xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-white via-indigo-100 to-teal-100 tracking-tight mb-2 text-center drop-shadow-sm z-10 relative">
                Ludo Base
            </h2>
            <p className="text-white/60 font-medium text-sm mb-8 text-center px-4 z-10 relative">
                Connect your Web3 wallet to enter the arena and play with friends.
            </p>

            <button
                onClick={onConnect}
                className="w-full relative group overflow-hidden rounded-2xl p-[1px] z-10 shadow-lg transition-transform active:scale-95"
            >
                {/* Animated Border */}
                <span className="absolute inset-0 bg-gradient-to-r from-indigo-500 via-teal-400 to-indigo-500 rounded-2xl opacity-70 group-hover:opacity-100 transition-opacity blur-[2px]" />
                <span className="absolute inset-0 bg-gradient-to-r from-indigo-500 via-teal-400 to-indigo-500 animate-[spin_4s_linear_infinite] opacity-50 group-hover:opacity-100" />

                {/* Button Content */}
                <div className="relative flex items-center justify-center gap-3 w-full bg-[#1a1c29]/90 backdrop-blur-xl px-6 py-4 rounded-2xl transition-all group-hover:bg-[#1a1c29]/70">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5 text-teal-400">
                        <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
                        <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
                        <path d="M18 12a1 1 0 1 0 2 0 1 1 0 0 0-2 0" />
                    </svg>
                    <span className="font-bold text-white text-lg tracking-wide">Connect Wallet</span>
                </div>
            </button>
        </motion.div>
    );
}
