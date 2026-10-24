/**
 * Shared failure taxonomy for send paths (live chat, DMs).
 *
 * Why this exists: on 2026-10-23 a signed-in user could not send a live-chat
 * message and the UI showed *nothing* — no error, just a 10-second cooldown
 * counting down. The route had returned 401, the client had swallowed it, and the
 * real cause (no session header) took four rounds to find because there was no
 * signal at any layer.
 *
 * Every failure on a send path must answer one question for the user: **whose
 * fault is this, and what do I do about it?** A bare "Failed to send" answers
 * neither, so it is not an error message — it is the absence of one.
 *
 * The rule this file encodes: never return a generic failure. Always attach a
 * `code` from this union, so the client can tell the user which of these it is.
 */

export type SendErrorCode =
    /** The request never left, or never got a response. Client-side. */
    | 'network'
    /** Session missing, expired or revoked — the user must reconnect. */
    | 'auth'
    /** Input rejected before any write. Client-fixable. */
    | 'validation'
    /** Slow mode / cooldown. Client-fixable by waiting. */
    | 'rate_limited'
    /** The write itself failed — FK, constraint, RLS, connection. Server-side. */
    | 'db_write'
    /** A read the send depends on failed. Server-side. */
    | 'db_read'
    /** Required server configuration is absent. Server-side, operator-fixable. */
    | 'config'
    /** Anything else that went wrong server-side. */
    | 'server';

/** HTTP status each code maps to. Keeps routes and clients in agreement. */
export const SEND_ERROR_STATUS: Record<SendErrorCode, number> = {
    network: 0,
    auth: 401,
    validation: 400,
    rate_limited: 429,
    db_write: 500,
    db_read: 500,
    config: 500,
    server: 500,
};

/**
 * User-facing copy. Each entry says whose fault it is and what to do — that is
 * the whole point. Written for the person who just watched their message
 * vanish, not for a log file.
 */
export const SEND_ERROR_MESSAGE: Record<SendErrorCode, string> = {
    network: "Can't reach the game server. Check your connection and try again.",
    auth: 'Session disconnected',
    validation: 'That message was rejected — check what you typed.',
    rate_limited: 'Slow mode — wait a moment before your next message.',
    db_write:
        "Couldn't save your message. That's on us, not you — please try again in a moment.",
    db_read: "Couldn't load what's needed to send that. Please try again in a moment.",
    config: 'The server is missing configuration it needs. This is being looked at.',
    server: 'Something went wrong on our side. Please try again shortly.',
};

export interface SendErrorBody {
    error: string;
    code: SendErrorCode;
    /** Optional machine detail for logs. Never shown raw to the user. */
    detail?: string;
}

/** Build the JSON body a send route should return on failure. */
export function sendError(code: SendErrorCode, detail?: string): SendErrorBody {
    return { error: SEND_ERROR_MESSAGE[code], code, ...(detail ? { detail } : {}) };
}

/**
 * Classify an arbitrary thrown value / PostgREST error into a code.
 *
 * PostgREST errors carry `code` (a Postgres SQLSTATE) and `message`. A missing
 * service-role key surfaces as a thrown Error before any query runs.
 */
export function classifyWriteError(err: unknown): { code: SendErrorCode; detail?: string } {
    const e = err as { code?: string; message?: string } | null | undefined;
    const msg = String(e?.message ?? err ?? '');
    const sqlstate = e?.code ?? '';

    if (/service role is not configured|not configured/i.test(msg)) {
        return { code: 'config', detail: msg };
    }
    // 23503 FK, 23505 unique, 23514 check, 42501 RLS — all write-side failures.
    if (/^(23503|23505|23514|42501|23|42)/.test(sqlstate)) {
        return { code: 'db_write', detail: `${sqlstate}: ${msg}` };
    }
    if (/foreign key|violates|constraint|permission denied|row-level security/i.test(msg)) {
        return { code: 'db_write', detail: msg };
    }
    if (/fetch failed|network|ECONN|timed out|timeout/i.test(msg)) {
        return { code: 'network', detail: msg };
    }
    return { code: 'server', detail: msg };
}

/** Map an HTTP status back to a code, for the client side of a non-ok response. */
export function codeFromStatus(status: number, body?: { code?: SendErrorCode }): SendErrorCode {
    if (body?.code) return body.code;
    if (status === 401 || status === 403) return 'auth';
    if (status === 429) return 'rate_limited';
    if (status === 400 || status === 404 || status === 409) return 'validation';
    if (status === 0) return 'network';
    return 'server';
}

/**
 * Client-side: turn a non-ok response (or a thrown fetch) into the sentence the
 * user should read.
 *
 * The server always sends `{ error, code, detail }` now, so this normally just
 * relays `error`. It exists so the client never has to invent its own wording —
 * one place decides what a failure means.
 */
export async function describeSendFailure(
    res: Response | null,
    thrown?: unknown,
): Promise<{ message: string; code: SendErrorCode }> {
    if (thrown) {
        return { message: SEND_ERROR_MESSAGE.network, code: 'network' };
    }
    if (!res) {
        return { message: SEND_ERROR_MESSAGE.network, code: 'network' };
    }
    let body: { error?: string; code?: SendErrorCode } = {};
    try {
        body = await res.json();
    } catch {
        /* non-JSON body — fall through to the status mapping */
    }
    const code = codeFromStatus(res.status, body);
    return { message: body.error || SEND_ERROR_MESSAGE[code], code };
}
