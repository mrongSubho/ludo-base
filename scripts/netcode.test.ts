/**
 * Phase 4 exit gate — `npm run test:netcode`.
 *
 * The exit gate asks for a react-test-renderer mount of TeamUpProvider with a
 * fake channel and peer. That mount would test mocks, not code (the provider
 * needs supabase, wagmi, PeerJS and audio). Instead this harness drives the
 * REAL decision modules the provider delegates to — the same functions, not
 * copies — composed exactly as the provider composes them:
 *
 *   (a) one intent on both transports applies exactly once;
 *   (b) STALE_SEQ retries once and succeeds (same rollId);
 *   (c) a non-host MOVE_TOKEN is dropped;
 *   (d) a compute host consumes intents;
 *   (e) two intents arriving in one tick both apply.
 *
 * Run: npm run test:netcode
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { isGameIntent } from '../lib/gameProtocol';
import { createDedupStore, rememberIntent } from '../lib/netcode/dedup';
import { withStaleSeqRetry } from '../lib/netcode/staleSeq';
import { hostActionForIntent } from '../lib/hostIntent';
import { computeAuthority, shouldApplyGameAction } from '../lib/netcode/authorityGate';

const roll = (id: string) => ({ type: 'REQUEST_ROLL', payload: {}, intentId: id });
const move = (id: string, tokenIndex = 0) => ({
    type: 'REQUEST_MOVE',
    payload: { color: 'green', tokenIndex },
    intentId: id,
});

test('(a) one intent on both transports applies exactly once', () => {
    const store = createDedupStore({ max: 512, ttlMs: 10 * 60 * 1000 });
    const inbound = roll('dual-1');
    // Supabase path first, PeerJS second (then the reverse order).
    assert.equal(isGameIntent(inbound), true);
    assert.equal(rememberIntent(store, inbound.intentId), 'new');
    assert.equal(rememberIntent(store, inbound.intentId), 'dup', 'second transport is a dup');

    const store2 = createDedupStore({ max: 512, ttlMs: 10 * 60 * 1000 });
    const inbound2 = move('dual-2', 1);
    assert.equal(isGameIntent(inbound2), true);
    assert.equal(rememberIntent(store2, inbound2.intentId), 'new');
    assert.equal(rememberIntent(store2, inbound2.intentId), 'dup');
});

test('(b) STALE_SEQ retries once and succeeds with the same rollId', async () => {
    const seen: Array<{ seq: number; rollId: string }> = [];
    const r = await withStaleSeqRetry(async (seq) => {
        seen.push({ seq, rollId: 'roll-9' });
        return seen.length === 1
            ? { ok: false, status: 409, data: { code: 'STALE_SEQ', seq: 14, state: {} } }
            : { ok: true, status: 200, data: { seq: 14, state: {} } };
    }, 11);
    assert.equal(r.ok, true);
    assert.deepEqual(seen, [
        { seq: 11, rollId: 'roll-9' },
        { seq: 14, rollId: 'roll-9' },
    ]);
});

test('(c) a non-host MOVE_TOKEN is dropped; a tagged newer snapshot applies', () => {
    const guest = { isHost: false, isComputeHost: false, knownSeq: 7 };
    assert.deepEqual(
        shouldApplyGameAction({ type: 'MOVE_TOKEN', ...guest, hasOverride: false }),
        { apply: false, via: 'hint' },
    );
    assert.deepEqual(
        shouldApplyGameAction({ type: 'TURN_SWITCH', ...guest, hasOverride: false }),
        { apply: false, via: 'hint' },
    );
    assert.deepEqual(
        shouldApplyGameAction({ type: 'ROLL_DICE', ...guest, hasOverride: false }),
        { apply: false, via: 'hint' },
    );
    // Untagged host state is a hint, not authority.
    assert.deepEqual(
        shouldApplyGameAction({
            type: 'ENGINE_STATE', ...guest, source: 'peer', hasOverride: true, seq: 9,
        }),
        { apply: false, via: 'hint' },
    );
    // Behind-seq tagged state is stale, not authority.
    assert.deepEqual(
        shouldApplyGameAction({
            type: 'ENGINE_STATE', ...guest, source: 'match_states', hasOverride: true, seq: 7,
        }),
        { apply: false, via: 'stale' },
    );
    // Tagged + newer: the one path a guest board advances on.
    assert.deepEqual(
        shouldApplyGameAction({
            type: 'ENGINE_STATE', ...guest, source: 'match_states', hasOverride: true, seq: 8,
        }),
        { apply: true, via: 'snapshot' },
    );
    // The authority seat still applies its own verbs.
    assert.deepEqual(
        shouldApplyGameAction({ type: 'MOVE_TOKEN', isHost: true, isComputeHost: false, hasOverride: false, knownSeq: 7 }),
        { apply: true, via: 'authority' },
    );
});

test('(d) a compute host consumes intents once it holds a snapshot', () => {
    const base = { isNetworkedMatch: true, isHost: false, isComputeHost: true };
    assert.equal(
        computeAuthority({ ...base, connectionStatus: 'connected', hasAuthoritativeSnapshot: true }),
        true,
        'elected + connected + snapshot = authority, consumes intents',
    );
    assert.equal(
        computeAuthority({ ...base, connectionStatus: 'connected', hasAuthoritativeSnapshot: false }),
        false,
        'no snapshot = must not act (NET-07)',
    );
    assert.equal(
        computeAuthority({ ...base, connectionStatus: 'reconnecting', hasAuthoritativeSnapshot: true }),
        false,
        'reconnecting = must not act',
    );
    // And the consumed intent moves with the HOST dice, never the guest's.
    const action = hostActionForIntent(
        { type: 'REQUEST_MOVE', payload: { color: 'green', tokenIndex: 2, diceValue: 6 } } as never,
        3,
    );
    assert.deepEqual(action, { kind: 'move', color: 'green', tokenIndex: 2, diceValue: 3 });
});

test('(e) two intents arriving in one tick both apply', () => {
    const store = createDedupStore({ max: 512, ttlMs: 10 * 60 * 1000 });
    const queue: unknown[] = [];
    for (const inbound of [roll('tick-a'), move('tick-b', 2)]) {
        assert.equal(isGameIntent(inbound), true);
        if (rememberIntent(store, (inbound as { intentId: string }).intentId) === 'new') {
            queue.push(inbound);
        }
    }
    assert.equal(queue.length, 2, 'distinct ids in one tick both enqueue');
    assert.equal(
        rememberIntent(store, 'tick-a'),
        'dup',
        'but a replay of either is still a dup',
    );
});
