import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { PlayerColor } from '@/lib/types';
import { Player } from '@/hooks/useGameEngine';

interface StatusNotificationProps {
    message: string | null;
}

export function StatusNotification({ message }: StatusNotificationProps) {
    return (
        <AnimatePresence>
            {message && (
                <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    className="capture-toast"
                >
                    {message}
                </motion.div>
            )}
        </AnimatePresence>
    );
}

interface IdleWarningOverlayProps {
    idleWarning: { player: PlayerColor; timeLeft: number } | null;
    myPlayer: Player | undefined;
    onCancelAfk: (color: PlayerColor) => void;
}

export function IdleWarningOverlay({ idleWarning, myPlayer, onCancelAfk }: IdleWarningOverlayProps) {
    if (!idleWarning || idleWarning.player !== myPlayer?.color) return null;

    return (
        <AnimatePresence>
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                style={{
                    position: 'absolute',
                    inset: 0,
                    zIndex: 50,
                    backgroundColor: 'rgba(0, 0, 0, 0.65)',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: '16px',
                    color: '#fff',
                    backdropFilter: 'blur(20px)',
                    WebkitBackdropFilter: 'blur(20px)'
                }}
            >
                <motion.div 
                    initial={{ scale: 0.8, y: 20 }}
                    animate={{ scale: 1, y: 0 }}
                    style={{ 
                        textAlign: 'center', 
                        padding: '32px', 
                        background: 'rgba(255, 255, 255, 0.05)', 
                        backdropFilter: 'blur(40px)',
                        WebkitBackdropFilter: 'blur(40px)',
                        borderRadius: '24px', 
                        border: '1px solid rgba(239, 68, 68, 0.3)',
                        boxShadow: '0 20px 50px rgba(0,0,0,0.5)'
                    }}
                >
                    <h2 style={{ fontSize: '24px', margin: '0 0 12px 0', color: '#ef4444', fontWeight: 'bold', textShadow: '0 0 20px rgba(239, 68, 68, 0.3)' }}>Are you still there?</h2>
                    <p style={{ fontSize: '18px', margin: '0 0 24px 0', opacity: 0.7, color: 'rgba(255,255,255,0.8)' }}>
                        Auto-kicking in <span style={{ fontWeight: 'bold', fontSize: '24px', color: '#fff' }}>{idleWarning.timeLeft}s</span>
                    </p>
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            if (myPlayer?.color) onCancelAfk(myPlayer.color);
                        }}
                        className="px-8 py-3 bg-white/10 hover:bg-white/20 border border-white/20 rounded-xl text-white font-bold transition-all duration-300"
                    >
                        I'm Back!
                    </button>
                </motion.div>
            </motion.div>
        </AnimatePresence>
    );
}

interface CelebrationOverlayProps {
    winner: string | null;
    onReset: () => void;
}

export function CelebrationOverlay({ winner, onReset }: CelebrationOverlayProps) {
    return (
        <AnimatePresence>
            {winner && (
                <div className="winner-overlay">
                    <motion.div
                        initial={{ scale: 0.8, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        className="winner-card"
                    >
                        <span className="celebration-emoji">🏆</span>
                        <h2 style={{ textTransform: 'capitalize' }}>{winner} Wins!</h2>
                        <p>Masterful play!</p>
                        <button className="play-again-btn" onClick={onReset}>Rematch</button>
                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    );
}

interface NameOverlayProps {
    uiSlots: Record<string, PlayerColor | null>;
    players: Player[];
    getDisplayName: (player: Player) => string;
}

export function NameOverlay({ uiSlots, players, getDisplayName }: NameOverlayProps) {
    const renderLabel = (corner: 'TL' | 'TR' | 'BL' | 'BR', className: string, style: React.CSSProperties) => {
        const color = uiSlots[corner];
        const p = players.find(pl => pl.color === color);
        if (!p) return null;
        return (
            <div className={`home-player-label ${className} ${color}`} style={style}>
                {getDisplayName(p)}
            </div>
        );
    };

    return (
        <div className="board-name-overlay" style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 15 }}>
            {renderLabel('TL', 'label-top-inside', { position: 'absolute', top: 0, left: '20%', width: '34%', transform: 'translateX(-50%)' })}
            {renderLabel('TR', 'label-top-inside', { position: 'absolute', top: 0, left: '80%', width: '34%', transform: 'translateX(-50%)' })}
            {renderLabel('BL', 'label-bottom-inside', { position: 'absolute', bottom: 0, left: '20%', width: '34%', transform: 'translateX(-50%)' })}
            {renderLabel('BR', 'label-bottom-inside', { position: 'absolute', bottom: 0, left: '80%', width: '34%', transform: 'translateX(-50%)' })}
        </div>
    );
}
