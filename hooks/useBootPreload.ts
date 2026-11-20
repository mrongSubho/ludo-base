'use client';

import { useEffect, useRef, useState } from 'react';
import { useGameData } from '@/hooks/GameDataContext';
import { getOrCreateIdentityKey } from '@/lib/encryption';

export interface BootPreloadSnapshot {
    authReady: boolean;
    socialReady: boolean;
    ledgerWarmed: boolean;
    arenaWarmed: boolean;
    chunksWarmed: boolean;
    completedCount: number;
    totalStages: number;
    percent: number;
}

/**
 * Parallel background preload orchestrator executed during the cold-boot video.
 * Defers heavy chunk imports and directory network fetches until `canStartHeavy`
 * flips true (right after video frame-1 starts playing, or after a 1.5s fallback)
 * so initial boot bandwidth & CPU belong 100% to instant video startup.
 */
export function useBootPreload(isSessionChecking: boolean, canStartHeavy = true): BootPreloadSnapshot {
    const gameData = useGameData();
    const heavyStartedRef = useRef(false);

    const [ecdhWarmed, setEcdhWarmed] = useState(false);
    const [ledgerWarmed, setLedgerWarmed] = useState(false);
    const [arenaWarmed, setArenaWarmed] = useState(false);
    const [chunksWarmed, setChunksWarmed] = useState(false);

    const ownerId = gameData.myProfile?.wallet_address ?? null;

    // 1. Warm IndexedDB ECDH identity key once wallet address is available (deferred until video plays)
    useEffect(() => {
        if (!canStartHeavy) return;
        if (!ownerId) {
            setEcdhWarmed(true);
            return;
        }
        let alive = true;
        void getOrCreateIdentityKey(ownerId.toLowerCase())
            .catch(() => undefined)
            .finally(() => {
                if (alive) setEcdhWarmed(true);
            });
        return () => {
            alive = false;
        };
    }, [canStartHeavy, ownerId]);

    useEffect(() => {
        if (!canStartHeavy || heavyStartedRef.current) return;
        heavyStartedRef.current = true;
        let alive = true;

        // 2. Broadcast passive ledger refresh so wallet/vault/claims caches hydrate in parallel
        if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('ludo-chips-refresh'));
            window.dispatchEvent(new CustomEvent('ludo-arena-vault-updated'));
            window.dispatchEvent(new CustomEvent('ludo-clan-claims-updated'));
        }
        const ledgerTimer = window.setTimeout(() => {
            if (alive) setLedgerWarmed(true);
        }, 650);

        // 3. Pre-warm public live arena directory endpoint into browser HTTP cache
        const controller = new AbortController();
        const arenaTimeout = window.setTimeout(() => controller.abort(), 5000);
        void fetch('/api/live-arena/directory', {
            method: 'GET',
            signal: controller.signal,
            cache: 'no-store',
        })
            .catch(() => undefined)
            .finally(() => {
                window.clearTimeout(arenaTimeout);
                if (alive) setArenaWarmed(true);
            });

        // 4. Preload heavy lazy route/panel chunks so lobby -> board / wallet is instant
        void Promise.allSettled([
            import('@/app/components/Board'),
            import('@/app/components/WalletPanel'),
            import('@/app/components/ArenaPanel'),
            import('@/app/components/FriendsPanel'),
        ]).finally(() => {
            if (alive) setChunksWarmed(true);
        });

        return () => {
            alive = false;
            window.clearTimeout(ledgerTimer);
            window.clearTimeout(arenaTimeout);
            controller.abort();
        };
    }, [canStartHeavy]);

    const authReady = !isSessionChecking;
    const socialReady = gameData.isBootComplete || (!gameData.isBooting && ecdhWarmed);
    const stages = [authReady, socialReady, ledgerWarmed, arenaWarmed, chunksWarmed];
    const completedCount = stages.filter(Boolean).length;
    const totalStages = stages.length;

    return {
        authReady,
        socialReady,
        ledgerWarmed,
        arenaWarmed,
        chunksWarmed,
        completedCount,
        totalStages,
        percent: Math.round((completedCount / totalStages) * 100),
    };
}
