import { useState, useCallback, useRef, useEffect } from 'react';
import { 
    LobbyState, 
    InvitePayload, 
    LobbySlot, 
    GameActionType,
    LobbyActionType,
    PlayerColor,
    GameState
} from '@/lib/types';
import { 
    createLobbySlots, 
    assignJoinerToSlot, 
    removePlayerFromSlot, 
    swapSlots as swapSlotsLogic, 
    canStartMatch,
    generateRoomCode
} from '@/lib/gameLogic';
import { supabase } from '@/lib/supabase';
import Peer from 'peerjs';

interface UseLobbyManagerProps {
    myAddress: string | undefined;
    myProfile: any;
    isHost: boolean;
    setIsHost: React.Dispatch<React.SetStateAction<boolean>>;
    setRoomId: React.Dispatch<React.SetStateAction<string>>;
    setCurrentRoomCode: React.Dispatch<React.SetStateAction<string | null>>;
    setIsLobbyConnected: React.Dispatch<React.SetStateAction<boolean>>;
    setGameState: React.Dispatch<React.SetStateAction<GameState>>;
    peerRef: React.MutableRefObject<Peer | null>;
    connectionsRef: React.MutableRefObject<any>;
    broadcastToAll: (data: any) => void;
    /** Host join secret stamped onto game_invites so accept can join. */
    getRoomSecret?: () => string | null;
}

/** Stored SIWE session without prompting a signature (invites are fire-and-forget). */
function readStoredSessionId(wallet: string): string | null {
    try {
        const raw = localStorage.getItem('ludo-siwe-session');
        if (!raw) return null;
        const parsed = JSON.parse(raw) as { sessionId: string; wallet: string; expiresAt: string };
        if (String(parsed.wallet || '').toLowerCase() !== wallet.toLowerCase()) return null;
        if (new Date(parsed.expiresAt).getTime() <= Date.now()) return null;
        return parsed.sessionId || null;
    } catch {
        return null;
    }
}

