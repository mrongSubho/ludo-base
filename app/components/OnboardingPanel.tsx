"use client";

import React, { useCallback, useEffect, useState } from 'react';
import { useWriteContract } from 'wagmi';
import type { Address, Hex } from 'viem';
import { encodeFunctionData } from 'viem';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { usePlayerSigner } from '@/hooks/usePlayerSigner';
import { useCdpUserOp } from '@/hooks/useCdpUserOp';
import { useAppSession } from '@/hooks/useAppSession';
import { MISSION_CLAIM_ABI } from '@/hooks/useMissionVoucher';
import { ONBOARDING_TRACKS, ONBOARDING_TRACK_KEYS, WELCOME_GRANT_DESC, type OnboardingTrack } from '@/lib/onboardingShared';
import Button from './Button';
import { useMissionOnChainState } from '@/hooks/useMissionOnChainState';
import { ClaimingOverlay } from './ClaimingOverlay';
import { showTxPrompt, updateAuthPromptStatus } from '@/hooks/useAuthPrompt';
import { HudCornerTicks, HudProgressGauge, HudSectionLabel } from './HudPrimitives';
import { CheckGlyphIcon, ChipsHexIcon } from './icons';

interface TrackRow {
    track: string;
    label: string;
    core: boolean;
    progress: number;
    target: number;
    reward: number;
    is_claimed: boolean;
    claimable: boolean;
    voucher_id: string | null;
    desc: string;
}

interface ProgressResponse {
    tracks: TrackRow[];
    welcomeGrant: { reward: number; claimed: boolean };
}

interface ReferralResponse {
    code: string;
    referrer: string | null;
    successful: number;
    unsuccessful: number;
    pending: number;
    slotsUsed: number;
    slotsRemaining: number;
}

interface ClaimResponse {
    success?: boolean;
    pending?: boolean;
    reward?: number;
    missionClaim?: Address;
    voucher?: {
        wallet: Address;
        missionId: Hex;
        amount: string;
        periodId: Hex;
        deadline: string;
        nonce: string;
    };
    signature?: Hex;
    error?: string;
}

const WELCOME_ID = 'welcome_grant';
const WELCOME_REWARD = 50;

