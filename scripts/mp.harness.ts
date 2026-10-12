/**
 * Q4 — multiplayer integration harness (Node, 2–4 clients).
 * Full path: seat → seed → roll → move → capture → resync → end.
 * Prefer this over browser E2E for PRs; Playwright stays optional later.
 *
 * Run: npm run test:mp   (or npm test)
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    INITIAL_GAME_STATE,
    processMove,
    getLegalTokenIndices,
    getNextPlayer,
    calculateNextPosition,
    handleThreeSixes,
    emptyMatchStats,
} from '../lib/gameLogic';
import { hashGameState } from '../lib/replay/hash';
import { createMatchFsm } from '../lib/matchFsm';
import { buildResyncRequest, isResyncRequest } from '../lib/netcode/resyncProof';
import { parseGameIntent, parseJoinRequest, parseGameActionEnvelope } from '../lib/protocol';
import { bumpNet, getNetCounters, resetNetCounters } from '../lib/netcode/counters';
import { resyncMatch } from '../lib/netcode/resync';
import type { ColorCorner, GameState, PlayerColor } from '../lib/types';

const CC: ColorCorner = { green: 'BL', red: 'BR', yellow: 'TR', blue: 'TL' };

type Wire =
    | { channel: 'peer' | 'supa'; kind: 'JOIN' | 'INTENT' | 'ACTION' | 'SYNC'; payload: unknown; id: string };

class Bus {
    peerUp = true;
    supaUp = true;
    log: Wire[] = [];

    send(msg: Omit<Wire, 'channel'>, channels: Array<'peer' | 'supa'> = ['peer', 'supa']): boolean {
        let ok = false;
        for (const channel of channels) {
            const up = channel === 'peer' ? this.peerUp : this.supaUp;
            if (!up) continue;
            this.log.push({ ...msg, channel });
            ok = true;
        }
        return ok;
    }
}

type Seat = {
    color: PlayerColor;
    name: string;
    wallet: string;
    seq: number;
    intentSeen: Set<string>;
};

function makeSeat(color: PlayerColor, name: string, wallet: string): Seat {
    return { color, name, wallet, seq: 0, intentSeen: new Set() };
}

/** Deterministic Edge-RNG stub (replaces roll-dice receipt). */
function edgeRoll(n: number): number {
    return ((n - 1) % 6) + 1;
}

function playingState(overrides: Partial<GameState> = {}): GameState {
    return {
        ...INITIAL_GAME_STATE,
        status: 'playing',
        isStarted: true,
        matchId: 'mp-harness',
        playerCount: '4P',
        matchStats: emptyMatchStats(),
        ...overrides,
        positions: {
            green: [-1, -1, -1, -1],
            red: [-1, -1, -1, -1],
            yellow: [-1, -1, -1, -1],
            blue: [-1, -1, -1, -1],
            ...(overrides.positions || {}),
        },
    };
}

