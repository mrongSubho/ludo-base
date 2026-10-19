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
import { ThinkingOrb } from './ThinkingOrb';
import { LuX, LuShieldCheck, LuListChecks, LuGift, LuDices, LuTrophy, LuSwords, LuBell, LuEye, LuUsers, LuTarget } from 'react-icons/lu';
import { missionBadgeFor, type MissionBadgeKey } from '@/lib/missionBadge';
import { Button } from './Button';
import { useToast } from './Toast';
import { useMissionOnChainState } from '@/hooks/useMissionOnChainState';

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
        <span className="px-2 py-0.5 rounded-md bg-white/[0.07] border border-white/10 text-ludo-xs font-black tracking-[0.18em] text-white/60 font-mono uppercase">
            {children}
        </span>
        <div className="flex-1 h-px bg-gradient-to-r from-white/15 to-transparent" />
        {right}
    </div>
);

/**
 * Icon per badge key. The *style* (bg/color) comes from the pure, unit-tested
 * `missionBadgeFor()` in lib/missionBadge.ts — keyed off `mission_id` and total
 * by construction (it always ends in a default).
 *
 * Regression history: this panel used to switch on a `type` wire field left
 * over from the old hardcoded DAILY_MISSIONS table. Commit 1084c72 ("missions
 * on CHIPS, single reward source") replaced that source with `mission_catalog`
 * (migration 202609300003), which has no `type` column — so the switch fell
 * through for every mission, the badge was undefined, and `badge.bg` threw
 * "Cannot read properties of undefined (reading 'bg')" on the first mission
 * row, taking the whole Mission panel down for signed-in users.
 */
const MISSION_BADGE_ICON: Record<MissionBadgeKey, React.ReactNode> = {
    bonus: <LuGift className="w-[22px] h-[22px]" />,
    play: <LuDices className="w-[22px] h-[22px]" />,
    win: <LuTrophy className="w-[22px] h-[22px]" />,
    capture: <LuSwords className="w-[22px] h-[22px]" />,
    poke: <LuBell className="w-[22px] h-[22px]" />,
    predict: <LuEye className="w-[22px] h-[22px]" />,
    social: <LuUsers className="w-[22px] h-[22px]" />,
    default: <LuTarget className="w-[22px] h-[22px]" />,
};

interface Mission {
    id: string;
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
    const toast = useToast();

    const [activeMissionTab, setActiveMissionTab] = useState<MissionTab>('daily');
    const [missions, setMissions] = useState<Mission[]>([]);
    const [isLoadingMissions, setIsLoadingMissions] = useState(false);
    const [claimingId, setClaimingId] = useState<string | null>(null);
    const { claim: claimVoucher, error: voucherError } = useMissionVoucherClaim();
    const [missionsLocked, setMissionsLocked] = useState(false);

