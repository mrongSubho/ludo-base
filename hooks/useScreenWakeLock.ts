"use client";

import { useEffect, useRef } from 'react';

// Keep the screen on while a match (or spectated match) is live: phones
// auto-locking mid-game can cost a turn or drop realtime connections.
// Unsupported browsers/webviews fail silent — the game plays on regardless.
// The lock is scoped to active play and always released on exit.
type WakeLockSentinelLike = {
    readonly released: boolean;
    release: () => Promise<void>;
    addEventListener: (type: 'release', listener: () => void) => void;
    removeEventListener: (type: 'release', listener: () => void) => void;
};

type WakeLockNavigator = Navigator & {
    wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinelLike> };
};

export function useScreenWakeLock(active: boolean) {
    const lockRef = useRef<WakeLockSentinelLike | null>(null);
    const activeRef = useRef(active);
    activeRef.current = active;

    useEffect(() => {
        if (!active) return;
        const nav = (typeof navigator !== 'undefined' ? navigator : undefined) as WakeLockNavigator | undefined;
        if (!nav?.wakeLock) return;

        let cancelled = false;

        const releaseCurrent = () => {
            const lock = lockRef.current;
            lockRef.current = null;
            if (lock && !lock.released) void lock.release().catch(() => {});
        };

        const request = async () => {
            if (cancelled || !activeRef.current) return;
            if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
            try {
                const lock = await nav.wakeLock!.request('screen');
                if (cancelled || !activeRef.current) {
                    await lock.release().catch(() => {});
                    return;
                }
                releaseCurrent();
                lockRef.current = lock;
                // The OS can revoke the lock (low battery, policy). While the
                // match is still live and visible, take it again.
                const onRelease = () => {
                    if (lockRef.current === lock) lockRef.current = null;
                    void request();
                };
                lock.addEventListener('release', onRelease);
            } catch {
                // Denied or unsupported — never block play for a lock.
            }
        };

        // Wake locks die when the page hides; take a fresh one on return.
        const onVisibility = () => {
            if (document.visibilityState === 'visible') void request();
            else releaseCurrent();
        };

        void request();
        document.addEventListener('visibilitychange', onVisibility);
        return () => {
            cancelled = true;
            document.removeEventListener('visibilitychange', onVisibility);
            releaseCurrent();
        };
    }, [active]);
}
