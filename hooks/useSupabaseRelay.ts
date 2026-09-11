import { useCallback, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { LobbyState } from '@/lib/types';

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
    const processedActionIds = useRef<Set<string>>(new Set());
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

    const relayViaSupabase = useCallback((type: string, data: any, lobbyStateRef: React.MutableRefObject<LobbyState | null>) => {
        const targetCode = roomCodeRef.current || currentRoomCode || lobbyStateRef.current?.roomCode;
        if (!targetCode) {
            console.warn('🛰️ Relay skipped — no room code yet', type);
            return;
        }

        const actionId = `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
        const payload = {
            ...data,
            actionId,
            sender: myAddress?.toLowerCase() || 'host'
        };

        processedActionIds.current.add(actionId);

        supabase
            .channel(`game-room-${targetCode}`)
            .send({
                type: 'broadcast',
                event: 'game-action',
                payload
            })
            .then((status) => {
                if (status !== 'ok') console.error('🚨 Supabase Relay Error:', status);
            });
    }, [myAddress, currentRoomCode]);

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
