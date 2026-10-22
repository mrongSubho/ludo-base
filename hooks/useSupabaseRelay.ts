/* eslint-disable @typescript-eslint/no-explicit-any -- lint burn-down quarantine 2026-09-23 */
import { useCallback, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { LobbyState } from '@/lib/types';
import { createDedupStore, type DedupStore } from '@/lib/netcode/dedup';
import { bumpNet } from '@/lib/netcode/counters';

interface UseSupabaseRelayProps {
    myAddress: string | undefined;
    lobbyState: LobbyState | null;
    currentRoomCode: string | null;
    processGameAction: (data: any) => void;
}

export function useSupabaseRelay({
    myAddress,
    lobbyState,
    currentRoomCode,
    processGameAction,
}: UseSupabaseRelayProps) {
    // NET-08: TTL + LRU-bounded eviction replaces an unbounded Set that grew
    // for the whole session. Evictions meter net_intent_dup so a dropped id
    // is visible rather than silently re-applied.
    const processedActionIds = useRef<DedupStore>(createDedupStore({
        max: 2048,
        ttlMs: 30 * 60 * 1000,
        onEvict: (id, reason) => {
            bumpNet('net_intent_dup');
            console.warn(`🛰️ Relay dedup evicted ${id} (${reason})`);
        },
    }));
    /** Immediate room target — React state lags one render; guests must send now. */
    const roomCodeRef = useRef<string | null>(null);

    // Keep ref in sync when state catches up (host path).
    useEffect(() => {
        if (currentRoomCode) roomCodeRef.current = currentRoomCode;
        else if (lobbyState?.roomCode) roomCodeRef.current = lobbyState.roomCode;
    }, [currentRoomCode, lobbyState?.roomCode]);

    // Single unified active channel for both publishing and receiving broadcasts.
    // Guaranteed to be subscribed so .send() transmits over live WebSockets rather than
    // failing on un-subscribed REST fallback.
    const activeChannelRef = useRef<{ code: string | null; channel: ReturnType<typeof supabase.channel> | null }>({
        code: null,
        channel: null,
    });

    const ensureChannel = useCallback((code: string) => {
        if (activeChannelRef.current.code === code && activeChannelRef.current.channel) {
            return activeChannelRef.current.channel;
        }
        if (activeChannelRef.current.channel) {
            supabase.removeChannel(activeChannelRef.current.channel);
        }
        console.log(`📡 [Relay] Subscribing to Supabase Game Channel: game-room-${code}`);
        const ch = supabase
            .channel(`game-room-${code}`)
            .on('broadcast', { event: 'game-action' }, ({ payload }) => {
                if (payload.actionId && processedActionIds.current.has(payload.actionId)) return;
                console.log('🛰️ Action received via Supabase Relay:', payload.type);
                processGameAction(payload);
            })
            // TU-1: this channel previously also listened for `host-migrated`
            // and called `joinGame(payload.newRoomCode)` on it. Nothing in the
            // repo ever *sent* that event — it had no producer, no documented
            // plan, and no validation — so it was a receive-only, unauthenticated
            // control verb on a public topic: anyone who learned the room code
            // could bounce every subscribed client into an arbitrary room.
            // AGENTS.md invariant 3 says the relay is not an authority channel
            // and must not carry a verb that moves a client between rooms, so
            // the handler is gone rather than gated. `joinGame` is therefore no
            // longer a dependency of this hook at all.
            .subscribe((status) => {
                console.log(`📡 [Relay] Channel status for game-room-${code}:`, status);
            });

        activeChannelRef.current = { code, channel: ch };
        return ch;
    }, [processGameAction]);

    const setRelayRoom = useCallback((code: string | null) => {
        roomCodeRef.current = code;
        if (code) {
            ensureChannel(code);
        }
    }, [ensureChannel]);

    const relayViaSupabase = useCallback((type: string, data: any, lobbyStateRef: React.MutableRefObject<LobbyState | null>) => {
        const targetCode = roomCodeRef.current || currentRoomCode || lobbyStateRef.current?.roomCode;
        if (!targetCode) {
            console.warn('🛰️ Relay skipped — no room code yet', type);
            return;
        }

        const channel = ensureChannel(targetCode);

        const actionId = `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
        const payload = {
            ...data,
            actionId,
            sender: myAddress?.toLowerCase() || 'host'
        };

        processedActionIds.current.add(actionId);

        channel
            .send({
                type: 'broadcast',
                event: 'game-action',
                payload
            })
            .then((status) => {
                if (status !== 'ok') console.warn('🚨 Supabase Relay Send status:', status);
                else console.log('🛰️ Relay broadcast sent successfully:', payload.type);
            })
            .catch((err) => {
                console.error('🚨 Supabase Relay Send Error:', err);
            });
    }, [myAddress, currentRoomCode, ensureChannel]);

    // Synchronize subscription whenever roomCode catches up via React state
    useEffect(() => {
        const targetCode = currentRoomCode || lobbyState?.roomCode;
        if (!targetCode) return;
        ensureChannel(targetCode);
    }, [currentRoomCode, lobbyState?.roomCode, ensureChannel]);

    // Teardown active channel on unmount
    useEffect(() => {
        return () => {
            if (activeChannelRef.current.channel) {
                supabase.removeChannel(activeChannelRef.current.channel);
                activeChannelRef.current = { code: null, channel: null };
            }
        };
    }, []);

    return {
        relayViaSupabase,
        setRelayRoom,
        processedActionIds
    };
}
