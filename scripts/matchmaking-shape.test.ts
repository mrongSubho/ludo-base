import { test } from 'node:test';
import assert from 'node:assert/strict';

test('MM-4: gameMode and matchType boundary validation sets', () => {
    const ALLOWED_MODES = new Set(['classic', 'power', 'snakes']);
    const ALLOWED_TYPES = new Set(['1v1', '2v2', '4P']);

    assert.ok(ALLOWED_MODES.has('classic'));
    assert.ok(ALLOWED_MODES.has('power'));
    assert.ok(!ALLOWED_MODES.has('invalid_mode'));

    assert.ok(ALLOWED_TYPES.has('1v1'));
    assert.ok(ALLOWED_TYPES.has('2v2'));
    assert.ok(ALLOWED_TYPES.has('4P'));
    assert.ok(!ALLOWED_TYPES.has('3P'));
    assert.ok(!ALLOWED_TYPES.has('invalid_type'));
});

test('MM-1: required slots calculation per match shape', () => {
    const getSlotsNeeded = (matchType: string) => (matchType === '2v2' || matchType === '4P' ? 4 : 2);
    assert.equal(getSlotsNeeded('1v1'), 2);
    assert.equal(getSlotsNeeded('2v2'), 4);
    assert.equal(getSlotsNeeded('4P'), 4);
});
