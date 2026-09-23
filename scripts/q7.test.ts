/**
 * Q7 telemetry policy tests — scrub + sampling + SLO table.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    isSensitiveKey,
    scrubTelemetryProps,
    shouldSample,
    truncateValue,
    STANDING_SLOS,
    ALWAYS_SAMPLE_EVENTS,
    MAX_PROP_VALUE_LEN,
} from '../lib/telemetryPolicy';

test('Q7 scrub redacts sensitive keys and truncates', () => {
    const out = scrubTelemetryProps({
        signature: '0xdeadbeef',
        sessionId: 'sess-1',
        ecdhPubkey: '-----BEGIN',
        privateKey: 'nope',
        dice: 6,
        ok: true,
        note: 'x'.repeat(500),
        nested: { secret: 'a' },
    });
    assert.equal(out.signature, '[redacted]');
    assert.equal(out.sessionId, '[redacted]');
    assert.equal(out.ecdhPubkey, '[redacted]');
    assert.equal(out.privateKey, '[redacted]');
    assert.equal(out.dice, 6);
    assert.equal(out.ok, true);
    assert.equal(String(out.note).length, MAX_PROP_VALUE_LEN + 1);
    assert.equal(out.nested, '[omitted]');
    assert.ok(isSensitiveKey('authorization'));
    assert.ok(!isSensitiveKey('diceValue'));
});

test('Q7 sampling keeps critical events at 100%', () => {
    for (const e of ALWAYS_SAMPLE_EVENTS) {
        assert.equal(shouldSample(e, 0, () => 0.99), true, e);
    }
    assert.equal(shouldSample('roll_ok', 0, () => 0.5), false);
    assert.equal(shouldSample('roll_ok', 1, () => 0.99), true);
    assert.equal(shouldSample('move_ok', 0.5, () => 0.4), true);
    assert.equal(shouldSample('move_ok', 0.5, () => 0.6), false);
});

test('Q7 standing SLO table is complete', () => {
    assert.ok(STANDING_SLOS.length >= 4);
    const names = new Set(STANDING_SLOS.map((s) => s.name));
    assert.ok(names.has('match_completion_rate'));
    assert.ok(names.has('resync_success_rate'));
    assert.ok(names.has('roll_dice_p95_ms'));
    assert.ok(truncateValue('a'.repeat(10)).length === 10);
});
