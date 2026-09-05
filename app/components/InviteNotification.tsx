import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useAccount } from 'wagmi';
import { useTeamUpContext } from '@/hooks/TeamUpContext';
import { useSoundEffects } from '../hooks/useSoundEffects';

// ─── Theme-agnostic contract (holds for current + future themes) ───────────
// Same vocabulary as the synced panels: white-ink + white-opacity surfaces +
// cyan/status accents on the shared dark-glass surface. No font-family is set
// (inherits the active theme's display font). Spacing inside
// `.ludo-invite-scope` is re-asserted in globals.css (the global unlayered
// reset zeroes Tailwind utilities).

export const InviteNotification = () => {
    const { address } = useAccount();
    const { joinGame } = useTeamUpContext();
    const { playSelect } = useSoundEffects();
    const [invite, setInvite] = useState<any>(null);
    const [hostProfile, setHostProfile] = useState<{ username: string; avatar_url: string } | null>(null);

    useEffect(() => {
        if (!address) return;
        const lowerAddr = address.toLowerCase();

        // 1. Listen for NEW inserts into game_invites where guest_address matches
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
                    const newInvite = payload.new;
                    
                    // 2. Fetch Host Profile
                    const { data: profile } = await supabase
                        .from('players')
                        .select('username, avatar_url')
                        .eq('wallet_address', newInvite.host_address.toLowerCase())
                        .single();

                    setHostProfile({
                        username: profile?.username || 'Host',
                        avatar_url: profile?.avatar_url || ''
                    });
                    setInvite(newInvite);
                    playSelect();

                    // Auto-hide after 15 seconds
                    setTimeout(() => setInvite(null), 15000);
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [address, playSelect]);

    const handleAccept = () => {
        if (invite) {
            joinGame(invite.room_code);
            setInvite(null);
        }
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

                        <div className="flex items-center gap-3 relative z-10">
                            {/* Host Avatar Pod */}
                            <div className="relative w-12 h-12 shrink-0">
                                <div className="absolute inset-0 bg-cyan-500/20 rounded-full animate-pulse" />
                                <div className="w-full h-full rounded-full border-2 border-cyan-400/50 overflow-hidden bg-slate-800">
                                    {hostProfile?.avatar_url ? (
                                        <img src={hostProfile.avatar_url} alt="host" className="w-full h-full object-cover" />
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
                                onClick={() => setInvite(null)}
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