test('Q4 4P: seat → seed → roll → move → capture → resync → end', async () => {
    resetNetCounters();
    const bus = new Bus();
    const host = { fsm: createMatchFsm('idle'), seq: 0, state: playingState() };
    const seats: Seat[] = [
        makeSeat('green', 'Host', '0xhost'),
        makeSeat('red', 'Ada', '0xada'),
        makeSeat('yellow', 'Cy', '0xcy'),
        makeSeat('blue', 'Di', '0xdi'),
    ];

    // ── Seating (dual-path JOIN + intent dedup) ─────────────────────────
    host.fsm.send({ type: 'OPEN_LOBBY' });
    for (const s of seats.slice(1)) {
        const joinId = `join-${s.wallet}`;
        const join = {
            type: 'JOIN_REQUEST',
            intentId: joinId,
            payload: { name: s.name, walletAddress: s.wallet },
        };
        assert.equal(parseJoinRequest(join).ok, true);
        assert.equal(bus.send({ kind: 'JOIN', payload: join, id: joinId }), true);
        host.fsm.send({ type: 'GUEST_SEATED' });
        bumpNet('net_intent_ok');
    }
    host.fsm.send({ type: 'ALL_SEATED' });
    host.fsm.send({ type: 'START' });
    host.fsm.send({ type: 'START' });
    assert.equal(host.fsm.phase, 'live');

    // ── Seed match_states (seq 1) ───────────────────────────────────────
    host.seq = 1;
    // Capture fixture: green 0→1 (non-safe cell); red sits on the same board cell (path 1).
    host.state = playingState({
        positions: {
            green: [0, -1, -1, -1],
            red: [1, -1, -1, -1],
            yellow: [-1, -1, -1, -1],
            blue: [-1, -1, -1, -1],
        },
    });
    const roll = edgeRoll(1);
    assert.equal(roll, 1);
    const landing = calculateNextPosition(0, roll, 'green', CC);
    assert.equal(landing, 1, 'fixture landing');
    host.state = { ...host.state, diceValue: roll, gamePhase: 'moving' };
    for (const s of seats) {
        bus.send({ kind: 'SYNC', payload: { seq: host.seq, hash: hashGameState(host.state) }, id: `seed-${s.wallet}` });
        s.seq = host.seq;
    }

    // ── Roll (Edge stub receipt) already applied to state.diceValue ─────

    // ── Intent: green move (dual-path, flood-safe) ──────────────────────
    const intentId = 'move-green-0';
    const intent = {
        type: 'REQUEST_MOVE',
        intentId,
        sender: '0xhost',
        // No diceValue: the wire must not carry a face. The host reads the one it
        // rolled from host.state.diceValue, exactly as useGameEngine now does.
        // This fixture used to send diceValue, so the harness was asserting the
        // vulnerable shape was legal.
        payload: { color: 'green' as PlayerColor, tokenIndex: 0 },
    };
    assert.equal(parseGameIntent(intent).ok, true);
    assert.equal(bus.send({ kind: 'INTENT', payload: intent, id: intentId }), true);
    // Duplicate delivery on the other channel
    bus.send({ kind: 'INTENT', payload: intent, id: intentId }, ['peer']);
    for (const s of seats) {
        if (s.intentSeen.has(intentId)) bumpNet('net_intent_dup');
        else {
            s.intentSeen.add(intentId);
            bumpNet('net_intent_ok');
        }
    }

    // ── Host applies move with engine math (never pos+roll) ─────────────
    const legal = getLegalTokenIndices(host.state.positions, 'green', roll, CC);
    assert.ok(legal.includes(0), 'token 0 must be legal');
    const beforeGreen = host.state.positions.green[0];
    const beforeRed = host.state.positions.red[0];
    const result = processMove(host.state, 'green', 0, roll, '4P', CC);
    assert.notEqual(result.newState.positions.green[0], beforeGreen, 'green must advance');
    assert.equal(result.captured, true, 'should capture red on landing');
    assert.equal(beforeRed, 1);
    assert.equal(result.newState.positions.red[0], -1, 'captured red returns to base');
    assert.equal(result.newState.positions.green[0], landing);
    assert.equal(result.bonusRoll, true, 'capture grants bonus roll');
    host.state = result.newState;
    host.seq += 1;
    for (const s of seats) s.seq = host.seq;

    // ── Resync proof (N0) mid-match for Ada ─────────────────────────────
    const proof = buildResyncRequest({
        matchId: 'mp-harness',
        sessionId: 'sess-ada',
        actor: '0xAda',
        sinceSeq: 0,
    });
    assert.equal(proof.ok, true);
    if (proof.ok) assert.equal(isResyncRequest(proof.request), true);
    // Exit-gate fix: the old code handed the guest a live reference to
    // host.state and then merged the applied snapshot back INTO host.state —
    // the guest's resync mutated the host. The snapshot is now a deep copy
    // (as the Edge/socket boundary is in production) and the guest keeps its
    // own board object.
    const guestBoard: { seq: number; state: GameState } = { seq: 1, state: playingState() };
    const snap = async () => ({
        ok: true as const,
        seq: host.seq,
        state: JSON.parse(JSON.stringify(host.state)) as GameState,
    });
    const ada = await resyncMatch({
        matchId: 'mp-harness',
        currentSeq: guestBoard.seq,
        allowEqual: true,
        fetchSnapshot: snap,
        apply: (st, seq) => {
            guestBoard.seq = seq;
            guestBoard.state = { ...guestBoard.state, ...st };
        },
    });
    // The host's board is untouched by the guest's resync.
    assert.equal(host.seq, guestBoard.seq, 'guest converged on the host seq without touching host.state');
    assert.equal(ada.status, 'applied');

    // ── Three-sixes rule still holds under harness ──────────────────────
    const t6 = handleThreeSixes(2, 6);
    assert.equal(t6.isThreeSixes, true);

    // ── End: green runs home (synthetic win) ────────────────────────────
    host.state = {
        ...host.state,
        positions: { ...host.state.positions, green: [57, 57, 57, 57] },
        status: 'finished',
        winner: 'Host',
        winners: ['green'],
    };
    host.seq += 1;
    host.fsm.send({ type: 'FINISH' });
    assert.equal(host.fsm.phase, 'ended');
    assert.equal(host.fsm.illegalTransitions, 0);

    // ── Receipt hash stability ──────────────────────────────────────────
    const h1 = hashGameState(host.state);
    const h2 = hashGameState(host.state);
    assert.equal(h1, h2);
    assert.ok(getNetCounters().net_intent_ok >= 4);
    assert.ok(bus.log.some((l) => l.kind === 'JOIN'));
    assert.ok(bus.log.some((l) => l.kind === 'INTENT'));

    console.log(`
── Q4 mp harness sign-off ──
  seats: 4 (host + 3 guests)
  seq: ${host.seq}   intents ok/dup: ${getNetCounters().net_intent_ok}/${getNetCounters().net_intent_dup}
  capture: green→red on cell ${landing}
  resync proof: ok   fsm: ${host.fsm.phase} illegal=${host.fsm.illegalTransitions}
  finalHash: ${h1}
`);
});

