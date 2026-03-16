// hooks/useCompetitiveConnection.ts
import { useState, useEffect, useCallback } from 'react';
import { EdgeServerClient } from '../lib/multiplayer/edge-server-client';
import { PeerJSGameplay } from '../lib/multiplayer/peerjs-gameplay';
import { FallbackConnectionManager } from '../lib/multiplayer/fallback-connection';
import { GameConfig } from '../lib/types/multiplayer.types';

export interface CompetitiveMatch {
  matchId: string;
  peerIds: string[];
  validationToken: string;
  gameConfig: GameConfig;
}

export const useCompetitiveConnection = () => {
  const [edgeClient, setEdgeClient] = useState<EdgeServerClient | null>(null);
  const [gameplayClient, setGameplayClient] = useState<PeerJSGameplay | null>(null);
  const [fallbackManager] = useState(() => new FallbackConnectionManager());
  const [match, setMatch] = useState<CompetitiveMatch | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const edgeUrl = process.env.NEXT_PUBLIC_EDGE_SERVER_URL || 'https://edge.ludo.game';
    const client = new EdgeServerClient(edgeUrl);
    setEdgeClient(client);

    return () => {
      client.disconnect();
      if (gameplayClient) {
        gameplayClient.disconnect();
      }
    };
  }, [gameplayClient]);

  const findCompetitiveMatch = useCallback(async (mode: 'quick' | 'friends', entryFee?: number) => {
    setLoading(true);
    setError(null);
    
    try {
      if (!edgeClient) throw new Error('Edge client not initialized');
      
      // Attempt connection to Edge Server via WebRTC
      await edgeClient.connect();

      // Find match through fallback manager (starts with Edge Client)
      const matchResponse = await fallbackManager.findMatchWithFallback({
        mode,
        gameType: entryFee ? 'tournament' : 'standard',
        entryFee
      });

      // Establish PeerJS connection for gameplay
      const gClient = new PeerJSGameplay();
      // Use validation token for secure state sync
      await gClient.initialize(matchResponse.validationToken);
      
      setGameplayClient(gClient);
      setMatch({
        matchId: matchResponse.matchId,
        peerIds: matchResponse.players.map(p => p.id),
        validationToken: matchResponse.validationToken,
        gameConfig: matchResponse.gameConfig
      });
      
    } catch (err) {
      console.error('❌ [CompetitiveConnection] Setup failed:', err);
      setError(err instanceof Error ? err.message : 'Failed to establish competitive connection');
    } finally {
      setLoading(false);
    }
  }, [edgeClient, fallbackManager]);

  const validateResult = useCallback(async (result: any) => {
    if (!edgeClient) throw new Error('Edge client not initialized');
    return await edgeClient.validateGameResult(result);
  }, [edgeClient]);

  return {
    findCompetitiveMatch,
    validateResult,
    match,
    loading,
    error,
    isFallback: fallbackManager.isFallbackActive()
  };
};
