'use client';

import { motion, AnimatePresence } from 'framer-motion';

interface LeaderboardEntry {
    name: string;
    avatar: string;
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

        // Dummy Data mapped with new Avatar indexing
        const dummyEntries: LeaderboardEntry[] = [
            { name: 'Mrong', avatar: '1', wins: 42, lastWin: Date.now() - 3600000 },
            { name: 'Fahmida', avatar: '2', wins: 38, lastWin: Date.now() - 86400000 },
            { name: 'Gemini (AI)', avatar: '3', wins: 12, lastWin: Date.now() - 172800000 },
            { name: 'Core (AI)', avatar: '4', wins: 8, lastWin: Date.now() - 259200000 }
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

    // Map ranks to nice podium badges
    const getRankBadge = (rank: number) => {
        if (rank === 1) return <div className="w-8 h-8 rounded-full bg-yellow-400/20 text-yellow-400 font-extrabold flex items-center justify-center border border-yellow-400/30 shadow-[0_0_10px_rgba(250,204,21,0.2)]">1</div>;
        if (rank === 2) return <div className="w-8 h-8 rounded-full bg-slate-300/20 text-slate-300 font-bold flex items-center justify-center border border-slate-300/30">2</div>;
        if (rank === 3) return <div className="w-8 h-8 rounded-full bg-orange-700/20 text-orange-400 font-bold flex items-center justify-center border border-orange-700/30">3</div>;
        return <div className="w-8 h-8 text-white/40 font-bold flex items-center justify-center">{rank}</div>;
    };

    return (
        <AnimatePresence>
            {isOpen && (
                <>
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
                        onClick={onClose}
                    />

                    <motion.div
                        initial={{ y: '100%' }}
                        animate={{ y: 0 }}
                        exit={{ y: '100%' }}
                        transition={{ type: 'spring', damping: 25, stiffness: 200 }}
                        // Desktop centered constraint
                        className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[500px] h-[85vh] bg-[#1a1c29]/20 backdrop-blur-xl border-t border-white/10 rounded-t-[32px] z-50 flex flex-col shadow-2xl"
                    >
                        {/* Drag Handle */}
                        <div className="w-full flex justify-center pt-4 pb-2" onClick={onClose}>
                            <div className="w-12 h-1.5 bg-white/20 rounded-full" />
                        </div>

                        {/* Header */}
                        <div className="px-6 pb-4 border-b border-white/10">
                            <div className="flex items-center justify-between mt-2">
                                <h2 className="text-2xl font-bold text-white flex items-center gap-3">
                                    <span className="text-2xl">🏆</span>
                                    Leaderboard
                                </h2>
                                <button onClick={onClose} className="p-2 rounded-full bg-white/5 hover:bg-white/10 text-white/70 transition-colors">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                                </button>
                            </div>
                        </div>

                        {/* Leaderboard Content */}
                        <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
                            {stats.length === 0 ? (
                                <div className="flex flex-col items-center justify-center h-full text-center p-8 opacity-60">
                                    <span className="text-6xl mb-4">👑</span>
                                    <h3 className="text-xl font-bold text-white mb-2">The throne is empty</h3>
                                    <p className="text-sm text-white/60">Who will be the first champion?</p>
                                </div>
                            ) : (
                                <div className="space-y-3 pb-20">
                                    {stats.map((entry, idx) => (
                                        <div
                                            key={entry.name}
                                            className="flex items-center gap-3 bg-white/5 border border-white/10 p-3 rounded-2xl hover:bg-white/10 transition-colors"
                                        >
                                            {/* Rank Badge */}
                                            <div className="flex-shrink-0 mr-1">
                                                {getRankBadge(idx + 1)}
                                            </div>

                                            {/* Avatar */}
                                            <div className="w-12 h-12 rounded-full overflow-hidden bg-[#2a2d3e] flex-shrink-0 border border-white/10">
                                                <img
                                                    src={`/avatars/${entry.avatar || (idx % 8 + 1)}.png`}
                                                    alt={entry.name}
                                                    className="w-full h-full object-cover"
                                                    onError={(e) => { e.currentTarget.src = '/avatars/1.png' }}
                                                />
                                            </div>

                                            {/* Info */}
                                            <div className="flex flex-col flex-1 min-w-0">
                                                <span className="text-white font-bold text-[15px] truncate">{entry.name}</span>
                                                <span className="text-[11px] font-medium text-white/40 uppercase tracking-widest mt-0.5">
                                                    {new Date(entry.lastWin).toLocaleDateString()}
                                                </span>
                                            </div>

                                            {/* Score Metric */}
                                            <div className="flex flex-col items-end justify-center bg-black/40 rounded-xl px-4 py-2 border border-white/5">
                                                <span className="text-lg font-black text-indigo-400 leading-none">{entry.wins}</span>
                                                <span className="text-[9px] font-bold text-white/30 uppercase tracking-widest mt-1">Wins</span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
}
