import { GameIntent, GameIntentType, GameIntentPayloads, PlayerColor } from './types';

export function isPlayerColor(value: unknown): value is PlayerColor {
    return value === 'green' || value === 'red' || value === 'yellow' || value === 'blue';
}

export function isGameIntent(value: unknown): value is GameIntent {
    if (!value || typeof value !== 'object') return false;
    const candidate = value as { type?: unknown; payload?: unknown; intentId?: unknown };
    if (
        typeof candidate.type !== 'string'
        || !(['REQUEST_ROLL', 'REQUEST_MOVE', 'DICE_COMMIT', 'DICE_REVEAL', 'CMD_REQUEST_TRUST'] as GameIntentType[]).includes(candidate.type as GameIntentType)
        || typeof candidate.intentId !== 'string'
        || candidate.intentId.length === 0
        || !candidate.payload
        || typeof candidate.payload !== 'object'
    ) return false;

    const payload = candidate.payload as Record<string, unknown>;
    switch (candidate.type as GameIntentType) {
        case 'REQUEST_ROLL':
            // No face. A guest may ask the host to roll, never choose the face.
            // Fail closed: reject the whole intent rather than stripping the
            // field, so a forged payload is visible rather than silently honoured.
            return !('value' in payload);
        case 'REQUEST_MOVE':
            // `diceValue` is also rejected. The host must move the token with the
            // face it already committed to on its own state; letting the mover
            // declare the face would let a guest move with any roll it liked.
            return isPlayerColor(payload.color)
                && typeof payload.tokenIndex === 'number'
                && Number.isInteger(payload.tokenIndex)
                && payload.tokenIndex >= 0
                && payload.tokenIndex < 4
                && !('diceValue' in payload);
        case 'DICE_COMMIT':
            return typeof payload.hash === 'string' && payload.hash.length > 0;
        case 'DICE_REVEAL':
            return typeof payload.nonce === 'string' && payload.nonce.length > 0;
        case 'CMD_REQUEST_TRUST':
            return isPlayerColor(payload.color)
                && typeof payload.isBotTrusted === 'boolean'
                && typeof payload.isKicked === 'boolean';
    }
}

export function createGameIntent<T extends GameIntentType>(
    type: T,
    payload: GameIntentPayloads[T],
    sender: string | undefined,
    intentId: string
): GameIntent {
    return { type, payload, sender, intentId } as GameIntent;
}
