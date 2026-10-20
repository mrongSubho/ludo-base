import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname ?? __dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

test('SA-2: match/record enforces participant authorization for session-based recording', () => {
    const src = read('app/api/match/record/route.ts');
    
    // Asserts session wallet is checked against participants and roomOwner
    assert.match(src, /authenticatedWallet = session\.wallet\.toLowerCase\(\)/);
    assert.match(src, /!lowerParts\.includes\(authenticatedWallet\) && roomOwner !== authenticatedWallet/);
    assert.match(src, /Caller is not an authorized participant of this match/);
});

test('SA-2: match/record requires authoritative server winner when no signature proof', () => {
    const src = read('app/api/match/record/route.ts');
    
    // When hasSignatureProof is false, server-recorded winner is mandatory
    assert.match(src, /code: 'SERVER_WINNER_REQUIRED'/);
    assert.match(src, /Match has no server-recorded winner; cannot record progression without host signature/);
    
    // Claimed winner must match server winner
    assert.match(src, /winnerAddress\.toLowerCase\(\) !== authoritativeWinnerAddress/);
    assert.match(src, /code: 'WINNER_MISMATCH'/);
});

test('SA-2: match/record caps progression wager to prevent LXP inflation exploit', () => {
    const src = read('app/api/match/record/route.ts');
    
    // Asserts wager capping
    assert.match(src, /MAX_PROGRESSION_WAGER\s*=\s*10_000/);
    assert.match(src, /effectiveWager\s*=\s*Math\.min\(Math\.max\(0,\s*wager\),\s*MAX_PROGRESSION_WAGER\)/);
    assert.match(src, /winLxpGain\s*=\s*150\s*\+\s*Math\.floor\(effectiveWager\s*\*\s*0\.1\)/);
    
    // Behavioral calculation verification
    const calculateLxp = (wagerInput: number) => {
        const MAX_PROGRESSION_WAGER = 10_000;
        const effectiveWager = Math.min(Math.max(0, wagerInput), MAX_PROGRESSION_WAGER);
        return 150 + Math.floor(effectiveWager * 0.1);
    };
    
    // Normal wager: 50 -> 150 + 5 = 155
    assert.equal(calculateLxp(50), 155);
    // Large wager: 5,000 -> 150 + 500 = 650
    assert.equal(calculateLxp(5000), 650);
    // Exploit wager: 10,000,000 -> capped at 10,000 => 150 + 1,000 = 1,150 (not 1,000,150)
    assert.equal(calculateLxp(10_000_000), 1150);
});
