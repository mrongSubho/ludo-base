/**
 * Checklist integrity.
 *
 * The remediation tracker drifted badly before this test existed: items were
 * ticked that were not implemented, an implemented item was left unticked, and
 * a stale item claimed deployed contracts were stale after they had been
 * replaced. A markdown file that asserts things about the code needs its own
 * gate, or the next reader inherits someone else's optimism.
 *
 * The checks are deliberately mechanical — no judgement about whether a fix is
 * *good*, only whether the claim is anchored to something that exists.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname ?? __dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const md = read('docs/ops/REMEDIATION_CHECKLIST.md');

function section(name: string, until: string): string {
    // Guard against matching a heading in the *wrong* phase: search from the
    // heading, and require the terminator to come after it.
    const i = md.indexOf(name);
    assert.ok(i > 0, `missing section ${name}`);
    const j = md.indexOf(until, i + name.length);
    assert.ok(j > i, `section ${name} has no ${until} after it`);
    return md.slice(i, j);
}

let phase1Cache: string | null = null;
/** Lazy so a structural break fails the tests that need it, not module load. */
function phase1Parts(): { tasks: string; exitGate: string } {
    if (phase1Cache === null) {
        const p1 = section('## Phase 1', '## Phase 2');
        const g = p1.indexOf('### Exit gate');
        assert.ok(g > 0, 'Phase 1 has no exit gate');
        phase1Cache = p1.slice(0, g);
        return { tasks: phase1Cache, exitGate: p1.slice(g) };
    }
    const p1 = section('## Phase 1', '## Phase 2');
    const g = p1.indexOf('### Exit gate');
    return { tasks: p1.slice(0, g), exitGate: p1.slice(g) };
}

/** Strip the checkbox syntax so items can be classified. */
const items = (body: string) =>
    body
        .split('\n')
        .filter((l) => /^- \[[ x]\]/.test(l))
        .map((l) => ({ done: /^- \[x\]/.test(l), text: l.replace(/^- \[[ x]\]\s*/, '') }));

/** `path:line` and bare `path` references, ignoring URLs and glob-ish prose. */
function references(line: string): string[] {
    const out: string[] = [];
    for (const m of line.matchAll(/`([A-Za-z0-9_./-]+\.(?:ts|tsx|mjs|js|sol|sql|sh|json|toml))(?::(\d+))?`/g)) {
        out.push(m[1]!);
    }
    return out;
}

test('every file referenced by a Phase 1 item exists', () => {
    const missing: string[] = [];
    for (const { text } of items(phase1Parts().tasks)) {
        for (const ref of references(text)) {
            if (!existsSync(join(root, ref))) missing.push(`${ref}  <- ${text.slice(0, 70)}`);
        }
    }
    assert.deepEqual(missing, [], `checklist references files that do not exist:\n${missing.join('\n')}`);
});

test('every file:line citation in Phase 1 still resolves to that line', () => {
    // A line-number citation is a maintenance liability; these are the ones most
    // likely to rot as code shifts.
    const stale: string[] = [];
    for (const { text } of items(phase1Parts().tasks)) {
        for (const m of text.matchAll(/`([A-Za-z0-9_./-]+\.(?:ts|tsx|sol|sql))(?::(\d+))(?:-(\d+))?`/g)) {
            const [, file, , endRaw] = m;
            const path = join(root, file!);
            if (!existsSync(path)) continue;
            const lines = readFileSync(path, 'utf8').split('\n');
            const start = Number(m[2]);
            const end = endRaw ? Number(endRaw) : start;
            if (start > lines.length || end > lines.length) {
                stale.push(`${file}:${m[2]}${endRaw ? `-${endRaw}` : ''} is past EOF (${lines.length} lines)`);
                continue;
            }
            // A citation should point at real code, not a blank line.
            const snippet = lines.slice(start - 1, end).join('\n').trim();
            if (snippet.length === 0) stale.push(`${file}:${m[2]} points at a blank line`);
        }
    }
    assert.deepEqual(stale, [], `stale line citations:\n${stale.join('\n')}`);
});

test('a closed Phase 1 item cites code or is explicitly marked as a decision', () => {
    // Prevents a bare "- [x] it is fixed" from ever entering the tracker.
    const unanchored: string[] = [];
    for (const { done, text } of items(phase1Parts().tasks)) {
        if (!done) continue;
        const anchored =
            references(text).length > 0 ||
            /superseded|policy|documented as|decision|no code|explicit 410|by design/i.test(text);
        if (!anchored) unanchored.push(text.slice(0, 90));
    }
    assert.deepEqual(unanchored, [], `closed items with no anchor:\n${unanchored.join('\n')}`);
});

test('the Phase 1 exit gate cannot read as passed while items are open', () => {
    const { tasks, exitGate } = phase1Parts();
    const open = items(tasks).filter((i) => !i.done).length;
    const gateOpen = items(exitGate).filter((i) => !i.done).length;
    const claimsPassed = /gate status: *open/i.test(exitGate);

    if (open > 0) {
        // Either the gate states it is open, or it still carries unticked boxes.
        assert.ok(
            claimsPassed || gateOpen > 0,
            `${open} Phase 1 task(s) are open but the exit gate claims closure. ` +
                'Mark the gate open or close the tasks.',
        );
    }
    if (open === 0) {
        assert.equal(gateOpen, 0, 'no tasks are open, so no exit-gate box may be unticked');
    }
});

test('open items state why, not just that they are open', () => {
    // An unticked item with no rationale is how SEC-04's test inversion stayed
    // "in progress" while the underlying model was already settled.
    const vague: string[] = [];
    for (const { done, text } of items(phase1Parts().tasks)) {
        if (done) continue;
        if (text.length < 60) vague.push(text);
    }
    assert.deepEqual(vague, [], `open items with no explanation:\n${vague.join('\n')}`);
});

test('contract addresses recorded in the tracker still hold code on chain', async () => {
    // Skipped unless a chain is reachable; a stale address in the tracker is
    // exactly the failure that made the ECO-08 redeploy warning untrue.
    const rpc = process.env.CONSISTENCY_RPC;
    if (!rpc) return; // opt-in: keeps `npm test` offline-safe
    const addrs = [...new Set([...md.matchAll(/`(0x[0-9a-fA-F]{40})`/g)].map((m) => m[1]!))];
    const { createPublicClient, http } = await import('viem');
    const client = createPublicClient({ transport: http(rpc) });
    const dead: string[] = [];
    for (const a of addrs) {
        const code = await client.getCode({ address: a as `0x${string}` });
        if (!code || code === '0x') dead.push(a);
    }
    assert.deepEqual(dead, [], `addresses in the tracker with no code on ${rpc}: ${dead.join(', ')}`);
});
