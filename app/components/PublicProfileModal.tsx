'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useChipsBalanceFor } from '@/hooks/useChipsBalance';
import { useGuestWall } from '@/hooks/GuestWallContext';
import { getProgression } from '@/lib/progression';
import { FormChart } from './FormChart';
import { ModeBreakdown, winGame } from './ModeBreakdown';
import { ChatIcon, ChipsHexIcon, CloseReticleIcon } from './icons';
import { useAppSession } from '@/hooks/useAppSession';
import { clearOutboxForPeer } from '@/lib/messageOutbox';
import { HudCornerTicks, HudSectionLabel } from './HudPrimitives';
import { PilotAvatar } from './PilotAvatar';
import { RankTierIcon } from './RankTierIcon';
import { Button } from './Button';

interface PublicProfileData {
    wallet_address: string;
    username: string | null;
    avatar_url: string | null;
    lxp: number | null;
    rxp: number | null;
    status: string | null;
    classic_played: number | null;
    power_played: number | null;
    ai_played: number | null;
    total_wins: number | null;
    total_games: number | null;
    rank_tier: string | null;
    last_played_at: string | null;
    created_at: string | null;
    is_public?: boolean;
    allow_requests?: boolean;
    clan_tag?: string | null;
    clan_name?: string | null;
    private_redacted?: boolean;
}

interface TargetMatchRow {
    winner_address: string | null;
    created_at: string | null;
    game_mode?: string | null;
}

interface PublicProfileModalProps {
    isOpen: boolean;
    userAddress: string | null;
    onClose: () => void;
    onDM: (address: string) => void;
}

type FriendListEntry = string | { address?: string; wallet_address?: string; user_address?: string; friend_address?: string };

