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
    joinGame: (targetRoomId: string) => void;
}

export function useSupabaseRelay({
    myAddress,
    lobbyState,
    currentRoomCode,
    processGameAction,
    joinGame
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

    const setRelayRoom = useCallback((code: string | null) => {
        roomCodeRef.current = code;
    }, []);

    // REA-01: the send channel, joined once per room and held in a ref. The
    // old code minted a fresh never-joined `supabase.channel(...)` per relay —
    // a channel object per send, none of them ever subscribed or torn down.
    const sendChannelRef = useRef<{ code: string | null; channel: ReturnType<typeof supabase.channel> | null }>({
        code: null,
        channel: null,
    });

    const relayViaSupabase = useCallback((type: string, data: any, lobbyStateRef: React.MutableRefObject<LobbyState | null>) => {
        const targetCode = roomCodeRef.current || currentRoomCode || lobbyStateRef.current?.roomCode;
        if (!targetCode) {
            console.warn('🛰️ Relay skipped — no room code yet', type);
            return;
        }
        // Rotate the held channel when the room changes; otherwise reuse it.
        // A never-joined channel sends through the REST fallback at higher
        // cost, so joining once per room keeps both cost and identity stable.
        if (sendChannelRef.current.code !== targetCode) {
            sendChannelRef.current = {
                code: targetCode,
                channel: supabase.channel(`game-room-${targetCode}`),
            };
        }

        const actionId = `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
        const payload = {
            ...data,
            actionId,
            sender: myAddress?.toLowerCase() || 'host'
        };

        processedActionIds.current.add(actionId);

        sendChannelRef.current.channel!
            .send({
                type: 'broadcast',
                event: 'game-action',
                payload
            })
            .then((status) => {
                if (status !== 'ok') console.error('🚨 Supabase Relay Error:', status);
            });
    }, [myAddress, currentRoomCode]);

    // The held send channel is torn down with the room subscription, never
    // left dangling across rooms (NET-11's double-subscribe hazard included
    // sends, not just receives).
    useEffect(() => {
        return () => {
            sendChannelRef.current = { code: null, channel: null };
        };
    }, [currentRoomCode, lobbyState?.roomCode]);

    useEffect(() => {
        const targetCode = currentRoomCode || lobbyState?.roomCode;
        if (!targetCode) return;

        console.log(`📡 Subscribing to Supabase Game Channel: game-room-${targetCode}`);
        const channel = supabase
            .channel(`game-room-${targetCode}`)
            .on('broadcast', { event: 'game-action' }, ({ payload }) => {
                if (payload.actionId && processedActionIds.current.has(payload.actionId)) return;
                console.log('🛰️ Action received via Supabase Relay:', payload.type);
                processGameAction(payload);
            })
            .on('broadcast', { event: 'host-migrated' }, ({ payload }) => {
                console.log('🔄 MIGRATION SIGNAL RECEIVED:', payload);
                if (payload.newRoomCode) {
                    joinGame(payload.newRoomCode);
                }
            })
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [currentRoomCode, lobbyState?.roomCode, processGameAction, joinGame]);

    return {
        relayViaSupabase,
        setRelayRoom,
        processedActionIds
    };
}
