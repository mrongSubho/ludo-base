/* eslint-disable @typescript-eslint/no-explicit-any -- lint burn-down quarantine 2026-09-23 */
"use client";

import { useEffect, useRef } from 'react';
import { useAccount } from 'wagmi';
import { useTeamUp } from '@/hooks/useTeamUp';
import { useAppSession } from '@/hooks/useAppSession';

export default function PresenceManager() {
    const { address, isConnected } = useAccount();
    const { gameState, lobbyState } = useTeamUp();
    const { ensureAppSession } = useAppSession();
    const lastStatusRef = useRef<string | null>(null);

    useEffect(() => {
        if (!isConnected || !address) return;

        const syncStatus = async (statusOverride?: string) => {
            // Determine current status
            let currentStatus = statusOverride || 'Online';
            if (!statusOverride && (gameState.status === 'playing' || gameState.isStarted)) {
                currentStatus = 'In Match';
            }

            // Publish room code with status so EVERY client (host or guest)
            // is spectatable — the old host-only write left guests invisible.
            const sessionId = await ensureAppSession();
            if (!sessionId) return;
            await fetch('/api/presence', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ walletAddress: address, sessionId, status: currentStatus, currentRoomCode: (lobbyState as any)?.roomCode })
            });

            lastStatusRef.current = currentStatus;
        };

        // Handle tab close / refresh
        const handleUnload = () => {
            if (address) {
                // We use a regular update here; navigating away might cancel the request
                // but we try our best. The SQL job handles the rest.
                void ensureAppSession().then(sessionId => {
                    if (!sessionId) return null;
                    return fetch('/api/presence', {
                        method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ walletAddress: address, sessionId, status: 'Offline' })
                    });
                });
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
    }, [address, isConnected, gameState.status, gameState.isStarted, (lobbyState as any)?.roomCode, ensureAppSession]);

    return null;
}
