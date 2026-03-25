"use client";

import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';

// ═══════════════════════════════════════════════════════════════════════
// useSpectatorPresence — Live spectator count tracker
//
// HOW IT WORKS:
//   Uses Supabase Presence (not Broadcast) on a SEPARATE channel:
//   `spectators-${roomCode}`. Each spectator joins with their wallet
//   address as the presence key. The host and all spectators can read
//   the aggregate count — powering the "1.2k spectators" badge in
//   LiveArenaDirectory without any database polling.
//
// CLEANUP:
//   The hook removes the presence track and leaves the channel on unmount,
//   so the count is always accurate (no ghost spectators).
// ═══════════════════════════════════════════════════════════════════════

interface SpectatorPresenceState {
    spectatorCount: number;
    isTracked: boolean;
}

export function useSpectatorPresence(
    roomCode: string | null,
    walletAddress?: string,
) {
    const [presenceState, setPresenceState] = useState<SpectatorPresenceState>({
        spectatorCount: 0,
        isTracked: false,
    });
    const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

    useEffect(() => {
        if (!roomCode) return;

        console.log(`👥 [Presence] Joining spectators-${roomCode}`);

        const channel = supabase.channel(`spectators-${roomCode}`, {
            config: { presence: { key: walletAddress || 'anonymous' } },
        });

        channelRef.current = channel;

        channel
            .on('presence', { event: 'sync' }, () => {
                const state = channel.presenceState<{ wallet?: string }>();
                const count = Object.keys(state).length;
                setPresenceState({ spectatorCount: count, isTracked: true });
                console.log(`👥 [Presence] spectators-${roomCode}: ${count} live`);
            })
            .subscribe(async (status) => {
                if (status === 'SUBSCRIBED' && walletAddress) {
                    await channel.track({ wallet: walletAddress, joinedAt: Date.now() });
                }
            });

        return () => {
            console.log(`🚪 [Presence] Leaving spectators-${roomCode}`);
            channel.untrack().then(() => supabase.removeChannel(channel));
            channelRef.current = null;
        };
    }, [roomCode, walletAddress]);

    return presenceState;
}