export function useLobbyManager({
    myAddress,
    myProfile,
    isHost,
    setIsHost,
    setRoomId,
    setCurrentRoomCode,
    setIsLobbyConnected,
    setGameState,
    peerRef,
    connectionsRef,
    broadcastToAll,
    getRoomSecret
}: UseLobbyManagerProps) {
    const [lobbyState, setLobbyState] = useState<LobbyState | null>(null);
    const lobbyStateRef = useRef<LobbyState | null>(null);
    const [pendingInvite, setPendingInvite] = useState<InvitePayload | null>(null);
    const [participants, setParticipants] = useState<Record<string, { address: string; username?: string; avatar_url?: string; color?: PlayerColor }>>({});



    useEffect(() => { lobbyStateRef.current = lobbyState; }, [lobbyState]);

    const swapPlayers = useCallback((indexA: number, indexB: number) => {
        if (!isHost || !lobbyState) return;
        const newSlots = swapSlotsLogic(lobbyState.slots, indexA, indexB);
        const newLobby = { ...lobbyState, slots: newSlots };
        setLobbyState(newLobby);
        lobbyStateRef.current = newLobby;
        broadcastToAll({ type: 'LOBBY_SYNC', lobbyState: newLobby });
    }, [isHost, lobbyState, broadcastToAll]);

    const kickPlayer = useCallback((slotIndex: number) => {
        if (!isHost || !lobbyState) return;
        const slot = lobbyState.slots[slotIndex];
        if (!slot || slot.role === 'host' || slot.status !== 'joined') return;

        const peerId = slot.peerId;
        if (peerId) {
            const conn = connectionsRef.current.get(peerId);
            if (conn) conn.close();
        }

        const newSlots = removePlayerFromSlot(lobbyState.slots, slot.playerId || '');
        const newLobby: LobbyState = { ...lobbyState, slots: newSlots, status: 'forming' };
        setLobbyState(newLobby);
        lobbyStateRef.current = newLobby;
        broadcastToAll({ type: 'LOBBY_SYNC', lobbyState: newLobby });
    }, [isHost, lobbyState, broadcastToAll, connectionsRef]);

    const sendInvite = useCallback((friendId: string, friendName?: string, role?: 'teammate' | 'opponent') => {
        if (!lobbyState || !myAddress) {
            console.warn('⚠️ [Lobby] sendInvite dropped: no active lobby (host a room first).');
            return;
        }
        const lowerFriendId = friendId.toLowerCase();

        // Fail fast without a session: the invite API is host-session gated,
        // and marking the seat first would orphan it (invited locally, no row
        // lands, invitee never notified).
        const storedSession = myAddress ? readStoredSessionId(myAddress) : null;
        if (!storedSession) {
            console.error('🚨 Invite blocked: no stored SIWE session — complete sign-in first.');
            return;
        }

        setLobbyState(prev => {
            if (!prev) return prev;
            // Prefer: empty seat → same invited seat (re-ping) → any empty.
            const isFree = (s: LobbySlot) => s.status === 'empty' || (s.status === 'invited' && s.playerId?.toLowerCase() === lowerFriendId);
            let emptyIdx = -1;
            if (prev.matchType === '2v2' && role) {
                const want = role === 'teammate' ? 'teammate' : 'opponent';
                emptyIdx = prev.slots.findIndex(s => s.role === want && isFree(s));
                if (emptyIdx === -1) {
                    console.warn(`⚠️ [Lobby] sendInvite: no free ${want} seat.`);
                    return prev;
                }
            } else {
                emptyIdx = prev.slots.findIndex(isFree);
            }
            if (emptyIdx === -1) return prev;
            const newSlots = prev.slots.map((s, i) => {
                if (i === emptyIdx) {
                    return { ...s, status: 'invited' as const, playerId: friendId, playerName: friendName || 'Invited', invitedAt: Date.now() };
                }
                return s;
            });
            const newLobby = { ...prev, slots: newSlots };
            lobbyStateRef.current = newLobby;
            broadcastToAll({ type: 'LOBBY_SYNC', lobbyState: newLobby });
            return newLobby;
        });

        // Service-role API — anon RLS cannot insert game_invites (wallet-only app).
        // Host-session gated; the stored SIWE session is attached without prompting.
        void fetch('/api/lobby/invite', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                roomCode: lobbyState.roomCode,
                hostAddress: myAddress,
                guestAddress: lowerFriendId,
                matchType: lobbyState.matchType,
                entryFee: lobbyState.entryFee,
                validationToken: getRoomSecret?.() ?? null,
                sessionId: myAddress ? readStoredSessionId(myAddress) : null,
            }),
        }).then(async (res) => {
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                console.error('🚨 Error sending invite:', data?.error || res.status);
                // Roll back the optimistic seat so a rejected invite (e.g.
                // expired session) doesn't orphan an `invited` slot forever.
                // Only reverts if the slot is still ours — never clobbers newer state.
                setLobbyState(prev => {
                    if (!prev) return prev;
                    const idx = prev.slots.findIndex(s => s.status === 'invited' && s.playerId?.toLowerCase() === lowerFriendId);
                    if (idx === -1) return prev;
                    const newSlots = prev.slots.map((s, i) => i === idx
                        ? { ...s, status: 'empty' as const, playerId: undefined, playerName: undefined, invitedAt: undefined }
                        : s);
                    const newLobby = { ...prev, slots: newSlots };
                    lobbyStateRef.current = newLobby;
                    broadcastToAll({ type: 'LOBBY_SYNC', lobbyState: newLobby });
                    return newLobby;
                });
            }
        }).catch((err) => console.error('🚨 Invite network error:', err));
    }, [lobbyState, broadcastToAll, myAddress, getRoomSecret]);

    return {
        lobbyState,
        setLobbyState,
        lobbyStateRef,
        pendingInvite,
        setPendingInvite,
        participants,
        setParticipants,
        swapPlayers,
        kickPlayer,
        sendInvite
    };
}
