import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripPowerTypesForWire } from '../lib/engine/core';

const root = join(import.meta.dirname ?? __dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

test('PW-1: stripPowerTypesForWire masks opponent power types', () => {
    const rawState = {
        powerTiles: [{ r: 1, c: 2, type: 'nuke' }],
        playerPowers: {
            green: [{ type: 'boost', expiresAt: 1700001000 }],
            red: [{ type: 'nuke', expiresAt: 1700002000 }],
        },
    };

    // Viewer is green: green retains 'boost', red is redacted (undefined)
    const sanitizedForGreen = stripPowerTypesForWire(rawState, 'green');
    assert.equal(sanitizedForGreen.playerPowers.green[0].type, 'boost');
    assert.equal(sanitizedForGreen.playerPowers.red[0].type, undefined);

    // Spectator (no viewerColor): all colors redacted
    const sanitizedForSpectator = stripPowerTypesForWire(rawState);
    assert.equal(sanitizedForSpectator.playerPowers.green[0].type, undefined);
    assert.equal(sanitizedForSpectator.playerPowers.red[0].type, undefined);
});

test('PW-1: /api/match/state resolves viewer session and redacts opponent power inventory', () => {
    const src = read('app/api/match/state/route.ts');
    
    // Checks that session is resolved from matchId
    assert.match(src, /requireSession\(request,\s*\{\s*scope:\s*'match',\s*matchId\s*\}\)/);
    // Checks seat mapping to viewerColor
    assert.match(src, /seat\.wallet\.toLowerCase\(\)\s*===\s*lowWallet/);
    assert.match(src, /viewerColor\s*=\s*seatColor/);
    // Checks that sanitized state uses viewerColor
    assert.match(src, /sanitizeGameStateForWire\(data\.state\s+as\s+unknown\s+as\s+GameState,\s*viewerColor/);
});
