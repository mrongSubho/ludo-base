/**
 * Drift gate (Phase 2 / ENG-17).
 *
 * `lib/engine/core.ts` is the authority and is copied verbatim into
 * `supabase/functions/_shared/engine.ts` (guarded by `npm run check:engine`).
 * But `core.ts` also *duplicates* the board tables that `lib/constants.ts` and
 * `lib/boardLayout.ts` own. Nothing compared them, so the app and the authority
 * could disagree about where a cell is, and the symptom would be a capture that
 * only resolves on one side of the wire.
 *
 *   npm run check:drift
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as engine from '../lib/engine/core';
import * as constants from '../lib/constants';
import * as boardLayout from '../lib/boardLayout';
import { calculateNextPosition as glNextPosition } from '../lib/gameLogic';

const root = join(import.meta.dirname ?? __dirname, '..');

test('TEAM_PAIRINGS agrees between the engine and lib/constants', () => {
    assert.deepEqual(engine.TEAM_PAIRINGS, constants.TEAM_PAIRINGS as typeof engine.TEAM_PAIRINGS);
});

test('TEAM_ID agrees between the engine and lib/constants', () => {
    assert.deepEqual(engine.TEAM_ID, constants.TEAM_ID as typeof engine.TEAM_ID);
});

test('SHARED_PATH is identical, index for index', () => {
    assert.equal(engine.SHARED_PATH.length, 52, 'the shared path must be 52 cells');
    assert.deepEqual(engine.SHARED_PATH, boardLayout.SHARED_PATH);
});

test('CORNER_SLOTS agrees cell for cell', () => {
    // boardLayout carries extra rendering fields (gridRow, arrowDir, ...) that
    // the authority has no use for. Compare the four the engine depends on, so
    // this asserts the rules and not the shape of a UI table.
    for (const corner of ['BL', 'BR', 'TR', 'TL'] as const) {
        const a = engine.CORNER_SLOTS[corner];
        const b = boardLayout.CORNER_SLOTS[corner];
        assert.equal(a.startIdx, b.startIdx, `CORNER_SLOTS.${corner}.startIdx drifted`);
        assert.deepEqual(a.homeCells, b.homeCells, `CORNER_SLOTS.${corner}.homeCells drifted`);
        assert.deepEqual(a.finishCell, b.finishCell, `CORNER_SLOTS.${corner}.finishCell drifted`);
        assert.deepEqual(a.startCell, b.startCell, `CORNER_SLOTS.${corner}.startCell drifted`);
    }
});

test('SAFE_POSITIONS agrees', () => {
    assert.deepEqual(engine.SAFE_POSITIONS, boardLayout.SAFE_POSITIONS);
});

test('board constants agree', () => {
    assert.equal(engine.BOARD_FINISH_INDEX, constants.BOARD_FINISH_INDEX);
    assert.equal(engine.BASE_INDEX, constants.BASE_INDEX);
    assert.equal(engine.DICE_ROLL_SIX, constants.DICE_ROLL_SIX);
    assert.equal(engine.MAX_CONSECUTIVE_SIXES, constants.MAX_CONSECUTIVE_SIXES);
    assert.equal(engine.HOME_LANE_START_INDEX, 52);
    assert.equal(constants.TOTAL_PATH_CELLS, 52);
});

test('getBoardCoordinate agrees between the engine and boardLayout', () => {
    const cc = boardLayout.assignCorners2v2();
    for (const color of ['green', 'red', 'yellow', 'blue'] as const) {
        for (let pos = -1; pos <= 57; pos++) {
            assert.deepEqual(
                engine.getBoardCoordinate(pos, color, cc),
                boardLayout.getBoardCoordinate(pos, color, cc),
                `coordinate drift at pos=${pos} color=${color}`,
            );
        }
    }
});

test('calculateNextPosition agrees between the engine and gameLogic', () => {
    // The app resolves moves with gameLogic and the authority with core.ts. If
    // the gate arithmetic drifts, the same roll sends a token to different cells.
    const cc = boardLayout.assignCorners2v2();
    for (const color of ['green', 'red', 'yellow', 'blue'] as const) {
        for (let pos = -1; pos <= 57; pos++) {
            for (let steps = 1; steps <= 12; steps++) {
                assert.equal(
                    engine.calculateNextPosition(pos, steps, color, cc),
                    glNextPosition(pos, steps, color, cc),
                    `next-position drift at pos=${pos} steps=${steps} color=${color}`,
                );
            }
        }
    }
});

test('the authority rules are single-sourced, not reimplemented in hooks', () => {
    // The active-colour rule lived in three places and each could drift from the
    // others (ENG-04). Pin that the hooks call the engine instead.
    for (const f of ['hooks/useGameActions.ts', 'hooks/useGameEngine.ts']) {
        const src = readFileSync(join(root, f), 'utf8')
            .split('\n')
            .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
            .join('\n');
        assert.doesNotMatch(
            src,
            /isAutoPlaying\s*\|\|\s*teammateHasTokens|hasTokens\s*\|\|\s*teammateHasTokens/,
            `${f} must not reimplement activeColorsForTurns`,
        );
        assert.match(src, /activeColorsForTurns/, `${f} must call the engine's rule`);
    }
});

test('the Edge copy of the engine matches the source apart from its banner', () => {
    // sync-edge-engine.mjs prepends a two-line "do not edit" header, so compare
    // the body. (npm run check:engine asserts the same thing; this keeps the
    // invariant visible in the drift gate too.)
    const src = readFileSync(join(root, 'lib/engine/core.ts'), 'utf8');
    const dest = readFileSync(join(root, 'supabase/functions/_shared/engine.ts'), 'utf8')
        .replace(/^\/\/ AUTO-GENERATED[^\n]*\n\/\/ Source:[^\n]*\n/, '');
    assert.equal(dest, src, 'run `node scripts/sync-edge-engine.mjs`');
});
