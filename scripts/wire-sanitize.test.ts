import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeGameStateForWire } from '../lib/wireSanitize';

test('PW-1/PW-2: sanitizeGameStateForWire strips board power tiles and masks opponent hands', () => {
    const rawState = {
        powerTiles: [
            { r: 2, c: 3, type: 'nuke' },
            { r: 5, c: 5, type: 'shield' },
        ],
        playerPowers: {
            green: [{ type: 'boost', expiresAt: 1700001000 }],
            red: [{ type: 'nuke', expiresAt: 1700002000 }],
            yellow: [{ type: 'shield', expiresAt: 1700003000 }],
            blue: [{ type: 'teleport', expiresAt: 1700004000 }],
        },
    };

    // 1. Viewer is 'green':
    const sanitizedForGreen = sanitizeGameStateForWire(rawState, 'green');

    // Board tiles must not leak type
    assert.deepEqual(sanitizedForGreen.powerTiles, [{ r: 2, c: 3 }, { r: 5, c: 5 }]);

    // Own color ('green') keeps type
    assert.equal(sanitizedForGreen.playerPowers.green[0].type, 'boost');
    assert.equal(sanitizedForGreen.playerPowers.green[0].expiresAt, 1700001000);

    // Opponent colors ('red', 'yellow', 'blue') must have type masked (undefined)
    assert.equal(sanitizedForGreen.playerPowers.red[0].type, undefined, 'opponent red power type must be redacted');
    assert.equal(sanitizedForGreen.playerPowers.yellow[0].type, undefined, 'opponent yellow power type must be redacted');
    assert.equal(sanitizedForGreen.playerPowers.blue[0].type, undefined, 'opponent blue power type must be redacted');

    // Expiries remain for countdown timers
    assert.equal(sanitizedForGreen.playerPowers.red[0].expiresAt, 1700002000);

    // 2. Spectator (no viewerColor): all power types must be masked
    const sanitizedForSpectator = sanitizeGameStateForWire(rawState);
    assert.equal(sanitizedForSpectator.playerPowers.green[0].type, undefined);
    assert.equal(sanitizedForSpectator.playerPowers.red[0].type, undefined);
});
