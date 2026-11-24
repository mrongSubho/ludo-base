import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assignCornersForShape } from '../lib/boardLayout';
import { getIntermediatePathCoords, INITIAL_GAME_STATE } from '../lib/gameLogic';
import type { GameState } from '../lib/types';
import { deriveMatchFeedEvent, formatColorList, formatPrimaryTurnLine } from '../lib/matchFeed';
import { computeNukeBlastCorridor, derivePowerVfxEvents } from '../lib/powerVfx';
import { computeMovePreview, computeSingleLegalMovePreview } from '../lib/movePreview';
import {
    classifyTokenTransition,
    computeHopCadence,
    computeMoveSettleBufferMs,
    computeReverseTrackCoords,
    computeScreenSpaceLeanDeg,
    computeYardSlotCoord,
} from '../lib/tokenMovement';
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

        assert.deepEqual(
            formatPrimaryTurnLine({
                currentPlayer: 'green',
                gamePhase: 'moving',
                diceValue: 6,
                myColor: 'green',
                spectatorMode: false,
                targeting: null,
                activeBoost: null,
                boostPendingDice: 4,
                winner: null,
                myTokensInHome: 2,
                effectiveMyDice: 6,
            }),
            { text: 'BOOST 1/2 · DEPLOY OR MOVE [6] → NEXT [4]', tone: 'yours', color: 'green' },
        );
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

        // Shielded enemy in Nuke corridor produces deflectedCells
        const prevNukeDeflect = cloneState({
            currentPlayer: 'red',
            positions: { green: [14, -1, -1, -1], blue: [-1, -1, -1, -1], red: [13, -1, -1, -1], yellow: [-1, -1, -1, -1] },
            nukeFlash: [],
        });
        const nextNukeDeflect = cloneState({
            currentPlayer: 'red',
            positions: { green: [14, -1, -1, -1], blue: [-1, -1, -1, -1], red: [13, -1, -1, -1], yellow: [-1, -1, -1, -1] },
            activeShields: [{ color: 'green', tokenIdx: 0 }],
            nukeFlash: [{ r: 7, c: 10 }],
            captureMessage: 'NUKE! 0 tokens vaporized!',
        });
        const deflectVfx = derivePowerVfxEvents(prevNukeDeflect, nextNukeDeflect, cc, '4P');
        assert.equal(deflectVfx[0]?.kind, 'nuke');
        if (deflectVfx[0]?.kind === 'nuke') {
            assert.equal(deflectVfx[0].deflectedCells?.length, 1);
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
        assert.match(vfxOverlay, /power-shield-deflect/);
        assert.match(vfxOverlay, /power-tp-ghost/);
        assert.match(vfxOverlay, /power-tp-column/);
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
        assert.match(bay, /boostPendingDice/);
        assert.match(bay, /dice-streak-strip/);

        const row = read('app/components/PlayerInfoRow.tsx');
        assert.match(row, /<AnchoredDiceBay/);

        const actions = read('hooks/useGameActions.ts');
        assert.match(actions, /ROLL_TUMBLE_MS = 440/);
        assert.doesNotMatch(actions, /setTimeout\(r, 1200\)/);

        const piece = read('app/components/board/TokenPiece.tsx');
        assert.match(piece, /classifyTokenTransition/);
        assert.match(piece, /computeHopCadence/);
        assert.match(piece, /TokenStepCrown/);
        assert.match(piece, /onHoverChange/);

        const visual = read('app/components/board/TokenVisual.tsx');
        assert.match(visual, /showValid \? 'ludo-token-pulse ' : ''/);
        assert.match(visual, /token-valid-halo/);
        assert.match(visual, /token-valid-ring/);
        assert.match(visual, /token-shield-dome/);
        assert.match(visual, /token-shield-badge/);
        assert.match(visual, /computeReverseTrackCoords/);

        const tokens = read('app/components/BoardTokens.tsx');
        assert.match(tokens, /stepRipples/);
        assert.match(tokens, /finishingKeys/);
        assert.match(tokens, /victimHolds/);
        assert.match(tokens, /justDeployed/);

        const boardSrc = read('app/components/Board.tsx');
        assert.match(boardSrc, /onTransitStatusChange=\{setTransitStatus\}/);

        const home = read('app/components/BoardHome.tsx');
        assert.match(home, /w-\[74%\] h-\[74%\]/);
        assert.match(home, /const r = 21;/);

        const boardCss = read('app/styles/board.css');
        assert.match(boardCss, /\.board-terminal-hud\s*\{[^}]*position:\s*absolute;/);
        assert.match(boardCss, /\.move-dest-reticle/);
        assert.match(boardCss, /\.player-wrapper\.active-turn/);
        assert.match(boardCss, /\.token-step-crown/);
        assert.match(boardCss, /\.token-step-ripple/);
        assert.match(boardCss, /\.token-valid-halo/);
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

        // Split Boost + 6 -> Step 2 (6) and Boost + 4 -> Step 2 (4) roll history tracking
        let splitChain6: TurnRollHistoryState = { player: 'green', rolls: [], nextId: 0 };
        const splitRoll6 = cloneState({ currentPlayer: 'green', isRolling: true, diceValue: null, activeBoost: 'green' });
        const splitStep1_6 = cloneState({ currentPlayer: 'green', isRolling: false, diceValue: 6, boostPendingDice: 6, activeBoost: null });
        const splitStep2_6 = cloneState({ currentPlayer: 'green', isRolling: false, diceValue: 6, boostPendingDice: null, activeBoost: null });
        splitChain6 = updateTurnRollHistory(splitChain6, splitRoll6, splitStep1_6);
        splitChain6 = updateTurnRollHistory(splitChain6, splitStep1_6, splitStep2_6);
        assert.deepEqual(splitChain6.rolls.map((r) => [r.value, r.boosted]), [[6, true], [6, false]]);

        let splitChain4: TurnRollHistoryState = { player: 'green', rolls: [], nextId: 0 };
        const splitRoll4 = cloneState({ currentPlayer: 'green', isRolling: true, diceValue: null, activeBoost: 'green' });
        const splitStep1_4 = cloneState({ currentPlayer: 'green', isRolling: false, diceValue: 6, boostPendingDice: 4, activeBoost: null });
        const splitStep2_4 = cloneState({ currentPlayer: 'green', isRolling: false, diceValue: 4, boostPendingDice: null, activeBoost: null });
        splitChain4 = updateTurnRollHistory(splitChain4, splitRoll4, splitStep1_4);
        splitChain4 = updateTurnRollHistory(splitChain4, splitStep1_4, splitStep2_4);
        assert.deepEqual(splitChain4.rolls.map((r) => [r.value, r.boosted]), [[6, true], [4, false]]);
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

        // Active boost does not add +6 to computeMovePreview steps (split move previews exact diceValue)
        const boostPreviewState = cloneState({
            currentPlayer: 'green',
            gamePhase: 'moving',
            diceValue: 6,
            activeBoost: 'green',
            boostPendingDice: 4,
            positions: { green: [35, -1, -1, -1], red: [-1, -1, -1, -1], yellow: [-1, -1, -1, -1], blue: [-1, -1, -1, -1] },
        });
        assert.equal(
            computeMovePreview({ state: boostPreviewState, color: 'green', tokenIndex: 0, colorCorner: cc, playerCount: '4P' })?.steps,
            6,
        );
    });

    it('handles 51->0 perimeter wraps, +6 boost 12-step paths, finish entries, yard deploys, and modular capture rewinds', () => {
        const cc = { green: 'BL', red: 'TL', yellow: 'TR', blue: 'BR' } as const;

        // 1. 51 -> 0 wrap (green BL startIdx=34): 49 -> 2 must classify as a 5-step hop across [50, 51, 0, 1, 2]
        const wrapTransition = classifyTokenTransition({
            oldPos: 49,
            newPos: 2,
            color: 'green',
            colorCorner: cc,
        });
        assert.equal(wrapTransition.kind, 'hop');
        if (wrapTransition.kind === 'hop') {
            assert.equal(wrapTransition.steps, 5);
            assert.equal(wrapTransition.waypoints.length, 5);
            assert.equal(wrapTransition.isFinishEntry, false);
        }

        // 2. +6 Boost 12-step path (34 + 12 -> 46): returns all 12 intermediate cells and fits 1300ms walk budget
        const boostCoords = getIntermediatePathCoords(34, 46, 'green', cc);
        assert.equal(boostCoords.length, 12);
        const boostCadence = computeHopCadence(12, true, '3077');
        assert.ok(boostCadence.totalWalkMs <= 1300, `Expected <= 1300ms, got ${boostCadence.totalWalkMs}`);
        assert.ok(computeMoveSettleBufferMs(12, true) >= boostCadence.totalWalkMs);
        assert.ok(computeMoveSettleBufferMs(1, false) <= 450);

        // 3. Finish entry (54 -> 57): hops 55 -> 56 -> 57 (finishCell)
        const finishTransition = classifyTokenTransition({
            oldPos: 54,
            newPos: 57,
            color: 'green',
            colorCorner: cc,
        });
        assert.equal(finishTransition.kind, 'hop');
        if (finishTransition.kind === 'hop') {
            assert.equal(finishTransition.steps, 3);
            assert.equal(finishTransition.isFinishEntry, true);
            assert.deepEqual(finishTransition.waypoints[2], { r: 9, c: 8 });
        }

        // 4. Yard deploy (-1 -> 34): exact 2x2 Yard slot coordinates
        const deployTransition = classifyTokenTransition({
            oldPos: -1,
            newPos: 34,
            color: 'green',
            colorCorner: cc,
            tokenIndex: 3,
        });
        assert.equal(deployTransition.kind, 'deploy');
        if (deployTransition.kind === 'deploy') {
            assert.deepEqual(deployTransition.targetPt, { r: 14, c: 7 });
            assert.deepEqual(deployTransition.yardPt, computeYardSlotCoord('BL', 3));
        }

        // 5. Modular reverse capture path when victim wrapped past 0 (fromPos 4 < startIdx 34)
        const reverseCells = computeReverseTrackCoords(4, 'green', 2, cc);
        assert.ok(reverseCells.length > 20, 'Wrapped capture path must unwind 4..0..51..34 plus yard dive');
        assert.deepEqual(reverseCells[reverseCells.length - 1], computeYardSlotCoord('BL', 2));

        // 6. Teleport transition skips step-by-step walk
        const tpTransition = classifyTokenTransition({
            oldPos: 35,
            newPos: 42,
            color: 'green',
            colorCorner: cc,
            isTeleport: true,
        });
        assert.equal(tpTransition.kind, 'teleport');

        // 7. Screen-space lean accounts for board rotation
        assert.equal(computeScreenSpaceLeanDeg({ r: 7, c: 2 }, { r: 7, c: 3 }, 0), 8.5);
        assert.equal(computeScreenSpaceLeanDeg({ r: 7, c: 2 }, { r: 7, c: 3 }, 180), -8.5);
    });
});
