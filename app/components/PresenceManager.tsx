/* eslint-disable @typescript-eslint/no-explicit-any -- lint burn-down quarantine 2026-09-23 */
"use client";

import { useEffect, useRef } from 'react';
import { useAccount } from 'wagmi';
import { useTeamUp } from '@/hooks/useTeamUp';
import { useAppSession } from '@/hooks/useAppSession';

export default function PresenceManager() {
    const { address, isConnected } = useAccount();
    const { gameState, lobbyState } = useTeamUp();
    const { peekAppSession } = useAppSession();
    const lastStatusRef = useRef<string | null>(null);

    useEffect(() => {
        if (!isConnected || !address) return;

        const syncStatus = async (statusOverride?: string) => {
            // Cached session only — presence must NEVER open a wallet popup.
            const sessionId = peekAppSession();
            if (!sessionId) return;
            let currentStatus = statusOverride || 'Online';
            if (!statusOverride && (gameState.status === 'playing' || gameState.isStarted)) {
                currentStatus = 'In Match';
            }
            await fetch('/api/presence', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ walletAddress: address, sessionId, status: currentStatus, currentRoomCode: (lobbyState as any)?.roomCode })
            });
            lastStatusRef.current = currentStatus;
        };

        // Handle tab close / refresh — no signing on unload either
        const handleUnload = () => {
            const sessionId = peekAppSession();
            if (!address || !sessionId) return;
            void fetch('/api/presence', {
                method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ walletAddress: address, sessionId, status: 'Offline' })
            });
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
    }, [address, isConnected, gameState.status, gameState.isStarted, (lobbyState as any)?.roomCode, peekAppSession]);

    return null;
}
