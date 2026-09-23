/**
 * Hardening unit tests — N2 resync, E4 AI client fallback, Q2 perf budget,
 * G1 receipt, G3 abandon/AFK.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resyncMatch, shouldPauseLocalOrchestration } from '../lib/netcode/resync';
import { getBestMoveAsync, getBestPowerUsageAsync, resetAiClientForTests } from '../lib/ai/client';
import { measureHop, assertWithinBudget, recordHopSample, hopSampleSummary, resetHopSamples, PERF_BUDGET } from '../lib/perf/budget';
import { buildMatchReceipt, renderReceiptMarkdown } from '../lib/receipt/buildMatchReceipt';
import { afkHonestyView, classifyAbandon, abandonGraceRemainingMs, ABANDON_GRACE_MS } from '../lib/netcode/abandon';
import { hashGameState } from '../lib/replay/hash';
import { createMatchFsm } from '../lib/matchFsm';
import type { GameState, BoardPlayer } from '../lib/types';

function stubState(): GameState {
    return {
        positions: { green: [3, -1, -1, -1], red: [-1, -1, -1, -1], yellow: [-1, -1, -1, -1], blue: [-1, -1, -1, -1] },
        currentPlayer: 'green',
        diceValue: 6,
        isRolling: false,
        gamePhase: 'moving',
        status: 'playing',
        winner: null,
        winners: [],
        captureMessage: null,
        timeLeft: 12,
        strikes: { green: 0, red: 0, yellow: 0, blue: 0 },
        powerTiles: [],
        playerPowers: { green: [], red: [], yellow: [], blue: [] },
        powerSpentThisTurn: false,
        activeBoost: null,
        nukeFlash: [],
        boostTrail: null,
        activeTraps: [],
        activeShields: [],
        consecutiveSixes: 0,
        afkStats: {
            green: { isAutoPlaying: true, consecutiveTurns: 2, totalTriggers: 1, isKicked: false },
            red: { isAutoPlaying: false, consecutiveTurns: 0, totalTriggers: 0, isKicked: false },
            yellow: { isAutoPlaying: false, consecutiveTurns: 0, totalTriggers: 0, isKicked: false },
            blue: { isAutoPlaying: false, consecutiveTurns: 0, totalTriggers: 3, isKicked: true },
        },
        idleWarning: null,
        participantPeers: {},
        isStarted: true,
        isBotMatch: false,
        botDifficulty: 'pro',
        lastUpdate: 0,
        playerCount: '4P',
        matchId: 'rcpt-1',
        lastRollId: 'roll-abc',
        matchStats: {
            green: { kicks: 2, gotKicked: 0 },
            red: { kicks: 0, gotKicked: 1 },
            yellow: { kicks: 0, gotKicked: 1 },
            blue: { kicks: 1, gotKicked: 0 },
        },
    };
}

const players: BoardPlayer[] = [
    { name: 'Ada', level: 3, avatar: 'a', color: 'green', position: 'bottom-left', walletAddress: '0xada' },
    { name: 'Bot', level: 1, avatar: 'b', color: 'red', position: 'bottom-right', isAi: true },
    { name: 'Cy', level: 2, avatar: 'c', color: 'yellow', position: 'top-right' },
    { name: 'Di', level: 4, avatar: 'd', color: 'blue', position: 'top-left' },
];

test('N2 resync applies forward snapshot and reports stale', async () => {
    const seq = 0;
    let applied = 0;
    const apply = (_s: GameState, next: number) => {
        applied = next;
    };
    const ok = await resyncMatch({
        matchId: 'm1',
        currentSeq: seq,
        fetchSnapshot: async () => ({ ok: true, seq: 4, state: stubState() }),
        apply,
        allowEqual: true,
    });
    assert.equal(ok.status, 'applied');
    assert.equal(applied, 4);

    const stale = await resyncMatch({
        matchId: 'm1',
        currentSeq: 4,
        fetchSnapshot: async () => ({ ok: true, seq: 2, state: stubState() }),
        apply,
    });
    assert.equal(stale.status, 'stale');
    assert.equal(applied, 4);
});

test('N2 local match short-circuits', async () => {
    const r = await resyncMatch({
        matchId: 'local',
        currentSeq: 0,
        fetchSnapshot: async () => ({ ok: true, seq: 1, state: stubState() }),
        apply: () => {},
    });
    assert.equal(r.status, 'error');
    assert.equal(shouldPauseLocalOrchestration('syncing'), true);
});

test('E4 AI client falls back to sync heuristics without a worker', async () => {
    resetAiClientForTests();
    const state = stubState();
    const move = await getBestMoveAsync({
        positions: state.positions,
        playerId: 'green',
        roll: 3,
        colorCorner: { green: 'BL', red: 'BR', yellow: 'TR', blue: 'TL' },
        playerCount: '4P',
        powerTiles: [],
        state,
        difficulty: 'pro',
    });
    // green token 0 at 3 + 3 → 6 is legal; expect 0 (only token on board)
    assert.equal(move, 0);

    const power = await getBestPowerUsageAsync({
        state,
        playerId: 'green',
        colorCorner: { green: 'BL', red: 'BR', yellow: 'TR', blue: 'TL' },
        playerCount: '4P',
        difficulty: 'rookie',
    });
    // No inventory — should be null
    assert.equal(power, null);
});

test('Q2 measureHop flags budget violations and records samples', async () => {
    resetHopSamples();
    const fast = await measureHop('fast', () => {});
    assert.equal(fast.ok, true);
    recordHopSample(fast);

    const slow = await measureHop('slow', async () => {
        await new Promise((r) => setTimeout(r, 30));
    }, { hopComposeMs: 10, longTaskMs: 50 });
    assert.equal(slow.ok, false);
    assert.ok(slow.violations.length >= 1);
    recordHopSample(slow);

    const check = assertWithinBudget(slow, { hopComposeMs: 10, longTaskMs: 50 });
    assert.equal(check.ok, false);
    const summary = hopSampleSummary();
    assert.equal(summary.n, 2);
    assert.ok(summary.failRate > 0);
});

test('Q2 default budget constants match the plan', () => {
    assert.equal(PERF_BUDGET.hopComposeMs, 16);
    assert.equal(PERF_BUDGET.longTaskMs, 50);
    assert.equal(PERF_BUDGET.hopDurationMs, 1300);
});

test('G1 match receipt includes hash, afk copy, captures, net section', () => {
    const state = stubState();
    const receipt = buildMatchReceipt({ state, players, seq: 9 });
    assert.equal(receipt.matchId, 'rcpt-1');
    assert.equal(receipt.finalHash, hashGameState(state));
    assert.equal(receipt.seq, 9);
    assert.equal(receipt.lastRollId, 'roll-abc');
    assert.equal(receipt.players.length, 4);
    const ada = receipt.players.find((p) => p.name === 'Ada')!;
    assert.equal(ada.afk.label, 'autoplaying');
    const di = receipt.players.find((p) => p.color === 'blue')!;
    assert.equal(di.afk.label, 'kicked');
    assert.equal(receipt.players[0].captures.kicks, 2);
    const md = renderReceiptMarkdown(receipt);
    assert.match(md, /Final hash/);
    assert.match(md, /Netcode/);
});

test('G3 abandon grace + AFK honesty views', () => {
    assert.equal(classifyAbandon({ hasEdgeSig: true, hasHostSig: false, sinceDisconnectMs: 10 }).mode, 'none');
    assert.equal(abandonGraceRemainingMs(0), ABANDON_GRACE_MS);
    assert.equal(abandonGraceRemainingMs(ABANDON_GRACE_MS), 0);

    const kicked = afkHonestyView('blue', {
        isAutoPlaying: false,
        consecutiveTurns: 0,
        totalTriggers: 3,
        isKicked: true,
    });
    assert.equal(kicked.label, 'kicked');

    const warn = afkHonestyView('green', {
        isAutoPlaying: true,
        consecutiveTurns: 4,
        totalTriggers: 2,
        isKicked: false,
    });
    assert.equal(warn.label, 'warned');
});

test('G1 receipt + FSM + hash stay coherent after a finish path', () => {
    const fsm = createMatchFsm();
    fsm.send({ type: 'OPEN_LOBBY' });
    fsm.send({ type: 'ALL_SEATED' });
    fsm.send({ type: 'START' });
    fsm.send({ type: 'START' });
    fsm.send({ type: 'FINISH' });
    const state = { ...stubState(), status: 'finished' as const, winner: 'Ada', winners: ['Ada'] };
    const receipt = buildMatchReceipt({ state, players, seq: 12 });
    assert.equal(receipt.status, 'finished');
    assert.equal(receipt.winner, 'Ada');
    assert.equal(fsm.phase, 'ended');
    // live START is a no-op keep-alive, not illegal
    const fsm2 = createMatchFsm();
    fsm2.send({ type: 'START' });
    fsm2.send({ type: 'START' });
    fsm2.send({ type: 'START' });
    assert.equal(fsm2.phase, 'live');
    assert.equal(fsm2.illegalTransitions, 0);
});
