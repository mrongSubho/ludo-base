/* eslint-disable @typescript-eslint/no-explicit-any -- legacy wire/UI types */
'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useMissionVoucherClaim } from '@/hooks/useMissionVoucher';
import { missionClaimAddress } from '@/lib/missionVoucher';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useAppSession } from '@/hooks/useAppSession';
import { useGuestWall } from '@/hooks/GuestWallContext';
import { useIsMobileView } from '@/hooks/useIsMobileView';
import { PanelChildTabs, TabCount } from './PanelTabs';
import { OnboardingPanel } from './OnboardingPanel';
import { LuX, LuShieldCheck, LuListChecks } from 'react-icons/lu';

// ─── Mission panel (moved out of Arena) ─────────────────────────────────────
// Daily / weekly / onboard missions + claim. Arena stays live-only.

type MissionTab = 'daily' | 'weekly' | 'onboard';

const MissionTile = () => (
    <div className="w-7 h-7 rounded-xl bg-cyan-500/15 border border-cyan-400/40 flex items-center justify-center shadow-[0_0_16px_rgba(34,211,238,0.25)]">
        <LuListChecks className="w-4 h-4 text-cyan-300" />
    </div>
);

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
    type: 'play' | 'win' | 'streak' | 'social' | 'predict';
    title: string;
    description: string;
    target: number;
    progress?: number;
    is_claimed?: boolean;
    /** CHIPS (whole). The coin economy is frozen; see 202609300001. */
    rewardType: 'chips';
    rewardAmount: number;
    category?: 'daily' | 'weekly';
    period?: 'once' | 'day' | 'week';
}

interface MissionPanelProps {
    isOpen: boolean;
    onClose: () => void;
    onSwitchTab?: (tab: any) => void;
}

