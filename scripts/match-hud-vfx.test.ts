import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assignCornersForShape } from '../lib/boardLayout';
import { INITIAL_GAME_STATE } from '../lib/gameLogic';
import type { GameState } from '../lib/types';
import { deriveMatchFeedEvent, formatColorList, formatPrimaryTurnLine } from '../lib/matchFeed';
import { computeNukeBlastCorridor, derivePowerVfxEvents } from '../lib/powerVfx';

const root = join(import.meta.dirname ?? __dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

type CloneStateOverrides = Partial<Omit<GameState, 'positions' | 'playerPowers'>> & {
    positions?: Partial<GameState['positions']>;
    playerPowers?: Partial<GameState['playerPowers']>;
};

function cloneState(overrides: CloneStateOverrides = {}): GameState {
    const base = structuredClone(INITIAL_GAME_STATE);
    return {
        ...base,
        ...overrides,
        positions: {
            ...base.positions,
            ...(overrides.positions ?? {}),
        },
        playerPowers: {
            ...base.playerPowers,
            ...(overrides.playerPowers ?? {}),
        },
    };
}

describe('Two-Line Terminal HUD, Match Presets, Typewriter & Cinematic Power/Dice VFX', () => {
    it('formats primary Line 1 turn directives clearly for all turn/phase/target/winner states', () => {
        assert.deepEqual(
            formatPrimaryTurnLine({
                currentPlayer: 'yellow',
                gamePhase: 'rolling',
                diceValue: null,
                myColor: 'green',
                spectatorMode: false,
                targeting: null,
                activeBoost: null,
                winner: null,
                myTokensInHome: 4,
                effectiveMyDice: null,
            }),
            { text: 'WAITING FOR YELLOW', tone: 'opponent', color: 'yellow' },
        );

        assert.deepEqual(
            formatPrimaryTurnLine({
                currentPlayer: 'green',
                gamePhase: 'rolling',
                diceValue: null,
                myColor: 'green',
                spectatorMode: false,
                targeting: 'nuke',
                activeBoost: null,
                winner: null,
                myTokensInHome: 2,
                effectiveMyDice: null,
            }),
            { text: 'NUKE ARMED · TAP TARGET TOKEN', tone: 'target', color: 'green' },
        );

        assert.deepEqual(
            formatPrimaryTurnLine({
                currentPlayer: 'green',
                gamePhase: 'moving',
                diceValue: 6,
                myColor: 'green',
                spectatorMode: false,
                targeting: null,
                activeBoost: null,
                winner: null,
                myTokensInHome: 3,
                effectiveMyDice: 6,
            }),
            { text: 'YOUR TURN · DEPLOY [6] OR MOVE', tone: 'yours', color: 'green' },
        );

        assert.equal(formatColorList(['green', 'blue', 'green']), 'GREEN & BLUE');
        assert.equal(formatColorList(['green', 'red', 'yellow']), 'GREEN, RED & YELLOW');
    });

    it('derives rich actor/victim presets while enforcing PW-1 privacy on opponent pickups', () => {
        const cc = assignCornersForShape('4P');

        // Single capture
        const prevCap = cloneState({
            currentPlayer: 'blue',
            positions: { green: [12, -1, -1, -1], red: [-1, -1, -1, -1], yellow: [-1, -1, -1, -1], blue: [10, -1, -1, -1] },
        });
        const nextCap = cloneState({
            currentPlayer: 'blue',
            positions: { green: [-1, -1, -1, -1], red: [-1, -1, -1, -1], yellow: [-1, -1, -1, -1], blue: [12, -1, -1, -1] },
        });
        const capEv = deriveMatchFeedEvent(prevCap, nextCap, { myColor: 'green', playerCount: '4P', colorCorner: cc });
        assert.deepEqual(capEv, { text: 'GREEN KICKED BY BLUE · BONUS ROLL', tone: 'capture' });

        // Multi-victim Nuke
        const prevNuke = cloneState({
            currentPlayer: 'red',
            positions: { green: [14, -1, -1, -1], blue: [15, -1, -1, -1], red: [13, -1, -1, -1], yellow: [-1, -1, -1, -1] },
            nukeFlash: [],
        });
        const nextNuke = cloneState({
            currentPlayer: 'red',
            positions: { green: [-1, -1, -1, -1], blue: [-1, -1, -1, -1], red: [13, -1, -1, -1], yellow: [-1, -1, -1, -1] },
            nukeFlash: [{ r: 7, c: 2 }],
            captureMessage: 'NUKE! 2 tokens vaporized!',
        });
        const nukeEv = deriveMatchFeedEvent(prevNuke, nextNuke, { myColor: 'green', playerCount: '4P', colorCorner: cc });
        assert.deepEqual(nukeEv, { text: 'GREEN & BLUE NUKED BY RED', tone: 'nuke' });

        // Shield, Boost, Teleport
        const shieldEv = deriveMatchFeedEvent(
            cloneState({ currentPlayer: 'blue', activeShields: [] }),
            cloneState({ currentPlayer: 'blue', activeShields: [{ color: 'blue', tokenIdx: 0 }] }),
            { myColor: 'green', playerCount: '4P', colorCorner: cc },
        );
        assert.deepEqual(shieldEv, { text: 'BLUE RAISED AEGIS SHIELD', tone: 'shield' });

        const boostEv = deriveMatchFeedEvent(
            cloneState({ currentPlayer: 'yellow', activeBoost: null }),
            cloneState({ currentPlayer: 'yellow', activeBoost: 'yellow' }),
            { myColor: 'green', playerCount: '4P', colorCorner: cc },
        );
        assert.deepEqual(boostEv, { text: 'YELLOW IGNITED +6 OVERDRIVE', tone: 'boost' });

        const tpEv = deriveMatchFeedEvent(
            cloneState({ currentPlayer: 'green', captureMessage: null }),
            cloneState({ currentPlayer: 'green', captureMessage: 'TELEPORT! Straight home!' }),
            { myColor: 'green', playerCount: '4P', colorCorner: cc },
        );
        assert.deepEqual(tpEv, { text: 'GREEN WARPED STRAIGHT HOME', tone: 'teleport' });

        // PW-1 Privacy: opponent pickup never leaks power type, own pickup reveals exact power
        const oppPickup = deriveMatchFeedEvent(
            cloneState({ currentPlayer: 'red', playerPowers: { red: [] } }),
            cloneState({ currentPlayer: 'red', playerPowers: { red: [{ type: 'nuke', expiresAt: 9_999_999 }] } }),
            { myColor: 'green', playerCount: '4P', colorCorner: cc },
        );
        assert.deepEqual(oppPickup, { text: 'RED CLAIMED A POWER ORB', tone: 'neutral' });

        const ownPickup = deriveMatchFeedEvent(
            cloneState({ currentPlayer: 'green', playerPowers: { green: [] } }),
            cloneState({ currentPlayer: 'green', playerPowers: { green: [{ type: 'nuke', expiresAt: 9_999_999 }] } }),
            { myColor: 'green', playerCount: '4P', colorCorner: cc },
        );
        assert.deepEqual(ownPickup, { text: 'YOU COLLECTED NUKE', tone: 'nuke' });
    });

    it('computes 7-cell (±3 / 6 surrounding blocks) Nuke blood-bath corridor and derives VFX events', () => {
        const cc = assignCornersForShape('4P');
        const corridorWrap = computeNukeBlastCorridor(1, 'green', cc);
        assert.equal(corridorWrap.length, 7);

        const prevNuke = cloneState({
            currentPlayer: 'red',
            positions: { green: [14, -1, -1, -1], blue: [15, -1, -1, -1], red: [13, -1, -1, -1], yellow: [-1, -1, -1, -1] },
            nukeFlash: [],
        });
        const nextNuke = cloneState({
            currentPlayer: 'red',
            positions: { green: [-1, -1, -1, -1], blue: [-1, -1, -1, -1], red: [13, -1, -1, -1], yellow: [-1, -1, -1, -1] },
            nukeFlash: [{ r: 2, c: 7 }],
            captureMessage: 'NUKE! 2 tokens vaporized!',
        });
        const vfx = derivePowerVfxEvents(prevNuke, nextNuke, cc, '4P');
        assert.equal(vfx.length, 1);
        assert.equal(vfx[0].kind, 'nuke');
        if (vfx[0].kind === 'nuke') {
            assert.equal(vfx[0].victimCells.length, 2);
            assert.ok(vfx[0].corridorCells.length >= 1);
        }
    });

    it('wires readable ...| typewriter, above-board 2-line HUD, PowerVfxOverlay, and upgraded Dice', () => {
        const typeText = read('app/components/TerminalTypeText.tsx');
        assert.match(typeText, /trailingEllipsis/);
        assert.match(typeText, /pr-\[1\.15ch\]/);

        const board = read('app/components/Board.tsx');
        assert.match(board, /<BoardTerminalHud/);
        assert.doesNotMatch(board, /<StatusNotification/);
        assert.doesNotMatch(board, /centerPrompt=/);

        const vfxOverlay = read('app/components/PowerVfxOverlay.tsx');
        assert.match(vfxOverlay, /power-nuke-board-tint/);
        assert.match(vfxOverlay, /power-nuke-blood-cell/);
        assert.match(vfxOverlay, /prefersReducedMotion/);

        const dice = read('app/components/LudoDice.tsx');
        assert.match(dice, /boostActive/);
        assert.match(dice, /arcControls/);
        assert.match(dice, /dice-crit-spark/);
    });
});
