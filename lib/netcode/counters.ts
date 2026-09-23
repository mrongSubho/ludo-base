/**
 * N1 named netcode counters (TSDK-style ops ladder).
 * Graph these; do not invent anonymous console-only metrics.
 */

export type NetCounter =
    | 'net_heartbeat_ok'
    | 'net_heartbeat_timeout'
    | 'net_reconnect_attempt'
    | 'net_reconnect_success'
    | 'net_seq_gap'
    | 'net_authority_switch'
    | 'net_resync_applied'
    | 'net_schema_drop'
    | 'net_intent_dup'
    | 'net_intent_ok';

const COUNTERS: NetCounter[] = [
    'net_heartbeat_ok',
    'net_heartbeat_timeout',
    'net_reconnect_attempt',
    'net_reconnect_success',
    'net_seq_gap',
    'net_authority_switch',
    'net_resync_applied',
    'net_schema_drop',
    'net_intent_dup',
    'net_intent_ok',
];

let counts: Record<NetCounter, number> = zero();

function zero(): Record<NetCounter, number> {
    const out = {} as Record<NetCounter, number>;
    for (const key of COUNTERS) out[key] = 0;
    return out;
}

type NetListener = (name: NetCounter, total: number, delta: number) => void;
const listeners = new Set<NetListener>();

export function bumpNet(name: NetCounter, delta = 1): void {
    if (!(name in counts)) return;
    counts[name] += delta;
    for (const fn of listeners) {
        try {
            fn(name, counts[name], delta);
        } catch {
            /* listeners must not break netcode */
        }
    }
}

export function getNetCounters(): Readonly<Record<NetCounter, number>> {
    return { ...counts };
}

export function resetNetCounters(): void {
    counts = zero();
}

export function onNetCounter(fn: NetListener): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

/** Exponential backoff with jitter for reconnect attempts. */
export function reconnectDelayMs(attempt: number, baseMs = 500, maxMs = 8000): number {
    const exp = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt));
    const jitter = Math.floor(Math.random() * (exp * 0.25));
    return Math.min(maxMs, exp + jitter);
}
