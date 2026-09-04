'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { getProgression, getRankProgress } from '@/lib/progression';
import { supabase } from '@/lib/supabase';
import { RANGES, FormChart, rangeCutoff } from './FormChart';

const TIER_GRADIENT: Record<string, string> = {
    'Arena Master': 'from-orange-400 to-red-600',
    'Diamond': 'from-cyan-300 to-blue-500',
    'Platinum': 'from-blue-400 to-indigo-600',
    'Gold': 'from-yellow-400 to-orange-500',
    'Silver': 'from-slate-300 to-gray-500',
    'Bronze': 'from-amber-600 to-orange-800',
};

export default function UserProfilePanel({ onClose }: { onClose: () => void }) {
    const { profile, address, displayName: finalName } = useCurrentUser();

    const finalAvatar = profile?.avatar_url || null;

    const progression = getProgression(profile?.lxp || 0, profile?.rxp || 0);
    const rank = getRankProgress(profile?.rxp || 0);

    const wins = profile?.total_wins || 0;
    const games = profile?.total_games || 0;
    const winRate = games > 0 ? Math.round((wins / games) * 100) : 0;
    const coins = profile?.coins || 0;

    const [range, setRange] = useState<string>('All');
    const [recentMatches, setRecentMatches] = useState<{ winner_address: string | null; created_at: string | null }[]>([]);

    // Recent matches power both the live streak and the form chart (single query)
    useEffect(() => {
        if (!address) return;
        let cancelled = false;
        (async () => {
            try {
                const { data } = await supabase
                    .from('matches')
                    .select('winner_address, created_at')
                    .overlaps('participants', [address.toLowerCase(), address])
                    .order('created_at', { ascending: false })
                    .limit(100);
                if (!cancelled) setRecentMatches(data || []);
            } catch {
                if (!cancelled) setRecentMatches([]);
            }
        })();
        return () => { cancelled = true; };
    }, [address]);

    // Live win streak: consecutive wins, most recent first
    const streak = useMemo(() => {
        const me = (address || '').toLowerCase();
        if (!me) return 0;
        let s = 0;
        for (const m of recentMatches) {
            if ((m.winner_address || '').toLowerCase() === me) s++;
            else break;
        }
        return s;
    }, [recentMatches, address]);

    // Form series for the selected range: cumulative +30/win, -15/loss (mirrors RXP)
    const form = useMemo(() => {
        const me = (address || '').toLowerCase();
        const cutoff = rangeCutoff(range);
        const inRange = recentMatches.filter(m => m.created_at && new Date(m.created_at).getTime() >= cutoff).reverse();
        let score = 0;
        const pts: number[] = [];
        let w = 0;
        for (const m of inRange) {
            if (me && (m.winner_address || '').toLowerCase() === me) { score += 30; w++; }
            else score -= 15;
            pts.push(score);
        }
        return {
            pts,
            wins: w,
            played: inRange.length,
            net: score,
            rate: inRange.length ? Math.round((w / inRange.length) * 100) : 0,
            positive: score >= 0,
        };
    }, [recentMatches, range, address]);

    const [isPublic, setIsPublic] = useState(true);
    const [allowRequests, setAllowRequests] = useState(true);

    const stats = [
        { v: wins.toLocaleString(), l: 'Wins', c: 'text-white' },
        { v: `${winRate}%`, l: 'Win rate', c: 'text-cyan-400' },
        { v: games.toLocaleString(), l: 'Matches', c: 'text-white' },
        { v: `${streak}`, l: 'Streak', c: 'text-orange-500' },
    ];

    return (
        <>
            <div
                className="fixed top-[64px] bottom-[80px] left-0 right-0 z-40 bg-transparent"
            />

            {/* Clipped Container (Fixed Ghost Centering) */}
            <div className="fixed inset-0 z-[110] flex justify-center pointer-events-none">
                <div className="w-full max-w-[500px] relative h-full">
                    <div
                        /* Unified global panel layout: top-64, bottom-80 sandwich */
                        className="pointer-events-auto absolute top-[64px] bottom-[80px] left-[8px] right-[8px] border border-white/10 rounded-[32px] flex flex-col shadow-2xl overflow-hidden"
                        style={{ background: 'var(--ludo-bg-cosmic)', backgroundColor: 'rgba(13,13,13,0.92)', backdropFilter: 'blur(32px)' }}
                    >
                {/* Authentic Subdued Cosmic Orbs */}
                <div className="absolute top-[-20%] left-[-20%] w-full h-full cosmic-orb cosmic-orb-1 opacity-20 scale-150 pointer-events-none" />
                <div className="absolute bottom-[-20%] right-[-20%] w-full h-full cosmic-orb cosmic-orb-2 opacity-15 scale-150 pointer-events-none" />

                {/* Handle Bar */}
                <div className="w-full flex justify-center pt-4 pb-2">
                    <div className="w-12 h-1.5 bg-white/20 rounded-full" />
                </div>

                {/* Header */}
                <div className="px-panel-gutter pb-3 border-b border-white/10">
                    <div className="flex items-center justify-between mt-2">
                        <h2 className="text-2xl font-bold text-white flex items-center gap-2">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6 text-cyan-400">
                                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                                <circle cx="12" cy="7" r="4"></circle>
                            </svg>
                            Profile
                        </h2>
                        <button
                            onClick={onClose}
                            className="w-8 h-8 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white/70 hover:text-white transition-all ring-1 ring-white/10 shadow-sm"
                        >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                        </button>
                    </div>
                </div>

                {/* Scrollable Content Area */}
                <div className="flex-1 min-h-0 overflow-y-auto px-panel-gutter py-3 space-y-3 no-scrollbar">

                    {/* Identity row: avatar + name/tier + coins */}
                    <div className="glass-card !p-3 flex items-center gap-3">
                        <div
                            className="w-14 h-14 rounded-full bg-gradient-to-tr from-cyan-600 to-teal-400 p-0.5 shrink-0 shadow-lg overflow-hidden"
                            title="Your Profile Avatar"
                        >
                            <div className="w-full h-full bg-cyan-600 rounded-full flex items-center justify-center overflow-hidden">
                                {finalAvatar ? (
                                    <img src={finalAvatar} alt={finalName} className="w-full h-full object-cover" />
                                ) : (
                                    <span className="text-2xl">🎮</span>
                                )}
                            </div>
                        </div>
                        <div className="flex-1 min-w-0">
                            <h2 className="text-base font-bold text-white truncate">{finalName}</h2>
                            <div className="flex items-center gap-1.5 mt-1">
                                <span className={`text-[10px] font-extrabold uppercase tracking-wider text-transparent bg-clip-text bg-gradient-to-r ${TIER_GRADIENT[progression.tier] || TIER_GRADIENT['Bronze']}`}>
                                    {progression.tier} {progression.subRank}
                                </span>
                                <div className="w-1 h-1 bg-white/30 rounded-full shrink-0" />
                                <span className="text-[10px] text-white/70 font-bold">Lv. {progression.level}</span>
                            </div>
                        </div>
                        <div className="flex items-center gap-1.5 bg-black/40 px-2.5 py-1.5 rounded-full border border-white/10 shrink-0">
                            <span className="w-2 h-2 rounded-full bg-yellow-400 shadow-[0_0_8px_rgba(250,204,21,0.8)]" />
                            <span className="text-xs font-black text-white tabular-nums">{coins.toLocaleString()}</span>
                        </div>
                    </div>

                    {/* Level progress bar */}
                    <div className="glass-card !p-3 space-y-2">
                        <div className="flex items-center justify-between">
                            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-cyan-400">Level {progression.level}</span>
                            <span className="text-[10px] font-bold text-white/60 tabular-nums">{progression.currentLxp.toLocaleString()} / {progression.lxpToNextLevel.toLocaleString()} XP</span>
                        </div>
                        <div className="h-2.5 bg-black/40 rounded-full overflow-hidden border border-white/5">
                            <motion.div
                                className="h-full bg-gradient-to-r from-cyan-500 to-teal-400 rounded-full shadow-[0_0_10px_rgba(34,211,238,0.5)]"
                                initial={{ width: 0 }}
                                animate={{ width: `${progression.progressPercentage}%` }}
                                transition={{ duration: 0.8, ease: 'easeOut' }}
                            />
                        </div>
                        <div className="text-[9px] font-bold text-white/30 uppercase tracking-widest">
                            {(progression.lxpToNextLevel - progression.currentLxp).toLocaleString()} XP to Lv. {progression.level + 1} • {(profile?.lxp || 0).toLocaleString()} lifetime
                        </div>
                    </div>

                    {/* Rank progress bar */}
                    <div className="glass-card !p-3 space-y-2">
                        <div className="flex items-center justify-between">
                            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-amber-400">Rank — {progression.tier} {progression.subRank}</span>
                            <span className="text-[10px] font-bold text-white/60 tabular-nums">
                                {rank.target === null ? `${rank.current.toLocaleString()} RXP` : `${rank.current.toLocaleString()} / ${rank.target.toLocaleString()} RXP`}
                            </span>
                        </div>
                        <div className="h-2.5 bg-black/40 rounded-full overflow-hidden border border-white/5">
                            <motion.div
                                className="h-full bg-gradient-to-r from-amber-400 to-orange-600 rounded-full shadow-[0_0_10px_rgba(245,158,11,0.5)]"
                                initial={{ width: 0 }}
                                animate={{ width: `${Math.min(100, Math.max(0, rank.pct))}%` }}
                                transition={{ duration: 0.8, ease: 'easeOut', delay: 0.15 }}
                            />
                        </div>
                        <div className="text-[9px] font-bold text-white/30 uppercase tracking-widest">
                            {rank.nextLabel === 'MAX' ? 'Top of the arena' : `Next: ${rank.nextLabel} • resets quarterly`}
                        </div>
                    </div>

                    {/* Form chart: price-chart style performance sparkline */}
                    <div className="glass-card !p-3 space-y-2">
                        <div>
                            <div className="text-[10px] font-black uppercase tracking-[0.2em] text-white/40">Form</div>
                            <div className="flex items-center gap-2 mt-0.5">
                                <span className="text-2xl font-black text-white tabular-nums leading-none">
                                    {form.played ? `${form.rate}%` : '–'}
                                </span>
                                {form.played > 0 && (
                                    <span className={`text-[11px] font-black tabular-nums ${form.positive ? 'text-emerald-400' : 'text-red-400'}`}>
                                        {form.net > 0 ? `+${form.net}` : `${form.net}`}
                                    </span>
                                )}
                            </div>
                            <div className="text-[9px] font-bold text-white/30 uppercase tracking-widest mt-1">
                                {form.played} matches • {range}
                            </div>
                        </div>
                        {form.pts.length > 0 ? (
                            <FormChart points={form.pts} positive={form.positive} />
                        ) : (
                            <div className="h-[96px] flex items-center justify-center border border-dashed border-white/10 rounded-xl">
                                <span className="text-[10px] font-bold text-white/30 uppercase tracking-widest">{recentMatches.length ? 'No matches in this range' : 'Play matches to build form'}</span>
                            </div>
                        )}
                        <div className="flex items-center justify-between pt-1">
                            {RANGES.map((r) => (
                                <button
                                    key={r.id}
                                    onClick={() => setRange(r.id)}
                                    className={`px-2 py-1 rounded-full text-[10px] font-black transition-all ${range === r.id ? 'bg-white/10 text-white' : 'text-white/30 hover:text-white/60'}`}
                                >
                                    {r.id}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Stat grid */}
                    <div className="grid grid-cols-4 gap-2">
                        {stats.map((s) => (
                            <div key={s.l} className="glass-card-sm !p-2 flex flex-col items-center justify-center">
                                <span className={`text-base font-black tabular-nums ${s.c}`}>{s.v}</span>
                                <span className="text-[8px] font-black uppercase tracking-widest text-white/30 mt-0.5">{s.l}</span>
                            </div>
                        ))}
                    </div>

                    {/* Privacy & Social Controls */}
                    <div className="flex flex-col">
                        <h3 className="text-sm font-bold text-white/40 uppercase tracking-wider mb-2 px-2">Privacy</h3>

                        <div className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden">
                            <div className="flex items-center justify-between p-2.5 border-b border-white/5">
                                <div className="flex items-center gap-2.5">
                                    <div className="w-7 h-7 rounded-full bg-white/5 text-cyan-400 flex items-center justify-center shrink-0">
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
                                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                                            <circle cx="12" cy="12" r="3"></circle>
                                        </svg>
                                    </div>
                                    <span className="text-[13px] font-medium text-white">Public Profile</span>
                                </div>
                                <button
                                    className={`w-12 h-6 rounded-full p-1 transition-colors relative shrink-0 ${isPublic ? 'bg-cyan-600' : 'bg-white/10'}`}
                                    onClick={() => setIsPublic(!isPublic)}
                                >
                                    <motion.div
                                        layout
                                        className="w-4 h-4 bg-white rounded-full shadow-sm"
                                        animate={{ x: isPublic ? 24 : 0 }}
                                        transition={{ type: "spring", stiffness: 500, damping: 30 }}
                                    />
                                </button>
                            </div>

                            <div className="flex items-center justify-between p-2.5">
                                <div className="flex items-center gap-2.5">
                                    <div className="w-7 h-7 rounded-full bg-teal-500/20 text-teal-400 flex items-center justify-center shrink-0">
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
                                            <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                                            <circle cx="8.5" cy="7" r="4"></circle>
                                            <line x1="20" y1="8" x2="20" y2="14"></line>
                                            <line x1="23" y1="11" x2="17" y2="11"></line>
                                        </svg>
                                    </div>
                                    <span className="text-[13px] font-medium text-white">Allow Requests</span>
                                </div>
                                <button
                                    className={`w-12 h-6 rounded-full p-1 transition-colors relative shrink-0 ${allowRequests ? 'bg-teal-500' : 'bg-white/10'}`}
                                    onClick={() => setAllowRequests(!allowRequests)}
                                >
                                    <motion.div
                                        layout
                                        className="w-4 h-4 bg-white rounded-full shadow-sm"
                                        animate={{ x: allowRequests ? 24 : 0 }}
                                        transition={{ type: "spring", stiffness: 500, damping: 30 }}
                                    />
                                </button>
                            </div>
                        </div>

                    </div>

                    </div>
                </div>
            </div>
        </div>
    </>
    );
}