export const OnboardingPanel = () => {
    const { address, isGuest } = useCurrentUser();
    const player = usePlayerSigner();
    const cdpUserOp = useCdpUserOp();
    const { ensureAppSession } = useAppSession();
    const { writeContractAsync } = useWriteContract();

    const [tracks, setTracks] = useState<TrackRow[]>([]);
    const catalog: TrackRow[] = React.useMemo(() => {
        const byId = new Map(tracks.map((x) => [x.track, x]));
        return (Object.keys(ONBOARDING_TRACKS) as OnboardingTrack[]).map((key) => {
            const def = ONBOARDING_TRACKS[key];
            const live = byId.get(key);
            return {
                track: key,
                label: def.label,
                core: def.core,
                progress: live?.progress ?? 0,
                target: live?.target && live.target > 0 ? live.target : def.target,
                reward: live?.reward ?? def.reward,
                is_claimed: live?.is_claimed ?? false,
                claimable: live?.claimable ?? false,
                voucher_id: live?.voucher_id ?? null,
                desc: def.desc,
            };
        });
    }, [tracks]);

    const [welcomeClaimed, setWelcomeClaimed] = useState(false);
    const [referral, setReferral] = useState<ReferralResponse | null>(null);
    const [locked, setLocked] = useState(false);
    const [claimingId, setClaimingId] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [referralCodeInput, setReferralCodeInput] = useState('');
    const [bindState, setBindState] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);

    const onChain = useMissionOnChainState(address, ONBOARDING_TRACK_KEYS);

    const load = useCallback(async () => {
        if (!address || isGuest) {
            setLocked(true);
            return;
        }
        setLocked(false);
        try {
            const sessionId = await ensureAppSession();
            if (!sessionId) {
                setLocked(true);
                setTracks([]);
                return;
            }
            const qs = `walletAddress=${encodeURIComponent(address)}&sessionId=${encodeURIComponent(sessionId)}`;
            const [progRes, refRes] = await Promise.all([
                fetch(`/api/onboarding/progress?${qs}`),
                fetch(`/api/onboarding/referral?${qs}`),
            ]);
            const progData: ProgressResponse & { error?: string } = await progRes.json();
            if (!progRes.ok) throw new Error(progData?.error || 'progress failed');
            setTracks(progData.tracks || []);
            setWelcomeClaimed(!!progData.welcomeGrant?.claimed);
            if (refRes.ok) {
                setReferral((await refRes.json()) as ReferralResponse);
            }
        } catch {
            setTracks([]);
        }
    }, [address, isGuest, ensureAppSession]);

    useEffect(() => {
        void load();
    }, [load]);

    const handleClaim = async (id: string) => {
        if (!address || claimingId) return;
        setNotice(null);
        setClaimingId(id);
        try {
            const sessionId = await ensureAppSession();
            if (!sessionId) {
                setNotice('Sign in to claim');
                return;
            }
            const res = await fetch('/api/onboarding/claim', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ walletAddress: address, sessionId, track: id }),
            });
            const data = (await res.json()) as ClaimResponse;
            if (!res.ok) throw new Error(data?.error || 'claim failed');

            if (data.pending) {
                setNotice(id === WELCOME_ID ? 'Welcome grant marked pending' : 'Marked pending');
            } else if (data.voucher && data.signature && data.missionClaim) {
                setNotice('Voucher issued — confirm in wallet');
                let hidePrompt: (() => void) | undefined;
                try {
                    hidePrompt = showTxPrompt({
                        context: 'mission-claim',
                        title: 'CLAIM ONBOARDING REWARD',
                        statusText: 'Please approve the transaction in your wallet to claim your reward on-chain.',
                    });
                    const claimArgs = [
                        data.voucher.wallet,
                        data.voucher.missionId,
                        BigInt(data.voucher.amount),
                        data.voucher.periodId,
                        BigInt(data.voucher.deadline),
                        BigInt(data.voucher.nonce),
                        data.signature,
                    ] as const;

                    if (player.mode === 'ingame' && cdpUserOp.isInGame) {
                        const callData = encodeFunctionData({
                            abi: MISSION_CLAIM_ABI,
                            functionName: 'claim',
                            args: claimArgs,
                        });
                        await cdpUserOp.sendCalls([{ to: data.missionClaim, data: callData }]);
                    } else {
                        await writeContractAsync({
                            address: data.missionClaim,
                            abi: MISSION_CLAIM_ABI,
                            functionName: 'claim',
                            args: claimArgs,
                        });
                    }
                    updateAuthPromptStatus('Reward transaction submitted! Confirming on-chain...', 'Confirming On-Chain');
                    setNotice('Claim submitted on-chain');
                } catch {
                    setNotice('Voucher issued — claim on-chain later');
                } finally {
                    hidePrompt?.();
                }
            } else {
                setNotice(`Claimed +${data.reward ?? 0} CHIPS`);
            }
            await load();
        } catch (e) {
            setNotice(e instanceof Error ? e.message : 'Claim failed');
        } finally {
            setClaimingId(null);
        }
    };

    const bindReferral = async () => {
        if (!address || !referralCodeInput.trim()) return;
        setBindState(null);
        try {
            const sessionId = await ensureAppSession();
            if (!sessionId) {
                setBindState('Sign in first');
                return;
            }
            const res = await fetch('/api/onboarding/referral', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    walletAddress: address,
                    sessionId,
                    code: referralCodeInput.trim(),
                }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data?.error || 'bind failed');
            setBindState('Referral bound');
            setReferralCodeInput('');
            await load();
        } catch (e) {
            setBindState(e instanceof Error ? e.message : 'Bind failed');
        }
    };

    const copyCode = async () => {
        if (!referral?.code) return;
        try {
            await navigator.clipboard.writeText(referral.code);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch {
            /* clipboard unavailable */
        }
    };

    if (isGuest || locked) {
        return (
            <div className="flex flex-col items-center justify-center text-center py-12 px-6 rounded-2xl bg-surface-recessed border border-line-soft">
                <h3 className="text-ink-strong font-extrabold text-ludo-md mb-1 uppercase tracking-wider">
                    {isGuest ? 'Connect wallet for onboarding' : 'Session Inactive'}
                </h3>
                <p className="text-ink-faint text-ludo-xs max-w-[240px] mb-4">
                    {isGuest
                        ? 'Connect a wallet to track onboarding rewards and referrals.'
                        : 'Activate your session to track onboarding rewards and referrals.'}
                </p>
                {!isGuest && (
                    <Button
                        size="sm"
                        variant="primary"
                        onClick={async () => {
                            const sid = await ensureAppSession({ context: 'missions', force: true });
                            if (sid) {
                                void load();
                            }
                        }}
                        className="uppercase tracking-widest"
                    >
                        Activate Session
                    </Button>
                )}
            </div>
        );
    }

    const coreTracks = catalog.filter((x) => x.core);
    const extTracks = catalog.filter((x) => !x.core);
    const coreSum = coreTracks.reduce((s, x) => s + (x.reward || 0), 0);
    const extSum = extTracks.reduce((s, x) => s + (x.reward || 0), 0);

    const TrackIcon = ({ track }: { track: string }) => {
        const dice = (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <path d="M7 7h.01M17 7h.01M12 12h.01M7 17h.01M17 17h.01" />
            </svg>
        );
        const trophy = (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
                <path d="M8 21h8M12 17v4M7 4h10v6a5 5 0 0 1-10 0V4M3 5h4v4A5 5 0 0 1 3 5M21 5h-4v4a5 5 0 0 0 4-4" />
            </svg>
        );
        const flame = (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
                <path d="M17 10C15 8 13.97 3 13.97 3 10 5.25 10 10 10 10c-3-2-2.5-6.5-2.5-6.5C4 6.5 4 11 4 14a8 8 0 0 0 16 0c0-2.5-1.5-4-3-4z" />
            </svg>
        );
        const users = (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
        );
        const clock = (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 6v6l4 2" />
            </svg>
        );
        const calendar = (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
                <rect x="3" y="4" width="18" height="18" rx="2" />
                <path d="M16 2v4M8 2v4M3 10h18" />
            </svg>
        );
        const chat = (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
        );
        const target = (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
                <circle cx="12" cy="12" r="10" />
                <circle cx="12" cy="12" r="6" />
                <circle cx="12" cy="12" r="2" />
            </svg>
        );

        const map: Record<string, { badge: string; icon: React.ReactNode }> = {
            tutorial: { badge: 'bg-accent-soft text-accent border-accent/35', icon: target },
            ai_classic: { badge: 'bg-accent-soft text-accent border-accent/35', icon: dice },
            ai_power: { badge: 'bg-warn/15 text-warn border-warn/35', icon: flame },
            ai_snakes: { badge: 'bg-positive/15 text-positive border-positive/35', icon: dice },
            pvp: { badge: 'bg-negative/15 text-negative border-negative/35', icon: trophy },
            playtime: { badge: 'bg-warn/15 text-warn border-warn/35', icon: clock },
            social: { badge: 'bg-accent-soft text-accent border-accent/35', icon: users },
            day2: { badge: 'bg-positive/15 text-positive border-positive/35', icon: calendar },
            day3: { badge: 'bg-positive/15 text-positive border-positive/35', icon: calendar },
            friend_dm: { badge: 'bg-accent-soft text-accent border-accent/35', icon: chat },
            clan: { badge: 'bg-warn/15 text-warn border-warn/35', icon: users },
        };
        const b = map[track] || { badge: 'bg-surface-panel text-ink-strong border-line-soft', icon: dice };
        return (
            <div className={`w-11 h-11 flex items-center justify-center rounded-xl shrink-0 border ${b.badge}`}>
                {b.icon}
            </div>
        );
    };

    const TrackCard = (x: TrackRow) => {
        const oc = onChain.configured ? onChain.states[x.track] : undefined;
        const useOnChain = Boolean(oc);
        const rawProgress = useOnChain ? oc!.progress : (x.progress || 0);
        const rawTarget = typeof x.target === 'number' ? x.target : 1;
        const targetVal = rawTarget <= 0 ? 1 : rawTarget;
        const isCompleted = useOnChain ? oc!.completed : rawProgress >= rawTarget;
        const isClaimed = useOnChain ? oc!.claimed : x.is_claimed;
        const claimable = !isClaimed && (isCompleted || x.claimable);
        const progressVal = (isCompleted || isClaimed) ? Math.max(rawProgress, targetVal) : rawProgress;
        const progressPercent = Math.min((progressVal / Math.max(targetVal, 1)) * 100, 100);

        return (
            <div
                key={x.track}
                className="card-3077 flex flex-col gap-2.5 bg-surface-recessed border border-line-soft p-3.5 rounded-2xl hover:bg-surface-hover hover:border-line-strong transition-colors relative overflow-hidden"
            >
                <HudCornerTicks />
                <ClaimingOverlay isClaiming={claimingId === x.track} />
                {isCompleted && !isClaimed && (
                    <div className="absolute inset-0 bg-positive/10 opacity-40 pointer-events-none" />
                )}

                <div className="flex items-start gap-3 relative z-[1]">
                    <TrackIcon track={x.track} />
                    <div className="flex flex-col flex-1 min-w-0 pt-0.5">
                        <div className="flex items-start justify-between gap-2">
                            <h3
                                className={`font-bold text-ludo-md truncate ${
                                    isCompleted ? 'text-positive' : 'text-ink-strong'
                                }`}
                            >
                                {x.label}
                            </h3>
                            <div className="flex items-center gap-1.5 bg-surface-panel px-2.5 py-1 rounded-lg border border-line-soft shrink-0">
                                <ChipsHexIcon className="w-3 h-3 text-accent" active />
                                <span className="text-ludo-xs font-extrabold font-mono leading-none text-accent tabular-nums">
                                    {x.reward}
                                </span>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="flex flex-col gap-2 relative z-[1]">
                    <p className="text-ludo-xs font-medium text-ink-muted leading-snug">{x.desc}</p>
                    <div className="flex items-center gap-3">
                        <div className="flex-1 min-w-0">
                            <div className="flex items-end justify-between mb-1 px-0.5">
                                <span className="text-ludo-xs uppercase font-bold font-mono text-ink-faint tracking-wider">
                                    Progress
                                </span>
                                <span
                                    className={`text-ludo-xs font-extrabold font-mono tabular-nums ${
                                        isCompleted ? 'text-positive' : 'text-ink-strong'
                                    }`}
                                >
                                    {progressVal}{' '}
                                    <span className="text-ink-faint">/ {targetVal}</span>
                                </span>
                            </div>
                            <HudProgressGauge
                                percent={progressPercent}
                                tone={isClaimed ? 'muted' : isCompleted ? 'positive' : 'accent'}
                            />
                        </div>

                        <Button
                            variant={claimable ? 'primary' : 'secondary'}
                            size="sm"
                            loading={claimingId === x.track}
                            disabled={isClaimed || !claimable}
                            onClick={claimable ? () => void handleClaim(x.track) : undefined}
                            className={`min-w-[74px] rounded-xl shrink-0 ${
                                isClaimed
                                    ? 'opacity-60 cursor-not-allowed'
                                    : claimable
                                      ? 'bg-positive text-accent-ink border-positive hover:brightness-110'
                                      : ''
                            }`}
                        >
                            {isClaimed ? (
                                <span className="inline-flex items-center gap-1 text-ink-muted">
                                    CLAIMED
                                    <CheckGlyphIcon className="w-3 h-3 text-positive" />
                                </span>
                            ) : claimable ? (
                                'CLAIM'
                            ) : (
                                'GO'
                            )}
                        </Button>
                    </div>
                </div>
            </div>
        );
    };

    return (
        <div className="flex flex-col gap-2.5 pb-2">
            {onChain.configured && (
                <div className="flex items-center gap-1.5 text-ludo-xs font-mono font-bold text-accent uppercase tracking-wider">
                    <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
                    on-chain verified
                </div>
            )}

            {/* Welcome Grant */}
            <div className="card-3077 flex flex-col gap-2.5 bg-surface-recessed border border-line-soft p-3.5 rounded-2xl hover:bg-surface-hover hover:border-line-strong transition-colors relative overflow-hidden">
                <HudCornerTicks />
                <ClaimingOverlay isClaiming={claimingId === WELCOME_ID} />
                {welcomeClaimed && (
                    <div className="absolute inset-0 bg-positive/10 opacity-35 pointer-events-none" />
                )}
                <div className="flex items-start gap-3 relative z-[1]">
                    <div className="w-11 h-11 flex items-center justify-center rounded-xl shrink-0 bg-accent-soft text-accent border border-accent/35">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="w-5 h-5">
                            <path d="M20 12v10H4V12" />
                            <path d="M2 7h20v5H2z" />
                            <path d="M12 22V7" />
                            <path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z" />
                            <path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z" />
                        </svg>
                    </div>
                    <div className="flex flex-col flex-1 min-w-0 pt-0.5">
                        <div className="flex items-start justify-between gap-2">
                            <h3
                                className={`font-bold text-ludo-md truncate ${
                                    welcomeClaimed ? 'text-positive' : 'text-ink-strong'
                                }`}
                            >
                                Welcome grant
                            </h3>
                            <div className="flex items-center gap-1.5 bg-surface-panel px-2.5 py-1 rounded-lg border border-line-soft shrink-0">
                                <ChipsHexIcon className="w-3 h-3 text-accent" active />
                                <span className="text-ludo-xs font-extrabold font-mono leading-none text-accent tabular-nums">
                                    {WELCOME_REWARD}
                                </span>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="flex flex-col gap-2 relative z-[1]">
                    <p className="text-ludo-xs font-medium text-ink-muted leading-snug">
                        {WELCOME_GRANT_DESC}
                    </p>
                    <div className="flex items-center gap-3">
                        <div className="flex-1 min-w-0">
                            <div className="flex items-end justify-between mb-1 px-0.5">
                                <span className="text-ludo-xs uppercase font-bold font-mono text-ink-faint tracking-wider">
                                    Progress
                                </span>
                                <span
                                    className={`text-ludo-xs font-extrabold font-mono tabular-nums ${
                                        welcomeClaimed ? 'text-positive' : 'text-ink-strong'
                                    }`}
                                >
                                    {welcomeClaimed ? 1 : 0}{' '}
                                    <span className="text-ink-faint">/ 1</span>
                                </span>
                            </div>
                            <HudProgressGauge
                                percent={welcomeClaimed ? 100 : 0}
                                tone={welcomeClaimed ? 'positive' : 'accent'}
                            />
                        </div>

                        <Button
                            variant={welcomeClaimed ? 'secondary' : 'primary'}
                            size="sm"
                            loading={claimingId === WELCOME_ID}
                            disabled={welcomeClaimed}
                            onClick={() => void handleClaim(WELCOME_ID)}
                            className={`min-w-[74px] rounded-xl shrink-0 ${
                                welcomeClaimed
                                    ? 'opacity-60 cursor-not-allowed'
                                    : 'bg-positive text-accent-ink border-positive hover:brightness-110'
                            }`}
                        >
                            {welcomeClaimed ? (
                                <span className="inline-flex items-center gap-1 text-ink-muted">
                                    CLAIMED
                                    <CheckGlyphIcon className="w-3 h-3 text-positive" />
                                </span>
                            ) : (
                                'CLAIM'
                            )}
                        </Button>
                    </div>
                </div>
            </div>

            <HudSectionLabel
                right={
                    <span className="text-ludo-xs font-mono font-bold text-accent tabular-nums">
                        {coreSum || 1000} CHIPS
                    </span>
                }
            >
                Core package
            </HudSectionLabel>
            <p className="text-ludo-xs text-ink-faint -mt-1">
                Finish core missions to unlock extended rewards.
            </p>
            <div className="flex flex-col gap-2">{coreTracks.map(TrackCard)}</div>

            <div className="mt-2 flex flex-col gap-1.5">
                <HudSectionLabel
                    right={
                        <span className="text-ludo-xs font-mono font-bold text-ink-muted tabular-nums">
                            {extSum} CHIPS
                        </span>
                    }
                >
                    Extended missions
                </HudSectionLabel>
                <p className="text-ludo-xs text-ink-faint -mt-0.5">
                    Unlocks after the core package is claimed.
                </p>
                <div className="flex flex-col gap-2">{extTracks.map(TrackCard)}</div>
            </div>

            {notice && (
                <div className="text-ludo-sm font-mono font-bold text-accent text-center pt-1">
                    {notice}
                </div>
            )}

            {/* Invite & Referrals */}
            <div className="mt-2 flex flex-col gap-2">
                <HudSectionLabel
                    right={
                        referral ? (
                            <span className="text-ludo-xs font-mono font-bold text-ink-muted tabular-nums">
                                {referral.successful} ok / {referral.unsuccessful} dead / {referral.slotsRemaining} slots
                            </span>
                        ) : undefined
                    }
                >
                    Invite
                </HudSectionLabel>
                <div className="bg-surface-recessed border border-line-soft p-3.5 rounded-2xl flex flex-col gap-2.5">
                    <p className="text-ludo-xs font-medium text-ink-muted leading-snug">
                        Share your code. Early referees earn 50 CHIPS, then 10 after top slots fill.
                    </p>
                    <div className="flex items-center gap-2">
                        <div
                            onClick={() => void copyCode()}
                            className="flex-1 px-3 py-2 rounded-xl bg-surface-panel border border-accent/35 font-mono text-accent text-ludo-md cursor-pointer select-all truncate"
                        >
                            {referral?.code || '—'}
                        </div>
                        <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => void copyCode()}
                            className="uppercase tracking-[0.16em]"
                        >
                            {copied ? 'Copied' : 'Copy'}
                        </Button>
                    </div>
                    {referral?.referrer ? (
                        <div className="text-ludo-xs text-ink-faint font-mono">
                            Referred by {referral.referrer.slice(0, 10)}…
                        </div>
                    ) : (
                        <div className="flex items-center gap-2">
                            <input
                                value={referralCodeInput}
                                onChange={(e) => setReferralCodeInput(e.target.value)}
                                placeholder="REFERRAL CODE"
                                maxLength={32}
                                autoComplete="off"
                                autoCorrect="off"
                                autoCapitalize="none"
                                spellCheck={false}
                                className="flex-1 px-3 py-2 rounded-xl bg-surface-panel border border-line-soft text-ink-strong text-ludo-sm font-mono uppercase tracking-wider placeholder:text-ink-faint focus:outline-none focus:border-accent"
                            />
                            <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => void bindReferral()}
                                disabled={!referralCodeInput.trim()}
                                className="uppercase tracking-[0.16em]"
                            >
                                Bind
                            </Button>
                        </div>
                    )}
                    {bindState && <div className="text-ludo-xs font-mono text-accent">{bindState}</div>}
                </div>
            </div>
        </div>
    );
};

export default OnboardingPanel;
