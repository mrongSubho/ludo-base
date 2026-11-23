'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useMissionVoucherClaim } from '@/hooks/useMissionVoucher';
import { missionClaimAddress } from '@/lib/missionVoucher';
import { isMissionSystemConfigured } from '@/lib/missionSystem';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useAppSession } from '@/hooks/useAppSession';
import { useGuestWall } from '@/hooks/GuestWallContext';
import { PanelChildTabs, TabCount } from './PanelTabs';
import { OnboardingPanel } from './OnboardingPanel';
import { ThinkingOrb } from './ThinkingOrb';
import {
    LuShieldCheck,
    LuGift,
    LuDices,
    LuTrophy,
    LuSwords,
    LuBell,
    LuEye,
    LuUsers,
    LuTarget,
    LuClock,
} from 'react-icons/lu';
import { missionBadgeFor, type MissionBadgeKey } from '@/lib/missionBadge';
import { Button } from './Button';
import { useToast } from './Toast';
import { useMissionOnChainState } from '@/hooks/useMissionOnChainState';
import { MissionCard } from './MissionCard';
import { GamePanelShell } from './GamePanelShell';
import { HudSectionLabel } from './HudPrimitives';
import { CheckGlyphIcon, ChipsHexIcon, DirectiveTargetIcon } from './icons';
import { getSoundEngine } from '@/lib/audio/SoundEngine';

type MissionTab = 'daily' | 'weekly' | 'onboard';
type NavTab =
    | 'friends'
    | 'leaderboard'
    | 'mission'
    | 'arena'
    | 'marketplace'
    | 'settings'
    | 'messages'
    | 'wallet'
    | 'profile'
    | 'clan'
    | null;

const MISSION_BADGE_ICON: Record<MissionBadgeKey, React.ReactNode> = {
    bonus: <LuGift className="w-5 h-5" />,
    play: <LuDices className="w-5 h-5" />,
    win: <LuTrophy className="w-5 h-5" />,
    capture: <LuSwords className="w-5 h-5" />,
    poke: <LuBell className="w-5 h-5" />,
    predict: <LuEye className="w-5 h-5" />,
    social: <LuUsers className="w-5 h-5" />,
    default: <LuTarget className="w-5 h-5" />,
};

interface Mission {
    id: string;
    title: string;
    description: string;
    target: number;
    progress?: number;
    is_claimed?: boolean;
    rewardType: 'chips';
    rewardAmount: number;
    category?: 'daily' | 'weekly';
    period?: 'once' | 'day' | 'week';
}

interface MissionPanelProps {
    isOpen: boolean;
    onClose: () => void;
    onSwitchTab?: (tab: NavTab) => void;
}

function getDailyResetString(): string {
    const now = new Date();
    const nextMidnight = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0),
    );
    const diffMs = Math.max(0, nextMidnight.getTime() - now.getTime());
    const totalSecs = Math.floor(diffMs / 1000);
    const hours = Math.floor(totalSecs / 3600);
    const minutes = Math.floor((totalSecs % 3600) / 60);
    const seconds = totalSecs % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function getWeeklyResetString(): string {
    const now = new Date();
    const currentDay = now.getUTCDay();
    const daysUntilNextMonday = currentDay === 0 ? 1 : 8 - currentDay;
    const nextMonday = new Date(
        Date.UTC(
            now.getUTCFullYear(),
            now.getUTCMonth(),
            now.getUTCDate() + daysUntilNextMonday,
            0,
            0,
            0,
            0,
        ),
    );
    const diffMs = Math.max(0, nextMonday.getTime() - now.getTime());
    const totalSecs = Math.floor(diffMs / 1000);
    const days = Math.floor(totalSecs / 86400);
    const hours = Math.floor((totalSecs % 86400) / 3600);
    const minutes = Math.floor((totalSecs % 3600) / 60);
    if (days > 0) return `${days}d ${String(hours).padStart(2, '0')}h`;
    return `${String(hours).padStart(2, '0')}h ${String(minutes).padStart(2, '0')}m`;
}

