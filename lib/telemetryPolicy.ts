/**
 * Q7 — standing SLOs and telemetry policy.
 * Promote exit criteria to measurable SLOs; enforce scrub + sample rules
 * in code so high-volume noise never buries resync/authority/errors.
 */

export type SloName =
    | 'match_completion_rate'
    | 'resync_success_rate'
    | 'roll_dice_p95_ms'
    | 'settle_ready_p95_ms';

export interface SloDefinition {
    name: SloName;
    /** Human label for dashboards / notice strip. */
    label: string;
    /** Healthy threshold (inclusive). */
    target: string;
    /** Alert when breached this long. */
    alertAfter: string;
    /** Events always kept at 100% sample. */
    alwaysSample: boolean;
}

export const STANDING_SLOS: SloDefinition[] = [
    {
        name: 'match_completion_rate',
        label: 'Match completion',
        target: '≥ 95% of started matches reach finished',
        alertAfter: '1h below target',
        alwaysSample: true,
    },
    {
        name: 'resync_success_rate',
        label: 'Resync success',
        target: '≥ 90% of resync attempts apply a snapshot',
        alertAfter: '15m below target',
        alwaysSample: true,
    },
    {
        name: 'roll_dice_p95_ms',
        label: 'Edge roll-dice p95',
        target: '< 800ms',
        alertAfter: '15m above',
        alwaysSample: false,
    },
    {
        name: 'settle_ready_p95_ms',
        label: 'Settle-ready p95 (excl. dispute window)',
        target: '< 10min lock → settled',
        alertAfter: 'any stuck locked pool past effective settleBy + pauseDelta',
        alwaysSample: true,
    },
];

/** Events that must never be sampled away. */
export const ALWAYS_SAMPLE_EVENTS = new Set([
    'session_start',
    'resync_ok',
    'net_degraded',
    'schema_drop',
    'match_end',
]);

/** Deny-list prefixes — beforeSend must never emit these. */
export const SENSITIVE_KEY_PREFIXES = [
    'sig',
    'signature',
    'session',
    'sessionid',
    'sessionkey',
    'private',
    'privatekey',
    'ecdh',
    'seed',
    'nonce',
    'token',
    'authorization',
    'password',
    'secret',
    'mnemonic',
    'cookie',
] as const;

export const MAX_PROP_VALUE_LEN = 200;

export function isSensitiveKey(key: string): boolean {
    const k = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    return SENSITIVE_KEY_PREFIXES.some((p) => k.startsWith(p) || k.includes(p));
}

export function truncateValue(v: string): string {
    return v.length > MAX_PROP_VALUE_LEN ? `${v.slice(0, MAX_PROP_VALUE_LEN)}…` : v;
}

/**
 * Hard scrub used by every transport (beforeSend).
 * Strips sensitive keys, truncates strings, drops functions/BigInt.
 */
export function scrubTelemetryProps(props: Record<string, unknown> | undefined): Record<string, string | number | boolean | null> {
    const out: Record<string, string | number | boolean | null> = {};
    if (!props) return out;
    for (const [k, v] of Object.entries(props)) {
        if (isSensitiveKey(k)) {
            out[k] = '[redacted]';
            continue;
        }
        if (v === null || typeof v === 'boolean' || typeof v === 'number') {
            out[k] = v;
            continue;
        }
        if (typeof v === 'string') {
            out[k] = truncateValue(v);
            continue;
        }
        // objects / arrays / functions / bigint — drop (never serialize secrets accidentally)
        out[k] = '[omitted]';
    }
    return out;
}

/**
 * Sampling: 100% for always-sample / errors; `rate` for the rest.
 * Deterministic when `rand` is provided (tests).
 */
export function shouldSample(event: string, rate = 0.25, rand: () => number = Math.random): boolean {
    if (ALWAYS_SAMPLE_EVENTS.has(event)) return true;
    if (rate >= 1) return true;
    if (rate <= 0) return false;
    return rand() < rate;
}

export function sloStatusLine(): string {
    return STANDING_SLOS.map((s) => `${s.label}: ${s.target}`).join(' · ');
}