export default function PublicProfileModal({
    isOpen,
    userAddress,
    onClose,
    onDM,
}: PublicProfileModalProps) {
    const { ensureAppSession } = useAppSession();
    const { address: currentUserAddress } = useCurrentUser();
    const { guard } = useGuestWall();
    const [mounted, setMounted] = useState(false);
    useEffect(() => setMounted(true), []);

    const [isProfileLoading, setProfileLoading] = useState(false);
    const [isFriendValidationLoading, setFriendValidationLoading] = useState(false);

    const [profile, setProfile] = useState<PublicProfileData | null>(null);
    const [targetMatches, setTargetMatches] = useState<TargetMatchRow[]>([]);
    const [isFriend, setIsFriend] = useState(false);
    const [isPending, setIsPending] = useState(false);
    const [isBlocked, setIsBlocked] = useState(false);

    const [isActionLoading, setIsActionLoading] = useState(false);
    const [actionFeedback, setActionFeedback] = useState<{ text: string; tone: 'positive' | 'negative' } | null>(null);
    const [reportStep, setReportStep] = useState<'none' | 'select' | 'submitting' | 'done'>('none');
    const [selectedReportReason, setSelectedReportReason] = useState<string>('');
    const [copiedAddr, setCopiedAddr] = useState(false);

    const flashFeedback = (text: string, tone: 'positive' | 'negative' = 'positive') => {
        setActionFeedback({ text, tone });
        setTimeout(() => setActionFeedback(null), 2600);
    };

    useEffect(() => {
        if (!isOpen || !userAddress || !currentUserAddress) {
            setProfile(null);
            setTargetMatches([]);
            setIsFriend(false);
            setIsPending(false);
            setIsBlocked(false);
            setActionFeedback(null);
            setReportStep('none');
            setSelectedReportReason('');
            setProfileLoading(false);
            setFriendValidationLoading(false);
            return;
        }

        let cancelled = false;
        const fetchProfileData = async () => {
            setProfileLoading(true);
            setFriendValidationLoading(true);

            let sessionId: string | null = null;
            try {
                sessionId = await ensureAppSession().catch(() => null);
            } catch {
                sessionId = null;
            }

            // 1. Fetch public dossier via /api/profile/public (enforces is_public + includes clan_tag)
            try {
                const res = await fetch(
                    `/api/profile/public?walletAddress=${encodeURIComponent(userAddress)}`,
                    sessionId
                        ? {
                              headers: {
                                  Authorization: `Bearer ${sessionId}`,
                                  'x-session-id': sessionId,
                              },
                          }
                        : undefined,
                );
                if (res.ok) {
                    const payload = await res.json();
                    if (!cancelled && payload?.profile) {
                        setProfile(payload.profile as PublicProfileData);
                        setTargetMatches(Array.isArray(payload.recentMatches) ? payload.recentMatches : []);
                    }
                }
            } catch (err) {
                console.error('Error fetching public profile:', err);
            } finally {
                if (!cancelled) setProfileLoading(false);
            }

            // 2. Fetch block status via session-gated moderation route
            try {
                if (!sessionId) {
                    if (!cancelled) setIsBlocked(false);
                } else {
                    const params = new URLSearchParams({
                        walletAddress: currentUserAddress,
                        sessionId,
                        target: userAddress,
                    });
                    const blockRes = await fetch(`/api/social/moderation?${params.toString()}`);
                    const blockData = blockRes.ok ? await blockRes.json() : { blocked: false };
                    if (!cancelled) setIsBlocked(!!blockData.blocked);
                }
            } catch {
                if (!cancelled) setIsBlocked(false);
            }

            // 3. Fetch friendship state
            try {
                const authHeaders = sessionId
                    ? {
                          Authorization: `Bearer ${sessionId}`,
                          'x-session-id': sessionId,
                      }
                    : undefined;

                const [friendsRes, friendshipsRes] = await Promise.all([
                    fetch(
                        `/api/friends?wallet=${encodeURIComponent(currentUserAddress)}&walletAddress=${encodeURIComponent(currentUserAddress)}`,
                        authHeaders ? { headers: authHeaders } : undefined,
                    )
                        .then((r) => (r.ok ? r.json() : null))
                        .catch(() => null),
                    sessionId
                        ? fetch(`/api/friendships?walletAddress=${encodeURIComponent(currentUserAddress)}`, {
                              headers: authHeaders,
                          })
                              .then((r) => (r.ok ? r.json() : null))
                              .catch(() => null)
                        : null,
                ]);

                const targetLc = userAddress.toLowerCase();
                const data = friendsRes || {};
                const friendshipData = friendshipsRes || { accepted: [], incoming: [], outgoing: [] };

                const isFollowing =
                    (data.onchainFriends as FriendListEntry[] | undefined)?.some((f) => {
                        if (typeof f === 'string') return f.toLowerCase() === targetLc;
                        return (
                            f.address?.toLowerCase() === targetLc ||
                            f.wallet_address?.toLowerCase() === targetLc
                        );
                    }) || false;

                const isAcceptedInFriends =
                    (data.acceptedFriends as FriendListEntry[] | undefined)?.some((a) => {
                        const val = typeof a === 'string' ? a : a.wallet_address || a.address || '';
                        return val.toLowerCase() === targetLc;
                    }) || false;

                const isAcceptedInFriendships = (
                    (friendshipData.accepted as FriendListEntry[] | undefined) || []
                ).some((row) => {
                    if (typeof row === 'string') return row.toLowerCase() === targetLc;
                    return [row.user_address, row.friend_address]
                        .map((v) => String(v || '').toLowerCase())
                        .includes(targetLc);
                });

                const effectiveFriend = isFollowing || isAcceptedInFriends || isAcceptedInFriendships;
                if (!cancelled) {
                    setIsFriend(effectiveFriend);
                    if (effectiveFriend) {
                        setIsPending(false);
                    } else {
                        const pendingList: FriendListEntry[] = [
                            ...((friendshipData.incoming as FriendListEntry[]) || []),
                            ...((friendshipData.outgoing as FriendListEntry[]) || []),
                        ];
                        const pending = pendingList.some((row) => {
                            if (typeof row === 'string') return row.toLowerCase() === targetLc;
                            return [row.user_address, row.friend_address]
                                .map((v) => String(v || '').toLowerCase())
                                .includes(targetLc);
                        });
                        setIsPending(pending);
                    }
                }
            } catch (err) {
                console.error('Error during profile validation:', err);
            } finally {
                if (!cancelled) setFriendValidationLoading(false);
            }
        };

        void fetchProfileData();
        return () => {
            cancelled = true;
        };
    }, [isOpen, userAddress, currentUserAddress, ensureAppSession]);

    const progression = getProgression(profile?.lxp || 0, profile?.rxp || 0);
    const chipsBal = useChipsBalanceFor(userAddress);

    const displayName =
        profile?.username && !profile.username.startsWith('0x')
            ? profile.username
            : `User ${userAddress?.slice(-4).toUpperCase() || '0000'}`;

    const isSelf =
        !!userAddress &&
        !!currentUserAddress &&
        userAddress.toLowerCase() === currentUserAddress.toLowerCase();

    const isPrivateRedacted = Boolean(profile?.private_redacted && !isSelf && !isFriend);
    const requestsDisabled = profile?.allow_requests === false && !isSelf && !isFriend && !isPending;

    const displayWins = profile?.total_wins ?? 0;
    const displayGames = profile?.total_games ?? 0;
    const displayWinRate = displayGames > 0 ? `${Math.round((displayWins / displayGames) * 100)}%` : '–';
    const classicPlayed = profile?.classic_played ?? 0;
    const powerPlayed = profile?.power_played ?? 0;
    const aiPlayed = profile?.ai_played ?? 0;
    const meLc = (userAddress || '').toLowerCase();

    const classicRows = targetMatches.filter((m) => (m.game_mode || 'classic') === 'classic');
    const powerRows = targetMatches.filter((m) => m.game_mode === 'power');
    const aiRows = targetMatches.filter((m) => m.game_mode === 'ai' || m.game_mode === 'offline');

    const modeForm = {
        classic: winGame(
            classicRows.filter((m) => (m.winner_address || '').toLowerCase() === meLc).length,
            Math.max(classicPlayed, classicRows.length),
        ),
        power: winGame(
            powerRows.filter((m) => (m.winner_address || '').toLowerCase() === meLc).length,
            Math.max(powerPlayed, powerRows.length),
        ),
        ai: winGame(
            aiRows.filter((m) => (m.winner_address || '').toLowerCase() === meLc).length,
            aiPlayed,
        ),
        form: winGame(displayWins, displayGames),
    };

    const activityBuckets = useMemo(() => {
        const now = Date.now();
        const day = 86400000;
        const buckets = new Array<number>(10).fill(0);
        for (const m of targetMatches) {
            if (!m.created_at) continue;
            const age = now - new Date(m.created_at).getTime();
            if (age < 0 || age >= 30 * day) continue;
            const idx = 9 - Math.floor(age / (3 * day));
            if (idx >= 0 && idx < 10) buckets[idx]++;
        }
        return buckets;
    }, [targetMatches]);
    const activityMax = Math.max(1, ...activityBuckets);

    const scout = useMemo(() => {
        const me = (userAddress || '').toLowerCase();
        let score = 0;
        const pts: number[] = [];
        for (const m of [...targetMatches].reverse()) {
            if (me && (m.winner_address || '').toLowerCase() === me) score += 30;
            else score -= 15;
            pts.push(score);
        }
        return { pts, positive: score >= 0, net: score };
    }, [targetMatches, userAddress]);

    const lastPlayedAt = profile?.last_played_at ? new Date(profile.last_played_at) : null;
    let isOnline = profile?.status === 'Online' || profile?.status === 'In Match';
    if (profile?.status === 'Online' && lastPlayedAt) {
        if (Date.now() - lastPlayedAt.getTime() > 5 * 60 * 1000) {
            isOnline = false;
        }
    }

    const localTimeString = lastPlayedAt
        ? new Intl.DateTimeFormat('default', {
              hour: 'numeric',
              minute: 'numeric',
              day: 'numeric',
              month: 'short',
          }).format(lastPlayedAt)
        : 'Never';

    const handleCopyAddress = async () => {
        if (!userAddress) return;
        try {
            await navigator.clipboard.writeText(userAddress);
            setCopiedAddr(true);
            setTimeout(() => setCopiedAddr(false), 1800);
        } catch {
            /* ignore */
        }
    };

    const handleAction = async (
        action: 'Add Friend' | 'Unfriend' | 'Block' | 'Unblock' | 'Report' | 'Poke' | 'Congratulate',
    ) => {
        if (!currentUserAddress || !userAddress || isActionLoading) return;

        if (action === 'Add Friend' && !guard('friend-add')) return;
        if ((action === 'Poke' || action === 'Congratulate') && !guard('poke')) return;
        if (action === 'Block' && !guard('friend-add')) return;
        if (action === 'Report' && !guard('friend-add')) return;

        if (action === 'Report') {
            setReportStep('select');
            return;
        }

        setIsActionLoading(true);
        try {
            if (action === 'Poke') {
                const pokeSession = await ensureAppSession();
                if (!pokeSession) {
                    flashFeedback('Sign-in required to poke', 'negative');
                    return;
                }
                const response = await fetch('/api/social/poke', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        sender: currentUserAddress,
                        receiver: userAddress,
                        walletAddress: currentUserAddress,
                        sessionId: pokeSession,
                    }),
                });
                const data = await response.json().catch(() => ({}));
                if (response.ok) {
                    window.dispatchEvent(new CustomEvent('ludo-profile-refresh'));
                    flashFeedback(
                        data.type === 'poke_back'
                            ? data.reward > 0
                                ? `Poked Back! +${data.reward} CHIPS`
                                : 'Poked Back!'
                            : 'Poke Sent!',
                    );
                } else {
                    flashFeedback(data.error || 'Failed to poke', 'negative');
                }
            } else if (action === 'Add Friend') {
                const sessionId = await ensureAppSession();
                const response = sessionId
                    ? await fetch('/api/friendships', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                              walletAddress: currentUserAddress,
                              sessionId,
                              action: 'request',
                              target: userAddress,
                          }),
                      })
                    : null;
                const data = response ? await response.json().catch(() => ({})) : {};
                if (response?.ok) {
                    if (data.status === 'accepted') {
                        setIsFriend(true);
                        setIsPending(false);
                        flashFeedback('Friend Added!');
                    } else {
                        setIsPending(true);
                        flashFeedback('Friend Request Sent!');
                    }
                } else {
                    flashFeedback(data?.error || 'Failed to send request', 'negative');
                }
            } else if (action === 'Unfriend') {
                const sessionId = await ensureAppSession();
                const response = sessionId
                    ? await fetch('/api/friendships', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                              walletAddress: currentUserAddress,
                              sessionId,
                              action: 'remove',
                              target: userAddress,
                          }),
                      })
                    : null;
                if (response?.ok) {
                    clearOutboxForPeer(currentUserAddress, userAddress);
                    setIsFriend(false);
                    flashFeedback('Friend Removed');
                } else {
                    flashFeedback('Couldn’t remove friend', 'negative');
                }
            } else if (action === 'Block') {
                const sessionId = await ensureAppSession();
                const response = sessionId
                    ? await fetch('/api/social/moderation', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                              walletAddress: currentUserAddress,
                              sessionId,
                              action: 'block',
                              target: userAddress,
                          }),
                      })
                    : null;
                if (response?.ok) {
                    setIsBlocked(true);
                    setIsFriend(false);
                    flashFeedback('Pilot Blocked');
                } else {
                    flashFeedback('Couldn’t block user', 'negative');
                }
            } else if (action === 'Unblock') {
                const sessionId = await ensureAppSession();
                const response = sessionId
                    ? await fetch('/api/social/moderation', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                              walletAddress: currentUserAddress,
                              sessionId,
                              action: 'unblock',
                              target: userAddress,
                          }),
                      })
                    : null;
                if (response?.ok) {
                    setIsBlocked(false);
                    flashFeedback('Pilot Unblocked');
                } else {
                    flashFeedback('Couldn’t unblock user', 'negative');
                }
            } else if (action === 'Congratulate') {
                const sessionId = await ensureAppSession();
                const response = sessionId
                    ? await fetch('/api/social/moderation', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                              walletAddress: currentUserAddress,
                              sessionId,
                              action: 'congratulate',
                              target: userAddress,
                          }),
                      })
                    : null;
                if (response?.ok) {
                    flashFeedback('Celebrated!');
                } else {
                    flashFeedback('Couldn’t celebrate', 'negative');
                }
            }
        } catch {
            flashFeedback('Something went wrong', 'negative');
        } finally {
            setIsActionLoading(false);
        }
    };

    const submitReport = async () => {
        if (!currentUserAddress || !userAddress || !selectedReportReason) return;
        setReportStep('submitting');
        try {
            const sessionId = await ensureAppSession();
            const response = sessionId
                ? await fetch('/api/social/moderation', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                          walletAddress: currentUserAddress,
                          sessionId,
                          action: 'report',
                          target: userAddress,
                          reason: selectedReportReason,
                      }),
                  })
                : null;
            if (response?.ok) {
                setReportStep('done');
                setTimeout(() => setReportStep('none'), 2000);
            } else {
                setReportStep('select');
            }
        } catch {
            setReportStep('select');
        }
    };

    const renderBreakdown = () => (
        <ModeBreakdown stats={modeForm} labels={['Classic', 'Power', 'vs AI', 'Overall']} />
    );

    const renderActivity = () => (
        <div className="w-full bg-surface-recessed border border-line-soft rounded-2xl p-3 flex flex-col gap-2">
            <div className="flex justify-between items-center gap-2">
                <span className="text-ludo-xs uppercase font-bold text-ink-muted tracking-widest">
                    30-Day Activity
                </span>
                <span className="text-ludo-xs text-ink-faint font-mono">
                    Last seen: {localTimeString}
                </span>
            </div>
            <div className="flex items-end justify-between h-6 gap-1">
                {activityBuckets.map((h, i) => (
                    <div
                        key={i}
                        className="flex-1 bg-accent/55 hover:bg-accent rounded-t-sm transition-colors"
                        style={{
                            height: `${Math.max(12, (h / activityMax) * 100)}%`,
                            opacity: h === 0 ? 0.25 : 1,
                        }}
                    />
                ))}
            </div>
        </div>
    );

    const renderScout = () =>
        scout.pts.length > 0 ? (
            <div className="w-full bg-surface-recessed border border-line-soft rounded-2xl p-3 flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                    <span className="text-ludo-xs uppercase font-bold text-ink-muted tracking-widest">
                        Scout Form · {targetMatches.length} Matches
                    </span>
                    <span
                        className={`text-ludo-xs font-mono font-bold tabular-nums px-2 py-0.5 rounded-full border ${
                            scout.positive
                                ? 'bg-positive/15 text-positive border-positive/35'
                                : 'bg-negative/15 text-negative border-negative/35'
                        }`}
                    >
                        {scout.net > 0 ? `+${scout.net}` : `${scout.net}`} RXP
                    </span>
                </div>
                <FormChart points={scout.pts} positive={scout.positive} />
            </div>
        ) : null;

    const renderPokeRow = () => (
        <div className="grid grid-cols-2 gap-2 w-full">
            <button
                type="button"
                onClick={() => handleAction('Poke')}
                disabled={isActionLoading}
                className="bg-warn/15 hover:bg-warn/25 text-warn border border-warn/40 text-ludo-sm font-bold uppercase tracking-[0.16em] py-2.5 rounded-xl transition-colors active:scale-95 flex items-center justify-center gap-1.5 disabled:opacity-50"
            >
                <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="w-4 h-4"
                >
                    <path d="M18 11V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v0" />
                    <path d="M14 10V4a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v2" />
                    <path d="M10 10.5V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v8" />
                    <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" />
                </svg>
                Poke
            </button>
            <button
                type="button"
                onClick={() => handleAction('Congratulate')}
                disabled={isActionLoading}
                className="bg-positive/15 hover:bg-positive/25 text-positive border border-positive/40 text-ludo-sm font-bold uppercase tracking-[0.16em] py-2.5 rounded-xl transition-colors active:scale-95 flex items-center justify-center gap-1.5 disabled:opacity-50"
            >
                <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="w-4 h-4"
                >
                    <path d="m6 9 6 6 6-6" />
                    <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z" />
                </svg>
                Gud Luck
            </button>
        </div>
    );

    if (!mounted || !isOpen || !userAddress) return null;

    const statusTone =
        profile?.status === 'Online' && isOnline
            ? { dot: 'bg-positive', text: 'text-positive', label: 'Online' }
            : profile?.status === 'In Match'
              ? { dot: 'bg-warn', text: 'text-warn', label: 'In Match' }
              : { dot: 'bg-ink-faint', text: 'text-ink-faint', label: 'Offline' };

    return createPortal(
        <>
            {/* Backdrop */}
            <div
                onClick={onClose}
                className="fixed inset-0 z-[200] bg-surface-page/70"
                style={{ backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)' }}
            />

            {/* Synchronized 3077 Modal Dossier Shell */}
            <div
                role="dialog"
                aria-modal="true"
                aria-label={`${displayName} dossier`}
                className="panel-shell-3077 ludo-pubprofile-scope fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[calc(100%-32px)] max-w-sm max-h-[84dvh] rounded-[32px] z-[210] flex flex-col overflow-hidden"
                style={{
                    background: 'var(--panel-bg)',
                    border: '1px solid var(--panel-border)',
                    boxShadow: 'var(--panel-shadow)',
                    color: 'var(--ink-strong)',
                    backdropFilter: 'blur(32px)',
                    WebkitBackdropFilter: 'blur(32px)',
                }}
            >
                <HudCornerTicks />

                {/* Header Bar */}
                <div
                    className="px-5 pt-3.5 pb-2.5 flex items-center justify-between gap-2 relative z-10 shrink-0"
                    style={{ borderBottom: '1px solid var(--line-soft)' }}
                >
                    <div className="min-w-0 flex flex-col">
                        <p className="text-ludo-xs font-mono uppercase tracking-[0.22em] text-accent">
                            {'// PILOT DOSSIER'}
                        </p>
                        {!isFriendValidationLoading && (isFriend || isSelf) ? (
                            <div className="flex items-center gap-1.5 mt-0.5">
                                <span className={`w-2 h-2 rounded-full ${statusTone.dot}`} />
                                <span
                                    className={`text-ludo-xs uppercase tracking-widest font-bold ${statusTone.text}`}
                                >
                                    {statusTone.label}
                                </span>
                            </div>
                        ) : (
                            <span className="text-ludo-xs font-mono uppercase tracking-widest text-ink-faint mt-0.5">
                                Telemetry Readout
                            </span>
                        )}
                    </div>

                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={onClose}
                        aria-label="Close pilot profile"
                        className="panel-close-3077 bg-surface-recessed border border-line-soft shrink-0"
                    >
                        <CloseReticleIcon className="icon-md" />
                    </Button>
                </div>

                {/* Main Scrollable Dossier */}
                <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar px-5 py-3.5 relative z-10 flex flex-col gap-3">
                    {isProfileLoading ? (
                        <div className="py-12 flex flex-col items-center justify-center gap-3">
                            <div className="w-8 h-8 border-2 border-line-soft border-t-accent rounded-full animate-spin" />
                            <span className="text-ink-faint text-ludo-xs font-mono font-bold uppercase tracking-widest">
                                Syncing Pilot Dossier…
                            </span>
                        </div>
                    ) : (
                        <>
                            {/* Hero Identity Card */}
                            <div className="rounded-2xl bg-surface-recessed border border-line-soft p-3.5 flex flex-col items-center text-center gap-2.5">
                                <PilotAvatar
                                    avatarUrl={profile?.avatar_url}
                                    name={displayName}
                                    size="xl"
                                    tier={progression.tier}
                                />

                                <div className="w-full min-w-0 flex flex-col items-center gap-1">
                                    <div className="flex items-center justify-center gap-1.5 max-w-full">
                                        <h3 className="text-ludo-xl font-extrabold text-ink-strong truncate">
                                            {displayName}
                                        </h3>
                                        {profile?.clan_tag && (
                                            <span className="px-1.5 py-0.5 rounded-sm bg-accent-soft border border-accent/35 text-ludo-xs font-mono font-bold text-accent shrink-0">
                                                [{profile.clan_tag}]
                                            </span>
                                        )}
                                    </div>

                                    <div className="flex flex-wrap items-center justify-center gap-1.5">
                                        {isSelf && (
                                            <span className="px-2 py-0.5 rounded-sm bg-accent text-accent-ink text-ludo-xs font-bold uppercase tracking-wider">
                                                You
                                            </span>
                                        )}
                                        <span className="inline-flex items-center gap-1 text-ludo-xs font-bold text-accent uppercase tracking-widest px-2 py-0.5 bg-accent-soft rounded-full border border-accent/30">
                                            <RankTierIcon
                                                tier={progression.tier}
                                                className="w-3 h-3 shrink-0"
                                            />
                                            <span>
                                                {progression.tier} {progression.subRank}
                                            </span>
                                        </span>
                                        <span className="text-ludo-xs font-mono font-bold text-ink-muted uppercase tracking-wider px-2 py-0.5 bg-surface-panel rounded-full border border-line-soft">
                                            Lv. {progression.level}
                                        </span>
                                        <span className="inline-flex items-center gap-1 text-ludo-xs font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border border-accent/30 bg-accent-soft">
                                            <ChipsHexIcon className="w-3 h-3 text-accent" active />
                                            <span className="text-ink-strong tabular-nums">
                                                {chipsBal.human}
                                            </span>
                                            <span className="text-accent">CHIPS</span>
                                        </span>
                                    </div>

                                    {!isFriendValidationLoading && (isFriend || isSelf) && (
                                        <button
                                            type="button"
                                            onClick={handleCopyAddress}
                                            className="mt-0.5 bg-surface-panel px-2.5 py-0.5 rounded-full border border-line-soft flex items-center gap-1.5 hover:border-line-strong transition-colors"
                                            title="Copy wallet address"
                                        >
                                            <span className="w-1.5 h-1.5 rounded-full bg-accent" />
                                            <span className="text-ludo-xs text-ink-faint font-mono">
                                                {copiedAddr
                                                    ? 'Copied to clipboard'
                                                    : `${userAddress.slice(0, 6)}…${userAddress.slice(-4)}`}
                                            </span>
                                        </button>
                                    )}
                                </div>

                                {/* Stats KPIs or Redacted Notice */}
                                {isPrivateRedacted ? (
                                    <div className="w-full rounded-xl bg-surface-panel border border-line-soft px-3 py-3 flex items-center gap-2.5 text-left">
                                        <div className="w-8 h-8 rounded-lg bg-accent-soft border border-accent/30 text-accent flex items-center justify-center shrink-0">
                                            <svg
                                                viewBox="0 0 24 24"
                                                fill="none"
                                                stroke="currentColor"
                                                strokeWidth="2"
                                                strokeLinecap="round"
                                                strokeLinejoin="round"
                                                className="w-4 h-4"
                                            >
                                                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                                                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                                            </svg>
                                        </div>
                                        <div className="min-w-0">
                                            <div className="text-ludo-xs font-mono font-bold uppercase tracking-widest text-ink-strong">
                                                Restricted Dossier
                                            </div>
                                            <div className="text-ludo-xs font-bold text-ink-faint leading-snug">
                                                Profile telemetry is private. Become friends to inspect full combat stats.
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-3 gap-2 w-full">
                                        <div className="bg-surface-panel border border-line-soft rounded-xl p-2 flex flex-col items-center justify-center">
                                            <span className="text-ludo-lg font-extrabold text-accent tabular-nums leading-none">
                                                {displayWins.toLocaleString()}
                                            </span>
                                            <span className="text-ludo-xs text-ink-faint font-bold uppercase tracking-widest mt-1">
                                                Wins
                                            </span>
                                        </div>
                                        <div className="bg-surface-panel border border-line-soft rounded-xl p-2 flex flex-col items-center justify-center">
                                            <span className="text-ludo-lg font-extrabold text-ink-strong tabular-nums leading-none">
                                                {displayWinRate}
                                            </span>
                                            <span className="text-ludo-xs text-ink-faint font-bold uppercase tracking-widest mt-1">
                                                Win Rate
                                            </span>
                                        </div>
                                        <div className="bg-surface-panel border border-line-soft rounded-xl p-2 flex flex-col items-center justify-center">
                                            <span className="text-ludo-lg font-extrabold text-ink-muted tabular-nums leading-none">
                                                {displayGames.toLocaleString()}
                                            </span>
                                            <span className="text-ludo-xs text-ink-faint font-bold uppercase tracking-widest mt-1">
                                                Matches
                                            </span>
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Telemetry & Actions */}
                            {isFriendValidationLoading ? (
                                <div className="flex flex-col gap-2 animate-pulse">
                                    <div className="w-full h-14 bg-surface-recessed rounded-2xl border border-line-soft" />
                                    <div className="w-full h-12 bg-surface-recessed rounded-2xl border border-line-soft" />
                                </div>
                            ) : (
                                <div className="flex flex-col gap-2.5">
                                    {!isPrivateRedacted && (
                                        <>
                                            <HudSectionLabel>Combat Telemetry</HudSectionLabel>
                                            {renderBreakdown()}
                                            {(isSelf || isFriend) && renderActivity()}
                                            {(!isFriend || isSelf) && renderScout()}
                                        </>
                                    )}

                                    {!isSelf && (
                                        <>
                                            <HudSectionLabel>Comms &amp; Actions</HudSectionLabel>

                                            {actionFeedback ? (
                                                <div
                                                    className={`w-full rounded-2xl p-3 border flex items-center justify-center gap-2 ${
                                                        actionFeedback.tone === 'negative'
                                                            ? 'bg-negative/10 border-negative/35 text-negative'
                                                            : 'bg-positive/10 border-positive/35 text-positive'
                                                    }`}
                                                >
                                                    <span className="text-ludo-md font-bold">
                                                        {actionFeedback.text}
                                                    </span>
                                                </div>
                                            ) : reportStep !== 'none' ? (
                                                <div className="w-full bg-surface-recessed border border-line-soft rounded-2xl p-3 flex flex-col gap-2.5">
                                                    {reportStep === 'done' ? (
                                                        <div className="flex items-center justify-center p-2 text-positive font-bold text-ludo-md gap-2">
                                                            Report Submitted
                                                        </div>
                                                    ) : (
                                                        <>
                                                            <span className="text-ludo-xs uppercase tracking-widest text-ink-muted font-bold">
                                                                Select Reason
                                                            </span>
                                                            <div className="flex gap-2">
                                                                {['Cheating', 'Abuse', 'Spam'].map((reason) => (
                                                                    <button
                                                                        key={reason}
                                                                        type="button"
                                                                        onClick={() => setSelectedReportReason(reason)}
                                                                        className={`flex-1 py-1.5 text-ludo-sm font-bold rounded-xl border transition-colors ${
                                                                            selectedReportReason === reason
                                                                                ? 'bg-negative/15 text-negative border-negative/50'
                                                                                : 'bg-surface-panel text-ink-muted border-line-soft hover:text-ink-strong'
                                                                        }`}
                                                                    >
                                                                        {reason}
                                                                    </button>
                                                                ))}
                                                            </div>
                                                            <div className="flex gap-2">
                                                                <Button
                                                                    variant="secondary"
                                                                    size="sm"
                                                                    onClick={() => setReportStep('none')}
                                                                    className="flex-1"
                                                                >
                                                                    Cancel
                                                                </Button>
                                                                <Button
                                                                    variant="danger"
                                                                    size="sm"
                                                                    onClick={submitReport}
                                                                    loading={reportStep === 'submitting'}
                                                                    disabled={!selectedReportReason || reportStep === 'submitting'}
                                                                    className="flex-1"
                                                                >
                                                                    Submit
                                                                </Button>
                                                            </div>
                                                        </>
                                                    )}
                                                </div>
                                            ) : isFriend && !isBlocked ? (
                                                <div className="flex flex-col gap-2">
                                                    <Button
                                                        variant="primary"
                                                        size="lg"
                                                        fullWidth
                                                        onClick={() => guard('dm', () => onDM(userAddress))}
                                                    >
                                                        <ChatIcon className="w-4 h-4" active />
                                                        <span>Direct Message</span>
                                                    </Button>

                                                    {renderPokeRow()}

                                                    <div className="flex gap-2 w-full">
                                                        <Button
                                                            variant="secondary"
                                                            size="md"
                                                            onClick={() => handleAction('Unfriend')}
                                                            disabled={isActionLoading}
                                                            className="flex-1"
                                                        >
                                                            Remove Friend
                                                        </Button>
                                                        <button
                                                            type="button"
                                                            onClick={() => handleAction('Block')}
                                                            disabled={isActionLoading}
                                                            className="flex-1 bg-negative/10 hover:bg-negative/20 text-negative text-ludo-sm font-bold py-2.5 rounded-xl transition-colors border border-negative/25 flex items-center justify-center gap-1.5 disabled:opacity-50"
                                                        >
                                                            Block
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => handleAction('Report')}
                                                            disabled={isActionLoading}
                                                            className="w-10 flex items-center justify-center bg-surface-recessed hover:bg-surface-hover text-ink-muted hover:text-ink-strong rounded-xl transition-colors border border-line-soft shrink-0 disabled:opacity-50"
                                                            title="Report Pilot"
                                                            aria-label="Report Pilot"
                                                        >
                                                            <svg
                                                                viewBox="0 0 24 24"
                                                                fill="none"
                                                                stroke="currentColor"
                                                                strokeWidth="2"
                                                                strokeLinecap="round"
                                                                strokeLinejoin="round"
                                                                className="w-4 h-4"
                                                            >
                                                                <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
                                                                <line x1="4" y1="22" x2="4" y2="15" />
                                                            </svg>
                                                        </button>
                                                    </div>
                                                </div>
                                            ) : (
                                                <div className="flex flex-col gap-2">
                                                    {!isBlocked && renderPokeRow()}
                                                    <div className="flex gap-2 w-full">
                                                        {isBlocked ? (
                                                            <Button
                                                                variant="secondary"
                                                                size="md"
                                                                onClick={() => handleAction('Unblock')}
                                                                disabled={isActionLoading}
                                                                className="flex-1"
                                                            >
                                                                Unblock Pilot
                                                            </Button>
                                                        ) : (
                                                            <>
                                                                <Button
                                                                    variant={isPending || requestsDisabled ? 'secondary' : 'primary'}
                                                                    size="md"
                                                                    onClick={() => handleAction('Add Friend')}
                                                                    disabled={isActionLoading || isPending || requestsDisabled}
                                                                    className="flex-1"
                                                                >
                                                                    {isPending
                                                                        ? 'Request Pending'
                                                                        : requestsDisabled
                                                                          ? 'Requests Paused'
                                                                          : 'Add Friend'}
                                                                </Button>

                                                                <button
                                                                    type="button"
                                                                    onClick={() => handleAction('Block')}
                                                                    disabled={isActionLoading}
                                                                    className="px-3.5 bg-negative/10 hover:bg-negative/20 text-negative text-ludo-sm font-bold rounded-xl transition-colors border border-negative/25 flex items-center justify-center disabled:opacity-50"
                                                                >
                                                                    Block
                                                                </button>

                                                                <button
                                                                    type="button"
                                                                    onClick={() => handleAction('Report')}
                                                                    disabled={isActionLoading}
                                                                    className="w-10 flex items-center justify-center bg-surface-recessed hover:bg-surface-hover text-ink-muted hover:text-ink-strong rounded-xl transition-colors border border-line-soft shrink-0 disabled:opacity-50"
                                                                    title="Report Pilot"
                                                                    aria-label="Report Pilot"
                                                                >
                                                                    <svg
                                                                        viewBox="0 0 24 24"
                                                                        fill="none"
                                                                        stroke="currentColor"
                                                                        strokeWidth="2"
                                                                        strokeLinecap="round"
                                                                        strokeLinejoin="round"
                                                                        className="w-4 h-4"
                                                                    >
                                                                        <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
                                                                        <line x1="4" y1="22" x2="4" y2="15" />
                                                                    </svg>
                                                                </button>
                                                            </>
                                                        )}
                                                    </div>
                                                </div>
                                            )}
                                        </>
                                    )}
                                </div>
                            )}
                        </>
                    )}
                </div>
            </div>
        </>,
        document.body,
    );
}