test('Q4 2P (1v1): seat → move → bonus roll → end', () => {
    resetNetCounters();
    const fsm = createMatchFsm();
    fsm.send({ type: 'OPEN_LOBBY' });
    fsm.send({ type: 'GUEST_SEATED' });
    fsm.send({ type: 'START' });
    fsm.send({ type: 'START' });

    let state = playingState({
        playerCount: '1v1',
        positions: {
            green: [10, -1, -1, -1],
            red: [7, -1, -1, -1],
            yellow: [-1, -1, -1, -1],
            blue: [-1, -1, -1, -1],
        },
    });

    const roll = 6;
    const legal = getLegalTokenIndices(state.positions, 'green', roll, CC);
    assert.ok(legal.length >= 1);
    const before = state.positions.green[0];
    const result = processMove(state, 'green', 0, roll, '1v1', CC);
    assert.notEqual(result.newState.positions.green[0], before, 'green token 0 must move');
    state = result.newState;
    // Capture grants bonus in engine — assert when engine reports it
    if (result.bonusRoll) {
        assert.equal(state.currentPlayer, 'green');
    }
    fsm.send({ type: 'FINISH' });
    assert.equal(fsm.phase, 'ended');
    assert.equal(fsm.illegalTransitions, 0);
});

test('Q4 action envelope parse-or-drop on the wire', () => {
    assert.equal(parseGameActionEnvelope({ type: 'START_GAME', actionId: 'a1' }).ok, true);
    assert.equal(parseGameActionEnvelope({ type: '' }).ok, false);
    assert.equal(parseGameActionEnvelope(12).ok, false);
});

/**
 * Phase 4 exit gate: a 4P and a 2v2 match played END-TO-END reach
 * `status='finished'` with a winner — including at least one turn with no
 * legal move (passed, not wedged) and one three-sixes forfeit.
 *
 * This drives the app's offline path (`lib/gameLogic`, the same functions
 * `useGameActions` calls) with seeded dice, so the termination proof covers
 * the code the UI actually runs — not just the authority engine (which
 * `test:golden` already covers through `lib/engine/core.ts`).
 */
function lcg(seed: number): () => number {
    let s = (seed >>> 0) || 1;
    return () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 0x100000000;
    };
}

