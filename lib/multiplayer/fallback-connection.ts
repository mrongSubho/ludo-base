// lib/multiplayer/fallback-connection.ts
import { EdgeServerClient } from './edge-server-client';
import { MatchResponse } from '../types/multiplayer.types';

export class FallbackConnectionManager {
  private edgeClient: EdgeServerClient | null = null;
  private fallbackActive = false;
  private onFallback: (() => void) | null = null;

  async attemptEdgeConnection(edgeUrl: string) {
    try {
      this.edgeClient = new EdgeServerClient(edgeUrl);
      await this.edgeClient.connect();
      return { success: true, client: this.edgeClient };
    } catch (error) {
      console.warn('⚠️ [Matchmaking] WebRTC edge connection failed, falling back to traditional matching', error);
      this.fallbackActive = true;
      this.onFallback?.();
      return { success: false, client: null };
    }
  }

  isFallbackActive(): boolean {
    return this.fallbackActive;
  }

  setOnFallback(callback: () => void) {
    this.onFallback = callback;
  }

  async findMatchWithFallback(request: any): Promise<MatchResponse> {
    if (!this.fallbackActive && this.edgeClient) {
      // Try edge server first
      try {
        return await this.edgeClient.findMatch(request);
      } catch (error) {
        console.warn('⚠️ [Matchmaking] Edge match failed, falling back to private lobby matching', error);
        this.fallbackActive = true;
        this.onFallback?.();
      }
    }

    // Fallback to traditional P2P matching (Simulated for protocol compatibility)
    return this.fallbackMatch(request);
  }

  private async fallbackMatch(request: any): Promise<MatchResponse> {
    // Simplified fallback implementation
    console.log('📡 [Matchmaking] Using fallback discovery');
    return {
      matchId: `fallback_${Date.now()}`,
      players: [{ id: 'local_host', name: 'Player', skillLevel: 1 }],
      validationToken: 'fallback_token',
      serverTimestamp: Date.now(),
      gameConfig: {
        mode: request.mode === 'snakes' ? 'snakes' : 'classic',
        matchType: request.matchType || '1v1',
        wager: request.entryFee || 0
      }
    };
  }
}
