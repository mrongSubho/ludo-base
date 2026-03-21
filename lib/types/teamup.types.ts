// lib/types/teamup.types.ts

export interface GameConfig {
  mode: 'classic' | 'power' | 'snakes';
  matchType: '1v1' | '2v2' | '4P';
  wager: number;
}

export interface MatchRequest {
  playerId: string;
  mode: 'quick' | 'friends';
  gameType: 'standard' | 'tournament';
  entryFee?: number;
  skillLevel?: number;
}

export interface MatchResponse {
  matchId: string;
  players: Array<{
    id: string;
    name: string;
    skillLevel: number;
  }>;
  validationToken: string;
  serverTimestamp: number;
  gameConfig: GameConfig;
}

export interface ValidationResult {
  isValid: boolean;
  reason?: string;
  gameConfig: GameConfig;
}
