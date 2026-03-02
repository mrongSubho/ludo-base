import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Wallet, ConnectWallet } from '@coinbase/onchainkit/wallet';

interface WalletConnectCardProps {
    onConnect?: () => void;
}

export default function WalletConnectCard({ onConnect }: WalletConnectCardProps) {
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

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

            <div className="z-10 w-full flex justify-center">
                {mounted ? (
                    <Wallet>
                        <ConnectWallet
                            className="bg-white/10 backdrop-blur-md text-white rounded-2xl shadow-lg border border-white/20 px-6 py-3 hover:bg-white/20 transition-all font-bold"
                            disconnectedLabel="Connect Wallet"
                        />
                    </Wallet>
                ) : (
                    <div className="w-40 h-10 bg-white/10 animate-pulse rounded-xl"></div>
                )}
            </div>
        </motion.div>
    );
}

