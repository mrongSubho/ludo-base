import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assignCornersForShape } from '../lib/boardLayout';
import { INITIAL_GAME_STATE } from '../lib/gameLogic';
import type { GameState } from '../lib/types';
import { deriveMatchFeedEvent, formatColorList, formatPrimaryTurnLine } from '../lib/matchFeed';
import { computeNukeBlastCorridor, derivePowerVfxEvents } from '../lib/powerVfx';
import { computeMovePreview, computeSingleLegalMovePreview } from '../lib/movePreview';
import {
    computeBreakoutTrajectory,
    resolveDisplayedTurnRolls,
    resolveDiceThemeId,
    updateTurnRollHistory,
    type TurnRollHistoryState,
} from '../lib/diceVisuals';

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
        assert.match(dice, /dice-ground-shadow/);
        assert.match(dice, /w-11 h-11/);
        assert.match(dice, /tz = '22px'/);
        assert.match(dice, /DiceSolidCore/);
        assert.match(dice, /DiceReadyEmblem/);
        assert.match(dice, /skippedRollPhase/);
        assert.doesNotMatch(dice, /y:\s*\[0,\s*3,\s*-18/);

        assert.match(board, /is-line2-promoted/);

        const bay = read('app/components/AnchoredDiceBay.tsx');
        assert.match(bay, /dice-bay-tether/);
        assert.match(bay, /dice-bay-well/);
        assert.match(bay, /dice-bay-overdrive/);
        assert.match(bay, /dice-streak-strip/);

        const row = read('app/components/PlayerInfoRow.tsx');
        assert.match(row, /<AnchoredDiceBay/);

        const actions = read('hooks/useGameActions.ts');
        assert.match(actions, /ROLL_TUMBLE_MS = 440/);
        assert.doesNotMatch(actions, /setTimeout\(r, 1200\)/);

        const piece = read('app/components/board/TokenPiece.tsx');
        assert.match(piece, /isBoosted \? 0\.085 : 0\.115/);
        assert.match(piece, /onHoverChange/);

        const home = read('app/components/BoardHome.tsx');
        assert.match(home, /w-\[74%\] h-\[74%\]/);
        assert.match(home, /const r = 21;/);

        const boardCss = read('app/styles/board.css');
        assert.match(boardCss, /\.board-terminal-hud\s*\{[^}]*position:\s*absolute;/);
        assert.match(boardCss, /\.move-dest-reticle/);
        assert.match(boardCss, /\.player-wrapper\.active-turn/);
    });

    it('computes board-inward 3D breakout trajectories for all 3 themes and accumulates turn roll chains', () => {
        assert.equal(resolveDiceThemeId('3077'), '3077');
        assert.equal(resolveDiceThemeId('retro'), 'retro');
        assert.equal(resolveDiceThemeId('light'), 'daybreak');

        for (const themeId of ['3077', 'retro', 'daybreak'] as const) {
            const tl = computeBreakoutTrajectory('TL', themeId);
            assert.equal(tl.dirX, 1);
            assert.equal(tl.dirY, 1);
            assert.ok(Math.max(...tl.flightKeyframes.scale) >= 1.55);

            const tr = computeBreakoutTrajectory('TR', themeId);
            assert.equal(tr.dirX, -1);
            assert.equal(tr.dirY, 1);

            const bl = computeBreakoutTrajectory('BL', themeId);
            assert.equal(bl.dirX, 1);
            assert.equal(bl.dirY, -1);

            const br = computeBreakoutTrajectory('BR', themeId);
            assert.equal(br.dirX, -1);
            assert.equal(br.dirY, -1);
        }

        // Distinct settle physics across themes
        const t3077 = computeBreakoutTrajectory('TL', '3077');
        const tRetro = computeBreakoutTrajectory('TL', 'retro');
        const tDay = computeBreakoutTrajectory('TL', 'daybreak');
        assert.notEqual(t3077.settleSpring.stiffness, tRetro.settleSpring.stiffness);
        assert.notEqual(tRetro.settleSpring.stiffness, tDay.settleSpring.stiffness);

        // Turn roll history chain [6, 6 (boosted), 4] then reset on turn switch
        let chain: TurnRollHistoryState = { player: 'green', rolls: [], nextId: 0 };
        const rolling6 = cloneState({ currentPlayer: 'green', isRolling: true, diceValue: null });
        const land6a = cloneState({ currentPlayer: 'green', isRolling: false, diceValue: 6 });
        chain = updateTurnRollHistory(chain, rolling6, land6a);
        assert.deepEqual(chain.rolls.map((r) => r.value), [6]);

        const rolling6b = cloneState({ currentPlayer: 'green', isRolling: true, diceValue: null, activeBoost: 'green' });
        const land6b = cloneState({ currentPlayer: 'green', isRolling: false, diceValue: 6, activeBoost: null });
        chain = updateTurnRollHistory(chain, rolling6b, land6b);
        assert.deepEqual(chain.rolls.map((r) => [r.value, r.boosted]), [[6, false], [6, true]]);

        const land4 = cloneState({ currentPlayer: 'green', isRolling: false, diceValue: 4 });
        chain = updateTurnRollHistory(chain, land6b, land4);
        assert.deepEqual(chain.rolls.map((r) => r.value), [6, 6, 4]);

        const nextTurn = cloneState({ currentPlayer: 'red', isRolling: false, diceValue: null });
        chain = updateTurnRollHistory(chain, land4, nextTurn);
        assert.equal(chain.player, 'red');
        assert.equal(chain.rolls.length, 0);

        // Mid-turn hydration fallback
        assert.deepEqual(resolveDisplayedTurnRolls([], 2).map((r) => r.value), [6, 6]);
    });

    it('computes authoritative move destination previews for normal, safe, power, capture, and finish squares', () => {
        const cc = { green: 'BL', red: 'TL', yellow: 'TR', blue: 'BR' } as const;

        // Normal move: BL startIdx=34; from 35 + 2 -> 37 (no capture/power/safe)
        const moveState = cloneState({
            currentPlayer: 'green',
            gamePhase: 'moving',
            diceValue: 2,
            positions: { green: [35, -1, -1, -1], red: [-1, -1, -1, -1], yellow: [-1, -1, -1, -1], blue: [-1, -1, -1, -1] },
        });
        assert.deepEqual(
            computeMovePreview({ state: moveState, color: 'green', tokenIndex: 0, colorCorner: cc, playerCount: '4P' }),
            { r: 11, c: 7, kind: 'move', color: 'green', steps: 2 },
        );

        // Safe star cell: 39 + 3 -> 42 (r: 9, c: 3)
        const safeState = cloneState({
            currentPlayer: 'green',
            gamePhase: 'moving',
            diceValue: 3,
            positions: { green: [39, -1, -1, -1], red: [-1, -1, -1, -1], yellow: [-1, -1, -1, -1], blue: [-1, -1, -1, -1] },
        });
        assert.equal(
            computeMovePreview({ state: safeState, color: 'green', tokenIndex: 0, colorCorner: cc, playerCount: '4P' })?.kind,
            'safe',
        );

        // Mystery power tile preview
        const powerState = cloneState({
            currentPlayer: 'green',
            gamePhase: 'moving',
            diceValue: 2,
            positions: { green: [35, -1, -1, -1], red: [-1, -1, -1, -1], yellow: [-1, -1, -1, -1], blue: [-1, -1, -1, -1] },
            powerTiles: [{ r: 11, c: 7 }],
        });
        assert.equal(
            computeMovePreview({ state: powerState, color: 'green', tokenIndex: 0, colorCorner: cc, playerCount: '4P' })?.kind,
            'power',
        );

        // Capture preview vs shielded skip
        const captureState = cloneState({
            currentPlayer: 'green',
            gamePhase: 'moving',
            diceValue: 2,
            positions: { green: [35, -1, -1, -1], red: [37, -1, -1, -1], yellow: [-1, -1, -1, -1], blue: [-1, -1, -1, -1] },
        });
        assert.equal(
            computeMovePreview({ state: captureState, color: 'green', tokenIndex: 0, colorCorner: cc, playerCount: '4P' })?.kind,
            'capture',
        );

        const shieldedState = cloneState({
            currentPlayer: 'green',
            gamePhase: 'moving',
            diceValue: 2,
            positions: { green: [35, -1, -1, -1], red: [37, -1, -1, -1], yellow: [-1, -1, -1, -1], blue: [-1, -1, -1, -1] },
            activeShields: [{ color: 'red', tokenIdx: 0 }],
        });
        assert.equal(
            computeMovePreview({ state: shieldedState, color: 'green', tokenIndex: 0, colorCorner: cc, playerCount: '4P' })?.kind,
            'move',
        );

        // Finish center preview (54 + 3 -> 57)
        const finishState = cloneState({
            currentPlayer: 'green',
            gamePhase: 'moving',
            diceValue: 3,
            positions: { green: [54, -1, -1, -1], red: [-1, -1, -1, -1], yellow: [-1, -1, -1, -1], blue: [-1, -1, -1, -1] },
        });
        assert.deepEqual(
            computeMovePreview({ state: finishState, color: 'green', tokenIndex: 0, colorCorner: cc, playerCount: '4P' }),
            { r: 8, c: 8, kind: 'finish', color: 'green', steps: 3 },
        );

        // Single-legal auto preview (4 yard tokens rolling 6 share one start cell) vs ambiguity
        const deployOnlyState = cloneState({
            currentPlayer: 'green',
            gamePhase: 'moving',
            diceValue: 6,
            positions: { green: [-1, -1, -1, -1], red: [-1, -1, -1, -1], yellow: [-1, -1, -1, -1], blue: [-1, -1, -1, -1] },
        });
        assert.deepEqual(
            computeSingleLegalMovePreview({ state: deployOnlyState, myColor: 'green', colorCorner: cc, playerCount: '4P' }),
            { r: 14, c: 7, kind: 'safe', color: 'green', steps: 6 },
        );

        const multiChoiceState = cloneState({
            currentPlayer: 'green',
            gamePhase: 'moving',
            diceValue: 2,
            positions: { green: [35, 38, -1, -1], red: [-1, -1, -1, -1], yellow: [-1, -1, -1, -1], blue: [-1, -1, -1, -1] },
        });
        assert.equal(
            computeSingleLegalMovePreview({ state: multiChoiceState, myColor: 'green', colorCorner: cc, playerCount: '4P' }),
            null,
        );
    });
});
