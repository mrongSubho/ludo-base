/**
 * Q2 — frame / hop performance budget.
 * Budget: hop compose ≤16ms, long task ≤50ms during move (competitive plan).
 */

import { track } from '../telemetry';

export const PERF_BUDGET = {
    /** Single compose/measure slice during a token hop (ms). */
    hopComposeMs: 16,
    /** Long-task ceiling while a hop is active (ms). */
    longTaskMs: 50,
    /** Reference GSAP FLIP hop duration (ms) — BoardTokens contract. */
    hopDurationMs: 1300,
} as const;

export type HopMetrics = {
    label: string;
    durationMs: number;
    composeMs: number;
    longTasks: number;
    ok: boolean;
    violations: string[];
};

export function nowMs(): number {
    return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

type LongTaskObserver = { disconnect: () => void };

function observeLongTasks(collected: { count: number; maxMs: number }): LongTaskObserver | null {
    if (typeof PerformanceObserver === 'undefined') return null;
    try {
        const po = new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
                collected.count += 1;
                collected.maxMs = Math.max(collected.maxMs, entry.duration);
            }
        });
        po.observe({ entryTypes: ['longtask'] as string[] });
        return po;
    } catch {
        return null;
    }
}

/**
 * Measure a hop/move unit of work against PERF_BUDGET.
 * `fn` is the compose + animation kick; we measure wall time of `fn` only.
 */
export async function measureHop(
    label: string,
    fn: () => void | Promise<void>,
    budget: { hopComposeMs: number; longTaskMs: number } = PERF_BUDGET
): Promise<HopMetrics> {
    const longTasks = { count: 0, maxMs: 0 };
    const po = observeLongTasks(longTasks);
    const t0 = nowMs();
    try {
        await fn();
    } finally {
        const durationMs = nowMs() - t0;
        // Give longtask observer a microtask to flush if present
        po?.disconnect();

        const violations: string[] = [];
        if (durationMs > budget.hopComposeMs) {
            violations.push(`compose ${durationMs.toFixed(1)}ms > ${budget.hopComposeMs}ms`);
        }
        if (longTasks.maxMs > budget.longTaskMs) {
            violations.push(`longtask ${longTasks.maxMs.toFixed(1)}ms > ${budget.longTaskMs}ms`);
        }

        const metrics: HopMetrics = {
            label,
            durationMs,
            composeMs: durationMs,
            longTasks: longTasks.count,
            ok: violations.length === 0,
            violations,
        };

        if (!metrics.ok) {
            track('net_degraded', {
                reason: 'perf_budget',
                label,
                durationMs: Math.round(durationMs),
                longTasks: longTasks.count,
            });
        }

        return metrics;
    }
}

export function assertWithinBudget(
    metrics: HopMetrics,
    budget: { hopComposeMs: number; longTaskMs: number } = PERF_BUDGET
): { ok: boolean; violations: string[] } {
    const violations = [...metrics.violations];
    if (metrics.composeMs > budget.hopComposeMs && !violations.some((v) => v.startsWith('compose'))) {
        violations.push(`compose ${metrics.composeMs}ms > ${budget.hopComposeMs}ms`);
    }
    return { ok: violations.length === 0, violations };
}

/** Rolling in-memory sample for debug overlays / drills. */
const samples: HopMetrics[] = [];

export function recordHopSample(m: HopMetrics): void {
    samples.push(m);
    if (samples.length > 50) samples.shift();
}

export function hopSampleSummary(): { n: number; p50: number; p95: number; failRate: number } {
    if (samples.length === 0) return { n: 0, p50: 0, p95: 0, failRate: 0 };
    const sorted = [...samples].map((s) => s.composeMs).sort((a, b) => a - b);
    const pick = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
    const fails = samples.filter((s) => !s.ok).length;
    return {
        n: samples.length,
        p50: pick(0.5),
        p95: pick(0.95),
        failRate: fails / samples.length,
    };
}

export function getHopSamples(): HopMetrics[] {
    return [...samples];
}

export function resetHopSamples(): void {
    samples.length = 0;
}
