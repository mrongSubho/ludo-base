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
        {/* We always render children now, and let QuickMatchPanel handle its own loading/error UI */}
        <motion.div 
          key="game-content"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="w-full h-full relative"
        >
          {children}
          
          {/* Verified Badge Overlay - Only show when matched */}
          {match && (
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
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
};
