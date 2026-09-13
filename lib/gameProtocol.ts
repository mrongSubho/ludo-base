import { GameIntent, GameIntentType, GameIntentPayloads, PlayerColor } from './types';

export function isPlayerColor(value: unknown): value is PlayerColor {
    return value === 'green' || value === 'red' || value === 'yellow' || value === 'blue';
}

export function isGameIntent(value: unknown): value is GameIntent {
    if (!value || typeof value !== 'object') return false;
    const candidate = value as { type?: unknown; payload?: unknown; intentId?: unknown };
    return typeof candidate.type === 'string'
        && (['REQUEST_ROLL', 'REQUEST_MOVE', 'DICE_COMMIT', 'DICE_REVEAL', 'CMD_REQUEST_TRUST'] as GameIntentType[]).includes(candidate.type as GameIntentType)
        && typeof candidate.intentId === 'string'
        && !!candidate.payload
        && typeof candidate.payload === 'object';
}

export function createGameIntent<T extends GameIntentType>(
    type: T,
    payload: GameIntentPayloads[T],
    sender: string | undefined,
    intentId: string
): GameIntent {
    return { type, payload, sender, intentId } as GameIntent;
}
