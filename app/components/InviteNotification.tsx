import React, { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useTeamUpContext } from '@/hooks/TeamUpContext';
import { useSoundEffects } from '../hooks/useSoundEffects';

// ─── Theme-agnostic contract (holds for current + future themes) ───────────
// Same vocabulary as the synced panels: white-ink + white-opacity surfaces +
// cyan/status accents on the shared dark-glass surface. No font-family is set
// (inherits the active theme's display font). Spacing inside
// `.ludo-invite-scope` is re-asserted in globals.css (the global unlayered
// reset zeroes Tailwind utilities).

export const InviteNotification = () => {
    const { address } = useCurrentUser();
    const { joinGame } = useTeamUpContext();
    const { playSelect } = useSoundEffects();
    const [invite, setInvite] = useState<any>(null);
    const [hostProfile, setHostProfile] = useState<{ username: string; avatar_url: string } | null>(null);
    // 10s to interact, then it vanishes. Visible countdown included.
    const [secsLeft, setSecsLeft] = useState(10);
    const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const tickTimer = useRef<ReturnType<typeof setInterval> | null>(null);
    const lastInviteIdRef = useRef<string | null>(null);
    const clearTimers = () => {
        if (hideTimer.current) clearTimeout(hideTimer.current);
        if (tickTimer.current) clearInterval(tickTimer.current);
        hideTimer.current = null;
        tickTimer.current = null;
    };

    const showToast = useCallback(async (newInvite: { id?: string; host_address: string; room_code: string; validation_token?: string | null }) => {
        if (newInvite.id && lastInviteIdRef.current === newInvite.id) return;
        lastInviteIdRef.current = newInvite.id || null;
        const { data: profile } = await supabase
            .from('players')
            .select('username, avatar_url')
            .eq('wallet_address', String(newInvite.host_address).toLowerCase())
            .single();
        setHostProfile({
            username: profile?.username || 'Host',
            avatar_url: profile?.avatar_url || ''
        });
        setInvite(newInvite);
        playSelect();
        clearTimers();
        setSecsLeft(10);
        tickTimer.current = setInterval(() => {
            setSecsLeft(s => Math.max(0, s - 1));
        }, 1000);
        hideTimer.current = setTimeout(() => setInvite(null), 10000);
    }, [playSelect]);

    useEffect(() => {
        if (!address) return;
        const lowerAddr = address.toLowerCase();

        // Poll: wallet-only app has no Supabase Auth, so realtime on
        // game_invites never delivers. Poll the service API instead.
        const poll = async () => {
            try {
                const res = await fetch(`/api/lobby/invites?wallet=${encodeURIComponent(lowerAddr)}`, {
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

        // Best-effort realtime (works only if RLS/publication allows).
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
                    await showToast(payload.new as { id?: string; host_address: string; room_code: string; validation_token?: string | null });
                }
            )
            .subscribe();

        return () => {
            clearTimers();
            clearInterval(iv);
            supabase.removeChannel(channel);
        };
    }, [address, playSelect, showToast]);

    const handleAccept = () => {
        if (invite) {
            clearTimers();
            joinGame(invite.room_code, invite.validation_token || undefined);
            setInvite(null);
        }
    };

    const handleIgnore = () => {
        clearTimers();
        setInvite(null);
    };

    return (
        <>
            {invite && (
                <div
                    className="fixed top-5 left-1/2 -translate-x-1/2 z-[200] w-[calc(100%-32px)] max-w-[400px]"
                >
                    <div
                        className="ludo-invite-scope border border-white/10 rounded-[32px] p-5 shadow-2xl overflow-hidden relative"
                        style={{ background: 'var(--panel-bg-image, var(--ludo-bg-cosmic))', backgroundColor: 'var(--panel-bg, rgba(13,13,13,0.92))', backdropFilter: 'blur(32px)' }}
                    >
                        {/* Glowing Background Pulse */}
                        <div className="absolute inset-0 bg-gradient-to-b from-cyan-500/10 to-transparent pointer-events-none" />
                        {/* 10s vanish progress */}
                        <div className="absolute top-0 left-5 right-5 h-0.5 rounded-full bg-white/10 overflow-hidden pointer-events-none">
                            <div
                                className="h-full bg-cyan-400/80 transition-[width] duration-1000 ease-linear"
                                style={{ width: `${secsLeft * 10}%` }}
                            />
                        </div>

                        <div className="flex items-center gap-3 relative z-10">
                            {/* Host Avatar Pod */}
                            <div className="relative w-12 h-12 shrink-0">
                                <div className="absolute inset-0 bg-cyan-500/20 rounded-full animate-pulse" />
                                <div className="w-full h-full rounded-full border-2 border-cyan-400/50 overflow-hidden bg-slate-800">
                                    {hostProfile?.avatar_url ? (
                                        <img loading="lazy" decoding="async" src={hostProfile.avatar_url} alt="host" className="w-full h-full object-cover" />
                                    ) : (
                                        <div className="w-full h-full flex items-center justify-center text-xl font-black text-cyan-400">
                                            {hostProfile?.username?.[0] || 'H'}
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className="flex-1 min-w-0">
                                <span className="flex items-center gap-1.5 text-[10px] font-black text-cyan-300 tracking-[0.2em] uppercase mb-1">
                                    <span className="w-1 h-1 rounded-full bg-cyan-400 animate-pulse" />
                                    Incoming Signal
                                    <span className="ml-auto px-1.5 py-0.5 rounded-md bg-white/10 text-[9px] tabular-nums text-white/60">
                                        {secsLeft}s
                                    </span>
                                </span>
                                <h4 className="text-white font-bold text-base leading-tight truncate">
                                    {hostProfile?.username || 'WARRIOR'} <span className="text-white/40 font-medium">invites you</span>
                                </h4>
                                <div className="flex gap-3 mt-1">
                                    <span className="text-[9px] font-bold text-white/40 uppercase tracking-widest">{invite.match_type}</span>
                                    <span className="text-[9px] font-bold text-amber-400 uppercase tracking-widest">{invite.entry_fee?.toLocaleString()} LUDO</span>
                                </div>
                            </div>
                        </div>

                        <div className="flex gap-2 mt-3 relative z-10">
                            <button
                                onClick={handleAccept}
                                className="flex-1 py-3 bg-cyan-500 text-slate-950 text-sm font-black uppercase tracking-[0.2em] rounded-2xl hover:bg-cyan-400 transition-all active:scale-95 shadow-lg shadow-cyan-500/20"
                            >
                                Accept Entry
                            </button>
                            <button
                                onClick={handleIgnore}
                                className="px-5 py-3 bg-white/5 border border-white/10 text-white/60 text-sm font-black uppercase tracking-[0.2em] rounded-2xl hover:bg-white/10 hover:text-white transition-all active:scale-95"
                            >
                                Ignore
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};
