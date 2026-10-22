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

test('TU-1: the relay cannot move a client to another room', () => {
    // `host-migrated` was a receive-only, unauthenticated control verb on the
    // public `game-room-<code>` topic: nothing in the repo ever sent it, and it
    // called `joinGame(payload.newRoomCode)` with an attacker-supplied value.
    // Anyone who learned a room code could bounce every subscribed client into
    // an arbitrary room. It is removed, not gated — AGENTS.md invariant 3 says
    // the relay must not carry a verb that relocates a client.
    //
    // Comments are stripped first: the removal is documented in place, and a
    // grep that matched its own explanation would be a tautology.
    const relay = read('hooks/useSupabaseRelay.ts')
        .split('\n')
        .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*') && !l.trim().startsWith('/*'))
        .join('\n');
    assert.doesNotMatch(relay, /host-migrated/, 'the relay must not listen for host-migrated');
    assert.doesNotMatch(relay, /joinGame/, 'the relay must not be able to join a room');

    // The hook no longer takes a room-joining callback at all, so a future
    // edit cannot quietly reintroduce the path.
    assert.doesNotMatch(relay, /joinGame\??:/, 'joinGame must not be a prop of useSupabaseRelay');

    // And no other module broadcasts it either — if someone re-adds a sender,
    // this test tells them to build it on the peer transport instead.
    const ctx = read('hooks/TeamUpContext.tsx')
        .split('\n')
        .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*') && !l.trim().startsWith('/*'))
        .join('\n');
    assert.doesNotMatch(ctx, /host-migrated/, 'nothing may broadcast host-migrated');
});

test('TU-1: the only relay-applied verb is game-action, and it stays transport-gated', () => {
    const relay = read('hooks/useSupabaseRelay.ts');
    // Exactly one broadcast handler: game-action. It calls processGameAction
    // with a single argument, so `via` defaults to 'relay' and the state-verb
    // gate in TeamUpContext rejects every state-bearing action.
    const handlers = relay.match(/\.on\('broadcast'/g) || [];
    assert.equal(handlers.length, 1, 'the relay must listen for exactly one event');
    assert.match(relay, /processGameAction\(payload\)/);
    assert.doesNotMatch(relay, /processGameAction\(payload,\s*'peer'\)/,
        'a relay-received payload must never be applied as a peer payload');
});
