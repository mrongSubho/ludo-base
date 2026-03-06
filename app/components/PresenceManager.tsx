"use client";

import { useEffect, useRef } from 'react';
import { useAccount } from 'wagmi';
import { supabase } from '@/lib/supabase';
import { useMultiplayer } from '@/hooks/useMultiplayer';

export default function PresenceManager() {
    const { address, isConnected } = useAccount();
    const { gameState } = useMultiplayer();
    const lastStatusRef = useRef<string | null>(null);

    useEffect(() => {
        if (!isConnected || !address) return;

        const syncStatus = async () => {
            // Determine current status
            let currentStatus = 'Online';
            if (gameState.status === 'playing' || gameState.isStarted) {
                currentStatus = 'In Match';
            }

            // Update database if status changed OR every 30s as a heartbeat
            const { error } = await supabase
                .from('players')
                .update({
                    status: currentStatus,
                    last_seen_at: new Date().toISOString()
                })
                .eq('wallet_address', address.toLowerCase());

            if (!error) {
                lastStatusRef.current = currentStatus;
            }
        };

        // Initial sync
        syncStatus();

        // Heartbeat every 30 seconds
        const interval = setInterval(syncStatus, 30000);

        return () => clearInterval(interval);
    }, [address, isConnected, gameState.status, gameState.isStarted]);

    // Handle offline status on unmount
    useEffect(() => {
        return () => {
            if (address) {
                supabase
                    .from('players')
                    .update({ status: 'Offline' })
                    .eq('wallet_address', address.toLowerCase())
                    .then();
            }
        };
    }, [address]);

    return null;
}
