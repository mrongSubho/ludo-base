/**
 * Q2 hop bench — generate DevicePassReport samples in Node (CI/proxy).
 * Real phone sign-off still uses docs/ops/DEVICE_PASS.md + __ludoPerf.
 *
 * Run: npm run bench:hop
 */

import { measureHop, recordHopSample, resetHopSamples, getHopSamples, PERF_BUDGET } from '../lib/perf/budget';
import { buildDevicePassReport, formatDevicePassMarkdown } from '../lib/perf/report';

function busyWork(ms: number): void {
    const end = Date.now() + ms;
    while (Date.now() < end) {
        Math.sqrt(Math.random() * 1000);
    }
}

async function main() {
    resetHopSamples();
    const mode = process.argv[2] || 'nominal';
    const count = Number(process.env.HOP_SAMPLES || 30);

    console.log('hop bench', { mode, count, budget: PERF_BUDGET });

    for (let i = 0; i < count; i++) {
        // Simulate token-hop compose cost: nominal ~2–8ms, jank mode ~20–40ms
        const workMs = mode === 'jank' ? 20 + (i % 5) * 4 : 2 + (i % 4);
        const metrics = await measureHop(`bench-${i}`, () => busyWork(workMs));
        recordHopSample(metrics);
    }

    const report = buildDevicePassReport(getHopSamples(), {
        userAgent: `node-hop-bench/${mode}`,
        viewport: { w: 0, h: 0, dpr: 1 },
    });

    console.log(formatDevicePassMarkdown(report));
    console.log('\n--- paste block for DEVICE_PASS.md ---\n');
    console.log(formatDevicePassMarkdown(report));
    console.log(`\nverdict=${report.verdict} (proxy/CI — confirm on physical device before un-park)`);
    process.exit(report.verdict === 'fail' ? 1 : 0);
}

void main();
