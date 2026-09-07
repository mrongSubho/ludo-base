'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useGuestWall } from '@/hooks/GuestWallContext';
import { PanelTabs, PanelChildTabs, TabCount } from './PanelTabs';
import { LiveArenaContent, LiveTile } from './LiveArenaDirectory';
import { LuTrophy, LuX, LuShieldCheck } from 'react-icons/lu';

// ─── Theme-agnostic contract (holds for current + future themes) ───────────
// Same as marketplace/settings/rankings/friends/messages: this panel always
// renders on the shared dark-glass sandwich shell, so content uses only
// white-ink + white-opacity surfaces + cyan/status accents. No font-family is
// set (inherits the active theme's display font). Spacing inside
// `.ludo-arena-scope` is re-asserted in globals.css (the global unlayered
// reset zeroes Tailwind spacing utilities).

type ArenaTab = 'live' | 'missions';
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
    onWatchMatch?: (roomCode: string) => void;
}

export default function ArenaPanel({ isOpen, onClose, onSwitchTab, onWatchMatch }: ArenaPanelProps) {
    const { address } = useCurrentUser();
    // Guests can view missions, but claiming pays onchain — walled.
    const { guard } = useGuestWall();
    const [arenaTab, setArenaTab] = useState<ArenaTab>('live');

    // Live header stats, reported up by the live tab content.
    const [liveStats, setLiveStats] = useState({ live: 0, watching: 0, vol: 0 });
    const handleLiveStats = useCallback(
        (live: number, watching: number, vol: number) => {
            setLiveStats(prev =>
                prev.live === live && prev.watching === watching && prev.vol === vol
                    ? prev
                    : { live, watching, vol }
            );
        },
        []
    );

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
                                style={{ background: 'var(--panel-bg-image, var(--ludo-bg-cosmic))', backgroundColor: 'var(--panel-bg, rgba(13, 13, 13, 0.92))', backdropFilter: 'blur(32px)' }}
                            >
                                {/* Authentic Subdued Cosmic Orbs */}
                                <div className="absolute top-[-20%] left-[-20%] w-full h-full cosmic-orb cosmic-orb-1 opacity-20 scale-150 pointer-events-none" />
                                <div className="absolute bottom-[-20%] right-[-20%] w-full h-full cosmic-orb cosmic-orb-2 opacity-15 scale-150 pointer-events-none" />

                                {/* Drag Handle */}
                                <div className="w-full flex justify-center pt-2 pb-1 relative z-10">
                                    <div className="w-12 h-1.5 bg-white/20 rounded-full" />
                                </div>

                                {/* Header — contextual: live stats on the live tab,
                                    missions on the missions tab. No stacked dupes. */}
                                <div className="px-5 pb-3 border-b border-white/10 relative z-10">
                                    <div className="flex items-center justify-between mb-1 mt-1">
                                        <h2 className="text-xl font-bold text-white flex items-center gap-2">
                                            {arenaTab === 'live' ? <LiveTile /> : <TrophyTile />}
                                            {arenaTab === 'live' ? 'Live Arena' : 'Arena'}
                                        </h2>
                                    <button
                                        onClick={onClose}
                                        aria-label="Close arena"
                                        className="w-11 h-11 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white/70 hover:text-white transition-all ring-1 ring-white/10 shadow-sm shrink-0"
                                    >
                                        <LuX className="w-4 h-4" />
                                    </button>
                                    </div>
                                    <div className="flex items-center gap-2 px-0.5">
                                        {arenaTab === 'live' ? (
                                            <>
                                                {liveStats.live > 0 && <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />}
                                                <span className="text-[11px] font-black text-white/70 tracking-wide uppercase tabular-nums">
                                                    {liveStats.live} live
                                                </span>
                                                <span className="w-0.5 h-0.5 rounded-full bg-white/25" />
                                                <span className="text-[11px] font-black text-white/70 tracking-wide uppercase tabular-nums">
                                                    {liveStats.watching.toLocaleString()} watching
                                                </span>
                                                <span className="w-0.5 h-0.5 rounded-full bg-white/25" />
                                                <span className="text-[11px] font-black text-cyan-300 tracking-wide uppercase tabular-nums">
                                                    {liveStats.vol.toLocaleString()} vol
                                                </span>
                                            </>
                                        ) : (
                                            <span className="text-[11px] font-black text-cyan-300 tracking-wide uppercase tabular-nums">
                                                {dailyLeft + weeklyLeft} missions left
                                            </span>
                                        )}
                                    </div>
                                </div>

                                {/* Inner Tabs */}
                                <div className="px-5 pt-3 relative z-10">
                                    <PanelTabs
                                        value={arenaTab}
                                        onPick={setArenaTab}
                                        options={[
                                            { value: 'live', label: 'live' },
                                            { value: 'missions', label: 'missions' },
                                        ]}
                                    />
                                </div>

                                {arenaTab === 'live' ? (
                                    /* Live Arena streams (chat + searches live in the lobby's
                                        Live Broadcast card) */
                                    <LiveArenaContent
                                        onWatchMatch={onWatchMatch}
                                        onStats={handleLiveStats}
                                    />
                                ) : (
                                    /* Missions Content */
                                    <div className="flex-1 min-h-0 flex flex-col overflow-hidden relative z-10">
                                        <div className="px-5 pt-2">
                                            {/* Child tabs: text-underline row, deliberately subordinate to the
                                                parent segmented block above (no fill, smaller type). */}
                                            <PanelChildTabs
                                                ariaLabel="Mission cadence"
                                                value={activeMissionTab}
                                                onPick={setActiveMissionTab}
                                                options={[
                                                    { value: 'daily', label: 'daily', pill: <TabCount active={activeMissionTab === 'daily'}>{dailyLeft}</TabCount> },
                                                    { value: 'weekly', label: 'weekly', pill: <TabCount active={activeMissionTab === 'weekly'}>{weeklyLeft}</TabCount> },
                                                ]}
                                            />
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
