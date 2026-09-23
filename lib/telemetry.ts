/**
 * Q1 client telemetry — crash + play funnel.
 * Never log signatures, session keys, ECDH material, or DM plaintext.
 */

export type PlayFunnelEvent =
    | 'session_start'
    | 'lobby_open'
    | 'seat_confirmed'
    | 'roll_ok'
    | 'move_ok'
    | 'match_end'
    | 'resync_ok'
    | 'net_degraded'
    | 'schema_drop';

export type TelemetryProps = Record<string, string | number | boolean | null | undefined>;

type Transport = {
    track: (event: string, props?: TelemetryProps) => void;
    exception: (error: unknown, props?: TelemetryProps) => void;
};

const REDACT_KEYS = /^(sig|signature|sessionKey|privateKey|ecdh|seed|nonce|token|authorization|password)/i;

function scrub(props: TelemetryProps | undefined): TelemetryProps | undefined {
    if (!props) return undefined;
    const out: TelemetryProps = {};
    for (const [k, v] of Object.entries(props)) {
        out[k] = REDACT_KEYS.test(k) ? '[redacted]' : v;
    }
    return out;
}

const consoleTransport: Transport = {
    track(event, props) {
        if (process.env.NODE_ENV === 'production') return;
        console.info(`[telemetry] ${event}`, scrub(props) ?? {});
    },
    exception(error, props) {
        console.error('[telemetry] exception', error, scrub(props) ?? {});
    },
};

let transport: Transport = consoleTransport;
let initialized = false;

/** Swap transport (e.g. Sentry) without rewriting call sites. */
export function setTelemetryTransport(next: Transport): void {
    transport = next;
}

export function initTelemetry(opts?: { dsn?: string }): void {
    if (initialized) return;
    initialized = true;
    // Sentry or similar: auto-bind from env DSN (see telemetrySentry.ts).
    const envDsn = opts?.dsn
        || (typeof process !== 'undefined' ? process.env.NEXT_PUBLIC_SENTRY_DSN || process.env.SENTRY_DSN : undefined);
    if (envDsn) {
        void import('./telemetrySentry')
            .then((mod) => {
                try {
                    setTelemetryTransport(mod.createSentryTransport({ dsn: envDsn }));
                    console.info('[telemetry] Sentry transport bound');
                } catch (err) {
                    console.warn('[telemetry] invalid Sentry DSN — staying on console', err);
                }
            })
            .catch(() => {
                /* stay on console */
            });
    }
    track('session_start', { env: process.env.NODE_ENV ?? 'unknown' });
}

export function track(event: PlayFunnelEvent | (string & {}), props?: TelemetryProps): void {
    try {
        transport.track(event, scrub(props));
    } catch {
        /* telemetry must never break play */
    }
}

export function captureException(error: unknown, props?: TelemetryProps): void {
    try {
        transport.exception(error, scrub(props));
    } catch {
        /* ignore */
    }
}
