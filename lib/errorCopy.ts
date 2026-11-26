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
    POWER_ARMED: {
        code: 'POWER_ARMED',
        title: 'Choose a token',
        copy: 'Tap one of your tokens on the board to target this power.',
        severity: 'info',
        recoverable: true,
        cta: 'Target',
    },
    POWER_REFUSED: {
        code: 'POWER_REFUSED',
        title: 'Power unavailable',
        copy: 'That power cannot be used right now.',
        severity: 'warning',
        recoverable: true,
        cta: 'OK',
    },
    ILLEGAL_MOVE: {
        code: 'ILLEGAL_MOVE',
        title: 'Illegal move',
        copy: 'That token cannot move there right now.',
        severity: 'warning',
        recoverable: true,
        cta: 'Choose another',
    },
    INVALID_MOVE: {
        code: 'INVALID_MOVE',
        title: 'Invalid move',
        copy: 'That move is not valid on the current board.',
        severity: 'warning',
        recoverable: true,
        cta: 'Try again',
    },
    ALREADY_ROLLED: {
        code: 'ALREADY_ROLLED',
        title: 'Already rolled',
        copy: 'You already rolled this turn — pick a token to move.',
        severity: 'info',
        recoverable: true,
        cta: 'OK',
    },
    NOT_ROLLED: {
        code: 'NOT_ROLLED',
        title: 'Roll first',
        copy: 'Roll the dice before moving a token.',
        severity: 'warning',
        recoverable: true,
        cta: 'Roll',
    },
    ROOM_NOT_READY: {
        code: 'ROOM_NOT_READY',
        title: 'Table still initializing',
        copy: 'The match room is still loading the board. Try again in a moment.',
        severity: 'warning',
        recoverable: true,
        cta: 'Retry',
    },
    NOT_YOUR_TURN: {
        code: 'NOT_YOUR_TURN',
        title: 'Not your turn',
        copy: 'Wait for your turn before acting.',
        severity: 'info',
        recoverable: true,
        cta: 'OK',
    },
    THREE_SIXES: {
        code: 'THREE_SIXES',
        title: 'Three sixes',
        copy: 'Three consecutive sixes forfeited this turn.',
        severity: 'info',
        recoverable: true,
        cta: 'OK',
    },
    RATE_LIMITED: {
        code: 'RATE_LIMITED',
        title: 'Slow down',
        copy: 'Too many actions sent at once — wait a second and try again.',
        severity: 'warning',
        recoverable: true,
        cta: 'Wait',
    },
    UNKNOWN_INTENT: {
        code: 'UNKNOWN_INTENT',
        title: 'Unsupported action',
        copy: 'This client version sent an unrecognized match action.',
        severity: 'warning',
        recoverable: true,
        cta: 'Reload',
    },
    SPECTATOR_READ_ONLY: {
        code: 'SPECTATOR_READ_ONLY',
        title: 'Spectator mode',
        copy: 'Spectators cannot submit gameplay actions.',
        severity: 'info',
        recoverable: false,
        cta: 'OK',
    },
    TICKET_INVALID: {
        code: 'TICKET_INVALID',
        title: 'Ticket invalid',
        copy: 'Your match ticket is no longer valid. Sign in again to rejoin.',
        severity: 'warning',
        recoverable: true,
        cta: 'Sign in',
    },
    SEAT_TAKEN: {
        code: 'SEAT_TAKEN',
        title: 'Seat unavailable',
        copy: 'This match seat is already assigned to another player.',
        severity: 'fatal',
        recoverable: false,
        cta: 'Back',
    },
    NOT_IN_MATCH: {
        code: 'NOT_IN_MATCH',
        title: 'Not seated in match',
        copy: 'Your wallet does not hold a seat in this table.',
        severity: 'fatal',
        recoverable: false,
        cta: 'Back',
    },
    MALFORMED_FRAME: {
        code: 'MALFORMED_FRAME',
        title: 'Malformed request',
        copy: 'The match room received an invalid message frame.',
        severity: 'warning',
        recoverable: true,
        cta: 'Retry',
    },
    UNKNOWN_FRAME_TYPE: {
        code: 'UNKNOWN_FRAME_TYPE',
        title: 'Unknown frame',
        copy: 'The match room received an unsupported message type.',
        severity: 'warning',
        recoverable: true,
        cta: 'Retry',
    },
    FRAME_TOO_LARGE: {
        code: 'FRAME_TOO_LARGE',
        title: 'Message too large',
        copy: 'That message exceeded the 32 KB room packet limit.',
        severity: 'warning',
        recoverable: true,
        cta: 'Retry',
    },
    PROTOCOL_MISMATCH: {
        code: 'PROTOCOL_MISMATCH',
        title: 'Update required',
        copy: 'Your app version does not match the live room protocol — reload to update.',
        severity: 'fatal',
        recoverable: false,
        cta: 'Reload',
    },
    INTERNAL_ERROR: {
        code: 'INTERNAL_ERROR',
        title: 'Room error',
        copy: 'The match room hit a transient internal error. Try again.',
        severity: 'warning',
        recoverable: true,
        cta: 'Retry',
    },
    ROOM_UNAVAILABLE: {
        code: 'ROOM_UNAVAILABLE',
        title: 'Room unavailable',
        copy: 'The game room endpoint is unavailable right now.',
        severity: 'fatal',
        recoverable: true,
        cta: 'Retry',
    },
    NO_ROOM: {
        code: 'NO_ROOM',
        title: 'Not connected to room',
        copy: 'Reconnecting to the game room — wait a moment and try again.',
        severity: 'warning',
        recoverable: true,
        cta: 'Reconnect',
    },
    INTENT_TIMEOUT: {
        code: 'INTENT_TIMEOUT',
        title: 'Action timed out',
        copy: 'The game room did not confirm your action in time. Resyncing…',
        severity: 'warning',
        recoverable: true,
        cta: 'Retry',
    },
    SOCKET_CLOSED: {
        code: 'SOCKET_CLOSED',
        title: 'Connection dropped',
        copy: 'The room socket closed before confirming your action. Reconnecting…',
        severity: 'warning',
        recoverable: true,
        cta: 'Reconnect',
    },
    ROOM_INTENT_FAILED: {
        code: 'ROOM_INTENT_FAILED',
        title: 'Action rejected',
        copy: 'The match room rejected that action.',
        severity: 'warning',
        recoverable: true,
        cta: 'Retry',
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
