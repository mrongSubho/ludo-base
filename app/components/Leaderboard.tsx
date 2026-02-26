'use client';

import { motion, AnimatePresence } from 'framer-motion';

interface LeaderboardEntry {
    name: string;
    color: string;
    wins: number;
    lastWin: number;
}

interface LeaderboardProps {
    isOpen: boolean;
    onClose: () => void;
}

export default function Leaderboard({ isOpen, onClose }: LeaderboardProps) {
    // In a real app, this would be fetched from an API or shared state.
    // Here we'll read from localStorage.
    const getStats = (): LeaderboardEntry[] => {
        if (typeof window === 'undefined') return [];

        // Dummy Data
        const dummyEntries: LeaderboardEntry[] = [
            { name: 'Mrong', color: 'blue', wins: 42, lastWin: Date.now() - 3600000 },
            { name: 'Fahmida', color: 'rose', wins: 38, lastWin: Date.now() - 86400000 },
            { name: 'Gemini (AI)', color: 'sage', wins: 12, lastWin: Date.now() - 172800000 },
            { name: 'Core (AI)', color: 'slate', wins: 8, lastWin: Date.now() - 259200000 }
        ];

        const localData = localStorage.getItem('ludo-leaderboard');
        if (!localData) return dummyEntries.sort((a, b) => b.wins - a.wins);

        try {
            const parsed = JSON.parse(localData) as Record<string, LeaderboardEntry>;
            const localEntries = Object.values(parsed);

            // Combine dummy and local, ensuring names are unique
            const combinedMap = new Map<string, LeaderboardEntry>();
            dummyEntries.forEach(e => combinedMap.set(e.name, e));
            localEntries.forEach(e => combinedMap.set(e.name, e));

            return Array.from(combinedMap.values()).sort((a, b) => b.wins - a.wins);
        } catch (e) {
            return dummyEntries.sort((a, b) => b.wins - a.wins);
        }
    };

    const stats = getStats();

    return (
        <AnimatePresence>
            {isOpen && (
                <>
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={onClose}
                        className="modal-overlay"
                    />
                    <motion.div
                        initial={{ x: '100%' }}
                        animate={{ x: 0 }}
                        exit={{ x: '100%' }}
                        transition={{ type: 'spring', damping: 25, stiffness: 200 }}
                        className="leaderboard-panel"
                    >
                        <div className="leaderboard-header">
                            <h2>Hall of Fame</h2>
                            <button onClick={onClose} className="close-btn">✕</button>
                        </div>

                        <div className="leaderboard-content">
                            {stats.length === 0 ? (
                                <div className="empty-state">
                                    <span className="empty-emoji">🏆</span>
                                    <p>The throne is empty. Who will be the first champion?</p>
                                </div>
                            ) : (
                                <div className="stats-list">
                                    {stats.map((entry, idx) => (
                                        <div key={entry.name} className="stats-item">
                                            <div className="rank">#{idx + 1}</div>
                                            <div className={`avatar ${entry.color}`}>
                                                {entry.name.charAt(0).toUpperCase()}
                                            </div>
                                            <div className="info">
                                                <span className="name">{entry.name}</span>
                                                <span className="last-win">
                                                    {new Date(entry.lastWin).toLocaleDateString()}
                                                </span>
                                            </div>
                                            <div className="score">
                                                <strong>{entry.wins}</strong>
                                                <span>Wins</span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        <div className="leaderboard-footer">
                            <p>Only local legends are tracked here.</p>
                        </div>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
}