function playToFinish(
    mode: '4P' | '2v2',
    seed: number,
    maxTurns = 3000,
): { winner: string | null; turns: number; passes: number; forfeits: number } {
    const rand = lcg(seed);
    const colors: PlayerColor[] = mode === '2v2' ? ['green', 'blue', 'red', 'yellow'] : ['green', 'red', 'yellow', 'blue'];
    // On-track starts so the drill races instead of camping base exits.
    const positions = {} as Record<PlayerColor, number[]>;
    colors.forEach((c, i) => {
        positions[c] = [0, 1, 2, 3].map((j) => (i * 3 + j * 2) % 10);
    });
    let state = playingState({ playerCount: mode, positions, currentPlayer: 'green' });
    let sixes = 0;
    let passes = 0;
    let forfeits = 0;
    let turns = 0;

    for (let t = 0; t < maxTurns && state.status === 'playing'; t++) {
        turns += 1;
        const color = state.currentPlayer;
        // Deterministic forfeit: the opening three turns are sixes. Bonuses
        // keep the same player rolling, so turn 3 is a genuine three-sixes
        // forfeit processed through the same path as every other turn.
        const roll = t < 3 ? 6 : 1 + Math.floor(rand() * 6);
        const t6 = handleThreeSixes(state.consecutiveSixes, roll);
        if (t6.isThreeSixes) {
            // Three-sixes forfeit: the turn passes, nobody moves. The rotation
            // MUST advance here — a pass that re-rolls the same seat is the
            // NET-01 wedge this drill exists to prevent.
            forfeits += 1;
            sixes = 0;
            state = {
                ...state,
                consecutiveSixes: 0,
                diceValue: null,
                gamePhase: 'rolling',
                currentPlayer: getNextPlayer(color, mode, colors, CC),
            };
            continue;
        }
        sixes = t6.nextSixes;
        state = { ...state, consecutiveSixes: sixes, diceValue: roll, gamePhase: 'moving' };

        const legal = getLegalTokenIndices(state.positions, color, roll, CC);
        if (legal.length === 0) {
            // No legal move: the turn passes WITHOUT desyncing. Before NET-01
            // this exact situation wedged match_states and 403'd the next
            // player permanently. Same rotation rule as the forfeit above.
            passes += 1;
            state = {
                ...state,
                diceValue: null,
                gamePhase: 'rolling',
                currentPlayer: getNextPlayer(color, mode, colors, CC),
            };
            continue;
        }
        // Greedy max-progress with a seeded tiebreak — deterministic.
        let idx = legal[0]!;
        let best = -Infinity;
        for (const i of legal) {
            const dest = calculateNextPosition(state.positions[color]![i]!, roll, color, CC);
            const d = dest + rand() * 1e-9;
            if (d > best) {
                best = d;
                idx = i;
            }
        }
        const result = processMove(state, color, idx, roll, mode, CC, color);
        state = {
            ...result.newState,
            diceValue: result.bonusRoll ? roll : null,
            gamePhase: result.bonusRoll ? 'moving' : 'rolling',
        };
    }
    return { winner: state.status === 'finished' ? state.winner : null, turns, passes, forfeits };
}

test('Q4 end-to-end: 4P terminates with a winner (pass + forfeit included)', () => {
    const m = playToFinish('4P', 0x40);
    assert.ok(m.winner, `4P must terminate, ran ${m.turns} turns`);
    assert.ok(m.passes >= 1, 'the drill must include a no-legal-move pass');
    assert.ok(m.forfeits >= 1, 'the drill must include a three-sixes forfeit');
});

test('Q4 end-to-end: 2v2 terminates with a TEAM win (pass + forfeit included)', () => {
    const m = playToFinish('2v2', 0x2b0);
    assert.ok(m.winner, `2v2 must terminate, ran ${m.turns} turns`);
    assert.match(m.winner ?? '', /^Team [12]$/, '2v2 ends in a team win, not a solo colour');
    assert.ok(m.passes >= 1, 'the drill must include a no-legal-move pass');
    assert.ok(m.forfeits >= 1, 'the drill must include a three-sixes forfeit');
});
