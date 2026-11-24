import type { PlayerColor } from './types';

export const REMATCH_TIMEOUT_MS = 15_000;

export type RematchSignalKind = 'propose' | 'accept' | 'decline' | 'started';
export type RematchVote = 'pending' | 'accepted' | 'declined';
export type RematchOutcome =
    | 'pending'
    | 'all_accepted'
    | 'hybrid_quick_search'
    | 'solo_quick_search'
    | 'declined';

export interface RematchSignalPayload {
    kind: RematchSignalKind;
    proposalId: string;
    matchId?: string;
    roomCode?: string;
    color: PlayerColor;
    wallet?: string;
    actor?: string;
    newMatchId?: string;
    t: number;
}

const VALID_KINDS: ReadonlySet<RematchSignalKind> = new Set([
    'propose',
    'accept',
    'decline',
    'started',
]);

const VALID_COLORS: ReadonlySet<PlayerColor> = new Set([
    'green',
    'red',
    'yellow',
    'blue',
]);

/** Validates an inbound `REMATCH` signal payload received over match broadcast. */
export function parseRematchPayload(raw: unknown): RematchSignalPayload | null {
    if (!raw || typeof raw !== 'object') return null;
    const obj = raw as Record<string, unknown>;
    const kind = obj.kind;
    const proposalId = obj.proposalId;
    const color = obj.color;
    const t = obj.t;

    if (typeof kind !== 'string' || !VALID_KINDS.has(kind as RematchSignalKind)) {
        return null;
    }
    if (typeof proposalId !== 'string' || proposalId.trim().length === 0) {
        return null;
    }
    if (typeof color !== 'string' || !VALID_COLORS.has(color as PlayerColor)) {
        return null;
    }
    if (typeof t !== 'number' || !Number.isFinite(t)) {
        return null;
    }

    return {
        kind: kind as RematchSignalKind,
        proposalId: proposalId.trim(),
        matchId: typeof obj.matchId === 'string' && obj.matchId ? obj.matchId : undefined,
        roomCode: typeof obj.roomCode === 'string' && obj.roomCode ? obj.roomCode : undefined,
        color: color as PlayerColor,
        wallet: typeof obj.wallet === 'string' && obj.wallet ? obj.wallet.toLowerCase() : undefined,
        actor: typeof obj.actor === 'string' && obj.actor ? obj.actor : undefined,
        newMatchId: typeof obj.newMatchId === 'string' && obj.newMatchId ? obj.newMatchId : undefined,
        t,
    };
}

/**
 * Resolves the multiplayer post-match Restart / Rematch vote outcome once
 * everyone votes, any player declines, or the 15s countdown expires.
 */
export function evaluateRematchOutcome(params: {
    votes: Partial<Record<PlayerColor, RematchVote>>;
    humanColors: PlayerColor[];
    myColor?: PlayerColor;
    playerCount: '1v1' | '2v2' | '4P';
    expired: boolean;
}): {
    outcome: RematchOutcome;
    acceptedColors: PlayerColor[];
    slotsNeeded: number;
} {
    const { votes, humanColors, myColor, playerCount, expired } = params;
    const acceptedColors = humanColors.filter((c) => votes[c] === 'accepted');

    if (humanColors.length > 0 && acceptedColors.length === humanColors.length) {
        return {
            outcome: 'all_accepted',
            acceptedColors,
            slotsNeeded: 0,
        };
    }

    const anyoneDeclined = humanColors.some((c) => votes[c] === 'declined');
    if (!anyoneDeclined && !expired) {
        return {
            outcome: 'pending',
            acceptedColors,
            slotsNeeded: 0,
        };
    }

    if (!myColor || !acceptedColors.includes(myColor)) {
        return {
            outcome: 'declined',
            acceptedColors,
            slotsNeeded: 0,
        };
    }

    const totalSeats = playerCount === '1v1' ? 2 : 4;
    if (playerCount !== '1v1' && acceptedColors.length >= 2) {
        return {
            outcome: 'hybrid_quick_search',
            acceptedColors,
            slotsNeeded: Math.max(1, totalSeats - acceptedColors.length),
        };
    }

    return {
        outcome: 'solo_quick_search',
        acceptedColors,
        slotsNeeded: totalSeats - 1,
    };
}
