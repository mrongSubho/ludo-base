/**
 * Q5 — typed error codes → player-facing copy.
 * Recoverable = user can retry; fatal = needs reload / support.
 */

import type { MatchActionErrorCode } from './matchProtocol';

export type ErrorSeverity = 'info' | 'warning' | 'fatal';

export type FriendlyError = {
    code: string;
    title: string;
    copy: string;
    severity: ErrorSeverity;
    recoverable: boolean;
    /** CTA label when recoverable. */
    cta?: string;
};

const MATCH_ACTION_COPY: Record<MatchActionErrorCode, FriendlyError> = {
    STALE_SEQ: {
        code: 'STALE_SEQ',
        title: 'Out of sync',
        copy: 'Your board was behind the table. Pulling the latest state — try again.',
        severity: 'warning',
        recoverable: true,
        cta: 'Retry',
    },
    DUPLICATE_ACTION: {
        code: 'DUPLICATE_ACTION',
        title: 'Already submitted',
        copy: 'That move already landed. Nothing to redo.',
        severity: 'info',
        recoverable: true,
        cta: 'OK',
    },
    NOT_AUTHORIZED: {
        code: 'NOT_AUTHORIZED',
        title: 'Not your turn seat',
        copy: 'This seat is not authorized for that action.',
        severity: 'warning',
        recoverable: true,
        cta: 'OK',
    },
    MATCH_NOT_FOUND: {
        code: 'MATCH_NOT_FOUND',
        title: 'Match not found',
        copy: 'This table is gone or never existed. Head back to the lobby.',
        severity: 'fatal',
        recoverable: false,
        cta: 'Back',
    },
    MATCH_FINISHED: {
        code: 'MATCH_FINISHED',
        title: 'Match already finished',
        copy: 'This match is over. Check the receipt or start a rematch.',
        severity: 'info',
        recoverable: false,
        cta: 'Back',
    },
    ILLEGAL_ACTION: {
        code: 'ILLEGAL_ACTION',
        title: 'Illegal move',
        copy: 'That move is not legal on this board (gate, overshoot, or wrong token).',
        severity: 'warning',
        recoverable: true,
        cta: 'Try again',
    },
    ROLL_NOT_FOUND: {
        code: 'ROLL_NOT_FOUND',
        title: 'Roll missing',
        copy: 'The dice receipt is missing. Request a new roll.',
        severity: 'warning',
        recoverable: true,
        cta: 'Roll again',
    },
    ROLL_CONSUMED: {
        code: 'ROLL_CONSUMED',
        title: 'Roll already used',
        copy: 'That dice face is already spent. Wait for the next roll.',
        severity: 'info',
        recoverable: true,
        cta: 'OK',
    },
    SESSION_EXPIRED: {
        code: 'SESSION_EXPIRED',
        title: 'Session expired',
        copy: 'Your match session expired. Sign once to resume — no stake lost.',
        severity: 'warning',
        recoverable: true,
        cta: 'Resume',
    },
};

const EXTRA_COPY: Record<string, FriendlyError> = {
    LOCAL_MATCH: {
        code: 'LOCAL_MATCH',
        title: 'Local table',
        copy: 'This is an offline / Pass & Play table — nothing to sync.',
        severity: 'info',
        recoverable: true,
        cta: 'OK',
    },
    SESSION_REQUIRED: {
        code: 'SESSION_REQUIRED',
        title: 'Sign in to resume',
        copy: 'Reconnect needs your match session proof. Sign once to continue.',
        severity: 'warning',
        recoverable: true,
        cta: 'Resume',
    },
    BAD_SNAPSHOT: {
        code: 'BAD_SNAPSHOT',
        title: 'Sync hiccup',
        copy: 'We got a bad snapshot. Retrying the pull…',
        severity: 'warning',
        recoverable: true,
        cta: 'Retry',
    },
    FETCH_THROW: {
        code: 'FETCH_THROW',
        title: 'Connection lost',
        copy: 'Could not reach the match server. Check your network and retry.',
        severity: 'warning',
        recoverable: true,
        cta: 'Retry',
    },
    APPLY_THROW: {
        code: 'APPLY_THROW',
        title: 'Could not apply state',
        copy: 'The board rejected the update. Resync once more.',
        severity: 'warning',
        recoverable: true,
        cta: 'Resync',
    },
    CHUNK: {
        code: 'CHUNK',
        title: 'Update shipping',
        copy: 'A fresh update just shipped — reloading pulls the latest arena.',
        severity: 'fatal',
        recoverable: false,
        cta: 'Reload',
    },
    UNKNOWN: {
        code: 'UNKNOWN',
        title: 'Something broke',
        copy: 'Unexpected error. Retry — if it keeps happening, note the time for support.',
        severity: 'fatal',
        recoverable: true,
        cta: 'Retry',
    },
};

export function friendlyError(code: string | undefined | null): FriendlyError {
    if (!code) return EXTRA_COPY.UNKNOWN;
    if (code in MATCH_ACTION_COPY) {
        return MATCH_ACTION_COPY[code as MatchActionErrorCode];
    }
    return EXTRA_COPY[code] ?? EXTRA_COPY.UNKNOWN;
}

export function friendlyErrorFromMessage(message: string | undefined | null): FriendlyError {
    const m = message || '';
    if (/loading chunk|ChunkLoadError|dynamically imported module|importing a module script/i.test(m)) {
        return EXTRA_COPY.CHUNK;
    }
    if (/session expired|SESSION_EXPIRED/i.test(m)) return MATCH_ACTION_COPY.SESSION_EXPIRED;
    if (/not authorized|NOT_AUTHORIZED/i.test(m)) return MATCH_ACTION_COPY.NOT_AUTHORIZED;
    if (/illegal|ILLEGAL/i.test(m)) return MATCH_ACTION_COPY.ILLEGAL_ACTION;
    return EXTRA_COPY.UNKNOWN;
}
