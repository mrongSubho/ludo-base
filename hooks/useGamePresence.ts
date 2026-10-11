"use client";

import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';

interface GamePresenceState {
    activePlayers: string[]; // Ordered array of wallet addresses
    isComputeHost: boolean;
}

/**
 * NET-21: production liveness + authority metering for the match path.
 * - `heartbeat`: the presence sync IS the match liveness heartbeat
 *   (throttled to one bump per 5s — syncs also fire on joins).
 * - `authority-switch`: the elected compute host actually changed hands
 *   (initial election is not a switch).
 */
export type PresenceNetEvent =
    | { type: 'heartbeat' }
    | { type: 'authority-switch'; prev: string | null; next: string };

export function useGamePresence(
    roomCode: string | null,
    walletAddress?: string,
    onEvent?: (e: PresenceNetEvent) => void,
) {
    const [presenceState, setPresenceState] = useState<GamePresenceState>({
        activePlayers: [],
        isComputeHost: false,
    });
    const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
    const electedHostRef = useRef<string | null>(null);
    const pendingHostRef = useRef<string | null>(null);
    const activeWalletsRef = useRef<string[]>([]);
    const pendingHostTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    // Callback + heartbeat throttle live in refs so the channel effect below
    // does not resubscribe when the parent re-renders.
    const onEventRef = useRef(onEvent);
    onEventRef.current = onEvent;
    const lastHeartbeatRef = useRef(0);

    useEffect(() => {
        if (!roomCode) return;

        console.log(`📡 [Presence] Joining game-presence-${roomCode}...`);
        const storageKey = `ludo-presence-joined-at:${roomCode}`;
        const storedJoinedAt = typeof window !== 'undefined'
            ? window.sessionStorage.getItem(storageKey)
            : null;
        const joinedAt = storedJoinedAt ? Number(storedJoinedAt) : Date.now();
        if (!storedJoinedAt && typeof window !== 'undefined') {
            window.sessionStorage.setItem(storageKey, String(joinedAt));
        }

        const channel = supabase.channel(`game-presence-${roomCode}`, {
            config: { presence: { key: walletAddress || 'anonymous' } },
        });

        channelRef.current = channel;

        channel
            .on('presence', { event: 'sync' }, () => {
                const state = channel.presenceState<{ wallet?: string, joinedAt: number }>();
                
                const playersList: { wallet: string, joinedAt: number }[] = [];
                for (const key in state) {
                    const presenceArray = state[key];
                    if (presenceArray && presenceArray.length > 0) {
                        const p = presenceArray[0];
                        if (p.wallet) {
                            playersList.push({ wallet: p.wallet, joinedAt: p.joinedAt || Date.now() });
                        }
                    }
                }

                // Sort by joinedAt ascending (oldest first). 
                // The oldest connected player is the Compute Host.
                playersList.sort((a, b) => a.joinedAt - b.joinedAt || a.wallet.localeCompare(b.wallet));
                const activeWallets = playersList.map(p => p.wallet.toLowerCase());
                activeWalletsRef.current = activeWallets;
                const candidate = activeWallets[0] || null;
                const current = electedHostRef.current;

                if (!current || activeWallets.includes(current)) {
                    electedHostRef.current = current || candidate;
                    pendingHostRef.current = null;
                    if (pendingHostTimerRef.current) {
                        clearTimeout(pendingHostTimerRef.current);
                        pendingHostTimerRef.current = null;
                    }
                } else if (candidate && candidate !== pendingHostRef.current) {
                    pendingHostRef.current = candidate;
                    if (pendingHostTimerRef.current) clearTimeout(pendingHostTimerRef.current);
                    pendingHostTimerRef.current = setTimeout(() => {
                        const nextHost = pendingHostRef.current;
                        pendingHostTimerRef.current = null;
                        pendingHostRef.current = null;
                        if (!nextHost || !activeWalletsRef.current.includes(nextHost)) return;
                        const prev = electedHostRef.current;
                        electedHostRef.current = nextHost;
                        // Only a change of hands is a switch — the initial
                        // election has no predecessor to switch from.
                        if (prev && prev !== nextHost) {
                            onEventRef.current?.({ type: 'authority-switch', prev, next: nextHost });
                        }
                        setPresenceState(prevState => ({
                            ...prevState,
                            isComputeHost: walletAddress?.toLowerCase() === electedHostRef.current,
                        }));
                    }, 1000);
                }

                const electedHost = electedHostRef.current;
                setPresenceState({
                    activePlayers: activeWallets,
                    isComputeHost: !!electedHost && electedHost === walletAddress?.toLowerCase(),
                });

                // Match-path liveness heartbeat (throttled — syncs also fire
                // on joins, which are not heartbeats).
                const now = Date.now();
                if (now - lastHeartbeatRef.current >= 5000) {
                    lastHeartbeatRef.current = now;
                    onEventRef.current?.({ type: 'heartbeat' });
                }
                
                console.log(`👑 [Presence] Compute Hierarchy updated:`, activeWallets);
            })
            .subscribe(async (status) => {
                if (status === 'SUBSCRIBED' && walletAddress) {
                    await channel.track({ wallet: walletAddress, joinedAt });
                }
            });

        return () => {
            console.log(`🚪 [Presence] Leaving game-presence-${roomCode}`);
            channel.untrack().then(() => supabase.removeChannel(channel));
            channelRef.current = null;
            if (pendingHostTimerRef.current) clearTimeout(pendingHostTimerRef.current);
            pendingHostTimerRef.current = null;
            pendingHostRef.current = null;
            electedHostRef.current = null;
            activeWalletsRef.current = [];
        };
    }, [roomCode, walletAddress]);

    return presenceState;
}
