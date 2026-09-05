'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { getProgression, getRankProgress } from '@/lib/progression';
import { supabase } from '@/lib/supabase';
import { RANGES, FormChart, rangeCutoff } from './FormChart';
import { getShowcased } from '@/lib/showcase';

// ─── Theme-agnostic contract (holds for current + future themes) ───────────
// Same as marketplace/settings/rankings/friends/messages/arena: this panel
// always renders on the shared dark-glass sandwich shell, so content uses only
// white-ink + white-opacity surfaces + cyan/status accents. No font-family is
// set (inherits the active theme's display font). Spacing inside
// `.ludo-profile-scope` is re-asserted in globals.css (the global unlayered
// reset zeroes Tailwind spacing utilities).

// Vault relic catalogue (mirrors the collectible ids in MarketplacePanel —
// items are showcase-only, never equip). Profile only reads the choice.
const RELICS: Record<string, { name: string; tint: string; desc: string }> = {
    s1: { name: 'Crystal', tint: 'bg-cyan-500/30', desc: 'Prismatic ice relic' },
    s2: { name: 'Magma', tint: 'bg-orange-600', desc: 'Volcanic fire relic' },
    s3: { name: 'Void', tint: 'bg-black', desc: 'Light-eating relic' },
    s4: { name: 'Neon-X', tint: 'bg-cyan-600', desc: 'Electric skin' },
    s5: { name: 'Cyber-V', tint: 'bg-cyan-500', desc: 'Matrix skin' },
    s6: { name: 'Steel-Z', tint: 'bg-gray-500', desc: 'Cold steel skin' },
};

const RelicGem = ({ tint, px = 40 }: { tint: string; px?: number }) => (
    <div className="relative flex items-center justify-center shrink-0" style={{ width: px, height: px }}>
        <div className={`absolute inset-[8%] rotate-45 rounded-[22%] ${tint} border border-white/40`} />
        <div className="absolute inset-[8%] rotate-45 rounded-[22%] bg-gradient-to-br from-white/50 via-transparent to-black/50" />
        <div className="absolute left-[30%] top-[20%] w-[13%] h-[13%] rounded-full bg-white/90 blur-[1px]" />
    </div>
);

const ProfileTile = () => (
    <div className="w-7 h-7 rounded-xl bg-cyan-500/15 border border-cyan-400/40 flex items-center justify-center shadow-[0_0_16px_rgba(34,211,238,0.25)]">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 text-cyan-300">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
            <circle cx="12" cy="7" r="4"></circle>
        </svg>
    </div>
);

