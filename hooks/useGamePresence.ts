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

    useEffect(() => {
        if (!roomCode) return;

        console.log(`📡 [Presence] Joining game-presence-${roomCode}...`);

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
                playersList.sort((a, b) => a.joinedAt - b.joinedAt);
                const activeWallets = playersList.map(p => p.wallet.toLowerCase());

                const isHost = activeWallets.length > 0 && walletAddress 
                    ? activeWallets[0] === walletAddress.toLowerCase() 
                    : false;

                setPresenceState({ 
                    activePlayers: activeWallets, 
                    isComputeHost: isHost
                });
                
                console.log(`👑 [Presence] Compute Hierarchy updated:`, activeWallets);
            })
            .subscribe(async (status) => {
                if (status === 'SUBSCRIBED' && walletAddress) {
                    await channel.track({ wallet: walletAddress, joinedAt: Date.now() });
                }
            });

        return () => {
            console.log(`🚪 [Presence] Leaving game-presence-${roomCode}`);
            channel.untrack().then(() => supabase.removeChannel(channel));
            channelRef.current = null;
        };
    }, [roomCode, walletAddress]);

    return presenceState;
}

