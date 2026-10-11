import type { GameIntent, PlayerColor } from './types';

/**
 * The host's guest-intent decision as a pure function (Phase 2 exit gate).
 *
 * A hostile client cannot influence the dice face because there is no code
 * path that reads one: `REQUEST_ROLL` maps to a bare roll (the payload is
 * never inspected), and `REQUEST_MOVE` carries only `{color, tokenIndex}` —
 * the face comes from the host's committed `hostDiceValue` argument. The
 * React effect in `hooks/useGameEngine.ts` delegates to this function, and
 * `scripts/host-intent.test.ts` executes it over forged intents, so the
 * boundary is covered by execution rather than by source assertions alone.
 */
export type HostIntentAction =
    | { kind: 'roll' }
    | { kind: 'move'; color: PlayerColor; tokenIndex: number; diceValue: number }
    | { kind: 'trust'; color: PlayerColor; isKicked: boolean }
    | { kind: 'ignore' };

export function hostActionForIntent(
    intent: Pick<GameIntent, 'type' | 'payload'>,
    hostDiceValue: number | null,
): HostIntentAction {
    if (intent.type === 'REQUEST_ROLL') {
        // The payload is NEVER read — a forged `value` has nowhere to land.
        return { kind: 'roll' };
    }
    if (intent.type === 'REQUEST_MOVE') {
        // Fail closed with no committed face; otherwise move with the HOST's
        // face, even if the guest attached its own `diceValue`.
        if (hostDiceValue === null) return { kind: 'ignore' };
        const payload = intent.payload as { color?: unknown; tokenIndex?: unknown };
        if (typeof payload.tokenIndex !== 'number') return { kind: 'ignore' };
        return {
            kind: 'move',
            color: payload.color as PlayerColor,
            tokenIndex: payload.tokenIndex,
            diceValue: hostDiceValue,
        };
    }
    if (intent.type === 'CMD_REQUEST_TRUST') {
        const payload = intent.payload as { color?: unknown; isKicked?: unknown };
        if (typeof payload.isKicked !== 'boolean') return { kind: 'ignore' };
        return {
            kind: 'trust',
            color: payload.color as PlayerColor,
            isKicked: payload.isKicked,
        };
    }
    return { kind: 'ignore' };
}
