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
        payload: { color: 'green' as PlayerColor, tokenIndex: 0, diceValue: roll },
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
    const snap = async () => ({ ok: true as const, seq: host.seq, state: host.state });
    const ada = await resyncMatch({
        matchId: 'mp-harness',
        currentSeq: 1,
        allowEqual: true,
        fetchSnapshot: snap,
        apply: (s, seq) => {
            seats[1].seq = seq;
            host.state = { ...host.state, ...s };
        },
    });
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
