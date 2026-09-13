"use client";

import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';

interface GamePresenceState {
    activePlayers: string[]; // Ordered array of wallet addresses
    isComputeHost: boolean;
}

export function useGamePresence(
    roomCode: string | null,
    walletAddress?: string
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
                        electedHostRef.current = nextHost;
                        setPresenceState(prev => ({
                            ...prev,
                            isComputeHost: walletAddress?.toLowerCase() === electedHostRef.current,
                        }));
                    }, 1000);
                }

                const electedHost = electedHostRef.current;
                setPresenceState({
                    activePlayers: activeWallets,
                    isComputeHost: !!electedHost && electedHost === walletAddress?.toLowerCase(),
                });
                
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
