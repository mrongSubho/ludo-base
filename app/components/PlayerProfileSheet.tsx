'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { useState } from 'react';

interface Player {
    name: string;
    level: number;
    avatar: string;
    color: 'green' | 'red' | 'yellow' | 'blue';
    isAi?: boolean;
}

interface PlayerProfileSheetProps {
    player: Player | null;
    wins: number;
    onClose: () => void;
}

export default function PlayerProfileSheet({ player, wins, onClose }: PlayerProfileSheetProps) {
    const [friendStatus, setFriendStatus] = useState<'none' | 'sent' | 'friends'>('none');
    const [dmSent, setDmSent] = useState(false);
    const [blocked, setBlocked] = useState(false);

    if (!player) return null;

    const totalGames = Math.max(wins + Math.floor(Math.random() * 15 + 5), wins + 5);
    const winRate = totalGames > 0 ? Math.round((wins / totalGames) * 100) : 0;

    const colorMap: Record<string, string> = {
        green: 'linear-gradient(135deg, #7EC8A0, #5FA880)',
        red: 'linear-gradient(135deg, #D4847A, #B4645A)',
        yellow: 'linear-gradient(135deg, #E8C567, #C8A547)',
        blue: 'linear-gradient(135deg, #7BAFD4, #5B8FB4)',
    };

    const handleFriend = () => {
        if (friendStatus === 'none') setFriendStatus('sent');
        else if (friendStatus === 'sent') setFriendStatus('friends');
    };

    const handleDm = () => {
        setDmSent(true);
        setTimeout(() => setDmSent(false), 2000);
    };

    const handleBlock = () => {
        setBlocked(b => !b);
    };

    return (
        <AnimatePresence>
            <motion.div
                className="tab-panel-overlay"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={onClose}
            >
                <motion.div
                    className="tab-panel profile-sheet"
                    initial={{ y: '100%' }}
                    animate={{ y: 0 }}
                    exit={{ y: '100%' }}
                    transition={{ type: 'spring', damping: 28, stiffness: 220 }}
                    onClick={e => e.stopPropagation()}
                >
                    {/* Drag handle */}
                    <div className="tab-panel-handle" />

                    {/* Hero Banner */}
                    <div className="profile-hero" style={{ background: colorMap[player.color] }}>
                        <button className="tab-panel-close profile-close-btn" onClick={onClose}>✕</button>
                        <div className="profile-avatar-hero">
                            <span>{player.avatar}</span>
                        </div>
                        {player.isAi && <span className="profile-ai-badge">🤖 AI Player</span>}
                    </div>

                    {/* Identity */}
                    <div className="profile-identity">
                        <h2 className="profile-name">{player.name}</h2>
                        <span className="profile-level-badge">Level {player.level}</span>
                    </div>

                    {/* Stats Row */}
                    <div className="profile-stats-row">
                        <div className="profile-stat">
                            <strong>{wins}</strong>
                            <span>Wins</span>
                        </div>
                        <div className="profile-stat-divider" />
                        <div className="profile-stat">
                            <strong>{totalGames}</strong>
                            <span>Games</span>
                        </div>
                        <div className="profile-stat-divider" />
                        <div className="profile-stat">
                            <strong>{winRate}%</strong>
                            <span>Win Rate</span>
                        </div>
                    </div>

                    {/* Action Buttons */}
                    {!player.isAi && (
                        <div className="profile-actions">
                            <button
                                className={`profile-action-btn ${friendStatus !== 'none' ? 'action-active' : ''}`}
                                onClick={handleFriend}
                                disabled={friendStatus === 'friends'}
                            >
                                <span className="action-icon">
                                    {friendStatus === 'none' && '➕'}
                                    {friendStatus === 'sent' && '⌛'}
                                    {friendStatus === 'friends' && '✅'}
                                </span>
                                <span>
                                    {friendStatus === 'none' && 'Add Friend'}
                                    {friendStatus === 'sent' && 'Requested'}
                                    {friendStatus === 'friends' && 'Friends'}
                                </span>
                            </button>

                            <button
                                className={`profile-action-btn ${dmSent ? 'action-active' : ''}`}
                                onClick={handleDm}
                            >
                                <span className="action-icon">💬</span>
                                <span>{dmSent ? 'Sent!' : 'Send DM'}</span>
                            </button>

                            <button
                                className={`profile-action-btn action-danger ${blocked ? 'action-active-danger' : ''}`}
                                onClick={handleBlock}
                            >
                                <span className="action-icon">🚫</span>
                                <span>{blocked ? 'Unblock' : 'Block'}</span>
                            </button>
                        </div>
                    )}

                    {/* AI note */}
                    {player.isAi && (
                        <p className="profile-ai-note">This is an AI-controlled player. Actions are disabled.</p>
                    )}
                </motion.div>
            </motion.div>
        </AnimatePresence>
    );
}
