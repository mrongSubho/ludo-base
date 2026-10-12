/**
 * REA-11 — the server-state write-up decision, extracted for execution.
 *
 * The whole board used to flush into TeamUpContext on EVERY localGameState
 * change, including the ~1Hz timer ticks. The rule now: flush once, when a
 * real (non-local) matchId arrives while this client is the connected host;
 * reset the latch when there is no server match. Timer churn never flushes.
 *
 * Pure and total, so `test:hooks` executes the decision instead of asserting
 * on effect source.
 */

export type FlushDecision = 'flush' | 'hold' | 'reset';

export function shouldFlushServerState(args: {
    /** matchId already flushed, or null. */
    flushedId: string | null;
    /** current local matchId (may be undefined pre-join). */
    matchId: string | null | undefined;
    isHost: boolean;
    isLobbyConnected: boolean;
}): FlushDecision {
    const { flushedId, matchId, isHost, isLobbyConnected } = args;
    const hasServerMatch = Boolean(matchId && matchId !== 'local');
    if (!hasServerMatch) return 'reset';
    if (isHost && isLobbyConnected && flushedId !== matchId) return 'flush';
    return 'hold';
}
