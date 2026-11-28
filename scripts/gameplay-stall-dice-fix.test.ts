import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { INITIAL_GAME_STATE } from '../lib/gameLogic';
import { assignCornersForShape } from '../lib/boardLayout';
import { sanitizeGameStateForWire } from '../lib/wireSanitize';
import { AnimationBarrier, estimateTransitionDurationMs } from '../lib/animationBarrier';
import type { GameState, PlayerColor } from '../lib/types';

const root = join(import.meta.dirname ?? __dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

function makeState(overrides: Partial<GameState> = {}): GameState {
    return {
        ...structuredClone(INITIAL_GAME_STATE),
        matchId: 'match-stall-fix-test',
        playerCount: '4P',
        isStarted: true,
        status: 'playing',
        ...overrides,
    };
}

describe('Gameplay Stall, Dice Face Desync & Home-Base Roll-6 Regression Gate', () => {
    it('never leaves AnimationBarrier in an unlocked non-empty zombie state across multi-turn bot + timer sequences', (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        try {
            const cc = assignCornersForShape('4P');
            const s0 = makeState({
                currentPlayer: 'green',
                gamePhase: 'moving',
                diceValue: 4,
                positions: { green: [34, -1, -1, -1], red: [-1, -1, -1, -1], yellow: [-1, -1, -1, -1], blue: [-1, -1, -1, -1] },
            });
            const barrier = new AnimationBarrier({
                initialState: s0,
                onPresent: () => {},
            });

            // Human moves green[0] by 4 -> acquires hop lock
            const sHumanLand = makeState({
                currentPlayer: 'red',
                gamePhase: 'landing',
                diceValue: 4,
                positions: { green: [38, -1, -1, -1], red: [-1, -1, -1, -1], yellow: [-1, -1, -1, -1], blue: [-1, -1, -1, -1] },
            });
            const moveMs = estimateTransitionDurationMs(s0, sHumanLand, cc, '3077');
            barrier.enqueue(sHumanLand, { estimatedMs: moveMs });
            barrier.acquireLock('hop:green-0', moveMs);

            // While locked: turn switches to red (0ms), red starts rolling (0ms), timer ticks arrive
            const sRedTurn = makeState({
                ...sHumanLand,
                gamePhase: 'rolling',
                diceValue: null,
            });
            barrier.enqueue(sRedTurn, {
                estimatedMs: estimateTransitionDurationMs(sHumanLand, sRedTurn, cc, '3077'),
            });

            const sRedRolling = makeState({
                ...sRedTurn,
                isRolling: true,
            });
            barrier.enqueue(sRedRolling, {
                estimatedMs: estimateTransitionDurationMs(sRedTurn, sRedRolling, cc, '3077'),
            });

            // Interleave timer-only ticks while queued
            barrier.enqueue(makeState({ ...sRedRolling, timeLeft: 14 }), { estimatedMs: 0 });
            barrier.enqueue(makeState({ ...sRedRolling, timeLeft: 13 }), { estimatedMs: 0 });

            // Advance past all locks and watchdogs
            t.mock.timers.tick(2600);

            assert.equal(barrier.isLocked(), false, 'all locks must be released');
            assert.equal(barrier.getQueueLength(), 0, 'queue must be completely drained (no zombie items)');
            assert.equal(barrier.getPresented().currentPlayer, 'red');
            assert.equal(barrier.getPresented().isRolling, true);
            assert.equal(barrier.getPresented().timeLeft, 13);

            // Now simulate rolling a 6 on green's next turn with all tokens in Home Base
            const sGreenRollStart = makeState({
                currentPlayer: 'green',
                gamePhase: 'rolling',
                isRolling: true,
                diceValue: null,
                positions: { green: [-1, -1, -1, -1], red: [-1, -1, -1, -1], yellow: [-1, -1, -1, -1], blue: [-1, -1, -1, -1] },
            });
            barrier.enqueue(sGreenRollStart, { estimatedMs: 0 });
            assert.equal(barrier.getPresented().isRolling, true);

            // Atomic commit to moving + diceValue=6
            const sGreenMoving6 = makeState({
                ...sGreenRollStart,
                isRolling: false,
                diceValue: 6,
                gamePhase: 'moving',
            });
            const settleMs = estimateTransitionDurationMs(sGreenRollStart, sGreenMoving6, cc, '3077');
            barrier.enqueue(sGreenMoving6, { estimatedMs: settleMs });
            assert.equal(barrier.getPresented().diceValue, 6, '6 is presented immediately');
            assert.equal(barrier.getPresented().gamePhase, 'moving', 'Home Base deploy is immediately interactive');

            t.mock.timers.tick(500);
            assert.equal(barrier.isLocked(), false);
            assert.equal(barrier.getQueueLength(), 0);
            barrier.dispose();
        } finally {
            t.mock.timers.reset();
        }
    });

    it('keeps LudoDice 3D rotation synced to Face 1 Ready Emblem when diceValue resets to null (bonus roll after 6)', () => {
        const diceSrc = read('app/components/LudoDice.tsx');
        assert.match(
            diceSrc,
            /useMemo\(\(\)\s*=>\s*computeBreakoutTrajectory\(corner,\s*themeId\),\s*\[corner,\s*themeId\]\)/,
            'traj must be memoized so 1Hz/4Hz re-renders do not restart settle/catch-up effects',
        );
        assert.match(
            diceSrc,
            /if\s*\(!currentValue\)\s*\{[\s\S]*?normalize\(rotationRef\.current\.x,\s*0\)[\s\S]*?normalize\(rotationRef\.current\.y,\s*0\)/,
            'LudoDice must rotate back to Face 1 (0, 0) when currentValue resets to null',
        );
    });

    it('commits offline rolls atomically, isolates turnSettleTimeoutRef from autoMoveTimeoutRef, and guards expectedDice on token clicks', () => {
        const actionsSrc = read('hooks/useGameActions.ts');
        assert.match(actionsSrc, /turnSettleTimeoutRef/, 'post-move landing timer must not share autoMoveTimeoutRef');
        assert.match(
            actionsSrc,
            /if\s*\(currentState\.gamePhase\s*!==\s*'moving'\s*&&\s*!isRemote\)\s*return\s*'failed';\s*\n\s*if\s*\(autoMoveTimeoutRef\.current\)/,
            'moveToken must reject non-moving calls BEFORE clearing autoMoveTimeoutRef',
        );
        assert.match(
            actionsSrc,
            /expectedDice\s*!==\s*undefined\s*&&\s*expectedDice\s*!==\s*current\.diceValue/,
            'handleTokenClick must refuse clicks whose displayed diceValue differs from authoritative diceValue',
        );
        assert.match(actionsSrc, /isOfflineHotSeat/, 'offline Pass & Play must allow every local human seat to act on their turn');

        const engineSrc = read('hooks/useGameEngine.ts');
        const fix4Idx = engineSrc.indexOf('Landing safety net triggered');
        assert.ok(fix4Idx > 0, 'landing safety net must exist');
        const fix4Slice = engineSrc.slice(fix4Idx - 150, fix4Idx + 650);
        assert.doesNotMatch(
            fix4Slice,
            /getNextPlayer\(prev\.currentPlayer\)/,
            'landing safety net must NOT call getNextPlayer a second time and steal bonus rolls',
        );
    });

    it('recovers offline AI & AFK bot turns when power activation is refused or roll/move transiently fails', () => {
        const aiSrc = read('hooks/useAIBrain.ts');
        assert.match(aiSrc, /const applied = await handleUsePowerRef\.current/);
        assert.match(aiSrc, /if \(rollRes === 'failed'\)\s*\{\s*scheduleRetry\(\);/);
        assert.match(aiSrc, /if \(moveRes === 'failed'\)\s*\{\s*scheduleRetry\(\);/);

        const afkSrc = read('hooks/useAFKManager.ts');
        assert.match(afkSrc, /const applied = await handleUsePowerRef\.current/);
        assert.match(afkSrc, /if \(rollRes === 'failed'\)\s*\{\s*scheduleRetry\(\);/);

        const boardSrc = read('app/components/Board.tsx');
        assert.match(boardSrc, /const isPassAndPlay =/);
        assert.match(boardSrc, /const isPresentationSynced =/);
    });

    it('resolves viewerColor in /api/match/state for both array and map player_seats shapes', () => {
        const routeSrc = read('app/api/match/state/route.ts');
        assert.match(routeSrc, /Array\.isArray\(data\.player_seats\)/);

        const resolveViewerColor = (playerSeats: unknown, sessionWallet: string): PlayerColor | undefined => {
            const lowWallet = sessionWallet.toLowerCase();
            if (Array.isArray(playerSeats)) {
                for (const rawSeat of playerSeats as Array<{ color?: string; wallet?: string; walletAddress?: string }>) {
                    const seatColor = rawSeat?.color;
                    const seatWallet = rawSeat?.wallet ?? rawSeat?.walletAddress;
                    if (seatColor && seatWallet && seatWallet.toLowerCase() === lowWallet) {
                        return seatColor as PlayerColor;
                    }
                }
            } else if (playerSeats && typeof playerSeats === 'object') {
                for (const [seatColor, seat] of Object.entries(playerSeats as Record<string, { wallet?: string; walletAddress?: string }>)) {
                    if (
                        (seat?.wallet && seat.wallet.toLowerCase() === lowWallet) ||
                        (seat?.walletAddress && seat.walletAddress.toLowerCase() === lowWallet)
                    ) {
                        return seatColor as PlayerColor;
                    }
                }
            }
            return undefined;
        };

        const arraySeats = [
            { color: 'green', walletAddress: '0x1111111111111111111111111111111111111111', isAi: false },
            { color: 'red', walletAddress: '0x2222222222222222222222222222222222222222', isAi: false },
        ];
        const viewer = resolveViewerColor(arraySeats, '0x1111111111111111111111111111111111111111');
        assert.equal(viewer, 'green');

        const state = makeState({
            playerPowers: {
                green: [{ type: 'boost', expiresAt: 9999999999 }],
                red: [{ type: 'nuke', expiresAt: 9999999999 }],
                yellow: [],
                blue: [],
            },
        });
        const sanitized = sanitizeGameStateForWire(state, viewer);
        assert.equal(sanitized.playerPowers?.green?.[0]?.type, 'boost', 'own power preserved for array seats');
        assert.equal(sanitized.playerPowers?.red?.[0]?.type, undefined, 'opponent power still redacted');
    });

    it('reclaims Tier-1 AFK cleanly with a fresh turn deadline and renders compact AFK UI in bottom player-row centerSlot', () => {
        const timerSrc = read('hooks/useGameTimer.ts');
        assert.match(
            timerSrc,
            /activeSeatAfkMode/,
            'useGameTimer turnKey must include active seat AFK mode so reclaiming resets deadlineRef immediately',
        );
        assert.match(timerSrc, /prev\.gamePhase !== 'landing'/);

        const engineSrc = read('hooks/useGameEngine.ts');
        assert.match(engineSrc, /localStateRef\.current\.afkStats\?\.\[color\]/);
        assert.match(engineSrc, /deadlineAt: nextDeadlineAt/);

        const overlaysSrc = read('app/components/BoardOverlays.tsx');
        assert.doesNotMatch(overlaysSrc, /Auto-Bot Active/);
        assert.doesNotMatch(overlaysSrc, /Reclaim within \{formatCountdownMs/);
        assert.match(overlaysSrc, /AFK \{triggers\}\/\{AFK_MAX_TRIGGERS\}/);
        assert.match(overlaysSrc, />\s*Resume\s*</);

        const rowSrc = read('app/components/PlayerInfoRow.tsx');
        assert.match(rowSrc, /centerSlot\?: React\.ReactNode/);
        assert.match(rowSrc, /\{items\[0\]\}\s*\n\s*\{centerSlot\}\s*\n\s*\{items\[1\]\}/);

        const boardSrc = read('app/components/Board.tsx');
        assert.match(boardSrc, /corners=\{\['BL', 'BR'\]\}[\s\S]*?centerSlot=\{/);
    });
});
