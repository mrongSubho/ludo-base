"use client";

import React, { useCallback, useEffect, useState } from 'react';
import { useWriteContract } from 'wagmi';
import type { Address, Hex } from 'viem';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useAppSession } from '@/hooks/useAppSession';
import { MISSION_CLAIM_ABI } from '@/hooks/useMissionVoucher';

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

export const OnboardingPanel = () => {
    const { address, isGuest } = useCurrentUser();
    const { ensureAppSession } = useAppSession();
    const { writeContractAsync } = useWriteContract();

    const [tracks, setTracks] = useState<TrackRow[]>([]);
    const [welcomeClaimed, setWelcomeClaimed] = useState(false);
    const [referral, setReferral] = useState<ReferralResponse | null>(null);
    const [loading, setLoading] = useState(false);
    const [locked, setLocked] = useState(false);
    const [claimingId, setClaimingId] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [referralCodeInput, setReferralCodeInput] = useState('');
    const [bindState, setBindState] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);

    const load = useCallback(async () => {
        if (!address || isGuest) {
            setLocked(true);
            return;
        }
        setLoading(true);
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
        } finally {
            setLoading(false);
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
                <h3 className="text-white font-black text-sm mb-1 uppercase tracking-wider">Sign in for onboarding</h3>
                <p className="text-white/40 text-xs max-w-[220px]">
                    Connect a wallet to track onboarding rewards and referrals.
                </p>
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-2 pb-2">
            {/* Welcome grant */}
            <div className="flex items-center gap-3 bg-white/[0.04] border border-white/10 p-3 rounded-2xl">
                <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-bold text-white uppercase tracking-wide">Welcome grant</div>
                    <div className="text-[11px] text-white/50 mt-0.5">One-time 50 CHIPS on first wallet link</div>
                </div>
                {welcomeClaimed ? (
                    <span className="text-[10px] font-black uppercase tracking-[0.18em] text-cyan-300 px-2 py-1 rounded-md bg-cyan-500/10 border border-cyan-400/30">
                        Claimed
                    </span>
                ) : (
                    <button
                        onClick={() => handleClaim(WELCOME_ID)}
                        disabled={claimingId !== null}
                        className="px-3 py-2 rounded-xl bg-cyan-400 text-black text-[11px] font-black uppercase tracking-[0.18em] hover:bg-cyan-300 active:scale-[0.98] transition-all disabled:opacity-50"
                    >
                        {claimingId === WELCOME_ID ? '...' : 'Claim'}
                    </button>
                )}
            </div>

            {/* Referral */}
            <div className="bg-white/[0.04] border border-white/10 p-3 rounded-2xl flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                    <div className="text-[10px] font-black uppercase tracking-[0.22em] text-white/50">Referral</div>
                    {referral && (
                        <div className="text-[10px] font-black text-white/50 tabular-nums uppercase tracking-wide">
                            {referral.successful} ok / {referral.unsuccessful} dead / {referral.slotsRemaining} slots
                        </div>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    <div
                        onClick={copyCode}
                        className="flex-1 px-3 py-2 rounded-xl bg-black/40 border border-cyan-400/30 font-mono text-cyan-300 text-sm cursor-pointer select-all"
                    >
                        {referral?.code || '—'}
                    </div>
                    <button
                        onClick={copyCode}
                        className="px-3 py-2 rounded-xl bg-white/10 text-white text-[11px] font-black uppercase tracking-[0.18em] hover:bg-white/20 transition-all"
                    >
                        {copied ? 'Copied' : 'Copy'}
                    </button>
                </div>
                {referral?.referrer ? (
                    <div className="text-[10px] text-white/40 font-mono">Referred by {referral.referrer.slice(0, 10)}…</div>
                ) : (
                    <div className="flex items-center gap-2">
                        <input
                            value={referralCodeInput}
                            onChange={(e) => setReferralCodeInput(e.target.value)}
                            placeholder="REFERRAL CODE"
                            className="flex-1 px-3 py-2 rounded-xl bg-black/40 border border-white/10 text-white text-[11px] font-mono uppercase tracking-wider placeholder:text-white/25 focus:outline-none focus:border-cyan-400/50"
                        />
                        <button
                            onClick={bindReferral}
                            disabled={!referralCodeInput.trim()}
                            className="px-3 py-2 rounded-xl bg-white/10 text-white text-[11px] font-black uppercase tracking-[0.18em] hover:bg-white/20 transition-all disabled:opacity-40"
                        >
                            Bind
                        </button>
                    </div>
                )}
                {bindState && <div className="text-[10px] text-cyan-300/80">{bindState}</div>}
            </div>

            {/* Tracks */}
            <div className="text-[10px] font-black uppercase tracking-[0.22em] text-white/50 mt-1">Onboarding tracks</div>
            {loading && tracks.length === 0 ? (
                <div className="flex items-center justify-center py-10">
                    <div className="w-8 h-8 border-2 border-cyan-400/30 border-t-cyan-400 rounded-full animate-spin" />
                </div>
            ) : tracks.length === 0 ? (
                <div className="text-white/40 text-xs text-center py-8">No tracks yet — play a match to begin.</div>
            ) : (
                tracks.map((t) => {
                    const pct = Math.min(((t.progress || 0) / Math.max(t.target, 1)) * 100, 100);
                    return (
                        <div
                            key={t.track}
                            className="flex flex-col gap-2 bg-white/[0.04] border border-white/10 p-3 rounded-2xl"
                        >
                            <div className="flex items-center gap-3">
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                        <span className={`text-[13px] font-bold truncate ${t.is_claimed ? 'text-cyan-300' : 'text-white'}`}>
                                            {t.label}
                                        </span>
                                        {!t.core && (
                                            <span className="text-[9px] font-black uppercase tracking-[0.16em] text-white/40 border border-white/10 rounded px-1.5 py-0.5">
                                                Extended
                                            </span>
                                        )}
                                    </div>
                                    <div className="text-[10px] text-white/45 mt-0.5 tabular-nums">
                                        {t.progress}/{t.target} · {t.reward} CHIPS
                                    </div>
                                </div>
                                {t.is_claimed ? (
                                    <span className="text-[10px] font-black uppercase tracking-[0.18em] text-cyan-300 px-2 py-1 rounded-md bg-cyan-500/10 border border-cyan-400/30">
                                        Claimed
                                    </span>
                                ) : (
                                    <button
                                        onClick={() => handleClaim(t.track)}
                                        disabled={!t.claimable || claimingId !== null}
                                        className={`px-3 py-2 rounded-xl text-[11px] font-black uppercase tracking-[0.18em] transition-all ${
                                            t.claimable
                                                ? 'bg-cyan-400 text-black hover:bg-cyan-300 active:scale-[0.98] shadow-[0_0_16px_rgba(34,211,238,0.35)]'
                                                : 'bg-white/5 text-white/30 cursor-not-allowed'
                                        }`}
                                    >
                                        {claimingId === t.track ? '...' : 'Claim'}
                                    </button>
                                )}
                            </div>
                            <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                                <div
                                    className="h-full rounded-full bg-cyan-400 transition-all"
                                    style={{ width: `${pct}%` }}
                                />
                            </div>
                        </div>
                    );
                })
            )}

            {notice && <div className="text-[11px] text-cyan-300/90 text-center pt-1">{notice}</div>}
        </div>
    );
};

export default OnboardingPanel;
