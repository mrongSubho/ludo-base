export type MatchBoundaryError =
  | 'STALE_SEQ'
  | 'DUPLICATE_ACTION'
  | 'SESSION_EXPIRED'
  | 'MATCH_FINISHED';

export interface SequenceCheck {
  ok: boolean;
  code?: 'STALE_SEQ';
  currentSeq?: number;
}

export function checkExpectedSequence(currentSeq: number, expectedSeq: number): SequenceCheck {
  return currentSeq === expectedSeq
    ? { ok: true }
    : { ok: false, code: 'STALE_SEQ', currentSeq };
}

export function compareAndSwapSequence(currentSeq: number, expectedSeq: number): number | null {
  return checkExpectedSequence(currentSeq, expectedSeq).ok ? expectedSeq + 1 : null;
}

export function confirmSequenceAfterWrite(observedSeq: number, nextSeq: number): SequenceCheck {
  return checkExpectedSequence(observedSeq, nextSeq);
}

export function isExpired(expiresAt: string | number | Date, nowMs: number): boolean {
  return new Date(expiresAt).getTime() < nowMs;
}

export function isTerminalMatch(state: { winner?: unknown; status?: string }): boolean {
  return Boolean(state.winner) || state.status === 'finished';
}

/**
 * match_rolls.status values that mean "this receipt has not been spent yet".
 *
 * Must stay in sync with the DB CHECK constraint (match_rolls_status_check)
 * added in 202609300002. `npm run check:schema` (A3) asserts that the
 * migration-declared column default is a value this file treats as unspent,
 * so a future column-default or CHECK change cannot drift away silently —
 * which is exactly how `default 'available'` vs `status !== 'open'` 409'd
 * every networked move on a fresh install while CI stayed green.
 *
 * Unknown/missing values fail closed (treated as spent).
 */
export const OPEN_ROLL_STATUSES = ['open'] as const;

export function isDuplicateAction(status: string | null | undefined): boolean {
  if (status === null || status === undefined) return true;
  return !(OPEN_ROLL_STATUSES as readonly string[]).includes(status);
}
