/**
 * Print a paste-ready evidence block for docs/ops/UNPARK_DECISION.md §1.
 * Run: npm run unpark:evidence
 */

import { execSync } from 'node:child_process';

function run(cmd: string): string {
    try {
        return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
        return `command failed: ${cmd}\n${String(err)}`;
    }
}

function tail(text: string, n = 20): string {
    const lines = text.trimEnd().split('\n');
    return lines.slice(-n).join('\n');
}

const stamp = new Date().toISOString();
const tests = run('npm test');
const drill = run('npx --yes tsx --test scripts/drill.runner.ts');
const drillDeep = run('npx --yes tsx --test scripts/drill.deep.ts');
const hop = run('npx --yes tsx scripts/hop.bench.ts');
const tsc = run('npx tsc -p tsconfig.json --noEmit');

const testSummary = /# pass (\d+)\n# fail (\d+)/.exec(tests);
const drillSummary = /# pass (\d+)\n# fail (\d+)/.exec(drill);
const deepSummary = /# pass (\d+)\n# fail (\d+)/.exec(drillDeep);

console.log(`### Auto evidence — ${stamp}

#### tests (\`npm test\`)
\`\`\`
pass=${testSummary?.[1] ?? '?'} fail=${testSummary?.[2] ?? '?'}
\`\`\`

#### drill:live
\`\`\`
pass=${drillSummary?.[1] ?? '?'} fail=${drillSummary?.[2] ?? '?'}
${tail(drill, 12)}
\`\`\`

#### drill:deep (D1–D4 simulation)
\`\`\`
pass=${deepSummary?.[1] ?? '?'} fail=${deepSummary?.[2] ?? '?'}
${tail(drillDeep, 20)}
\`\`\`

#### hop bench (CI proxy — not a phone)
\`\`\`
${tail(hop, 18)}
\`\`\`

#### typecheck
\`\`\`
${tsc.trim() || 'clean (0 errors)'}
\`\`\`

#### Manual still required (paste when done)
- Q2 device: \`await __ludoPerf.markdown()\` on phone → \`DEVICE_PASS.md\`
- D1–D4 on two real browsers/phones (simulation is not sign-off)
- Sentry: project + DSN + first event
`);