export default function MissionPanel({ isOpen, onClose, onSwitchTab }: MissionPanelProps) {
    const { address, isGuest } = useCurrentUser();
    const { ensureAppSession } = useAppSession();
    const { guard } = useGuestWall();
    const toast = useToast();

    const [activeMissionTab, setActiveMissionTab] = useState<MissionTab>('daily');
    const [missions, setMissions] = useState<Mission[]>([]);
    const [isLoadingMissions, setIsLoadingMissions] = useState(false);
    const [claimingId, setClaimingId] = useState<string | null>(null);
    const { claim: claimVoucher } = useMissionVoucherClaim();
    const [missionsLocked, setMissionsLocked] = useState(false);
    const [resetTimerStr, setResetTimerStr] = useState<string>('');

    useEffect(() => {
        if (!isOpen || activeMissionTab === 'onboard') {
            setResetTimerStr('');
            return;
        }

        const updateTimer = () => {
            if (activeMissionTab === 'daily') setResetTimerStr(getDailyResetString());
            else if (activeMissionTab === 'weekly') setResetTimerStr(getWeeklyResetString());
            else setResetTimerStr('');
        };

        updateTimer();
        const interval = setInterval(updateTimer, 1000);
        return () => clearInterval(interval);
    }, [isOpen, activeMissionTab]);

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
            const response = await fetch(`/api/missions/list?wallet=${encodeURIComponent(address)}`, {
                headers: { Authorization: `Bearer ${sessionId}`, 'x-session-id': sessionId },
            });
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

    if (!isOpen) return null;

    const handleClaim = async (missionId: string) => {
        if (!address || claimingId) return;
        if (!guard('arena-claim')) return;
        setClaimingId(missionId);
        try {
            if (missionId === 'daily_bonus') {
                const oc = onChain.configured ? onChain.states['daily_bonus'] : undefined;
                if (!oc?.completed) {
                    const sessionId = await ensureAppSession({ context: 'missions' });
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
                    if (!res.ok) throw new Error(data?.error || 'Daily check-in failed');
                    if (data?.alreadyClaimed) {
                        toast('Daily bonus already claimed today.', 'info');
                        await onChain.refresh();
                        await fetchMissions();
                        return;
                    }
                    await onChain.refresh();
                }
            }

            if (isMissionSystemConfigured() || missionClaimAddress()) {
                const tx = await claimVoucher(missionId);
                if (tx) {
                    getSoundEngine().play('mission_complete');
                    window.dispatchEvent(new CustomEvent('ludo-profile-refresh'));
                    window.dispatchEvent(new CustomEvent('ludo-chips-refresh'));
                    await onChain.refresh();
                    await fetchMissions();
                    toast('Reward claimed — CHIPS are in your wallet.', 'success');
                }
                return;
            }
            getSoundEngine().play('ui_error');
            toast('Mission rewards require the CHIPS contract to be configured.', 'error');
        } catch (err) {
            getSoundEngine().play('ui_error');
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
                  activeMissionTab === 'daily' ? m.id.startsWith('daily') : !m.id.startsWith('daily'),
              );

    const isMissionDone = (m: Mission) => {
        const oc = onChain.configured ? onChain.states[m.id] : undefined;
        if (oc) return oc.claimed;
        if (m.id === 'daily_bonus' || m.id.startsWith('daily_bonus')) {
            return Boolean(m.is_claimed);
        }
        const target = typeof m.target === 'number' ? m.target : 1;
        return (m.progress ?? 0) >= target || Boolean(m.is_claimed);
    };
    const dailyLeft = missions.filter((m) => m.id.startsWith('daily') && !isMissionDone(m)).length;
    const weeklyLeft = missions.filter((m) => !m.id.startsWith('daily') && !isMissionDone(m)).length;

    return (
        <GamePanelShell
            scopeClass="ludo-arena-scope ludo-mission-scope"
            kicker="// DIRECTIVES"
            hideOrbs
            onClose={onClose}
            title={
                <span className="flex items-center gap-2">
                    <span className="hud-chamfer-sm w-7 h-7 rounded-xl bg-accent-soft border border-accent/40 flex items-center justify-center text-accent shrink-0">
                        <DirectiveTargetIcon className="w-4 h-4" active />
                    </span>
                    <span>Missions</span>
                </span>
            }
            subtitle={
                <span className="flex items-center gap-2 px-0.5 text-ludo-xs font-mono uppercase tracking-[0.14em]">
                    <span className="font-bold text-accent tabular-nums">
                        {dailyLeft + weeklyLeft} missions left
                    </span>
                    {onChain.configured && (
                        <>
                            <span className="text-ink-faint" aria-hidden="true">·</span>
                            <span className="inline-flex items-center gap-1 font-bold text-ink-muted">
                                <span className="hud-status-breath w-1.5 h-1.5 rounded-full bg-accent" />
                                on-chain
                            </span>
                        </>
                    )}
                </span>
            }
        >
            <PanelChildTabs
                ariaLabel="Mission cadence"
                value={activeMissionTab}
                onPick={setActiveMissionTab}
                options={[
                    {
                        value: 'daily',
                        label: 'daily',
                        pill: <TabCount active={activeMissionTab === 'daily'}>{dailyLeft}</TabCount>,
                    },
                    {
                        value: 'weekly',
                        label: 'weekly',
                        pill: <TabCount active={activeMissionTab === 'weekly'}>{weeklyLeft}</TabCount>,
                    },
                    { value: 'onboard', label: 'onboard' },
                ]}
            />

            {activeMissionTab === 'onboard' ? (
                <OnboardingPanel />
            ) : (
                <div className="flex flex-col gap-2.5 pb-2">
                    <HudSectionLabel
                        right={
                            resetTimerStr ? (
                                <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-surface-recessed border border-line-soft text-ludo-xs font-mono font-bold text-ink-muted tracking-wider shrink-0">
                                    <LuClock className="w-3 h-3 text-accent shrink-0" />
                                    <span className="text-ink-faint uppercase">Resets in</span>
                                    <span className="text-accent font-mono tabular-nums">{resetTimerStr}</span>
                                </div>
                            ) : undefined
                        }
                    >
                        {visibleMissions.length} mission{visibleMissions.length === 1 ? '' : 's'}
                    </HudSectionLabel>

                    {isLoadingMissions && missions.length === 0 ? (
                        <div className="flex items-center justify-center py-16">
                            <div className="w-8 h-8 border-2 border-line-soft border-t-accent rounded-full animate-spin" />
                        </div>
                    ) : missionsLocked ? (
                        <div className="flex flex-col items-center justify-center text-center py-12 px-6 rounded-2xl bg-surface-recessed border border-line-soft">
                            <div className="w-12 h-12 rounded-2xl bg-accent-soft border border-accent/35 flex items-center justify-center mb-3 text-accent">
                                <LuShieldCheck className="w-6 h-6" />
                            </div>
                            <h3 className="text-ink-strong font-extrabold text-ludo-md mb-1">
                                Session Inactive
                            </h3>
                            <p className="text-ink-muted text-ludo-xs max-w-[240px] mb-4">
                                Missions require an active session to track objectives and verify claim vouchers.
                            </p>
                            <Button
                                size="sm"
                                variant="primary"
                                onClick={async () => {
                                    const sid = await ensureAppSession({ context: 'missions', force: true });
                                    if (sid) {
                                        void fetchMissions();
                                    }
                                }}
                                className="uppercase tracking-widest"
                            >
                                Activate Session
                            </Button>
                        </div>
                    ) : visibleMissions.length === 0 ? (
                        <div className="flex flex-col items-center justify-center text-center py-14 px-6 rounded-2xl bg-surface-recessed border border-line-soft">
                            <div className="w-12 h-12 rounded-2xl bg-surface-panel border border-line-soft flex items-center justify-center mb-3 text-ink-faint">
                                <LuShieldCheck className="w-6 h-6" />
                            </div>
                            <h3 className="text-ink-strong font-extrabold text-ludo-md mb-1">
                                {isGuest ? 'Connect wallet to track missions' : 'All Caught Up!'}
                            </h3>
                            <p className="text-ink-faint text-ludo-xs max-w-[220px]">
                                {isGuest
                                    ? 'Connect a wallet to start earning mission rewards.'
                                    : 'Check back later for new missions.'}
                            </p>
                        </div>
                    ) : (
                        <div className="flex flex-col gap-2">
                            {visibleMissions.map((mission) => {
                                const oc = onChain.configured ? onChain.states[mission.id] : undefined;
                                const useOnChain = Boolean(oc);
                                const rawProgress = useOnChain ? oc!.progress : mission.progress || 0;
                                const rawTarget = typeof mission.target === 'number' ? mission.target : 1;
                                const onChainCompleted = useOnChain && oc!.completed;
                                const onChainClaimed = useOnChain && oc!.claimed;
                                const dbClaimed = Boolean(mission.is_claimed);
                                const isClaimed = useOnChain ? onChainClaimed : dbClaimed;
                                const isDailyBonus =
                                    mission.id === 'daily_bonus' || mission.id.startsWith('daily_bonus');
                                const isCompleted = isDailyBonus
                                    ? !isClaimed
                                    : onChainCompleted || rawProgress >= rawTarget || isClaimed;

                                let targetVal: number;
                                let progressVal: number;
                                if (isDailyBonus) {
                                    targetVal = isClaimed ? 1 : 0;
                                    progressVal = isClaimed ? 1 : 0;
                                } else {
                                    targetVal = rawTarget <= 0 ? 1 : rawTarget;
                                    progressVal =
                                        isCompleted || isClaimed
                                            ? Math.max(rawProgress, targetVal)
                                            : rawProgress;
                                }
                                const badge = missionBadgeFor(mission.id);

                                return (
                                    <MissionCard
                                        key={mission.id}
                                        title={mission.title}
                                        description={mission.description}
                                        icon={MISSION_BADGE_ICON[badge.key]}
                                        iconContainerClassName={`${badge.bg} ${badge.color} border-line-soft`}
                                        rewardAmount={mission.rewardAmount}
                                        rewardTone={mission.rewardType === 'chips' ? 'chips' : 'amber'}
                                        rewardIcon={
                                            mission.rewardType === 'chips' ? (
                                                <ChipsHexIcon className="w-3 h-3 text-accent" active />
                                            ) : (
                                                <LuTrophy className="w-3 h-3 text-warn" />
                                            )
                                        }
                                        progress={progressVal}
                                        target={targetVal}
                                        isCompleted={isCompleted}
                                        isClaimed={isClaimed}
                                        isClaiming={claimingId === mission.id}
                                        actionSlot={
                                            <Button
                                                variant={isCompleted && !isClaimed ? 'primary' : 'secondary'}
                                                size="sm"
                                                loading={claimingId === mission.id}
                                                loadingIcon={<ThinkingOrb state="solving" size={20} />}
                                                disabled={isClaimed}
                                                onClick={
                                                    isClaimed
                                                        ? undefined
                                                        : isCompleted
                                                          ? () => void handleClaim(mission.id)
                                                          : () => handleGo(mission.id)
                                                }
                                                className={`min-w-[74px] rounded-xl ${
                                                    isClaimed
                                                        ? 'opacity-60 cursor-not-allowed'
                                                        : isCompleted
                                                          ? 'bg-positive border-positive text-accent-ink hover:brightness-110'
                                                          : ''
                                                }`}
                                            >
                                                {isClaimed ? (
                                                    <span className="inline-flex items-center gap-1 text-ink-muted">
                                                        CLAIMED
                                                        <CheckGlyphIcon className="w-3 h-3 text-positive" />
                                                    </span>
                                                ) : isCompleted ? (
                                                    'CLAIM'
                                                ) : (
                                                    'GO'
                                                )}
                                            </Button>
                                        }
                                    />
                                );
                            })}
                        </div>
                    )}
                </div>
            )}
        </GamePanelShell>
    );
}
