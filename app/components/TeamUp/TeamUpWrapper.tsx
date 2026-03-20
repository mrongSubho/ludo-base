// app/components/TeamUp/TeamUpWrapper.tsx
import React, { ReactNode, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useCompetitiveConnection } from '../../../hooks/useCompetitiveConnection';

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

  useEffect(() => {
    // Only attempt competitive connection for quick matches with a wager
    if (mode === 'quick' && entryFee && entryFee > 0) {
      findCompetitiveMatch(mode, entryFee);
    }
  }, [mode, entryFee, findCompetitiveMatch]);

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
            
            <div className="relative w-24 h-24 mb-6 z-10">
              <motion.div 
                animate={{ rotate: 360 }}
                transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                className="absolute inset-0 border-4 border-t-cyan-500 border-r-transparent border-b-cyan-500 border-l-transparent rounded-full"
              />
              <motion.div 
                animate={{ rotate: -360 }}
                transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
                className="absolute inset-2 border-4 border-t-cyan-500 border-r-transparent border-b-cyan-500 border-l-transparent rounded-full"
              />
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-2xl">🎲</span>
              </div>
            </div>
            
            <h3 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-teal-400 to-cyan-400">
              Finding Opponents
            </h3>
            <p className="text-slate-400 mt-2 text-sm">
              Securing connection via UDP Edge Node...
            </p>
            
            <div className="mt-8 flex gap-2">
              {[0, 1, 2].map(i => (
                <motion.div
                  key={i}
                  animate={{ scale: [1, 1.5, 1], opacity: [0.3, 1, 0.3] }}
                  transition={{ duration: 1, repeat: Infinity, delay: i * 0.2 }}
                  className="w-2 h-2 rounded-full bg-cyan-500"
                />
              ))}
            </div>
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
            {/* Authentic Subdued Cosmic Orbs */}
            <div className="absolute top-[-20%] left-[-20%] w-full h-full cosmic-orb cosmic-orb-1 opacity-20 scale-150 pointer-events-none" />
            <div className="absolute bottom-[-20%] right-[-20%] w-full h-full cosmic-orb cosmic-orb-2 opacity-15 scale-150 pointer-events-none" />

            <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mb-4 border border-red-500/20 z-10">
              <span className="text-2xl text-red-500">⚠️</span>
            </div>
            <h3 className="text-xl font-bold text-white mb-2">Connection Match Failed</h3>
            <p className="text-slate-400 text-center max-w-xs mb-6">
              {error}
            </p>
            <button 
              onClick={() => findCompetitiveMatch(mode, entryFee)}
              className="bg-white hover:bg-white/90 text-black px-8 py-3 rounded-xl font-black italic tracking-tighter uppercase transition-all transform hover:scale-105 active:scale-95 shadow-lg shadow-white/20"
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
