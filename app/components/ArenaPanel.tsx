'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useGuestWall } from '@/hooks/GuestWallContext';
import { supabase } from '@/lib/supabase';
import { LuTrophy, LuTimer, LuUsers, LuX, LuShieldCheck } from 'react-icons/lu';

// ─── Theme-agnostic contract (holds for current + future themes) ───────────
// Same as marketplace/settings/rankings/friends/messages: this panel always
// renders on the shared dark-glass sandwich shell, so content uses only
// white-ink + white-opacity surfaces + cyan/status accents. No font-family is
// set (inherits the active theme's display font). Spacing inside
// `.ludo-arena-scope` is re-asserted in globals.css (the global unlayered
// reset zeroes Tailwind spacing utilities).

type ArenaTab = 'tournaments' | 'missions';
type MissionTab = 'daily' | 'weekly';

// Icon tile: cyan glow square shared with the other synced panels.
const TrophyTile = () => (
    <div className="w-7 h-7 rounded-xl bg-cyan-500/15 border border-cyan-400/40 flex items-center justify-center shadow-[0_0_16px_rgba(34,211,238,0.25)]">
        <LuTrophy className="w-4 h-4 text-cyan-300" />
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

interface Mission {
    id: string;
    type: 'play' | 'win' | 'streak' | 'social';
    title: string;
    description: string;
    target: number;
    progress?: number;
    is_claimed?: boolean;
    rewardType: 'coins' | 'gems';
    rewardAmount: number;
}

interface ArenaPanelProps {
    isOpen: boolean;
    onClose: () => void;
    onSwitchTab?: (tab: any) => void;
}

export default function ArenaPanel({ isOpen, onClose, onSwitchTab }: ArenaPanelProps) {
    const { address } = useCurrentUser();
    // Guests can view missions, but claiming pays onchain — walled.
    const { guard } = useGuestWall();
    const [arenaTab, setArenaTab] = useState<ArenaTab>('tournaments');

    // ─── Tournaments state ───
    const [tournaments, setTournaments] = useState<any[]>([]);
    const [isLoadingTournaments, setIsLoadingTournaments] = useState(true);

    const fetchTournaments = async () => {
        setIsLoadingTournaments(true);
        try {
            const { data, error } = await (supabase as any)
                .from('tournaments')
                .select('*')
                .order('start_at', { ascending: true });

            if (error) throw error;
            if (data) setTournaments(data);
        } catch (err: any) {
            console.error('Fetch tournaments error:', err.message || err);
        } finally {
            setIsLoadingTournaments(false);
        }
    };

    useEffect(() => {
        if (isOpen) {
            fetchTournaments();
        }
    }, [isOpen]);

    const handleJoin = async (tId: string) => {
        if (!address) return;
        try {
            const { error } = await (supabase as any).rpc('join_tournament', {
                p_tournament_id: tId,
                p_player_id: address.toLowerCase()
            });
            if (error) alert(error.message);
            else fetchTournaments();
        } catch (err) {
            console.error('Join error:', err);
        }
    };

    // ─── Missions state ───
    const [activeMissionTab, setActiveMissionTab] = useState<MissionTab>('daily');
    const [missions, setMissions] = useState<Mission[]>([]);
    const [isLoadingMissions, setIsLoadingMissions] = useState(false);
    const [claimingId, setClaimingId] = useState<string | null>(null);

    const fetchMissions = async () => {
        if (!address) return;
        setIsLoadingMissions(true);
        try {
            const response = await fetch(`/api/missions/list?wallet=${address}`);
            if (response.ok) {
                const data = await response.json();
                setMissions(data);
            }
        } catch (err) {
            console.error('Failed to fetch missions:', err);
        } finally {
            setIsLoadingMissions(false);
        }
    };

    useEffect(() => {
        if (isOpen && address) {
            fetchMissions();
        }
    }, [isOpen, address]);

    // Listener for real-time updates from GameDataContext
    useEffect(() => {
        const handleUpdate = () => {
            if (isOpen) fetchMissions();
        };
        window.addEventListener('mission-update', handleUpdate);
        return () => window.removeEventListener('mission-update', handleUpdate);
    }, [isOpen]);

    const handleClaim = async (missionId: string) => {
        if (!address || claimingId) return;
        if (!guard('arena-claim')) return;
        setClaimingId(missionId);
        try {
            const response = await fetch('/api/missions/claim', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ walletAddress: address, missionId })
            });
            if (response.ok) {
                // Refetch to update status
                await fetchMissions();
            } else {
                const err = await response.json();
                alert(err.error || 'Failed to claim');
            }
        } catch (err) {
            console.error('Claim error:', err);
        } finally {
            setClaimingId(null);
        }
    };

    const handleGo = (missionId: string) => {
        onClose();
        // Dynamic navigation based on mission
        if (missionId.includes('social') || missionId.includes('poke')) {
            if (onSwitchTab) onSwitchTab('friends');
        }
        // For 'play' or 'win', closing stays on dashboard which is correct
    };

    // Helpers for rendering aesthetic badges
    const getTypeBadge = (type: Mission['type']) => {
        switch (type) {
            case 'play': return {
                icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-[22px] h-[22px]"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><path d="M7 7h.01"></path><path d="M17 7h.01"></path><path d="M12 12h.01"></path><path d="M7 17h.01"></path><path d="M17 17h.01"></path></svg>,
                color: 'text-cyan-400',
                bg: 'bg-white/5'
            };
            case 'win': return {
                icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-[22px] h-[22px]"><path d="M8 21h8"></path><path d="M12 17v4"></path><path d="M7 4h10v6a5 5 0 0 1-10 0V4"></path><path d="M3 5h4v4A5 5 0 0 1 3 5"></path><path d="M21 5h-4v4a5 5 0 0 0 4-4"></path></svg>,
                color: 'text-yellow-400',
                bg: 'bg-yellow-500/20'
            };
            case 'streak': return {
                icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-[22px] h-[22px]"><path d="M17 10C15 8 13.97 3 13.97 3 10 5.25 10 10 10 10c-3-2-2.5-6.5-2.5-6.5C4 6.5 4 11 4 14a8 8 0 0 0 16 0c0-2.5-1.5-4-3-4z"></path></svg>,
                color: 'text-orange-400',
                bg: 'bg-orange-500/20'
            };
            case 'social': return {
                icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-[22px] h-[22px]"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>,
                color: 'text-cyan-400',
                bg: 'bg-white/5'
            };
        }
    };

    const visibleMissions = missions.filter(m => activeMissionTab === 'daily' ? m.id.startsWith('daily') : !m.id.startsWith('daily'));
    const dailyLeft = missions.filter(m => m.id.startsWith('daily') && !(m as any).is_claimed).length;
    const weeklyLeft = missions.filter(m => !m.id.startsWith('daily') && !(m as any).is_claimed).length;

    return (
        <AnimatePresence>
            {isOpen && (
                <>
                    {/* Backdrop */}
                    <div
                        className="fixed top-[64px] bottom-[80px] left-0 right-0 z-40 bg-transparent"
                        onClick={onClose}
                    />

                    {/* Panel Container */}
                    <div className="fixed inset-0 z-[110] flex justify-center pointer-events-none">
                        <motion.div
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: 20 }}
                            className="w-full max-w-[500px] relative h-full pointer-events-auto"
                        >
                            <div
                                className="ludo-arena-scope absolute top-[64px] bottom-[80px] left-[8px] right-[8px] border border-white/10 rounded-[32px] flex flex-col shadow-2xl overflow-hidden"
                                style={{ background: 'var(--ludo-bg-cosmic)', backgroundColor: 'rgba(13, 13, 13, 0.92)', backdropFilter: 'blur(32px)' }}
                            >
                                {/* Authentic Subdued Cosmic Orbs */}
                                <div className="absolute top-[-20%] left-[-20%] w-full h-full cosmic-orb cosmic-orb-1 opacity-20 scale-150 pointer-events-none" />
                                <div className="absolute bottom-[-20%] right-[-20%] w-full h-full cosmic-orb cosmic-orb-2 opacity-15 scale-150 pointer-events-none" />

                                {/* Drag Handle */}
                                <div className="w-full flex justify-center pt-2 pb-1 relative z-10">
                                    <div className="w-12 h-1.5 bg-white/20 rounded-full" />
                                </div>

                                {/* Header */}
                                <div className="px-5 pb-3 border-b border-white/10 relative z-10">
                                    <div className="flex items-center justify-between mb-1 mt-1">
                                        <h2 className="text-xl font-bold text-white flex items-center gap-2">
                                            <TrophyTile />
                                            Arena
                                        </h2>
                                    <button
                                        onClick={onClose}
                                        aria-label="Close arena"
                                        className="w-8 h-8 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white/70 hover:text-white transition-all ring-1 ring-white/10 shadow-sm shrink-0"
                                    >
                                        <LuX className="w-4 h-4" />
                                    </button>
                                    </div>
                                    <div className="flex items-center gap-2 px-0.5">
                                        <span className="text-[11px] font-black text-white/70 tracking-wide uppercase tabular-nums">
                                            {tournaments.length} arena{tournaments.length === 1 ? '' : 's'}
                                        </span>
                                        <span className="w-0.5 h-0.5 rounded-full bg-white/25" />
                                        <span className="text-[11px] font-black text-cyan-300 tracking-wide uppercase tabular-nums">
                                            {dailyLeft + weeklyLeft} missions left
                                        </span>
                                    </div>
                                </div>

                                {/* Inner Tabs */}
                                <div className="px-5 pt-3 relative z-10">
                                    <div className="grid grid-cols-2 gap-1 p-1 rounded-2xl bg-black/50 border border-white/10">
                                        {(['tournaments', 'missions'] as ArenaTab[]).map((tab) => (
                                            <button
                                                key={tab}
                                                onClick={() => setArenaTab(tab)}
                                                className={`flex items-center justify-center gap-1.5 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-[0.2em] transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60 ${arenaTab === tab ? 'bg-cyan-500/20 text-white shadow-[inset_0_0_0_1px_rgba(34,211,238,0.5)]' : 'text-white/35 hover:text-white/70'}`}
                                            >
                                                {tab}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {arenaTab === 'tournaments' ? (
                                    /* List */
                                    <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar pt-2 px-5 mb-2 relative z-10">
                                        <SectionLabel>
                                            {tournaments.length} arena{tournaments.length === 1 ? '' : 's'}
                                        </SectionLabel>
                                        {isLoadingTournaments ? (
                                            <div className="h-full flex flex-col items-center justify-center gap-4 py-16">
                                                <div className="w-12 h-12 border-4 border-cyan-500/20 border-t-cyan-500 rounded-full animate-spin" />
                                                <span className="text-[10px] font-black text-white/20 uppercase tracking-[0.3em]">Locating Arenas</span>
                                            </div>
                                        ) : tournaments.length === 0 ? (
                                            <div className="flex flex-col items-center justify-center text-center py-16 px-6">
                                                <div className="w-16 h-16 rounded-3xl bg-white/5 border border-white/10 flex items-center justify-center mb-4 text-white/25">
                                                    <LuShieldCheck className="w-7 h-7" />
                                                </div>
                                                <h3 className="text-white font-black text-sm mb-1">Construction Mode</h3>
                                                <p className="text-white/40 text-xs max-w-[220px]">Automated brackets coming soon. Check back shortly!</p>
                                            </div>
                                        ) : tournaments.map((t, idx) => (
                                            <motion.div
                                                key={t.id}
                                                initial={{ opacity: 0, scale: 0.95 }}
                                                animate={{ opacity: 1, scale: 1 }}
                                                transition={{ delay: idx * 0.1 }}
                                                className="group relative flex flex-col gap-4 p-5 rounded-2xl border border-white/10 bg-white/[0.04] hover:bg-white/[0.07] hover:border-white/25 transition-all overflow-hidden mb-2"
                                            >
                                                <div className="flex items-start justify-between">
                                                    <div>
                                                        <h4 className="text-lg font-black text-white italic truncate">{t.title}</h4>
                                                        <p className="text-[11px] text-white/40 font-bold uppercase tracking-widest mt-1">
                                                            Entry: <span className="text-yellow-400">{t.entry_fee} COINS</span>
                                                        </p>
                                                    </div>
                                                    <div className="p-2 bg-cyan-500/10 rounded-xl border border-cyan-500/20">
                                                        <LuUsers className="text-cyan-400 w-5 h-5" />
                                                    </div>
                                                </div>

                                                <div className="flex items-center gap-6 mt-2">
                                                    <div className="flex items-center gap-2">
                                                        <LuTimer className="text-white/20 w-4 h-4" />
                                                        <span className="text-[10px] text-white/60 font-black uppercase tracking-widest">Starts in 3h 20m</span>
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        <LuUsers className="text-white/20 w-4 h-4" />
                                                        <span className="text-[10px] text-white/60 font-black uppercase tracking-widest">JOINED: {t.current_participants || 0}/{t.max_players}</span>
                                                    </div>
                                                </div>

                                                <button
                                                    onClick={() => handleJoin(t.id)}
                                                    className="w-full py-3 bg-cyan-600 hover:bg-cyan-500 text-white font-black text-xs uppercase tracking-[0.2em] rounded-xl shadow-lg border border-cyan-400/20 transition-all active:scale-95"
                                                >
                                                    Register Entry
                                                </button>
                                            </motion.div>
                                        ))}
                                    </div>
                                ) : (
                                    /* Missions Content */
                                    <div className="flex-1 min-h-0 flex flex-col overflow-hidden relative z-10">
                                        <div className="px-5 pt-2">
                                            {/* Child tabs: text-underline row, deliberately subordinate to the
                                                parent segmented block above (no fill, smaller type). */}
                                            <div className="flex items-center gap-5 border-b border-white/5 px-1" role="tablist" aria-label="Mission cadence">
                                                {(['daily', 'weekly'] as MissionTab[]).map((tab) => {
                                                    const left = tab === 'daily' ? dailyLeft : weeklyLeft;
                                                    const active = activeMissionTab === tab;
                                                    return (
                                                        <button
                                                            key={tab}
                                                            role="tab"
                                                            aria-selected={active}
                                                            onClick={() => setActiveMissionTab(tab)}
                                                            className={`pb-2 text-[11px] font-black uppercase tracking-[0.2em] transition-colors relative focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60 rounded-sm ${active ? 'text-white' : 'text-white/35 hover:text-white/70'}`}
                                                        >
                                                            <span className="flex items-center gap-1.5">
                                                                {tab}
                                                                <span className={`px-1.5 py-0.5 rounded-md text-[9px] font-mono ${active ? 'bg-cyan-400/20 text-cyan-200' : 'bg-white/5 text-white/30'}`}>{left}</span>
                                                            </span>
                                                            {active && (
                                                                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-cyan-400 rounded-t-full shadow-[0_0_8px_rgba(34,211,238,0.8)]" />
                                                            )}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                        <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar pt-2 px-5 mb-2 relative">
                                            <SectionLabel>
                                                {visibleMissions.length} mission{visibleMissions.length === 1 ? '' : 's'} left
                                            </SectionLabel>
                                            {isLoadingMissions && missions.length === 0 ? (
                                                <div className="flex items-center justify-center py-16">
                                                    <div className="w-8 h-8 border-2 border-cyan-400/30 border-t-cyan-400 rounded-full animate-spin" />
                                                </div>
                                            ) : visibleMissions.length === 0 ? (
                                                <div className="flex flex-col items-center justify-center text-center py-16 px-6">
                                                    <div className="w-16 h-16 rounded-3xl bg-white/5 border border-white/10 flex items-center justify-center mb-4 text-white/25">
                                                        <LuShieldCheck className="w-7 h-7" />
                                                    </div>
                                                    <h3 className="text-white font-black text-sm mb-1">All Caught Up!</h3>
                                                    <p className="text-white/40 text-xs max-w-[220px]">Check back later for new missions.</p>
                                                </div>
                                            ) : (
                                                <div className="flex flex-col gap-2 pb-2">
                                                    <AnimatePresence mode="popLayout">
                                                        {visibleMissions.map((mission) => {
                                                            const isCompleted = (mission.progress || 0) >= mission.target;
                                                            const isClaimed = (mission as any).is_claimed;
                                                            const progressPercent = Math.min(((mission.progress || 0) / mission.target) * 100, 100);
                                                            const badge = getTypeBadge(mission.type);

                                                            return (
                                                                <motion.div
                                                                    layout
                                                                    initial={{ opacity: 0, scale: 0.95 }}
                                                                    animate={{ opacity: 1, scale: 1 }}
                                                                    exit={{ opacity: 0, scale: 0.95 }}
                                                                    key={mission.id}
                                                                    className="flex flex-col gap-3 bg-white/[0.04] border border-white/10 p-4 rounded-2xl hover:bg-white/[0.07] hover:border-white/25 transition-colors relative overflow-hidden group"
                                                                >
                                                                    {/* Background Glow for completed missions */}
                                                                    {isCompleted && (
                                                                        <div className="absolute inset-0 bg-green-500/5 opacity-50 blur-xl pointer-events-none" />
                                                                    )}

                                                                    <div className="flex items-start gap-4">
                                                                        {/* Icon Badge */}
                                                                        <div className={`w-12 h-12 flex items-center justify-center rounded-2xl flex-shrink-0 ${badge.bg} ${badge.color} text-2xl shadow-inner border border-white/5`}>
                                                                            {badge.icon}
                                                                        </div>

                                                                        {/* Mission Details */}
                                                                        <div className="flex flex-col flex-1 min-w-0 pt-0.5">
                                                                            <div className="flex items-start justify-between gap-2">
                                                                                <h3 className={`font-bold text-[15px] truncate ${isCompleted ? 'text-green-300' : 'text-white'}`}>
                                                                                    {mission.title}
                                                                                </h3>
                                                                                {/* Reward Tag */}
                                                                                <div className="flex items-center gap-1.5 bg-black/40 px-2.5 py-1.5 rounded-lg border border-white/5 flex-shrink-0">
                                                                                    {mission.rewardType === 'coins' ? (
                                                                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3 text-yellow-400">
                                                                                            <circle cx="12" cy="12" r="8"></circle>
                                                                                            <line x1="12" y1="8" x2="12" y2="16"></line>
                                                                                            <path d="M16 12H8"></path>
                                                                                        </svg>
                                                                                    ) : (
                                                                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3 text-cyan-400">
                                                                                            <path d="M6 3h12l4 6-10 13L2 9z"></path>
                                                                                            <path d="M11 3 8 9l4 13 4-13-3-6"></path>
                                                                                        </svg>
                                                                                    )}
                                                                                    <span className={`text-[11px] font-black leading-none ${mission.rewardType === 'coins' ? 'text-yellow-400' : 'text-cyan-400'}`}>
                                                                                        {mission.rewardAmount}
                                                                                    </span>
                                                                                </div>
                                                                            </div>
                                                                            <p className="text-[11px] font-medium text-white/60 mt-1 leading-snug pr-2">
                                                                                {mission.description}
                                                                            </p>
                                                                        </div>
                                                                    </div>

                                                                    {/* Bottom Row: Progress Bar & Button */}
                                                                    <div className="flex items-center gap-4 mt-1">
                                                                        <div className="flex-1">
                                                                            <div className="flex items-end justify-between mb-1.5 px-0.5">
                                                                                <span className="text-[10px] uppercase font-bold text-white/40 tracking-wider">Progress</span>
                                                                                <span className={`text-xs font-black ${isCompleted ? 'text-green-400' : 'text-white'}`}>
                                                                                    {mission.progress || 0} <span className="text-white/30 text-[10px]">/ {mission.target}</span>
                                                                                </span>
                                                                            </div>
                                                                            {/* Custom CSS Progress Bar */}
                                                                            <div className="w-full h-2 bg-black/40 rounded-full overflow-hidden border border-white/5">
                                                                                <div
                                                                                    className={`h-full rounded-full transition-all duration-1000 ease-out ${isClaimed ? 'bg-white/20' : isCompleted ? 'bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.5)]' : 'bg-cyan-600'}`}
                                                                                    style={{ width: `${progressPercent}%` }}
                                                                                />
                                                                            </div>
                                                                        </div>
                                                                        {/* Action Button */}
                                                                        <button
                                                                            onClick={isClaimed ? undefined : isCompleted ? () => handleClaim(mission.id) : () => handleGo(mission.id)}
                                                                            disabled={claimingId === mission.id || isClaimed}
                                                                            className={`min-w-[70px] py-2 px-3 rounded-xl font-bold text-xs transition-all shadow-lg active:scale-95 flex items-center justify-center gap-1
                                                                                ${isClaimed
                                                                                    ? 'bg-white/5 text-white/20 border border-white/5 cursor-default'
                                                                                    : isCompleted
                                                                                    ? 'bg-green-500/80 text-white border border-green-400 shadow-[0_0_15px_rgba(34,197,94,0.3)] hover:bg-green-500'
                                                                                    : 'bg-white/10 text-white border border-white/10 hover:bg-white/20'
                                                                                }
                                                                            `}
                                                                        >
                                                                            {claimingId === mission.id ? (
                                                                                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                                                            ) : isClaimed ? (
                                                                                'Claimed'
                                                                            ) : isCompleted ? (
                                                                                <span className="flex items-center gap-1">
                                                                                    CLAIM <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5"><polyline points="20 6 9 17 4 12"></polyline></svg>
                                                                                </span>
                                                                            ) : 'GO'}
                                                                        </button>
                                                                    </div>
                                                                </motion.div>
                                                            );
                                                        })}
                                                    </AnimatePresence>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </motion.div>
                    </div>
                </>
            )}
        </AnimatePresence>
    );
}
