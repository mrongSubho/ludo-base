/**
 * Q2 device-pass report — aggregate hop samples into a sign-off artifact.
 * Run on the target device (or via token-move-test), export JSON, paste into
 * docs/ops/DEVICE_PASS.md.
 */

import { PERF_BUDGET, type HopMetrics, hopSampleSummary, nowMs } from './budget';

export interface DevicePassReport {
    version: 1;
    generatedAt: string;
    userAgent: string;
    viewport: { w: number; h: number; dpr: number };
    budget: typeof PERF_BUDGET;
    summary: ReturnType<typeof hopSampleSummary>;
    samples: HopMetrics[];
    verdict: 'pass' | 'fail' | 'incomplete';
    failures: string[];
}

export function buildDevicePassReport(samples: HopMetrics[], meta?: {
    userAgent?: string;
    viewport?: { w: number; h: number; dpr: number };
}): DevicePassReport {
    const summary =
        samples.length > 0
            ? {
                n: samples.length,
                p50: percentile(samples.map((s) => s.composeMs), 0.5),
                p95: percentile(samples.map((s) => s.composeMs), 0.95),
                failRate: samples.filter((s) => !s.ok).length / samples.length,
            }
            : hopSampleSummary();

    const failures: string[] = [];
    if (samples.length === 0) {
        failures.push('no hop samples captured');
    } else {
        if (summary.p95 > PERF_BUDGET.hopComposeMs) {
            failures.push(`p95 compose ${summary.p95.toFixed(1)}ms > ${PERF_BUDGET.hopComposeMs}ms`);
        }
        if (summary.failRate > 0.1) {
            failures.push(`fail rate ${(summary.failRate * 100).toFixed(0)}% > 10%`);
        }
    }

    const verdict: DevicePassReport['verdict'] =
        samples.length === 0 ? 'incomplete' : failures.length === 0 ? 'pass' : 'fail';

    return {
        version: 1,
        generatedAt: new Date().toISOString(),
        userAgent: meta?.userAgent ?? (typeof navigator !== 'undefined' ? navigator.userAgent : 'node'),
        viewport: meta?.viewport ?? (typeof window !== 'undefined'
            ? { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio || 1 }
            : { w: 0, h: 0, dpr: 1 }),
        budget: PERF_BUDGET,
        summary,
        samples: samples.slice(-50),
        verdict,
        failures,
    };
}

function percentile(values: number[], q: number): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
}

export function formatDevicePassMarkdown(report: DevicePassReport): string {
    const lines = [
        `### Device pass — ${report.generatedAt}`,
        ``,
        `| Field | Value |`,
        `| --- | --- |`,
        `| Verdict | **${report.verdict.toUpperCase()}** |`,
        `| UA | ${report.userAgent} |`,
        `| Viewport | ${report.viewport.w}×${report.viewport.h} @${report.viewport.dpr}x |`,
        `| Samples | ${report.summary.n} |`,
        `| p50 / p95 compose | ${report.summary.p50.toFixed(1)}ms / ${report.summary.p95.toFixed(1)}ms |`,
        `| Budget | compose ≤${report.budget.hopComposeMs}ms · longtask ≤${report.budget.longTaskMs}ms |`,
        `| Fail rate | ${(report.summary.failRate * 100).toFixed(0)}% |`,
    ];
    if (report.failures.length) {
        lines.push(``, `**Failures:** ${report.failures.join('; ')}`);
    }
    return lines.join('\n');
}

/** Browser console helper: `await __ludoPerf.report()` */
export function installPerfDebugHook(collect: () => HopMetrics[]): void {
    if (typeof window === 'undefined') return;
    (window as unknown as { __ludoPerf?: unknown }).__ludoPerf = {
        budget: PERF_BUDGET,
        now: nowMs,
        summary: hopSampleSummary,
        report: () => buildDevicePassReport(collect()),
        markdown: () => formatDevicePassMarkdown(buildDevicePassReport(collect())),
    };
}
