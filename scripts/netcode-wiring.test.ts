/**
 * NET-07 — abandon classification on the disconnect path.
 *
 * `lib/netcode/abandon.ts` had zero call sites, so its grace window,
 * dual-sign policy and counters were unobservable. The wiring is:
 * TeamUpContext.recordDisconnect → the AFK kick → classifyAndRecordAbandon.
 *
 * What is asserted here (pure, no React): the outcome a kick produces, and
 * that classification is counter-silent (NET-22) and telemetry-bearing.
 * The React wiring is pinned by source assertions in netcode-wiring.test.ts.
 * Run: npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    classifyAbandon,
    abandonGraceRemainingMs,
    ABANDON_GRACE_MS,
    recordAbandonAttempt,
} from '../lib/netcode/abandon';
import { onNetCounter } from '../lib/netcode/counters';

/** Mirror of TeamUpContext.classifyAndRecordAbandon's pure decision. */
function kickOutcome(opts: { disconnected: boolean; edge: boolean; host: boolean; ended: boolean }) {
    const sinceMs = opts.disconnected ? ABANDON_GRACE_MS + 1 : Number.POSITIVE_INFINITY;
    return classifyAbandon({
        hasEdgeSig: opts.edge,
        hasHostSig: opts.host,
        sinceDisconnectMs: sinceMs,
        matchEnded: opts.ended,
    });
}

test('NET-07: a kick inside the grace window files nothing', () => {
    const outcome = classifyAbandon({
        hasEdgeSig: true,
        hasHostSig: true,
        sinceDisconnectMs: 30_000,
    });
    assert.equal(outcome.mode, 'none');
    assert.equal(outcome.reason, 'grace');
    assert.equal(abandonGraceRemainingMs(30_000), ABANDON_GRACE_MS - 30_000);
});

test('NET-07: a never-disconnected seat has an expired grace (infinite age)', () => {
    // The context stamps a seat on disconnect only. A kick for a seat that was
    // never stamped must fall through to classification, not to 'grace' —
    // otherwise a seat that never appeared in the presence set is unkickable.
    const outcome = kickOutcome({ disconnected: false, edge: true, host: true, ended: false });
    assert.equal(outcome.mode, 'dual_sign_burn_split');
    assert.equal(outcome.burnEnabled, false, 'the burn split stays flag-gated');
});

test('NET-07: dual-sign + stale disconnect is dual_sign_burn_split, burn off', () => {
    const outcome = kickOutcome({ disconnected: true, edge: true, host: true, ended: false });
    assert.equal(outcome.mode, 'dual_sign_burn_split');
    assert.equal(outcome.burnBps, 5000);
    assert.equal(outcome.burnEnabled, false);
});

test('NET-07: edge-only refunds in full with zero burn', () => {
    const outcome = kickOutcome({ disconnected: true, edge: true, host: false, ended: false });
    assert.equal(outcome.mode, 'edge_only_refund');
    assert.equal(outcome.burnBps, 0);
    assert.equal(outcome.refundBps, 10000);
});

test('NET-07: no signature at all is not an abandon', () => {
    const outcome = kickOutcome({ disconnected: true, edge: false, host: false, ended: false });
    assert.equal(outcome.mode, 'none');
    assert.equal(outcome.reason, 'insufficient');
});

test('NET-07: a finished match never yields an abandon', () => {
    assert.equal(kickOutcome({ disconnected: true, edge: true, host: true, ended: true }).mode, 'none');
});

test('NET-07: classification meters no intents (NET-22) and does not throw in record', () => {
    let intents = 0;
    const off = onNetCounter((name) => {
        if (name === 'net_intent_ok') intents += 1;
    });
    try {
        for (const o of [
            { hasEdgeSig: true, hasHostSig: true, sinceDisconnectMs: ABANDON_GRACE_MS + 1 },
            { hasEdgeSig: true, hasHostSig: false, sinceDisconnectMs: ABANDON_GRACE_MS + 1 },
            { hasEdgeSig: false, hasHostSig: false, sinceDisconnectMs: ABANDON_GRACE_MS + 1 },
        ]) {
            const outcome = classifyAbandon(o);
            // recordAbandonAttempt only emits telemetry; it must never throw,
            // or a teardown path would break the flow it is reporting on.
            recordAbandonAttempt(outcome, 'match-x');
        }
    } finally {
        off();
    }
    assert.equal(intents, 0, 'classifying abandonment must not count as an intent');
});
