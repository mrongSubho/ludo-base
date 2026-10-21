import type { GameIntent, PlayerColor, PowerType } from './types';

const POWER_TYPES: readonly PowerType[] = ['shield', 'boost', 'nuke', 'teleport'];

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
 *
 * `REQUEST_POWER` (PW-3) follows the same rule: the guest may name a colour and
 * a power, never a duration, a state or a target coordinate. Ownership and the
 * once-per-turn budget are re-checked by `applyPower` on the host's own state.
 */
export type HostIntentAction =
    | { kind: 'roll' }
    | { kind: 'move'; color: PlayerColor; tokenIndex: number; diceValue: number }
    | { kind: 'power'; color: PlayerColor; power: PowerType; tokenIndex?: number }
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
    if (intent.type === 'REQUEST_POWER') {
        const payload = intent.payload as { color?: unknown; power?: unknown; tokenIndex?: unknown };
        if (typeof payload.power !== 'string') return { kind: 'ignore' };
        if (!(POWER_TYPES as readonly string[]).includes(payload.power)) return { kind: 'ignore' };
        return {
            kind: 'power',
            color: payload.color as PlayerColor,
            power: payload.power as PowerType,
            tokenIndex: typeof payload.tokenIndex === 'number' ? payload.tokenIndex : undefined,
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
