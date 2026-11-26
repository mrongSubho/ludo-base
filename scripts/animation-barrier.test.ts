import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { INITIAL_GAME_STATE } from '../lib/gameLogic';
import { assignCornersForShape } from '../lib/boardLayout';
import type { GameState } from '../lib/types';
import {
    AnimationBarrier,
    MAX_BARRIER_WATCHDOG_MS,
    MAX_PRESENTATION_QUEUE,
    computeBarrierWatchdogMs,
    estimateTransitionDurationMs,
    isTimerOnlyTransition,
} from '../lib/animationBarrier';
import { DEPLOY_SETTLE_BUFFER_MS, computeMoveSettleBufferMs } from '../lib/tokenMovement';

function makeState(overrides: Partial<GameState> = {}): GameState {
    return {
        ...structuredClone(INITIAL_GAME_STATE),
        matchId: 'match-barrier-test',
        playerCount: '4P',
        isStarted: true,
        status: 'playing',
        ...overrides,
    };
}

describe('AnimationBarrier — FIFO Presentation Queue, Watchdogs & Timer Pass-Through', () => {
    it('passes timer-only updates straight through without blocking or dropping queued gameplay frames', (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        try {
            const presentedLog: GameState[] = [];
            const s0 = makeState({
                positions: { green: [34, -1, -1, -1], red: [-1, -1, -1, -1], yellow: [-1, -1, -1, -1], blue: [-1, -1, -1, -1] },
                timeLeft: 15,
            });
            const barrier = new AnimationBarrier({
                initialState: s0,
                onPresent: (st) => presentedLog.push(st),
            });

            // 1. Acquire a hop lock and enqueue a gameplay move
            barrier.acquireLock('hop:green-0', 500);
            const s1 = makeState({
                positions: { green: [38, -1, -1, -1], red: [-1, -1, -1, -1], yellow: [-1, -1, -1, -1], blue: [-1, -1, -1, -1] },
                currentPlayer: 'red',
                timeLeft: 15,
            });
            barrier.enqueue(s1, { estimatedMs: 600 });
            assert.equal(barrier.getPresented().positions.green[0], 34, 'board stays on s0 while locked');
            assert.equal(barrier.getQueueLength(), 1);

            // 2. Timer-only tick arrives while locked -> updates clock on presented AND tail queued frame
            const s1Tick = makeState({
                ...s1,
                timeLeft: 11,
                deadlineAt: 999999,
            });
            assert.equal(isTimerOnlyTransition(s1, s1Tick), true);
            barrier.enqueue(s1Tick, { estimatedMs: 0 });
            assert.equal(barrier.getPresented().timeLeft, 11, 'timer tick passes straight through to presented clock');
            assert.equal(barrier.getPresented().positions.green[0], 34, 'board positions remain locked until animation releases');
            assert.equal(barrier.getQueueLength(), 1, 'timer tick does not consume a queue slot');

            // 3. Release lock -> queued s1 presents with updated clock
            barrier.releaseLock('hop:green-0');
            assert.equal(barrier.getPresented().positions.green[0], 38);
            assert.equal(barrier.getPresented().timeLeft, 11);
            assert.equal(barrier.getPresented().deadlineAt, 999999);
            assert.ok(presentedLog.length >= 2);

            barrier.dispose();
        } finally {
            t.mock.timers.reset();
        }
    });

    it('caps queued snapshots at MAX_PRESENTATION_QUEUE=4 by evicting oldest intermediates', () => {
        const s0 = makeState();
        const barrier = new AnimationBarrier({
            initialState: s0,
            onPresent: () => {},
        });

        barrier.acquireLock('hop:green-0', 800);
        for (let step = 1; step <= 6; step++) {
            barrier.enqueue(
                makeState({
                    positions: {
                        green: [34 + step, -1, -1, -1],
                        red: [-1, -1, -1, -1],
                        yellow: [-1, -1, -1, -1],
                        blue: [-1, -1, -1, -1],
                    },
                    diceValue: (step % 6) + 1,
                }),
                { estimatedMs: 0 },
            );
        }

        assert.equal(barrier.getQueueLength(), MAX_PRESENTATION_QUEUE);
        // Drain all 4 surviving frames and verify the earliest 2 (pos 35, 36) were dropped while latest (pos 40) kept
        barrier.releaseLock('hop:green-0');
        assert.equal(barrier.getPresented().positions.green[0], 37);
        while (barrier.getQueueLength() > 0) {
            barrier.releaseLock('transition');
        }
        assert.equal(barrier.getPresented().positions.green[0], 40);
        assert.equal(barrier.getAuthoritative().positions.green[0], 40);
        barrier.dispose();
    });

    it('unblocks automatically via per-lock watchdog min(2500, estimatedMs + 350) when GSAP callback never fires', (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        try {
            assert.equal(computeBarrierWatchdogMs(600), 950);
            assert.equal(computeBarrierWatchdogMs(5000), MAX_BARRIER_WATCHDOG_MS);

            const s0 = makeState({ positions: { green: [34, -1, -1, -1], red: [-1, -1, -1, -1], yellow: [-1, -1, -1, -1], blue: [-1, -1, -1, -1] } });
            const s1 = makeState({ positions: { green: [40, -1, -1, -1], red: [-1, -1, -1, -1], yellow: [-1, -1, -1, -1], blue: [-1, -1, -1, -1] } });
            const barrier = new AnimationBarrier({
                initialState: s0,
                onPresent: () => {},
            });

            barrier.acquireLock('hop:green-0', 600);
            barrier.enqueue(s1, { estimatedMs: 0 });
            assert.equal(barrier.getPresented().positions.green[0], 34);

            // Just before watchdog (940ms) -> still locked
            t.mock.timers.tick(940);
            assert.equal(barrier.isLocked(), true);
            assert.equal(barrier.getPresented().positions.green[0], 34);

            // Watchdog fires at 950ms -> queue drains automatically
            t.mock.timers.tick(20);
            assert.equal(barrier.isLocked(), false);
            assert.equal(barrier.getPresented().positions.green[0], 40);

            barrier.dispose();
        } finally {
            t.mock.timers.reset();
        }
    });

    it('flushes immediately on reducedMotion, hidden visibility, resync, and match winner', (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        try {
            let reduced = false;
            let hidden = false;
            const s0 = makeState();
            const barrier = new AnimationBarrier({
                initialState: s0,
                getReducedMotion: () => reduced,
                isHidden: () => hidden,
                onPresent: () => {},
            });

            // Case 1: winner flushes through an active lock
            barrier.acquireLock('hop:green-0', 900);
            const s1 = makeState({ diceValue: 4 });
            barrier.enqueue(s1, { estimatedMs: 300 });
            assert.equal(barrier.getQueueLength(), 1);
            const sWin = makeState({ winner: 'green', status: 'finished', diceValue: 6 });
            barrier.enqueue(sWin, { estimatedMs: 500 });
            assert.equal(barrier.isLocked(), false);
            assert.equal(barrier.getQueueLength(), 0);
            assert.equal(barrier.getPresented().winner, 'green');

            // Case 2: resync flushes through an active lock
            const sNext = makeState({ matchId: 'match-barrier-2', positions: { green: [10, -1, -1, -1], red: [-1, -1, -1, -1], yellow: [-1, -1, -1, -1], blue: [-1, -1, -1, -1] } });
            barrier.enqueue(sNext);
            barrier.acquireLock('hop:green-0', 900);
            const sResync = makeState({ matchId: 'match-barrier-2', positions: { green: [25, -1, -1, -1], red: [-1, -1, -1, -1], yellow: [-1, -1, -1, -1], blue: [-1, -1, -1, -1] } });
            barrier.enqueue(sResync, { resync: true });
            assert.equal(barrier.getPresented().positions.green[0], 25);
            assert.equal(barrier.isLocked(), false);

            // Case 3: reducedMotion & hidden prevent locking and flush immediately
            reduced = true;
            barrier.acquireLock('hop:green-0', 900);
            assert.equal(barrier.isLocked(), false);

            reduced = false;
            hidden = true;
            barrier.enqueue(makeState({ matchId: 'match-barrier-2', currentPlayer: 'red' }), { estimatedMs: 500 });
            assert.equal(barrier.isLocked(), false);
            assert.equal(barrier.getPresented().currentPlayer, 'red');

            barrier.dispose();
        } finally {
            t.mock.timers.reset();
        }
    });

    it('estimates transition durations accurately (51->0 wrap, deploy settle 610ms, and nuke impact)', () => {
        const cc = assignCornersForShape('4P');
        const deployPrev = makeState();
        const deployNext = makeState({ positions: { green: [34, -1, -1, -1], red: [-1, -1, -1, -1], yellow: [-1, -1, -1, -1], blue: [-1, -1, -1, -1] } });
        assert.equal(estimateTransitionDurationMs(deployPrev, deployNext, cc, '3077'), 420);
        assert.equal(DEPLOY_SETTLE_BUFFER_MS, 610);
        assert.equal(computeMoveSettleBufferMs(1, false, '3077', true), 610);

        const wrapPrev = makeState({ positions: { green: [50, -1, -1, -1], red: [-1, -1, -1, -1], yellow: [-1, -1, -1, -1], blue: [-1, -1, -1, -1] } });
        const wrapNext = makeState({ positions: { green: [2, -1, -1, -1], red: [-1, -1, -1, -1], yellow: [-1, -1, -1, -1], blue: [-1, -1, -1, -1] } });
        const wrapMs = estimateTransitionDurationMs(wrapPrev, wrapNext, cc, '3077');
        assert.ok(wrapMs >= 500 && wrapMs <= 1200, `expected bounded 4-step wrap duration, got ${wrapMs}`);
    });
});
