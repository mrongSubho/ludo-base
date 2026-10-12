/**
 * Phase 4 exit gate — pure authority decisions for the match path.
 *
 * Two rules that used to live inline in React callbacks (untestable without
 * mounting the whole provider tree):
 *
 * 1. `computeAuthority` — who may orchestrate. Mirrors `useGameEngine`'s
 *    `isAuthority`: the host always; a compute host only while connected AND
 *    holding a verified snapshot (NET-07: a snapshot-less election must not
 *    drive AI/AFK from an empty board).
 * 2. `shouldApplyGameAction` — what a client may apply from the wire. Mirrors
 *    `processGameAction`: mutating verbs (ROLL_DICE/MOVE_TOKEN/TURN_SWITCH)
 *    need authority; a stateOverride advances a guest only when it carries
 *    `source: 'match_states'` and a strictly newer seq (NET-03).
 *
 * Pure and total, so `test:netcode` executes them instead of mounting React.
 */

export type AuthorityInput = {
    isNetworkedMatch: boolean;
    isHost: boolean;
    isComputeHost: boolean;
    /** MatchConnectionStatus, compared as strings to avoid a React import. */
    connectionStatus: string;
    hasAuthoritativeSnapshot: boolean;
};

export function computeAuthority(a: AuthorityInput): boolean {
    if (!a.isNetworkedMatch) return true;
    if (a.isHost) return true;
    return a.isComputeHost && a.connectionStatus === 'connected' && a.hasAuthoritativeSnapshot;
}

export type GameActionVerdict =
    | { apply: true; via: 'authority' | 'snapshot' }
    | { apply: false; via: 'hint' | 'stale' | 'lobby' };

const MUTATING = new Set(['ROLL_DICE', 'MOVE_TOKEN', 'TURN_SWITCH']);

/**
 * Decide a single inbound broadcast. `knownSeq` is this client's
 * serverSeqRef; `hasOverride`/`seq` describe the payload.
 */
export function shouldApplyGameAction(args: {
    type: string;
    isHost: boolean;
    isComputeHost: boolean;
    source?: unknown;
    hasOverride: boolean;
    seq?: unknown;
    knownSeq: number;
}): GameActionVerdict {
    const { type, isHost, isComputeHost, source, hasOverride, seq, knownSeq } = args;
    const authority = isHost || isComputeHost;

    // Snapshots first: a guest advances only on tagged, newer authority state.
    if (hasOverride && !isHost) {
        if (source !== 'match_states') return { apply: false, via: 'hint' };
        if (typeof seq !== 'number' || !Number.isFinite(seq)) return { apply: false, via: 'stale' };
        return seq > knownSeq ? { apply: true, via: 'snapshot' } : { apply: false, via: 'stale' };
    }

    // Mutating verbs need the authority seat.
    if (MUTATING.has(type)) {
        return authority ? { apply: true, via: 'authority' } : { apply: false, via: 'hint' };
    }

    // Lobby/intent/ack traffic is not rules state.
    return { apply: false, via: 'lobby' };
}
