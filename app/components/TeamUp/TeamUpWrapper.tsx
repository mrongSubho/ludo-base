// app/components/TeamUp/TeamUpWrapper.tsx
import React, { ReactNode, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useCompetitiveConnection } from '../../../hooks/useCompetitiveConnection';
import { useCurrentUser } from '@/hooks/useCurrentUser';

const DashedRadarRing = ({ color = "#22d3ee", className = "" }) => (
    <motion.div
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        className={`absolute inset-0 w-full h-full pointer-events-none flex items-center justify-center ${className}`}
    >
        <motion.svg
            viewBox="0 0 100 100"
            className="w-full h-full max-w-[280px]"
            animate={{ rotate: 360 }}
            transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
        >
            <circle cx="50" cy="50" r="48" fill="none" stroke={color} strokeWidth="1" strokeDasharray="4 4" opacity="0.4" />
            <circle cx="50" cy="50" r="38" fill="none" stroke={color} strokeWidth="0.5" strokeDasharray="2 2" opacity="0.2" />
            <circle cx="50" cy="50" r="28" fill="none" stroke={color} strokeWidth="0.5" opacity="0.1" />
        </motion.svg>
        
        {/* Scanning Sweep */}
        <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
            className="absolute inset-0 rounded-full bg-gradient-to-r from-cyan-500/10 to-transparent"
            style={{ clipPath: 'polygon(50% 50%, 100% 0, 100% 50%)', maxWidth: '280px', margin: 'auto' }}
        />
    </motion.div>
);

interface TeamUpWrapperProps {
  children: ReactNode;
  mode: 'quick' | 'friends';
  entryFee?: number;
}

export const TeamUpWrapper = ({ 
  children, 
  mode, 
  entryFee 
}: TeamUpWrapperProps) => {
  const { 
    findCompetitiveMatch, 
    match, 
    loading, 
    error,
    isFallback
  } = useCompetitiveConnection();

  const { address } = useCurrentUser();

  useEffect(() => {
    // Only attempt competitive connection for quick matches with a wager
    if (mode === 'quick' && entryFee && entryFee > 0 && address) {
      findCompetitiveMatch(address, mode, entryFee);
    }
  }, [mode, entryFee, findCompetitiveMatch, address]);

  return (
    <div className="team-up-wrapper w-full h-full relative overflow-hidden">
      <AnimatePresence mode="wait">
        {loading && (
          <motion.div 
            key="loading"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-50 flex flex-col items-center justify-center overflow-hidden"
            style={{ background: 'var(--ludo-bg-cosmic)', backgroundColor: '#1c1c1c' }}
          >
            {/* Authentic Subdued Cosmic Orbs */}
            <div className="absolute top-[-20%] left-[-20%] w-full h-full cosmic-orb cosmic-orb-1 opacity-20 scale-150 pointer-events-none" />
            <div className="absolute bottom-[-20%] right-[-20%] w-full h-full cosmic-orb cosmic-orb-2 opacity-15 scale-150 pointer-events-none" />
            
            <div className="relative w-64 h-64 mb-6 z-10 flex items-center justify-center">
                <DashedRadarRing color="#22d3ee" />
                <motion.div 
                    animate={{ y: [0, -4, 0], scale: [1, 1.05, 1] }}
                    transition={{ duration: 2, repeat: Infinity }}
                    className="relative z-20 text-4xl drop-shadow-[0_0_15px_rgba(34,211,238,0.5)]"
                >
                    🎲
                </motion.div>
            </div>
            
            <h3 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-teal-400 to-cyan-400 uppercase tracking-tighter italic">
              Searching the Arena
            </h3>
            <p className="text-white/40 mt-1 text-[10px] uppercase font-bold tracking-widest">
              Establishing Edge Link...
            </p>
          </motion.div>
        )}

        {error && (
          <motion.div 
            key="error"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="absolute inset-0 z-50 flex flex-col items-center justify-center overflow-hidden p-6"
            style={{ background: 'var(--ludo-bg-cosmic)', backgroundColor: '#1c1c1c' }}
          >
            {/* Background Radar in Error State */}
            <DashedRadarRing color="#ef4444" className="opacity-50" />

            <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mb-4 border border-red-500/20 z-10">
              <span className="text-2xl text-red-500">⚠️</span>
            </div>
            <h3 className="text-xl font-bold text-white mb-2 z-10">Connection Fault</h3>
            <p className="text-slate-400 text-center max-w-xs mb-6 z-10">
              {error}
            </p>
            <button 
              onClick={() => address && findCompetitiveMatch(address, mode, entryFee)}
              className="bg-white hover:bg-white/90 text-black px-8 py-3 rounded-xl font-black italic tracking-tighter uppercase transition-all transform hover:scale-105 active:scale-95 shadow-lg shadow-white/20 z-10"
            >
              Retry Connection
            </button>
          </motion.div>
        )}

        {match && (
          <motion.div 
            key="game"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="w-full h-full relative"
          >
            {children}
            
            {/* Verified Badge Overlay */}
            <motion.div 
              initial={{ y: -20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.5 }}
              className="absolute top-4 right-4 z-40 flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 backdrop-blur-md"
            >
              <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-widest">
                {isFallback ? 'Lobby Secured' : 'Edge Verified UDP'}
              </span>
            </motion.div>
          </motion.div>
        )}

        {!loading && !error && !match && (
          <motion.div key="default" className="w-full h-full">
            {children}
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
};
