/**
 * Record integrity — docs/ops/IMPLEMENTATION_RECORD.md.
 *
 * This gate has a history worth keeping. As a *checklist* the tracker drifted
 * badly: items were ticked that were not implemented, an implemented item was
 * left unticked, and a stale item claimed deployed contracts were stale after
 * they had been replaced. A markdown file that asserts things about the code
 * needs its own gate, or the next reader inherits someone else's optimism.
 *
 * The file became an implementation record on 2026-10-13 (the last open item,
 * DB-22, had closed), and on the same day the old plan + record were merged into
 * the centralized `docs/ops/IMPLEMENTATION_RECORD.md`, so the checkbox-era rules
 * ("no unticked box may claim closure") no longer apply. What replaces them is
 * the property that actually matters now:
 *
 *   1. every finding ID in the audit's findings table appears in the record —
 *      the "154/154" sign-off number is derived from the audit, not hand-typed;
 *   2. the three deferred-by-decision items are still recorded, so a future
 *      edit cannot quietly drop them and make the record look more finished
 *      than it is;
 *   3. no checkbox syntax is back — the record is prose, and a `- [ ]` would be
 *      drift toward plan form;
 *   4. the phase sections still exist, so a phase of history cannot be deleted
 *      by accident.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname ?? __dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const record = read('docs/ops/IMPLEMENTATION_RECORD.md'); // centralized since 2026-10-13
const audit = read('docs/ops/SYSTEM_REVIEW.md');

/** Finding IDs as they appear in the audit's findings table: `| SEC-01 | **H** | …`. */
function auditFindingIds(): string[] {
    return [
        ...new Set(
            [...audit.matchAll(/^\|\s*((?:SEC|DB|ECO|CRY|NET|REA|ENG)-\d+[a-z]?)\s*\|/gm)].map(
                (m) => m[1]!,
            ),
        ),
    ].sort();
}

test('every finding ID in the audit appears in the record', () => {
    // The Phase 6 sign-off claims 154/154. If a finding ever leaves the
    // register, that number is a lie — so it is derived here, not trusted.
    const ids = auditFindingIds();
    assert.ok(ids.length >= 150, `expected the audit's ~154 findings, parsed ${ids.length}`);
    const missing = ids.filter((id) => !record.includes(id));
    assert.deepEqual(missing, [], `findings absent from the record:\n${missing.join('\n')}`);
});

test('the deferred-by-decision items are still recorded', () => {
    // These are the three known non-closures. Each must stay visible with its
    // unblock criteria, or the record reads as more finished than it is.
    for (const token of ['NET-03a', 'NET-03b']) {
        assert.ok(record.includes(token), `${token} (private room channel) is no longer recorded`);
    }
    assert.ok(/mainnet deploy/i.test(record), 'the Base mainnet deferral is no longer recorded');
    assert.ok(/Android device trace/i.test(record), 'the Android device trace deferral is no longer recorded');
});

test('no checkbox syntax — the record is prose, not a plan', () => {
    const boxes = record.split('\n').filter((l) => /^- \[[ x]\]/.test(l));
    assert.deepEqual(boxes, [], `checklist syntax is back:\n${boxes.join('\n')}`);
});

test('the phase sections still exist', () => {
    // A record that loses a phase of history by careless edit must fail here.
    // Part II's headings sit one level deeper (### under ## Part II), so the
    // check is prefix-agnostic.
    for (const h of ['Phase 0', 'Phase 1', 'Phase 2', 'Phase 3', 'Phase 4', 'Phase 5', 'Phase 6']) {
        assert.ok(new RegExp(`^#{2,3} ${h}\\b`, 'm').test(record), `missing section ${h}`);
    }
    for (const h of ['Part I ', 'Part II ', 'Part III ', 'Part IV ']) {
        assert.ok(record.includes(`## ${h}`), `missing section ${h}`);
    }
    for (const h of ['Recorded decisions and risk acceptances', 'Deferred by decision', 'Sign-off']) {
        assert.ok(new RegExp(`^#{2,3} ${h}\\b`, 'm').test(record), `missing section ${h}`);
    }
});

test('the superseded files are redirect stubs, not deleted paths', () => {
    // Both old paths are still linked from AGENTS.md, SYSTEM_REVIEW.md, README
    // and the migration plan; a 404 there is how the next reader loses the trail.
    for (const old of ['docs/ops/REMEDIATION_CHECKLIST.md', 'docs/planning/RECOMMENDED_IMPLEMENTATION_PLAN.md']) {
        const stub = read(old);
        assert.ok(
            stub.includes('docs/ops/IMPLEMENTATION_RECORD.md'),
            `${old} must redirect to the centralized record, not hold stale content`,
        );
    }
});

test('the sign-off table records every phase gate', () => {
    for (const gate of ['Phase 0 exit', 'Phase 1 exit', 'Phase 2 exit', 'Phase 3 exit', 'Phase 4 exit', 'Phase 5 exit', 'Phase 6 exit']) {
        assert.ok(record.includes(gate), `sign-off has no ${gate} row`);
    }
});
