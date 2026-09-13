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

export function isDuplicateAction(status: string | null | undefined): boolean {
  return status !== 'open';
}