export default function MissionPanel({ isOpen, onClose, onSwitchTab }: MissionPanelProps) {
    const { address, isGuest } = useCurrentUser();
    const { ensureAppSession } = useAppSession();
    const { guard } = useGuestWall();
    const isMobile = useIsMobileView();

    const [activeMissionTab, setActiveMissionTab] = useState<MissionTab>('daily');
    const [missions, setMissions] = useState<Mission[]>([]);
    const [isLoadingMissions, setIsLoadingMissions] = useState(false);
    const [claimingId, setClaimingId] = useState<string | null>(null);
    const { claim: claimVoucher, error: voucherError } = useMissionVoucherClaim();
    const [missionsLocked, setMissionsLocked] = useState(false);

    const fetchMissions = useCallback(async () => {
        if (!address) return;
        setIsLoadingMissions(true);
        try {
            const sessionId = await ensureAppSession();
            if (!sessionId) {
                setMissions([]);
                setMissionsLocked(true);
                return;
            }
            setMissionsLocked(false);
            const response = await fetch(
                `/api/missions/list?wallet=${encodeURIComponent(address)}&sessionId=${encodeURIComponent(sessionId)}`
            );
            if (response.ok) {
                setMissions(await response.json());
            }
        } catch (err) {
            console.error('Failed to fetch missions:', err);
        } finally {
            setIsLoadingMissions(false);
        }
    }, [address, ensureAppSession]);

    useEffect(() => {
        if (isOpen && address) void fetchMissions();
    }, [isOpen, address, fetchMissions]);

    useEffect(() => {
        const handleUpdate = () => {
            if (isOpen) void fetchMissions();
        };
        window.addEventListener('mission-update', handleUpdate);
        return () => window.removeEventListener('mission-update', handleUpdate);
    }, [isOpen, fetchMissions]);

    const handleClaim = async (missionId: string) => {
        if (!address || claimingId) return;
        if (!guard('arena-claim')) return;
        setClaimingId(missionId);
        try {
            if (missionClaimAddress()) {
                const tx = await claimVoucher(missionId);
                if (tx) {
                    window.dispatchEvent(new CustomEvent('ludo-profile-refresh'));
                    window.dispatchEvent(new CustomEvent('ludo-chips-refresh'));
                    await fetchMissions();
                } else if (voucherError) {
                    alert(voucherError);
                }
                return;
            }
            // Coin rewards are retired (202609300001). Rewards are CHIPS and
            // are only claimable when MissionClaim is configured for the chain.
            alert('Mission rewards require the CHIPS contract to be configured.');
        } catch (err) {
            console.error('Claim error:', err);
        } finally {
            setClaimingId(null);
        }
    };

    const handleGo = (missionId: string) => {
        onClose();
        if (missionId.includes('social') || missionId.includes('poke')) {
            onSwitchTab?.('friends');
        }
    };

    const getTypeBadge = (type: Mission['type']) => {
        switch (type) {
            case 'play':
                return {
                    icon: (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-[22px] h-[22px]">
                            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                            <path d="M7 7h.01M17 7h.01M12 12h.01M7 17h.01M17 17h.01" />
                        </svg>
                    ),
                    color: 'text-cyan-400',
                    bg: 'bg-white/5',
                };
            case 'win':
                return {
                    icon: (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-[22px] h-[22px]">
                            <path d="M8 21h8M12 17v4M7 4h10v6a5 5 0 0 1-10 0V4M3 5h4v4A5 5 0 0 1 3 5M21 5h-4v4a5 5 0 0 0 4-4" />
                        </svg>
                    ),
                    color: 'text-yellow-400',
                    bg: 'bg-yellow-500/20',
                };
            case 'streak':
                return {
                    icon: (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-[22px] h-[22px]">
                            <path d="M17 10C15 8 13.97 3 13.97 3 10 5.25 10 10 10 10c-3-2-2.5-6.5-2.5-6.5C4 6.5 4 11 4 14a8 8 0 0 0 16 0c0-2.5-1.5-4-3-4z" />
                        </svg>
                    ),
                    color: 'text-orange-400',
                    bg: 'bg-orange-500/20',
                };
            case 'social':
                return {
                    icon: (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-[22px] h-[22px]">
                            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                            <circle cx="9" cy="7" r="4" />
                            <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
                        </svg>
                    ),
                    color: 'text-cyan-400',
                    bg: 'bg-white/5',
                };
            case 'predict':
                return {
                    icon: (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-[22px] h-[22px]">
                            <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                            <circle cx="12" cy="12" r="3" />
                        </svg>
                    ),
                    color: 'text-pink-400',
                    bg: 'bg-pink-500/20',
                };
        }
    };

    const visibleMissions =
        activeMissionTab === 'onboard'
            ? []
            : missions.filter((m) =>
                  activeMissionTab === 'daily' ? m.id.startsWith('daily') : !m.id.startsWith('daily')
              );
    const dailyLeft = missions.filter((m) => m.id.startsWith('daily') && !(m as any).is_claimed).length;
    const weeklyLeft = missions.filter((m) => !m.id.startsWith('daily') && !(m as any).is_claimed).length;

    return (
        <AnimatePresence initial={false}>
            {isOpen && (
                <>
                    <div
                        className="fixed top-[64px] bottom-[80px] left-0 right-0 z-40 bg-transparent"
                        onClick={onClose}
                    />
                    <div className="fixed inset-0 z-[110] flex justify-center pointer-events-none">
                        <motion.div
                            initial={isMobile ? false : { opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={isMobile ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, y: 20 }}
                            transition={
                                isMobile
                                    ? { duration: 0 }
                                    : { type: 'tween', duration: 0.22, ease: [0.22, 1, 0.36, 1] }
                            }
                            className="w-full max-w-[500px] relative h-full pointer-events-auto panel-motion-host"
                        >
                            <div
                                className="ludo-arena-scope ludo-mission-scope absolute top-[64px] bottom-[80px] left-[8px] right-[8px] border border-white/10 rounded-[32px] flex flex-col shadow-2xl overflow-hidden"
                                style={{
                                    background: 'var(--panel-bg-image, var(--ludo-bg-cosmic))',
                                    backgroundColor: 'var(--panel-bg, rgba(13, 13, 13, 0.92))',
                                    backdropFilter: 'blur(32px)',
                                }}
                            >
                                <div className="absolute top-[-20%] left-[-20%] w-full h-full cosmic-orb cosmic-orb-1 opacity-20 scale-150 pointer-events-none" />
                                <div className="absolute bottom-[-20%] right-[-20%] w-full h-full cosmic-orb cosmic-orb-2 opacity-15 scale-150 pointer-events-none" />

                                <div className="w-full flex justify-center pt-2 pb-1 relative z-10">
                                    <div className="w-12 h-1.5 bg-white/20 rounded-full" />
                                </div>

                                <div className="px-5 pb-3 border-b border-white/10 relative z-10">
                                    <div className="flex items-center justify-between mb-1 mt-1">
                                        <h2 className="text-xl font-bold text-white flex items-center gap-2">
                                            <MissionTile />
                                            Missions
                                        </h2>
                                        <button
                                            onClick={onClose}
                                            aria-label="Close missions"
                                            className="w-11 h-11 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white/70 hover:text-white transition-all ring-1 ring-white/10 shadow-sm shrink-0"
                                        >
                                            <LuX className="w-4 h-4" />
                                        </button>
                                    </div>
                                    <div className="flex items-center gap-2 px-0.5">
                                        <span className="text-[11px] font-black text-cyan-300 tracking-wide uppercase tabular-nums">
                                            {dailyLeft + weeklyLeft} missions left
                                        </span>
                                    </div>
                                </div>

                                <div className="flex-1 min-h-0 flex flex-col overflow-hidden relative z-10">
                                    <div className="px-5 pt-2">
                                        <PanelChildTabs
                                            ariaLabel="Mission cadence"
                                            value={activeMissionTab}
                                            onPick={setActiveMissionTab}
                                            options={[
                                                {
                                                    value: 'daily',
                                                    label: 'daily',
                                                    pill: (
                                                        <TabCount active={activeMissionTab === 'daily'}>
                                                            {dailyLeft}
                                                        </TabCount>
                                                    ),
                                                },
                                                {
                                                    value: 'weekly',
                                                    label: 'weekly',
                                                    pill: (
                                                        <TabCount active={activeMissionTab === 'weekly'}>
                                                            {weeklyLeft}
                                                        </TabCount>
                                                    ),
                                                },
                                                { value: 'onboard', label: 'onboard' },
                                            ]}
                                        />
                                    </div>
                                    <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar pt-2 px-5 mb-2 relative">
                                        {activeMissionTab === 'onboard' ? (
                                            <OnboardingPanel />
                                        ) : (
                                            <>
                                                <SectionLabel>
                                                    {visibleMissions.length} mission
                                                    {visibleMissions.length === 1 ? '' : 's'} left
                                                </SectionLabel>
                                                {isLoadingMissions && missions.length === 0 ? (
                                                    <div className="flex items-center justify-center py-16">
                                                        <div className="w-8 h-8 border-2 border-cyan-400/30 border-t-cyan-400 rounded-full animate-spin" />
                                                    </div>
                                                ) : missionsLocked ? (
                                                    <div className="flex flex-col items-center justify-center text-center py-16 px-6">
                                                        <div className="w-16 h-16 rounded-3xl bg-white/5 border border-white/10 flex items-center justify-center mb-4 text-white/25">
                                                            <LuShieldCheck className="w-7 h-7" />
                                                        </div>
                                                        <h3 className="text-white font-black text-sm mb-1">
                                                            Sign in to track missions
                                                        </h3>
                                                        <p className="text-white/40 text-xs max-w-[220px]">
                                                            Missions need an active session — sign in, then reopen this
                                                            tab.
                                                        </p>
                                                    </div>
                                                ) : visibleMissions.length === 0 ? (
                                                    <div className="flex flex-col items-center justify-center text-center py-16 px-6">
                                                        <div className="w-16 h-16 rounded-3xl bg-white/5 border border-white/10 flex items-center justify-center mb-4 text-white/25">
                                                            <LuShieldCheck className="w-7 h-7" />
                                                        </div>
                                                        <h3 className="text-white font-black text-sm mb-1">
                                                            {isGuest
                                                                ? 'Connect wallet to track missions'
                                                                : 'All Caught Up!'}
                                                        </h3>
                                                        <p className="text-white/40 text-xs max-w-[220px]">
                                                            {isGuest
                                                                ? 'Connect a wallet to start earning mission rewards.'
                                                                : 'Check back later for new missions.'}
                                                        </p>
                                                    </div>
                                                ) : (
                                                    <div className="flex flex-col gap-2 pb-2">
                                                        <AnimatePresence mode="popLayout">
                                                            {visibleMissions.map((mission) => {
                                                                const isCompleted =
                                                                    (mission.progress || 0) >= mission.target;
                                                                const isClaimed = (mission as any).is_claimed;
                                                                const progressPercent = Math.min(
                                                                    ((mission.progress || 0) / mission.target) * 100,
                                                                    100
                                                                );
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
                                                                        {isCompleted && (
                                                                            <div className="absolute inset-0 bg-green-500/5 opacity-50 blur-xl pointer-events-none" />
                                                                        )}
                                                                        <div className="flex items-start gap-4">
                                                                            <div
                                                                                className={`w-12 h-12 flex items-center justify-center rounded-2xl flex-shrink-0 ${badge.bg} ${badge.color} text-2xl shadow-inner border border-white/5`}
                                                                            >
                                                                                {badge.icon}
                                                                            </div>
                                                                            <div className="flex flex-col flex-1 min-w-0 pt-0.5">
                                                                                <div className="flex items-start justify-between gap-2">
                                                                                    <h3
                                                                                        className={`font-bold text-[15px] truncate ${isCompleted ? 'text-green-300' : 'text-white'}`}
                                                                                    >
                                                                                        {mission.title}
                                                                                    </h3>
                                                                                    <div className="flex items-center gap-1.5 bg-black/40 px-2.5 py-1.5 rounded-lg border border-white/5 flex-shrink-0">
                                                                                        {mission.rewardType === 'chips' ? (
                                                                                            <svg
                                                                                                viewBox="0 0 24 24"
                                                                                                fill="none"
                                                                                                stroke="currentColor"
                                                                                                strokeWidth="2.5"
                                                                                                strokeLinecap="round"
                                                                                                strokeLinejoin="round"
                                                                                                className="w-3 h-3 text-yellow-400"
                                                                                            >
                                                                                                <circle cx="12" cy="12" r="8" />
                                                                                                <line x1="12" y1="8" x2="12" y2="16" />
                                                                                                <path d="M16 12H8" />
                                                                                            </svg>
                                                                                        ) : (
                                                                                            <svg
                                                                                                viewBox="0 0 24 24"
                                                                                                fill="none"
                                                                                                stroke="currentColor"
                                                                                                strokeWidth="2.5"
                                                                                                strokeLinecap="round"
                                                                                                strokeLinejoin="round"
                                                                                                className="w-3 h-3 text-cyan-400"
                                                                                            >
                                                                                                <path d="M6 3h12l4 6-10 13L2 9z" />
                                                                                                <path d="M11 3 8 9l4 13 4-13-3-6" />
                                                                                            </svg>
                                                                                        )}
                                                                                        <span
                                                                                            className={`text-[11px] font-black leading-none ${mission.rewardType === 'chips' ? 'text-cyan-400' : 'text-yellow-400'}`}
                                                                                        >
                                                                                            {mission.rewardAmount}
                                                                                        </span>
                                                                                    </div>
                                                                                </div>
                                                                                <p className="text-[11px] font-medium text-white/60 mt-1 leading-snug pr-2">
                                                                                    {mission.description}
                                                                                </p>
                                                                            </div>
                                                                        </div>
                                                                        <div className="flex items-center gap-4 mt-1">
                                                                            <div className="flex-1">
                                                                                <div className="flex items-end justify-between mb-1.5 px-0.5">
                                                                                    <span className="text-[10px] uppercase font-bold text-white/40 tracking-wider">
                                                                                        Progress
                                                                                    </span>
                                                                                    <span
                                                                                        className={`text-xs font-black ${isCompleted ? 'text-green-400' : 'text-white'}`}
                                                                                    >
                                                                                        {mission.progress || 0}{' '}
                                                                                        <span className="text-white/30 text-[10px]">
                                                                                            / {mission.target}
                                                                                        </span>
                                                                                    </span>
                                                                                </div>
                                                                                <div className="w-full h-2 bg-black/40 rounded-full overflow-hidden border border-white/5">
                                                                                    <div
                                                                                        className={`h-full rounded-full transition-all duration-1000 ease-out ${isClaimed ? 'bg-white/20' : isCompleted ? 'bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.5)]' : 'bg-cyan-600'}`}
                                                                                        style={{ width: `${progressPercent}%` }}
                                                                                    />
                                                                                </div>
                                                                            </div>
                                                                            <button
                                                                                onClick={
                                                                                    isClaimed
                                                                                        ? undefined
                                                                                        : isCompleted
                                                                                          ? () => handleClaim(mission.id)
                                                                                          : () => handleGo(mission.id)
                                                                                }
                                                                                disabled={claimingId === mission.id || isClaimed}
                                                                                className={`min-w-[70px] py-2 px-3 rounded-xl font-bold text-xs transition-all shadow-lg active:scale-95 flex items-center justify-center gap-1
                                                                                ${isClaimed
                                                                                    ? 'bg-white/5 text-white/20 border border-white/5 cursor-default'
                                                                                    : isCompleted
                                                                                      ? 'bg-green-500/80 text-white border border-green-400 shadow-[0_0_15px_rgba(34,197,94,0.3)] hover:bg-green-500'
                                                                                      : 'bg-white/10 text-white border border-white/10 hover:bg-white/20'
                                                                                }`}
                                                                            >
                                                                                {claimingId === mission.id ? (
                                                                                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                                                                ) : isClaimed ? (
                                                                                    'Claimed'
                                                                                ) : isCompleted ? (
                                                                                    <span className="flex items-center gap-1">
                                                                                        CLAIM{' '}
                                                                                        <svg
                                                                                            viewBox="0 0 24 24"
                                                                                            fill="none"
                                                                                            stroke="currentColor"
                                                                                            strokeWidth="3"
                                                                                            strokeLinecap="round"
                                                                                            strokeLinejoin="round"
                                                                                            className="w-3.5 h-3.5"
                                                                                        >
                                                                                            <polyline points="20 6 9 17 4 12" />
                                                                                        </svg>
                                                                                    </span>
                                                                                ) : (
                                                                                    'GO'
                                                                                )}
                                                                            </button>
                                                                        </div>
                                                                    </motion.div>
                                                                );
                                                            })}
                                                        </AnimatePresence>
                                                    </div>
                                                )}
                                            </>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </motion.div>
                    </div>
                </>
            )}
        </AnimatePresence>
    );
}

