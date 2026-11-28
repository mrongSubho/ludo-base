'use client';

import { useEffect, useRef } from 'react';
import type { PlayerColor, SeatPresenceState } from '@/lib/types';

interface UseClientPresenceProps {
    enabled: boolean;
    myColor?: PlayerColor;
    matchAuthorityMode: 'offline' | 'p2p' | 'room';
    roomAuthority: boolean;
    sendRoomIntent: (kind: string, payload?: unknown) => Promise<unknown>;
    onLocalPresenceChange?: (color: PlayerColor, presence: SeatPresenceState) => void;
}

function readWindowPresence(): SeatPresenceState {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        return 'disconnected';
    }
    if (typeof document !== 'undefined') {
        if (document.visibilityState === 'hidden') return 'tab_hidden';
        if (typeof document.hasFocus === 'function' && !document.hasFocus()) {
            return 'window_blurred';
        }
    }
    return 'active';
}

/**
 * Multi-signal client presence detector:
 * reports `active`, `window_blurred`, `tab_hidden`, or `disconnected`
 * to MatchRoomCore via `CMD_PRESENCE` (or updates local offline state).
 */
export function useClientPresence({
    enabled,
    myColor,
    matchAuthorityMode,
    roomAuthority,
    sendRoomIntent,
    onLocalPresenceChange,
}: UseClientPresenceProps): void {
    const lastSentRef = useRef<SeatPresenceState | null>(null);
    const sendRoomIntentRef = useRef(sendRoomIntent);
    sendRoomIntentRef.current = sendRoomIntent;
    const onLocalRef = useRef(onLocalPresenceChange);
    onLocalRef.current = onLocalPresenceChange;

    useEffect(() => {
        if (!enabled || !myColor) {
            lastSentRef.current = null;
            return;
        }

        const report = () => {
            const next = readWindowPresence();
            if (lastSentRef.current === next) return;
            lastSentRef.current = next;

            if (matchAuthorityMode === 'room') {
                if (roomAuthority) {
                    void sendRoomIntentRef.current('CMD_PRESENCE', { presence: next });
                }
            } else {
                onLocalRef.current?.(myColor, next);
            }
        };

        report();

        window.addEventListener('focus', report);
        window.addEventListener('blur', report);
        window.addEventListener('online', report);
        window.addEventListener('offline', report);
        document.addEventListener('visibilitychange', report);

        return () => {
            window.removeEventListener('focus', report);
            window.removeEventListener('blur', report);
            window.removeEventListener('online', report);
            window.removeEventListener('offline', report);
            document.removeEventListener('visibilitychange', report);
        };
    }, [enabled, myColor, matchAuthorityMode, roomAuthority]);
}
