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
                <motion.div
                    className="tab-panel-overlay"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    onClick={onClose}
                >
                    <motion.div
                        className="tab-panel"
                        initial={{ y: '100%' }}
                        animate={{ y: 0 }}
                        exit={{ y: '100%' }}
                        transition={{ type: 'spring', damping: 28, stiffness: 220 }}
                        onClick={e => e.stopPropagation()}
                    >
                        {/* Drag handle */}
                        <div className="tab-panel-handle" />

                        {/* Header */}
                        <div className="tab-panel-header">
                            <span className="tab-panel-emoji">🏆</span>
                            <h2 className="tab-panel-title">Hall of Fame</h2>
                            <button className="tab-panel-close" onClick={onClose}>✕</button>
                        </div>

                        {/* Content */}
                        <div className="tab-panel-body" style={{ alignItems: 'flex-start', justifyContent: 'flex-start' }}>
                            {stats.length === 0 ? (
                                <div className="tab-coming-soon-card">
                                    <span className="coming-soon-icon">🏆</span>
                                    <p className="coming-soon-title">The throne is empty. Who will be the first champion?</p>
                                </div>
                            ) : (
                                <div className="stats-list" style={{ width: '100%' }}>
                                    {stats.map((entry, idx) => (
                                        <div key={entry.name} className="stats-item">
                                            <div className="rank">#{idx + 1}</div>
                                            <div className={`avatar ${entry.color}`}>
                                                {entry.name.charAt(0).toUpperCase()}
                                            </div>
                                            <div className="info">
                                                <span className="name">{entry.name.slice(0, 12)}</span>
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

                        {/* Footer note */}
                        <p style={{ textAlign: 'center', fontSize: 11, color: 'var(--color-ludo-faint)', padding: '0 20px 20px' }}>
                            Only local legends are tracked here.
                        </p>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
