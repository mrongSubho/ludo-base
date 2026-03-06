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

        const syncStatus = async (statusOverride?: string) => {
            // Determine current status
            let currentStatus = statusOverride || 'Online';
            if (!statusOverride && (gameState.status === 'playing' || gameState.isStarted)) {
                currentStatus = 'In Match';
            }

            await supabase
                .from('players')
                .update({
                    status: currentStatus,
                    last_seen_at: new Date().toISOString()
                })
                .eq('wallet_address', address.toLowerCase());

            lastStatusRef.current = currentStatus;
        };

        // Handle tab close / refresh
        const handleUnload = () => {
            if (address) {
                // We use a regular update here; navigating away might cancel the request
                // but we try our best. The SQL job handles the rest.
                supabase.from('players').update({ status: 'Offline' }).eq('wallet_address', address.toLowerCase()).then();
            }
        };

        window.addEventListener('beforeunload', handleUnload);

        // Initial sync
        syncStatus();

        // Heartbeat every 30 seconds
        const interval = setInterval(() => syncStatus(), 30000);

        return () => {
            clearInterval(interval);
            window.removeEventListener('beforeunload', handleUnload);
            syncStatus('Offline');
        };
    }, [address, isConnected, gameState.status, gameState.isStarted]);

    return null;
}
