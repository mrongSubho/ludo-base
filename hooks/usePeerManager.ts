import { useState, useRef, useEffect, useCallback } from 'react';
import Peer, { DataConnection } from 'peerjs';

interface UsePeerManagerProps {
    isHost: boolean;
    isLobbyConnected: boolean;
    broadcastToAll: (data: any) => void;
    gameStateRef: React.MutableRefObject<any>;
}

export function usePeerManager({
    isHost,
    isLobbyConnected,
    broadcastToAll,
    gameStateRef
}: UsePeerManagerProps) {
    const [connections, setConnections] = useState<Map<string, DataConnection>>(new Map());
    const peerRef = useRef<Peer | null>(null);
    const heartbeatTimerRef = useRef<any>(null);
    const connectionsRef = useRef(connections);

    useEffect(() => {
        connectionsRef.current = connections;
    }, [connections]);

    useEffect(() => {
        if (isHost && isLobbyConnected) {
            heartbeatTimerRef.current = setInterval(() => {
                console.log('💓 Heartbeat: Syncing state...');
                broadcastToAll({ type: 'SYNC_STATE', gameState: gameStateRef.current });
            }, 5000);
        } else {
            if (heartbeatTimerRef.current) clearInterval(heartbeatTimerRef.current);
        }
        return () => {
            if (heartbeatTimerRef.current) clearInterval(heartbeatTimerRef.current);
        };
    }, [isHost, isLobbyConnected, broadcastToAll, gameStateRef]);

    useEffect(() => {
        return () => {
            if (peerRef.current) {
                console.log('漫 Cleaning up Peer on unmount');
                peerRef.current.destroy();
            }
        };
    }, []);

    const destroyPeer = useCallback(() => {
        if (peerRef.current) {
            peerRef.current.destroy();
            peerRef.current = null;
        }
    }, []);

    return {
        peerRef,
        connections,
        setConnections,
        connectionsRef,
        destroyPeer
    };
}
