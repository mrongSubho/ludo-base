/**
 * Opaque Edge errors (Phase 3 / SEC-31).
 *
 * Every Edge function used to return `error.message` straight from PostgREST or
 * from a caught exception. That is not a cosmetic problem: a PostgREST message
 * carries the failing table, column and constraint name, and one of its
 * standard hints is literally
 *
 *   "Grant the required privileges to the current role with:
 *    GRANT SELECT ON public.<table> TO anon;"
 *
 * So an anonymous caller could enumerate the schema by reading error strings,
 * and an auth failure could tell them the exact grant to add. Errors are also
 * the easiest thing to trigger, so it is a free oracle.
 *
 * The rule here: **the client gets a fixed code and a generic sentence; the
 * detail goes to the log.** Callers switch on `code`, never on prose.
 */

/** Stable, client-facing codes. Add to this union rather than inventing strings. */
export type EdgeErrorCode =
    | 'BAD_REQUEST'
    | 'UNAUTHORIZED'
    | 'FORBIDDEN'
    | 'NOT_FOUND'
    | 'CONFLICT'
    | 'RATE_LIMITED'
    | 'INTERNAL';

export interface EdgeErrorBody {
    error: string;
    code: EdgeErrorCode;
    /** Present only where the value is safe to echo (e.g. a field name). */
    detail?: string;
}

/**
 * The one generic sentence per code. Deliberately uninformative: it tells the
 * client what to do next without telling an attacker what the server saw.
 */
const GENERIC: Record<EdgeErrorCode, { status: number; message: string }> = {
    BAD_REQUEST: { status: 400, message: 'Invalid request' },
    UNAUTHORIZED: { status: 401, message: 'Not authorized' },
    FORBIDDEN: { status: 403, message: 'Not permitted' },
    NOT_FOUND: { status: 404, message: 'Not found' },
    CONFLICT: { status: 409, message: 'Request conflicts with current state' },
    RATE_LIMITED: { status: 429, message: 'Too many requests' },
    INTERNAL: { status: 500, message: 'Request could not be completed' },
};

export interface OmitOpts {
    /**
     * The real cause. Logged, never returned. A PostgREST error object,
     * an exception, or a string.
     */
    cause?: unknown;
    /** Which function raised it, for the log line. */
    scope?: string;
    /**
     * Extra server-side context, also logged only. Use for values that would be
     * sensitive if echoed (match ids, wallet addresses, constraint names).
     */
    log?: Record<string, unknown>;
    /** Override the status (e.g. a 503 for a dependency being down). */
    status?: number;
}

/**
 * Build a Response carrying an opaque error. Always call `console.error` with
 * the real cause first — this function logs it for you.
 */
export function edgeError(code: EdgeErrorCode, opts: OmitOpts = {}): Response {
    const generic = GENERIC[code] ?? GENERIC.INTERNAL;
    const status = opts.status ?? generic.status;

    // Server-side record. This is the only place the real cause goes.
    const cause = describeCause(opts.cause);
    const scope = opts.scope ? `[${opts.scope}] ` : '';
    if (cause || opts.log) {
        console.error(
            `${scope}${code}${cause ? `: ${cause}` : ''}`,
            opts.log ? JSON.stringify(opts.log) : '',
        );
    }

    const body: EdgeErrorBody = { error: generic.message, code };
    return new Response(JSON.stringify(body), {
        status,
        headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers':
                'authorization, x-client-info, apikey, content-type, x-ludo-edge-version',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Content-Type': 'application/json',
        },
    });
}

/** Convenience: the same thing, shaped like a NextResponse body for in-handler use. */
export function edgeErrorBody(code: EdgeErrorCode): EdgeErrorBody {
    const generic = GENERIC[code] ?? GENERIC.INTERNAL;
    return { error: generic.message, code };
}

export function edgeErrorStatus(code: EdgeErrorCode): number {
    return (GENERIC[code] ?? GENERIC.INTERNAL).status;
}

/**
 * Flatten a PostgREST error (or anything else) into a log string.
 *
 * PostgREST errors are `{ message, details, hint, code }` and the `hint` is the
 * dangerous field — it names tables and suggests grants. It is logged because
 * the log is private, never because it is safe to return.
 */
function describeCause(cause: unknown): string {
    if (cause === undefined || cause === null) return '';
    if (typeof cause === 'string') return cause;
    if (cause instanceof Error) return `${cause.name}: ${cause.message}`;
    if (typeof cause === 'object') {
        const e = cause as { message?: unknown; code?: unknown; hint?: unknown; details?: unknown };
        const parts: string[] = [];
        if (typeof e.code === 'string' || typeof e.code === 'number') parts.push(`code=${e.code}`);
        if (typeof e.message === 'string') parts.push(`message=${e.message}`);
        if (typeof e.details === 'string' && e.details) parts.push(`details=${e.details}`);
        if (typeof e.hint === 'string' && e.hint) parts.push(`hint=${e.hint}`);
        if (parts.length) return parts.join(' ');
        try {
            return JSON.stringify(cause);
        } catch {
            return '[unserialisable]';
        }
    }
    return String(cause);
}

/**
 * SEC-31: `applyPower` returns engine-authored strings like "Power not held" or
 * "Not your turn". Those are correct for a local caller and wrong for the wire:
 * they describe another player's inventory and turn state to whoever asked.
 *
 * The caller keeps the two flags the UI genuinely needs (`armed` — a targeted
 * power is waiting for a target; `kept` — the item was not consumed) and gets a
 * fixed code for everything else.
 */
export type PowerErrorCode =
    | 'NOT_YOUR_TURN'
    | 'WRONG_PHASE'
    | 'ALREADY_SPENT'
    | 'NOT_HELD'
    | 'BAD_TARGET';

const POWER_ERROR_CODES: Record<string, PowerErrorCode> = {
    'Match finished': 'NOT_YOUR_TURN',
    'Not your turn': 'NOT_YOUR_TURN',
    'Wrong phase': 'WRONG_PHASE',
    'Power already spent this turn': 'ALREADY_SPENT',
    'Power not held': 'NOT_HELD',
    'Bad token index': 'BAD_TARGET',
    'Nuke needs a target token': 'BAD_TARGET',
    'Teleport needs a target token': 'BAD_TARGET',
};

export function opaquePowerError(engineError: string): PowerErrorCode {
    return POWER_ERROR_CODES[engineError] ?? 'BAD_TARGET';
}

export const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers':
        'authorization, x-client-info, apikey, content-type, x-ludo-edge-version',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
} as const;

export function jsonOk(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS } });
}