    // On-chain mission state overlay (MissionSystem contract, Base Sepolia).
    // When configured it is the payout authority; the panel then reflects
    // authoritative progress/completion and a completed mission is "Received".
    const onChain = useMissionOnChainState(address, missions.map((m) => m.id));

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
            if (missionId === 'daily_bonus') {
                // The daily check-in is server-driven — nothing is signed here.
                // MissionSystem completes it (target 0) and pays the CHIPS from
                // its own reserve; the endpoint keeps exactly one payout per
                // (wallet, UTC day) and suppresses the legacy voucher for it.
                const sessionId = await ensureAppSession();
                if (!sessionId) {
                    toast('Sign in to claim', 'error');
                    return;
                }
                const res = await fetch('/api/missions/daily-bonus', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ walletAddress: address, sessionId }),
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data?.error || 'claim failed');
                window.dispatchEvent(new CustomEvent('ludo-profile-refresh'));
                window.dispatchEvent(new CustomEvent('ludo-chips-refresh'));
                onChain.refresh();
                await fetchMissions();
                toast(
                    data?.alreadyClaimed
                        ? 'Daily bonus already claimed today.'
                        : 'Daily bonus claimed — CHIPS are in your wallet.',
                    'success',
                );
                return;
            }
            if (missionClaimAddress()) {
                const tx = await claimVoucher(missionId);
                if (tx) {
                    window.dispatchEvent(new CustomEvent('ludo-profile-refresh'));
                    window.dispatchEvent(new CustomEvent('ludo-chips-refresh'));
                    await fetchMissions();
                    toast('Reward claimed — CHIPS are in your wallet.', 'success');
                } else if (voucherError) {
                    toast(voucherError, 'error');
                }
                return;
            }
            // Coin rewards are retired (202609300001). Rewards are CHIPS and
            // are only claimable when MissionClaim is configured for the chain.
            toast('Mission rewards require the CHIPS contract to be configured.', 'error');
        } catch (err) {
            console.error('Claim error:', err);
            toast(err instanceof Error && err.message ? err.message : 'Claim failed — try again.', 'error');
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

    const visibleMissions =
        activeMissionTab === 'onboard'
            ? []
            : missions.filter((m) =>
                  activeMissionTab === 'daily' ? m.id.startsWith('daily') : !m.id.startsWith('daily')
              );

    // A mission counts as "done" when the on-chain contract says completed
    // (authoritative) or, when the contract is not configured, via the DB row.
    const isMissionDone = (m: Mission) => {
        const oc = onChain.configured ? onChain.states[m.id] : undefined;
        if (oc) return oc.completed || Boolean((m as any).is_claimed);
        // A target of 0 is valid (daily_bonus) and must not be coerced to 1.
        const target = typeof m.target === 'number' ? m.target : 1;
        return (m.progress ?? 0) >= target || Boolean((m as any).is_claimed);
    };
    const dailyLeft = missions.filter((m) => m.id.startsWith('daily') && !isMissionDone(m)).length;
    const weeklyLeft = missions.filter((m) => !m.id.startsWith('daily') && !isMissionDone(m)).length;

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
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            onClick={onClose}
                                            aria-label="Close missions"
                                            className="bg-surface-hover border border-line-soft shrink-0"
                                        >
                                            <LuX className="icon-md" />
                                        </Button>
                                    </div>
                                    <div className="flex items-center gap-2 px-0.5">
                                        <span className="text-ludo-sm font-black text-cyan-300 tracking-wide uppercase tabular-nums">
                                            {dailyLeft + weeklyLeft} missions left
                                        </span>
                                        {onChain.configured && (
                                            <span className="ml-2 inline-flex items-center gap-1 text-ludo-xs font-bold text-cyan-400/80 tracking-wider uppercase">
                                                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                                                on-chain
                                            </span>
                                        )}
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
                                                                // On-chain overlay: when the contract is configured and this
                                                                // mission was read, use its authoritative progress/completion.
                                                                const oc =
                                                                    onChain.configured ? onChain.states[mission.id] : undefined;
                                                                const useOnChain = Boolean(oc);
                                                                const progressVal = useOnChain
                                                                    ? oc!.progress
                                                                    : (mission.progress || 0);
                                                                // Nullish (`??`), NOT `||`: a target of 0 is a real, valid
                                                                // threshold — `daily_bonus` is "claimable on sight" with
                                                                // target 0. `mission.target || 1` silently turned 0 into 1, so
                                                                // that mission never read as complete and its button fell
                                                                // through to handleGo() -> onClose() (the "clicking Daily
                                                                // Bonus bounces me to the lobby" bug).
                                                                const targetVal =
                                                                    typeof mission.target === 'number' ? mission.target : 1;
                                                                const onChainCompleted = useOnChain && oc!.completed;
                                                                const dbClaimed = Boolean((mission as any).is_claimed);
                                                                const isCompleted =
                                                                    onChainCompleted || dbClaimed || progressVal >= targetVal;
                                                                // Paid one way or another => the legacy voucher CLAIM stays
                                                                // off, so the contract paying on completion cannot turn
                                                                // into a second payout through /api/missions/voucher.
                                                                const isPaid = onChainCompleted || dbClaimed;
                                                                const progressPercent = Math.min(
                                                                    (progressVal / Math.max(targetVal, 1)) * 100,
                                                                    100
                                                                );
                                                                const badge = missionBadgeFor(mission.id);

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
                                                                                {MISSION_BADGE_ICON[badge.key]}
                                                                            </div>
                                                                            <div className="flex flex-col flex-1 min-w-0 pt-0.5">
                                                                                <div className="flex items-start justify-between gap-2">
                                                                                    <h3
                                                                                        className={`font-bold text-ludo-lg truncate ${isCompleted ? 'text-green-300' : 'text-white'}`}
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
                                                                                            className={`text-ludo-sm font-black leading-none ${mission.rewardType === 'chips' ? 'text-cyan-400' : 'text-yellow-400'}`}
                                                                                        >
                                                                                            {mission.rewardAmount}
                                                                                        </span>
                                                                                    </div>
                                                                                </div>
                                                                            </div>
                                                                        </div>
                                                                        {/* Task details, directly above the progress bar — the same
                                                                            placement the onboarding cards use. Always rendered, single
                                                                            line, tabular-nums: no progress value can reflow the card. */}
                                                                        <div className="flex flex-col gap-2">
                                                                            <p className="text-ludo-sm font-medium text-white/60 leading-snug tabular-nums truncate">
                                                                                {mission.description}
                                                                            </p>
                                                                            <div className="flex items-center gap-4 mt-1">
                                                                            <div className="flex-1">
                                                                                <div className="flex items-end justify-between mb-1.5 px-0.5">
                                                                                    <span className="text-ludo-xs uppercase font-bold text-white/40 tracking-wider">
                                                                                        Progress
                                                                                    </span>
                                                                                    <span
                                                                                        className={`text-xs font-black tabular-nums ${isCompleted ? 'text-green-400' : 'text-white'}`}
                                                                                    >
                                                                                        {progressVal}{' '}
                                                                                        <span className="text-white/30 text-ludo-xs">
                                                                                            / {targetVal}
                                                                                        </span>
                                                                                    </span>
                                                                                </div>
                                                                                <div className="w-full h-2 bg-black/40 rounded-full overflow-hidden border border-white/5">
                                                                                    <div
                                                                                        className={`h-full rounded-full transition-all duration-1000 ease-out ${isPaid ? 'bg-white/20' : isCompleted ? 'bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.5)]' : 'bg-cyan-600'}`}
                                                                                        style={{ width: `${progressPercent}%` }}
                                                                                    />
                                                                                </div>
                                                                            </div>
                                                                            {/* The mission action is the shared Button (Phase C.1/C.3):
                                                                                `loading` replaces the hand-rolled spinner div and
                                                                                `disabled` brings the visible treatment the old
                                                                                "Claimed" state was faking with a grey fill. The
                                                                                completed state keeps its positive read via
                                                                                --positive instead of green-500. */}
                                                                            <Button
                                                                                variant="secondary"
                                                                                size="sm"
                                                                                loading={claimingId === mission.id}
                                                                                loadingIcon={<ThinkingOrb state="solving" size={20} />}
                                                                                disabled={isPaid}
                                                                                onClick={
                                                                                    isPaid
                                                                                        ? undefined
                                                                                        : isCompleted
                                                                                          ? () => handleClaim(mission.id)
                                                                                          : () => handleGo(mission.id)
                                                                                }
                                                                                className={`min-w-[70px] rounded-xl ${isPaid ? '' : isCompleted ? 'bg-positive/80 border-positive text-white hover:bg-positive shadow-[0_0_15px_color-mix(in_srgb,var(--positive)_30%,transparent)]' : ''}`}
                                                                            >
                                                                                {onChainCompleted ? (
                                                                                    'Received'
                                                                                ) : dbClaimed ? (
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
                                                                                            className="icon-sm"
                                                                                        >
                                                                                            <polyline points="20 6 9 17 4 12" />
                                                                                        </svg>
                                                                                    </span>
                                                                                ) : (
                                                                                    'GO'
                                                                                )}
                                                                            </Button>
                                                                        </div>
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

