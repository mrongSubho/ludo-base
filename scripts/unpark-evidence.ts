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
const tsc = run('npx tsc -p tsconfig.json --noEmit');

const testSummary = /# pass (\d+)\n# fail (\d+)/.exec(tests);
const drillSummary = /# pass (\d+)\n# fail (\d+)/.exec(drill);

console.log(`### Auto evidence — ${stamp}

#### tests (\`npm test\`)
\`\`\`
pass=${testSummary?.[1] ?? '?'} fail=${testSummary?.[2] ?? '?'}
\`\`\`

#### drill:live (\`scripts/drill.runner.ts\`)
\`\`\`
${tail(drill, 25)}
\`\`\`

#### typecheck
\`\`\`
${tsc.trim() || 'clean (0 errors)'}
\`\`\`

#### Manual still required (paste when done)
- Q2 device: \`await __ludoPerf.markdown()\` on phone → \`DEVICE_PASS.md\`
- D1–D4 live drills → table in UNPARK_DECISION §1.2
- Sentry: project + DSN + first event
`);
