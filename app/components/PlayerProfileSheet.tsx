'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { useState } from 'react';

interface Player {
    name: string;
    level: number;
    avatar: string;
    color: 'green' | 'red' | 'yellow' | 'blue';
    position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
    isAi?: boolean;
}

interface PlayerProfileSheetProps {
    player: Player | null;
    wins: number;
    onClose: () => void;
}

const COLOR_MAP: Record<string, string> = {
    green: 'linear-gradient(135deg, #7EC8A0, #5FA880)',
    red: 'linear-gradient(135deg, #D4847A, #B4645A)',
    yellow: 'linear-gradient(135deg, #E8C567, #C8A547)',
    blue: 'linear-gradient(135deg, #7BAFD4, #5B8FB4)',
};

// A stable "random" total based on player name (no re-render flicker)
function stableTotal(name: string, wins: number) {
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffff;
    return wins + (h % 12) + 6;
}

export default function PlayerProfileSheet({ player, wins, onClose }: PlayerProfileSheetProps) {
    const [friendStatus, setFriendStatus] = useState<'none' | 'sent' | 'friends'>('none');
    const [dmSent, setDmSent] = useState(false);
    const [blocked, setBlocked] = useState(false);

    if (!player) return null;

    const totalGames = stableTotal(player.name, wins);
    const winRate = Math.round((wins / totalGames) * 100);

    // Slide direction based on player side
    const isLeft = player.position.includes('left');
    const isTop = player.position.includes('top');
    const slideX = isLeft ? '-100%' : '100%';
    const verticalAnchor = isTop ? { top: '60px' } : { bottom: '60px' };
    const horizAnchor = isLeft ? { left: '8px' } : { right: '8px' };

    const handleFriend = () => {
        if (friendStatus === 'none') setFriendStatus('sent');
        else if (friendStatus === 'sent') setFriendStatus('friends');
    };

    const handleDm = () => {
        setDmSent(true);
        setTimeout(() => setDmSent(false), 2000);
    };

    return (
        <AnimatePresence>
            {/* Dim backdrop — very faint so board stays visible */}
            <motion.div
                key="profile-backdrop"
                className="profile-popup-backdrop"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={onClose}
            />

            {/* Compact floating popup */}
            <motion.div
                key="profile-popup"
                className="profile-popup"
                style={{ ...verticalAnchor, ...horizAnchor }}
                initial={{ opacity: 0, x: slideX }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: slideX }}
                transition={{ type: 'spring', damping: 26, stiffness: 240 }}
            >
                {/* Coloured top strip + avatar */}
                <div className="pp-header" style={{ background: COLOR_MAP[player.color] }}>
                    <div className="pp-avatar">{player.avatar}</div>
                    <button className="pp-close" onClick={onClose}>✕</button>
                </div>

                {/* Name + level */}
                <div className="pp-identity">
                    <span className="pp-name">{player.name}</span>
                    <span className="pp-lv">Lv.{player.level}</span>
                    {player.isAi && <span className="pp-ai-tag">AI</span>}
                </div>

                {/* Stats */}
                <div className="pp-stats">
                    <div className="pp-stat">
                        <strong>{wins}</strong>
                        <span>Wins</span>
                    </div>
                    <div className="pp-stat-div" />
                    <div className="pp-stat">
                        <strong>{totalGames}</strong>
                        <span>Games</span>
                    </div>
                    <div className="pp-stat-div" />
                    <div className="pp-stat">
                        <strong>{winRate}%</strong>
                        <span>W-Rate</span>
                    </div>
                </div>

                {/* Actions */}
                {!player.isAi ? (
                    <div className="pp-actions">
                        <button
                            className={`pp-btn ${friendStatus !== 'none' ? 'pp-btn-active' : ''}`}
                            onClick={handleFriend}
                            disabled={friendStatus === 'friends'}
                            title={friendStatus === 'none' ? 'Add Friend' : friendStatus === 'sent' ? 'Request sent' : 'Friends'}
                        >
                            {friendStatus === 'none' && '➕'}
                            {friendStatus === 'sent' && '⏳'}
                            {friendStatus === 'friends' && '✅'}
                            <span>{friendStatus === 'none' ? 'Add' : friendStatus === 'sent' ? 'Pending' : 'Friends'}</span>
                        </button>

                        <button
                            className={`pp-btn ${dmSent ? 'pp-btn-active' : ''}`}
                            onClick={handleDm}
                        >
                            💬
                            <span>{dmSent ? 'Sent!' : 'DM'}</span>
                        </button>

                        <button
                            className={`pp-btn pp-btn-danger ${blocked ? 'pp-btn-active-danger' : ''}`}
                            onClick={() => setBlocked(b => !b)}
                        >
                            🚫
                            <span>{blocked ? 'Unblock' : 'Block'}</span>
                        </button>
                    </div>
                ) : (
                    <p className="pp-ai-note">AI-controlled — actions disabled.</p>
                )}
            </motion.div>
        </AnimatePresence>
    );
}
