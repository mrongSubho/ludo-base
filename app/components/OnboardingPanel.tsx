"use client";

import React, { useCallback, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useWriteContract } from 'wagmi';
import type { Address, Hex } from 'viem';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useAppSession } from '@/hooks/useAppSession';
import { MISSION_CLAIM_ABI } from '@/hooks/useMissionVoucher';
import { ONBOARDING_TRACKS, ONBOARDING_TRACK_KEYS, WELCOME_GRANT_DESC, type OnboardingTrack } from '@/lib/onboardingShared';
import Button from './Button';
import { useMissionOnChainState } from '@/hooks/useMissionOnChainState';

// ─── OnboardingPanel ─────────────────────────────────────────────────────────
// CHIPS onboarding tracks (planning 7.7): progress, claim CTA, referral code.
// Content block — mounts inside Arena missions or standalone. Terminal-glass
// vocabulary (white-ink + cyan). No emoji.

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
    const { ensureAppSession } = useAppSession();
    const { writeContractAsync } = useWriteContract();

    const [tracks, setTracks] = useState<TrackRow[]>([]);
    /** Full catalog always visible (locked until progress exists). */
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

    // On-chain overlay: onboarding missions live on MissionSystem (pays CHIPS on
    // completion). When configured + read, its completion is authoritative and the
    // reward is already paid, so we show "Received" and suppress the legacy voucher
    // claim (avoids a double payout). Otherwise the DB/voucher path is unchanged.
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
                try {
                    await writeContractAsync({
                        address: data.missionClaim,
                        abi: MISSION_CLAIM_ABI,
                        functionName: 'claim',
                        args: [
                            data.voucher.wallet,
                            data.voucher.missionId,
                            BigInt(data.voucher.amount),
                            data.voucher.periodId,
                            BigInt(data.voucher.deadline),
                            BigInt(data.voucher.nonce),
                            data.signature,
                        ],
                    });
                    setNotice('Claim submitted on-chain');
                } catch {
                    setNotice('Voucher issued — claim on-chain later');
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
            <div className="flex flex-col items-center justify-center text-center py-12 px-6">
                <h3 className="text-white font-black text-sm mb-1 uppercase tracking-wider">
                    {isGuest ? 'Connect wallet for onboarding' : 'Session Inactive'}
                </h3>
                <p className="text-white/40 text-xs max-w-[240px] mb-4">
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
                        className="uppercase tracking-widest text-xs px-5 py-2 font-black"
                    >
                        Activate Session
                    </Button>
                )}
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-2 pb-2">
            {/* Mission-quality section labels + cards (match MissionPanel) */}
            {(() => {
                const coreTracks = catalog.filter((x) => x.core);
                const extTracks = catalog.filter((x) => !x.core);
                const coreSum = coreTracks.reduce((s, x) => s + (x.reward || 0), 0);
                const extSum = extTracks.reduce((s, x) => s + (x.reward || 0), 0);

                const SectionLabel = ({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) => (
                    <div className="flex items-center gap-2.5 mb-2">
                        <span className="px-2 py-0.5 rounded-md bg-white/[0.07] border border-white/10 text-ludo-xs font-black tracking-[0.18em] text-white/60 font-mono uppercase">
                            {children}
                        </span>
                        <div className="flex-1 h-px bg-gradient-to-r from-white/15 to-transparent" />
                        {right}
                    </div>
                );

                const TrackIcon = ({ track }: { track: string }) => {
                    // Same SVG language as MissionPanel getTypeBadge (24-view, stroke icons).
                    const dice = (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-[22px] h-[22px]">
                            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                            <path d="M7 7h.01M17 7h.01M12 12h.01M7 17h.01M17 17h.01" />
                        </svg>
                    );
                    const trophy = (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-[22px] h-[22px]">
                            <path d="M8 21h8M12 17v4M7 4h10v6a5 5 0 0 1-10 0V4M3 5h4v4A5 5 0 0 1 3 5M21 5h-4v4a5 5 0 0 0 4-4" />
                        </svg>
                    );
                    const flame = (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-[22px] h-[22px]">
                            <path d="M17 10C15 8 13.97 3 13.97 3 10 5.25 10 10 10 10c-3-2-2.5-6.5-2.5-6.5C4 6.5 4 11 4 14a8 8 0 0 0 16 0c0-2.5-1.5-4-3-4z" />
                        </svg>
                    );
                    const users = (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-[22px] h-[22px]">
                            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                            <circle cx="9" cy="7" r="4" />
                            <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
                        </svg>
                    );
                    const clock = (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-[22px] h-[22px]">
                            <circle cx="12" cy="12" r="10" />
                            <path d="M12 6v6l4 2" />
                        </svg>
                    );
                    const calendar = (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-[22px] h-[22px]">
                            <rect x="3" y="4" width="18" height="18" rx="2" />
                            <path d="M16 2v4M8 2v4M3 10h18" />
                        </svg>
                    );
                    const chat = (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-[22px] h-[22px]">
                            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                        </svg>
                    );
                    const target = (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-[22px] h-[22px]">
                            <circle cx="12" cy="12" r="10" />
                            <circle cx="12" cy="12" r="6" />
                            <circle cx="12" cy="12" r="2" />
                        </svg>
                    );

                    const map: Record<string, { bg: string; color: string; icon: React.ReactNode }> = {
                        tutorial: { bg: 'bg-cyan-500/15', color: 'text-cyan-300', icon: target },
                        ai_classic: { bg: 'bg-indigo-500/15', color: 'text-indigo-300', icon: dice },
                        ai_power: { bg: 'bg-violet-500/15', color: 'text-violet-300', icon: flame },
                        ai_snakes: { bg: 'bg-emerald-500/15', color: 'text-emerald-300', icon: dice },
                        pvp: { bg: 'bg-rose-500/15', color: 'text-rose-300', icon: trophy },
                        playtime: { bg: 'bg-amber-500/15', color: 'text-amber-300', icon: clock },
                        social: { bg: 'bg-sky-500/15', color: 'text-sky-300', icon: users },
                        day2: { bg: 'bg-teal-500/15', color: 'text-teal-300', icon: calendar },
                        day3: { bg: 'bg-teal-500/15', color: 'text-teal-300', icon: calendar },
                        friend_dm: { bg: 'bg-fuchsia-500/15', color: 'text-fuchsia-300', icon: chat },
                        clan: { bg: 'bg-orange-500/15', color: 'text-orange-300', icon: users },
                    };
                    const b = map[track] || { bg: 'bg-white/10', color: 'text-white', icon: dice };
                    return (
                        <div className={`w-12 h-12 flex items-center justify-center rounded-2xl flex-shrink-0 ${b.bg} ${b.color} shadow-inner border border-white/5`}>
                            {b.icon}
                        </div>
                    );
                };

                const TrackCard = (x: TrackRow) => {
                    // On-chain overlay (MissionSystem is the payout authority for onboarding):
                    const oc = onChain.configured ? onChain.states[x.track] : undefined;
                    const useOnChain = Boolean(oc);
                    const progressVal = useOnChain ? oc!.progress : (x.progress || 0);
                    // Nullish, not `||`: a target of 0 is valid and must survive.
                    const targetVal = typeof x.target === 'number' ? x.target : 1;
                    const isCompleted = useOnChain ? oc!.completed : progressVal >= targetVal;
                    const isClaimed = useOnChain ? oc!.claimed : x.is_claimed;
                    const claimable = !isClaimed && (isCompleted || x.claimable);
                    const progressPercent = Math.min((progressVal / Math.max(targetVal, 1)) * 100, 100);
                    return (
                        <motion.div
                            layout
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            key={x.track}
                            className="flex flex-col gap-3 bg-white/[0.04] border border-white/10 p-4 rounded-2xl hover:bg-white/[0.07] hover:border-white/25 transition-colors relative overflow-hidden"
                        >
                            {isCompleted && (
                                <div className="absolute inset-0 bg-green-500/5 opacity-50 blur-xl pointer-events-none" />
                            )}
                            <div className="flex items-start gap-4">
                                <TrackIcon track={x.track} />
                                <div className="flex flex-col flex-1 min-w-0 pt-0.5">
                                    <div className="flex items-start justify-between gap-2">
                                        <h3 className={`font-bold text-ludo-lg truncate ${isCompleted ? 'text-green-300' : 'text-white'}`}>
                                            {x.label}
                                        </h3>
                                        <div className="flex items-center gap-1.5 bg-black/40 px-2.5 py-1.5 rounded-lg border border-white/5 flex-shrink-0">
                                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3 text-cyan-400">
                                                <path d="M6 3h12l4 6-10 13L2 9z" />
                                                <path d="M11 3 8 9l4 13 4-13-3-6" />
                                            </svg>
                                            <span className="text-ludo-sm font-black leading-none text-cyan-400">{x.reward}</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            {/* Task details, directly above the progress bar. Always rendered
                                as a single line — every task carries it, and no progress value
                                can change the card's height. */}
                            <div className="flex flex-col gap-2">
                                <p className="text-ludo-sm font-medium text-white/60 leading-snug">
                                    {x.desc}
                                </p>
                                <div className="flex items-center gap-4">
                                    <div className="flex-1">
                                        <div className="flex items-end justify-between mb-1.5 px-0.5">
                                            <span className="text-ludo-xs uppercase font-bold text-white/40 tracking-wider">Progress</span>
                                            <span className={`text-xs font-black tabular-nums ${isCompleted ? 'text-green-400' : 'text-white'}`}>
                                                {progressVal} <span className="text-white/30 text-ludo-xs">/ {targetVal}</span>
                                            </span>
                                        </div>
                                        <div className="w-full h-2 bg-black/40 rounded-full overflow-hidden border border-white/5">
                                            <div
                                                className={`h-full rounded-full transition-all duration-1000 ease-out ${isClaimed ? 'bg-white/20' : isCompleted ? 'bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.5)]' : 'bg-cyan-600'}`}
                                                style={{ width: `${progressPercent}%` }}
                                            />
                                        </div>
                                    </div>
                                <Button
                                    variant="secondary"
                                    size="sm"
                                    loading={claimingId === x.track}
                                    disabled={isClaimed || !claimable}
                                    onClick={claimable ? () => handleClaim(x.track) : undefined}
                                    className={`min-w-[70px] rounded-xl ${isClaimed ? '' : claimable ? 'bg-positive/80 border-positive text-white hover:bg-positive shadow-[0_0_15px_color-mix(in_srgb,var(--positive)_30%,transparent)]' : ''}`}
                                >
                                    {isClaimed ? (
                                        'Claimed'
                                    ) : claimable ? (
                                        <span className="flex items-center gap-1">
                                            CLAIM
                                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="icon-sm">
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
                };

                return (
                    <>
                        {onChain.configured && (
                            <div className="flex items-center gap-1.5 pb-1 text-ludo-xs font-black text-cyan-400/80 uppercase tracking-wider">
                                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                                on-chain
                            </div>
                        )}
                        {/* Welcome — same card language as the tracks below: icon row
                            (title + gem reward chip + the details line every task
                            carries) over the progress/action row, so the claim button
                            sits exactly where the GO/CLAIM buttons do. */}
                        <motion.div
                            layout
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            className="flex flex-col gap-3 bg-white/[0.04] border border-white/10 p-4 rounded-2xl hover:bg-white/[0.07] hover:border-white/25 transition-colors relative overflow-hidden"
                        >
                            {welcomeClaimed && (
                                <div className="absolute inset-0 bg-green-500/5 opacity-50 blur-xl pointer-events-none" />
                            )}
                            <div className="flex items-start gap-4">
                                <div className="w-12 h-12 flex items-center justify-center rounded-2xl flex-shrink-0 bg-cyan-500/15 text-cyan-300 shadow-inner border border-white/5">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="w-[22px] h-[22px]">
                                        <path d="M20 12v10H4V12" /><path d="M2 7h20v5H2z" /><path d="M12 22V7" /><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z" /><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z" />
                                    </svg>
                                </div>
                                <div className="flex flex-col flex-1 min-w-0 pt-0.5">
                                    <div className="flex items-start justify-between gap-2">
                                        <h3 className={`font-bold text-ludo-lg truncate ${welcomeClaimed ? 'text-green-300' : 'text-white'}`}>
                                            Welcome grant
                                        </h3>
                                        <div className="flex items-center gap-1.5 bg-black/40 px-2.5 py-1.5 rounded-lg border border-white/5 flex-shrink-0">
                                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3 text-cyan-400">
                                                <path d="M6 3h12l4 6-10 13L2 9z" />
                                                <path d="M11 3 8 9l4 13 4-13-3-6" />
                                            </svg>
                                            <span className="text-ludo-sm font-black leading-none text-cyan-400">{WELCOME_REWARD}</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            {/* Task details, directly above the progress bar — same line,
                                same placement, as every track card in this list. */}
                            <div className="flex flex-col gap-2">
                                <p className="text-ludo-sm font-medium text-white/60 leading-snug">
                                    {WELCOME_GRANT_DESC}
                                </p>
                                <div className="flex items-center gap-4">
                                    <div className="flex-1">
                                        <div className="flex items-end justify-between mb-1.5 px-0.5">
                                            <span className="text-ludo-xs uppercase font-bold text-white/40 tracking-wider">Progress</span>
                                            <span className={`text-xs font-black tabular-nums ${welcomeClaimed ? 'text-green-400' : 'text-white'}`}>
                                                {welcomeClaimed ? 1 : 0} <span className="text-white/30 text-ludo-xs">/ 1</span>
                                            </span>
                                        </div>
                                        <div className="w-full h-2 bg-black/40 rounded-full overflow-hidden border border-white/5">
                                            <div
                                                className={`h-full rounded-full transition-all duration-1000 ease-out ${welcomeClaimed ? 'bg-white/20' : 'bg-cyan-600'}`}
                                                style={{ width: `${welcomeClaimed ? 100 : 0}%` }}
                                            />
                                        </div>
                                    </div>
                                <Button
                                    variant="secondary"
                                    size="sm"
                                    loading={claimingId === WELCOME_ID}
                                    disabled={welcomeClaimed}
                                    onClick={() => handleClaim(WELCOME_ID)}
                                    className={`min-w-[70px] rounded-xl ${welcomeClaimed ? '' : 'bg-positive/80 border-positive text-white hover:bg-positive shadow-[0_0_15px_color-mix(in_srgb,var(--positive)_30%,transparent)]'}`}
                                >
                                    {welcomeClaimed ? (
                                        'Claimed'
                                    ) : (
                                        <span className="flex items-center gap-1">
                                            CLAIM
                                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="icon-sm">
                                                <polyline points="20 6 9 17 4 12" />
                                            </svg>
                                        </span>
                                    )}
                                </Button>
                                </div>
                            </div>
                        </motion.div>

                        <SectionLabel right={<span className="text-ludo-xs font-black text-cyan-300 tabular-nums">{coreSum || 1000} CHIPS</span>}>
                            Core package
                        </SectionLabel>
                        <p className="text-ludo-sm text-white/45 mb-2 -mt-1">Finish core missions to unlock extended rewards.</p>
                        <div className="flex flex-col gap-2">
                            <AnimatePresence mode="popLayout">{coreTracks.map(TrackCard)}</AnimatePresence>
                        </div>

                        <div className="mt-3">
                            <SectionLabel right={<span className="text-ludo-xs font-black text-white/50 tabular-nums">{extSum} CHIPS</span>}>
                                Extended missions
                            </SectionLabel>
                            <p className="text-ludo-sm text-white/45 mb-2 -mt-1">Unlocks after the core package is claimed.</p>
                            <div className="flex flex-col gap-2">
                                <AnimatePresence mode="popLayout">{extTracks.map(TrackCard)}</AnimatePresence>
                            </div>
                        </div>

                        {notice && <div className="text-ludo-sm text-cyan-300/90 text-center pt-2">{notice}</div>}

                        {/* Invite — last, same card shell */}
                        <div className="mt-4">
                            <SectionLabel right={referral ? (
                                <span className="text-ludo-xs font-black text-white/50 tabular-nums">
                                    {referral.successful} ok / {referral.unsuccessful} dead / {referral.slotsRemaining} slots
                                </span>
                            ) : undefined}>
                                Invite
                            </SectionLabel>
                            <div className="bg-white/[0.04] border border-white/10 p-4 rounded-2xl flex flex-col gap-3">
                                <p className="text-ludo-sm font-medium text-white/60 leading-snug">
                                    Share your code. Early referees earn 50 CHIPS, then 10 after top slots fill.
                                </p>
                                <div className="flex items-center gap-2">
                                    <div
                                        onClick={copyCode}
                                        className="flex-1 px-3 py-2.5 rounded-xl bg-black/40 border border-cyan-400/30 font-mono text-cyan-300 text-sm cursor-pointer select-all"
                                    >
                                        {referral?.code || '—'}
                                    </div>
                                    <button
                                        onClick={copyCode}
                                        className="px-3 py-2.5 rounded-xl bg-white/10 text-white text-ludo-sm font-black uppercase tracking-[0.18em] hover:bg-white/20 transition-all border border-white/10"
                                    >
                                        {copied ? 'Copied' : 'Copy'}
                                    </button>
                                </div>
                                {referral?.referrer ? (
                                    <div className="text-ludo-xs text-white/40 font-mono">Referred by {referral.referrer.slice(0, 10)}…</div>
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
                                            className="flex-1 px-3 py-2.5 rounded-xl bg-black/40 border border-white/10 text-white text-ludo-sm font-mono uppercase tracking-wider placeholder:text-white/25 focus:outline-none focus:border-cyan-400/50"
                                        />
                                        <button
                                            onClick={bindReferral}
                                            disabled={!referralCodeInput.trim()}
                                            className="px-3 py-2.5 rounded-xl bg-white/10 text-white text-ludo-sm font-black uppercase tracking-[0.18em] hover:bg-white/20 transition-all border border-white/10 disabled:opacity-40"
                                        >
                                            Bind
                                        </button>
                                    </div>
                                )}
                                {bindState && <div className="text-ludo-xs text-cyan-300/80">{bindState}</div>}
                            </div>
                        </div>
                    </>
                );
            })()}
        </div>
    );
};

export default OnboardingPanel;
