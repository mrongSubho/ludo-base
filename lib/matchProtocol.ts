import type { GameState } from './types';

/** Server-authoritative actions that advance a networked match sequence. */
export type MatchAction = 'seed' | 'move' | 'pass' | 'power';

export type MatchConnectionStatus = 'offline' | 'connected' | 'reconnecting' | 'syncing' | 'ended';

/**
 * Stable machine-readable errors returned by move-auth.
 * UI code should branch on `code`, not the human-readable `error`.
 */
export type MatchActionErrorCode =
    | 'STALE_SEQ'
    | 'DUPLICATE_ACTION'
    | 'NOT_AUTHORIZED'
    | 'MATCH_NOT_FOUND'
    | 'MATCH_FINISHED'
    | 'ILLEGAL_ACTION'
    | 'ROLL_NOT_FOUND'
    | 'ROLL_CONSUMED'
    | 'SESSION_EXPIRED';

export interface MatchStateSnapshot {
    seq: number;
    state: GameState;
}

export interface MatchActionError {
    error: string;
    code?: MatchActionErrorCode;
    seq?: number;
    state?: GameState;
    legal?: number[];
}

export interface MatchActionSuccess extends MatchStateSnapshot {
    captured?: boolean;
    bonusRoll?: boolean;
    message?: string;
}
