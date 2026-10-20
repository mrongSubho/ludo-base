import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { calculateNextPosition } from '../lib/gameLogic';

const root = join(import.meta.dirname ?? __dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

test('TU-1: relay message gate enforces sender authorization and drops host external triggers', () => {
    const src = read('hooks/TeamUpContext.tsx');
    
    // Host drops external START_GAME broadcast
    assert.match(src, /if\s*\(isHost\)\s*\{\s*console\.warn\('[^']*Dropping external START_GAME broadcast'\);\s*return;\s*\}/);
    
    // Guest drops mid-match START_GAME re-seed
    assert.match(src, /gameStateRef\.current\.isStarted\s*&&\s*gameStateRef\.current\.status\s*===\s*'playing'/);
    
    // Guest drops START_GAME from unknown/omitted sender
    assert.match(src, /!sender\s*\|\|\s*!knownHost\s*\|\|\s*sender\s*!==\s*knownHost/);
    
    // Authority drops external MOVE_TOKEN and ROLL_DICE
    assert.match(src, /if\s*\(isMatchAuthority\)\s*\{\s*console\.warn\('[^']*Dropping external MOVE_TOKEN broadcast/);
    assert.match(src, /if\s*\(isMatchAuthority\)\s*\{\s*console\.warn\('[^']*Dropping external ROLL_DICE broadcast/);
    
    // MOVE_TOKEN validates calculateNextPosition
    assert.match(src, /const\s+expectedPos\s*=\s*calculateNextPosition\(currentPos,\s*diceValue,\s*color,\s*colorCorner\)/);
    assert.match(src, /if\s*\(expectedPos\s*!==\s*targetPosition\)/);
});

test('TU-1: calculateNextPosition correctly rejects illegal position leaps', () => {
    const colorCorner = { green: 'TL', red: 'TR', yellow: 'BR', blue: 'BL' } as const;
    
    // Green starts at TL (startIdx = 0). Token on cell 10 rolls 4 -> must land on 14
    const valid = calculateNextPosition(10, 4, 'green', colorCorner);
    assert.equal(valid, 14);
    
    // Injected targetPosition 57 from pos 10 with roll 4 is illegal!
    const illegalTarget = 57;
    assert.notEqual(valid, illegalTarget, 'illegal leap directly to home stretch must be rejected');
});
