/**
 * Q1 client telemetry — crash + play funnel.
 * Q7 policy: hard scrub + sampling via lib/telemetryPolicy.
 * Never log signatures, session keys, ECDH material, or DM plaintext.
 */

import {
    scrubTelemetryProps,
    shouldSample,
} from './telemetryPolicy';

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

const consoleTransport: Transport = {
    track(event, props) {
        if (process.env.NODE_ENV === 'production') return;
        console.info(`[telemetry] ${event}`, scrubTelemetryProps(props));
    },
    exception(error, props) {
        console.error('[telemetry] exception', error, scrubTelemetryProps(props));
    },
};

let transport: Transport = consoleTransport;
let initialized = false;
/** 0–1 sample rate for non-critical funnel events (Q7). */
let sampleRate = 0.25;

/** Swap transport (e.g. Sentry) without rewriting call sites. */
export function setTelemetryTransport(next: Transport): void {
    transport = next;
}

export function setTelemetrySampleRate(rate: number): void {
    sampleRate = Math.min(1, Math.max(0, rate));
}

export function initTelemetry(opts?: { dsn?: string; sampleRate?: number }): void {
    if (initialized) return;
    initialized = true;
    if (typeof opts?.sampleRate === 'number') setTelemetrySampleRate(opts.sampleRate);
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
        // Q7 — sample funnel noise; always keep resync/errors/authority.
        if (!shouldSample(event, sampleRate)) return;
        transport.track(event, scrubTelemetryProps(props) as TelemetryProps);
    } catch {
        /* telemetry must never break play */
    }
}

export function captureException(error: unknown, props?: TelemetryProps): void {
    try {
        // Errors always emit (exceptions bypass sampling).
        transport.exception(error, scrubTelemetryProps(props) as TelemetryProps);
    } catch {
        /* ignore */
    }
}

// Re-export policy helpers so call sites stay one import away.
export { scrubTelemetryProps, shouldSample, STANDING_SLOS, sloStatusLine } from './telemetryPolicy';
export type { SloDefinition, SloName } from './telemetryPolicy';