// Section label: pill + gradient rule (marketplace vocabulary)
const SectionLabel = ({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) => (
    <div className="mt-1 mb-1 flex items-center gap-2.5">
        <span className="px-2 py-0.5 rounded-md bg-white/[0.07] border border-white/10 text-[10px] font-black tracking-[0.18em] text-white/60 font-mono uppercase">
            {children}
        </span>
        <div className="flex-1 h-px bg-gradient-to-r from-white/15 to-transparent" />
        {right}
    </div>
);

const TIER_GRADIENT: Record<string, string> = {
    'Arena Master': 'from-orange-400 to-red-600',
    'Diamond': 'from-cyan-300 to-blue-500',
    'Platinum': 'from-blue-400 to-indigo-600',
    'Gold': 'from-yellow-400 to-orange-500',
    'Silver': 'from-slate-300 to-gray-500',
    'Bronze': 'from-amber-600 to-orange-800',
};

export default function UserProfilePanel({ onClose, onOpenMarketplace }: { onClose: () => void; onOpenMarketplace?: () => void }) {
    const { profile, address, displayName: finalName } = useCurrentUser();

    const finalAvatar = profile?.avatar_url || null;

    // Showcased vault relic: single SKU per wallet, set from Marketplace loadout.
    const [showcasedId, setShowcasedId] = useState<string | null>(null);
    useEffect(() => {
        setShowcasedId(getShowcased(address?.toLowerCase() ?? null));
        const onStorage = (e: StorageEvent) => {
            if (!e.key || e.key.startsWith('ludo-showcase-')) {
                setShowcasedId(getShowcased(address?.toLowerCase() ?? null));
            }
        };
        window.addEventListener('storage', onStorage);
        return () => window.removeEventListener('storage', onStorage);
    }, [address]);
    const showcased = showcasedId ? RELICS[showcasedId] : undefined;

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
                        className="ludo-profile-scope pointer-events-auto absolute top-[64px] bottom-[80px] left-[8px] right-[8px] border border-white/10 rounded-[32px] flex flex-col shadow-2xl overflow-hidden"
                        style={{ background: 'var(--panel-bg-image, var(--ludo-bg-cosmic))', backgroundColor: 'var(--panel-bg, rgba(13,13,13,0.92))', backdropFilter: 'blur(32px)' }}
                    >
                {/* Authentic Subdued Cosmic Orbs */}
                <div className="absolute top-[-20%] left-[-20%] w-full h-full cosmic-orb cosmic-orb-1 opacity-20 scale-150 pointer-events-none" />
                <div className="absolute bottom-[-20%] right-[-20%] w-full h-full cosmic-orb cosmic-orb-2 opacity-15 scale-150 pointer-events-none" />

                {/* Handle Bar */}
                <div className="w-full flex justify-center pt-2 pb-1 relative z-10">
                    <div className="w-12 h-1.5 bg-white/20 rounded-full" />
                </div>

                {/* Header */}
                <div className="px-5 pb-3 border-b border-white/10 relative z-10">
                    <div className="flex items-center justify-between mb-1 mt-1">
                        <h2 className="text-xl font-bold text-white flex items-center gap-2">
                            <ProfileTile />
                            Profile
                        </h2>
                        <button
                            onClick={onClose}
                            aria-label="Close profile"
                            className="w-8 h-8 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white/70 hover:text-white transition-all ring-1 ring-white/10 shadow-sm shrink-0"
                        >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                        </button>
                    </div>
                    <div className="flex items-center gap-2 px-0.5">
                        <span className="text-[11px] font-black text-white/70 tracking-wide uppercase truncate">
                            {finalName}
                        </span>
                        <span className="w-0.5 h-0.5 rounded-full bg-white/25 shrink-0" />
                        <span className="text-[11px] font-black text-cyan-300 tracking-wide uppercase shrink-0">
                            Lv. {progression.level}
                        </span>
                    </div>
                </div>

                {/* Scrollable Content Area */}
                <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar px-5 pt-3 pb-4 relative z-10 flex flex-col gap-2">

                    {/* Identity row: avatar + name/tier + coins */}
                    <div className="rounded-2xl bg-white/[0.04] border border-white/10 p-3 flex items-center gap-3">
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
                    <section>
                        <SectionLabel>Level</SectionLabel>
                        <div className="rounded-2xl bg-white/[0.04] border border-white/10 p-3 flex flex-col gap-2">
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
                    </section>

                    {/* Rank progress bar */}
                    <section>
                        <SectionLabel>Rank</SectionLabel>
                        <div className="rounded-2xl bg-white/[0.04] border border-white/10 p-3 flex flex-col gap-2">
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
                    </section>

                    {/* Form chart: price-chart style performance sparkline */}
                    <section>
                        <SectionLabel>Form</SectionLabel>
                        <div className="rounded-2xl bg-white/[0.04] border border-white/10 p-3 flex flex-col gap-2">
                            <div>
                                <div className="flex items-center gap-2 mt-0.5">
                                    <span className="porcelain-hero text-2xl font-black text-white tabular-nums leading-none">
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
                    </section>

                    {/* Stat grid */}
                    <section>
                        <SectionLabel>Stats</SectionLabel>
                        <div className="grid grid-cols-4 gap-2">
                            {stats.map((s) => (
                                <div key={s.l} className="rounded-xl bg-white/[0.04] border border-white/10 p-2 flex flex-col items-center justify-center">
                                    <span className={`text-base font-black tabular-nums ${s.c}`}>{s.v}</span>
                                    <span className="text-[8px] font-black uppercase tracking-widest text-white/30 mt-0.5">{s.l}</span>
                                </div>
                            ))}
                        </div>
                    </section>

                    {/* Showcase: single vault relic, set from Marketplace loadout */}
                    <section>
                        <SectionLabel
                            right={
                                showcased ? (
                                    <span className="px-2 py-0.5 rounded-full bg-cyan-500/15 border border-cyan-500/40 text-[9px] font-black text-cyan-300 uppercase tracking-widest">
                                        Showcasing
                                    </span>
                                ) : undefined
                            }
                        >
                            Showcase
                        </SectionLabel>
                        {showcased ? (
                            <div className="rounded-2xl bg-white/[0.04] border border-white/10 p-3 flex items-center gap-3">
                                <RelicGem tint={showcased.tint} />
                                <div className="flex-1 min-w-0">
                                    <div className="text-[13px] font-bold text-white truncate">{showcased.name}</div>
                                    <div className="text-[10px] font-bold text-white/35 truncate">{showcased.desc}</div>
                                </div>
                                {onOpenMarketplace && (
                                    <button
                                        onClick={onOpenMarketplace}
                                        className="shrink-0 px-2 py-1 rounded-full text-[9px] font-black uppercase tracking-widest bg-white/5 text-white/40 border border-white/10 hover:text-white/70 transition-all"
                                    >
                                        Change
                                    </button>
                                )}
                            </div>
                        ) : (
                            <div className="rounded-2xl border border-dashed border-white/10 p-3 flex items-center gap-3">
                                <div className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center shrink-0 text-white/25">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                                        <path d="M6 3h12l4 6-10 13L2 9z" />
                                    </svg>
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="text-[13px] font-bold text-white/60">No relic showcased</div>
                                    <div className="text-[10px] font-bold text-white/35 truncate">Own a collectible, then showcase it from the Market loadout.</div>
                                </div>
                                {onOpenMarketplace && (
                                    <button
                                        onClick={onOpenMarketplace}
                                        className="shrink-0 px-2 py-1 rounded-full text-[9px] font-black uppercase tracking-widest bg-cyan-500/20 text-cyan-200 border border-cyan-500/40 hover:bg-cyan-500/30 transition-all"
                                    >
                                        Market
                                    </button>
                                )}
                            </div>
                        )}
                    </section>

                    {/* Privacy & Social Controls */}
                    <section>
                        <SectionLabel>Privacy</SectionLabel>

                        <div className="rounded-2xl bg-white/[0.04] border border-white/10 overflow-hidden">
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

                    </section>

                    </div>
                </div>
            </div>
        </div>
    </>
    );
}
