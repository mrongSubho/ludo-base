/* eslint-disable @typescript-eslint/no-explicit-any -- Edge reply body passthrough: move-auth returns these fields verbatim */

/**
 * NET-01/NET-02 — bounded STALE_SEQ retry for the match-action client.
 *
 * Phase 4's liveness failure was: a turn with no legal move (or a third six)
 * handed the turn over, `match_states` desynced, and the next player's move was
 * refused with STALE_SEQ forever — with no recovery path. The recovery is: a
 * 409 body carries the authoritative `{seq, state}`, so re-read it and
 * re-submit with the fresh `expectedSeq` and the **same** action identity
 * (same `rollId` for moves/passes, so replay cannot apply a move twice).
 *
 * Bounded to ONE retry: a second STALE_SEQ surfaces to the caller, which then
 * resyncs from the authoritative snapshot. Two racers must not ping-pong the
 * sequence forward by retrying each other's refusals.
 */

export type MoveAuthCall = { ok: boolean; status: number; data: { [k: string]: any } };

/** True when a refusal reports a fresh authoritative seq worth retrying against. */
export function isStaleSeqCall(r: MoveAuthCall): boolean {
    if (r.ok || r.status !== 409) return false;
    const fresh = Number(r.data?.seq);
    const reason = r.data?.code;
    // An explicit code wins; a 409 with none is Edge's legacy STALE_SEQ shape.
    const stale = reason === 'STALE_SEQ' || reason === undefined;
    return stale && Number.isInteger(fresh) && fresh > 0;
}

/** The authoritative seq a STALE_SEQ refusal reports, or null. */
export function staleSeqValue(r: MoveAuthCall): number | null {
    const fresh = Number(r.data?.seq);
    return Number.isInteger(fresh) && fresh > 0 ? fresh : null;
}

export async function withStaleSeqRetry(
    attempt: (expectedSeq: number) => Promise<MoveAuthCall>,
    expectedSeq: number,
): Promise<MoveAuthCall> {
    const first = await attempt(expectedSeq);
    if (!isStaleSeqCall(first)) return first;

    const fresh = staleSeqValue(first);
    const retry = await attempt(fresh!);
    // Surface the retry's outcome — on refusal it carries the freshest
    // snapshot, which is what the caller needs to reconcile.
    return retry;
}
