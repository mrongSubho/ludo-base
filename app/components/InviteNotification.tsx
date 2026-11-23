import React, { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useTeamUpContext } from '@/hooks/TeamUpContext';
import { useSoundEffects } from '../hooks/useSoundEffects';
import { getSoundEngine } from '@/lib/audio/SoundEngine';
import { useAppSession } from '@/hooks/useAppSession';
import { HudCornerTicks } from './HudPrimitives';
import Button from './Button';

// ─── Theme-agnostic contract ────────────────────────────────────────────────
// Uses panel-shell-3077 + semantic tokens across retro-futurism and daybreak.

type InviteRow = {
    id?: string;
    host_address: string;
    room_code: string;
    match_type?: string | null;
    entry_fee?: number | null;
    validation_token?: string | null;
};

const INVITE_LIFETIME_S = 15;
const JOIN_TIMEOUT_MS = 10_000;

export const InviteNotification = () => {
    const { address, profile } = useCurrentUser();
    const { joinGame, lobbyState, leaveGame } = useTeamUpContext();
    const { playSelect } = useSoundEffects();
    const { ensureAppSession } = useAppSession();
    const myCoins = typeof profile?.coins === 'number' ? profile.coins : null;
    const playSelectRef = useRef(playSelect);
    useEffect(() => { playSelectRef.current = playSelect; }, [playSelect]);

    const [invite, setInvite] = useState<InviteRow | null>(null);
    const [hostProfile, setHostProfile] = useState<{ username: string; avatar_url: string } | null>(null);
    const [secsLeft, setSecsLeft] = useState(INVITE_LIFETIME_S);
    /** 'card' = accept/ignore · 'joining' = loading window · 'error' = join failed */
    const [phase, setPhase] = useState<'card' | 'joining' | 'error'>('card');
    const [joinError, setJoinError] = useState<string | null>(null);

    // Lifetime is deadline-based so a stalled interval can't freeze the label.
    const expiresAtRef = useRef(0);
    const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const tickTimer = useRef<ReturnType<typeof setInterval> | null>(null);
    const joinWatch = useRef<ReturnType<typeof setInterval> | null>(null);
    const joinDeadline = useRef<number>(0);
    const lastInviteIdRef = useRef<string | null>(null);
    const joinedCodeRef = useRef<string | null>(null);
    const phaseRef = useRef<'card' | 'joining' | 'error'>(phase);
    useEffect(() => { phaseRef.current = phase; }, [phase]);
    const me = address?.toLowerCase();

    const clearLifetimeTimers = useCallback(() => {
        if (hideTimer.current) clearTimeout(hideTimer.current);
        if (tickTimer.current) clearInterval(tickTimer.current);
        hideTimer.current = null;
        tickTimer.current = null;
    }, []);

    const clearJoinWatch = useCallback(() => {
        if (joinWatch.current) clearInterval(joinWatch.current);
        joinWatch.current = null;
    }, []);

    const dismissAll = useCallback(() => {
        clearLifetimeTimers();
        clearJoinWatch();
        setInvite(null);
        setPhase('card');
        setJoinError(null);
        joinedCodeRef.current = null;
    }, [clearLifetimeTimers, clearJoinWatch]);

    const showToast = useCallback(async (newInvite: InviteRow) => {
        if (newInvite.id && lastInviteIdRef.current === newInvite.id) return;
        // Never clobber an in-flight join loading window.
        if (joinedCodeRef.current || phaseRef.current === 'joining') return;
        lastInviteIdRef.current = newInvite.id || null;

        const { data: profile } = await supabase
            .from('players')
            .select('username, avatar_url')
            .eq('wallet_address', String(newInvite.host_address).toLowerCase())
            .maybeSingle();
        // Re-check: a join may have started while the profile query was in flight.
        // Cast breaks TS narrowing inherited from the pre-await check above.
        if (joinedCodeRef.current || (phaseRef.current as string) === 'joining') return;

        setHostProfile({
            username: profile?.username || 'Host',
            avatar_url: profile?.avatar_url || ''
        });
        setInvite(newInvite);
        setPhase('card');
        setJoinError(null);
        getSoundEngine().play('invite_received');
        clearLifetimeTimers();
        expiresAtRef.current = Date.now() + INVITE_LIFETIME_S * 1000;
        setSecsLeft(INVITE_LIFETIME_S);
        tickTimer.current = setInterval(() => {
            const left = Math.max(0, Math.ceil((expiresAtRef.current - Date.now()) / 1000));
            setSecsLeft(left);
            if (left <= 0 && tickTimer.current) {
                clearInterval(tickTimer.current);
                tickTimer.current = null;
            }
        }, 250);
        hideTimer.current = setTimeout(() => {
            setInvite(null);
            setPhase('card');
        }, INVITE_LIFETIME_S * 1000);
    }, [clearLifetimeTimers, ensureAppSession]);

    // Poll + best-effort realtime delivery.
    // Cleanup MUST NOT touch lifetime/join timers — those outlive this effect
    // (playSelect/sfx prefs re-identity used to kill the countdown every render).
    useEffect(() => {
        if (!address) return;
        const lowerAddr = address.toLowerCase();

        const poll = async () => {
            try {
                const sessionId = await ensureAppSession();
                if (!sessionId) return;
                const res = await fetch(`/api/lobby/invites?wallet=${encodeURIComponent(lowerAddr)}&sessionId=${encodeURIComponent(sessionId)}`, {
                    signal: AbortSignal.timeout(8000),
                });
                if (!res.ok) return;
                const data = await res.json();
                const first = data?.invites?.[0];
                if (first && first.id !== lastInviteIdRef.current) {
                    await showToast(first);
                }
            } catch { /* network / timeout */ }
        };
        void poll();
        const iv = setInterval(poll, 4000);

        const channel = supabase
            .channel('global-invites')
            .on(
                'postgres_changes',
                {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'game_invites',
                    filter: `guest_address=eq.${lowerAddr}`
                },
                async (payload) => {
                    await showToast(payload.new as InviteRow);
                }
            )
            .subscribe();

        return () => {
            clearInterval(iv);
            supabase.removeChannel(channel);
        };
    }, [address, showToast]);

    // Unmount: drop every timer.
    useEffect(() => () => {
        clearLifetimeTimers();
        clearJoinWatch();
    }, [clearLifetimeTimers, clearJoinWatch]);

    // Seated → close loading. GameLobby auto-opens Team Up on the same seat.
    useEffect(() => {
        if (phase !== 'joining' || !invite || !me) return;
        const code = invite.room_code?.toUpperCase();
        const seated = !!lobbyState
            && lobbyState.roomCode?.toUpperCase() === code
            && (lobbyState.slots || []).some(s => s.status === 'joined' && s.playerId?.toLowerCase() === me);
        if (seated) dismissAll();
    }, [phase, invite, me, lobbyState, dismissAll]);

    // Host started the match while we were joining → drop overlay, ride into game.
    useEffect(() => {
        if (phase !== 'joining' && phase !== 'error') return;
        if (lobbyState?.status === 'playing') dismissAll();
    }, [phase, lobbyState?.status, dismissAll]);

    const startJoin = useCallback((row: InviteRow) => {
        clearLifetimeTimers();
        clearJoinWatch();
        setPhase('joining');
        setJoinError(null);
        joinedCodeRef.current = row.room_code;
        joinDeadline.current = Date.now() + JOIN_TIMEOUT_MS;
        joinGame(row.room_code, row.validation_token || undefined);

        joinWatch.current = setInterval(() => {
            if (Date.now() >= joinDeadline.current) {
                clearJoinWatch();
                setPhase('error');
                setJoinError("Couldn't reach the host. They may be offline, or the room is full.");
            }
        }, 400);
    }, [clearLifetimeTimers, clearJoinWatch, joinGame]);

    const handleAccept = () => {
        if (!invite || phase !== 'card') return;
        getSoundEngine().play('invite_accept');
        startJoin(invite);
    };

    const handleIgnore = () => {
        getSoundEngine().play('invite_reject');
        dismissAll();
    };

    const handleCancelJoin = () => {
        try { leaveGame(); } catch { /* already clean */ }
        dismissAll();
    };

    if (!invite) return null;

    const hostName = hostProfile?.username || 'Host';
    const matchLabel = (invite.match_type || 'MATCH').toUpperCase();
    const feeLabel = typeof invite.entry_fee === 'number' && invite.entry_fee > 0
        ? `${invite.entry_fee.toLocaleString()} LUDO`
        : 'FREE';
    const fee = typeof invite.entry_fee === 'number' ? invite.entry_fee : 0;
    const shortOnCoins = fee > 0 && myCoins !== null && myCoins < fee;
    const acceptLabel = phase === 'card'
        ? (secsLeft > 0 ? `Accept · ${secsLeft}s` : 'Accept')
        : 'Accept';

    return (
        <div
            className="fixed inset-0 z-[220] flex items-start justify-center px-4 pt-16 sm:items-center sm:pt-0 pointer-events-none"
            role="status"
            aria-live="polite"
        >
            <div
                className="ludo-invite-scope panel-shell-3077 pointer-events-auto w-full max-w-[380px] rounded-[28px] border border-line-soft shadow-2xl overflow-hidden relative"
            >
                <HudCornerTicks />
                {phase === 'card' && (
                    <div className="absolute top-0 left-5 right-5 h-0.5 rounded-full bg-surface-recessed overflow-hidden pointer-events-none">
                        <div
                            className="h-full w-full bg-accent origin-left transition-transform duration-200 ease-linear"
                            style={{ transform: `scaleX(${Math.max(0, Math.min(1, secsLeft / INVITE_LIFETIME_S))})` }}
                        />
                    </div>
                )}

                {phase === 'joining' ? (
                    <div className="flex flex-col items-center text-center px-6 py-8 gap-3">
                        <div className="w-10 h-10 border-[3px] border-accent/20 border-t-accent rounded-full animate-spin" />
                        <p className="text-ludo-xs font-bold label-chrome uppercase tracking-[0.3em] text-accent">
                            Joining room
                        </p>
                        <p className="text-2xl font-bold label-chrome text-ink-strong tracking-[0.22em]">
                            {invite.room_code}
                        </p>
                        <p className="text-ludo-sm text-ink-faint font-bold uppercase tracking-wider">
                            Seating you with {hostName}…
                        </p>
                        <Button
                            variant="secondary"
                            size="md"
                            fullWidth
                            onClick={handleCancelJoin}
                            className="mt-2 label-chrome uppercase tracking-[0.2em]"
                        >
                            Cancel
                        </Button>
                    </div>
                ) : phase === 'error' ? (
                    <div className="flex flex-col items-center text-center px-6 py-7 gap-2.5">
                        <p className="text-ludo-xs font-bold label-chrome uppercase tracking-[0.3em] text-warn">
                            Room unavailable
                        </p>
                        <p className="text-ludo-md font-bold text-ink-strong leading-relaxed">
                            {joinError || 'Join failed.'}
                        </p>
                        <div className="flex gap-2 w-full mt-2">
                            <Button
                                variant="primary"
                                size="md"
                                onClick={() => {
                                    if (!invite) return;
                                    joinedCodeRef.current = null;
                                    startJoin(invite);
                                }}
                                className="flex-1 label-chrome uppercase tracking-[0.2em]"
                            >
                                Try again
                            </Button>
                            <Button
                                variant="secondary"
                                size="md"
                                onClick={dismissAll}
                                className="flex-1 label-chrome uppercase tracking-[0.2em]"
                            >
                                Close
                            </Button>
                        </div>
                    </div>
                ) : (
                    <div className="relative">
                        <div className="absolute inset-0 bg-gradient-to-b from-accent/10 to-transparent pointer-events-none" />

                        <div className="relative flex items-center gap-3 px-5 pt-5">
                            <div className="relative w-12 h-12 shrink-0">
                                <div className="absolute inset-0 bg-accent-soft rounded-full animate-pulse" />
                                <div className="w-full h-full rounded-full border-2 border-accent/50 overflow-hidden bg-surface-recessed">
                                    {hostProfile?.avatar_url ? (
                                        <img
                                            loading="lazy"
                                            decoding="async"
                                            src={hostProfile.avatar_url}
                                            alt=""
                                            className="w-full h-full object-cover"
                                            width={96}
                                            height={96}
                                        />
                                    ) : (
                                        <div className="w-full h-full flex items-center justify-center text-xl font-bold label-chrome text-accent">
                                            {hostName[0]?.toUpperCase() || 'H'}
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className="flex-1 min-w-0">
                                <span className="flex items-center gap-1.5 text-ludo-xs font-bold label-chrome text-accent tracking-[0.2em] uppercase mb-1">
                                    <span className="w-1 h-1 rounded-full bg-accent animate-pulse" />
                                    Incoming Signal
                                </span>
                                <h4 className="text-ink-strong font-bold text-base leading-tight truncate">
                                    {hostName} <span className="text-ink-faint font-medium">invites you</span>
                                </h4>
                                <div className="flex gap-3 mt-1">
                                    <span className="text-ludo-xs font-bold text-ink-faint uppercase tracking-widest">
                                        {matchLabel}
                                    </span>
                                    <span className="text-ludo-xs font-bold text-warn uppercase tracking-widest">
                                        {feeLabel}
                                    </span>
                                </div>
                                {shortOnCoins && phase === 'card' && (
                                    <p className="mt-1.5 text-ludo-xs font-bold text-warn leading-snug">
                                        You have {myCoins?.toLocaleString() ?? 0} · entry is {fee.toLocaleString()}. Host can lower the fee.
                                    </p>
                                )}
                            </div>
                        </div>

                        <div className="relative flex gap-2 px-5 pt-4 pb-5">
                            <Button
                                variant="primary"
                                size="md"
                                onClick={handleAccept}
                                disabled={secsLeft <= 0}
                                className="invite-accept-btn flex-1 label-chrome uppercase tracking-[0.16em] tabular-nums"
                            >
                                {acceptLabel}
                            </Button>
                            <Button
                                variant="secondary"
                                size="md"
                                onClick={handleIgnore}
                                className="px-5 label-chrome uppercase tracking-[0.2em]"
                            >
                                Ignore
                            </Button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};
