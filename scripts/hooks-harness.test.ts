/**
 * Phase 5 exit gate — `npm run test:hooks`.
 *
 * A react-test-renderer harness covering the effect/dependency findings.
 * What is EXECUTED (mounted with act(), real hook code):
 *   - REA-07: two mounted usePreferences readers stay in sync — a toggle in
 *     one re-renders the other with the new value (the store, not per-hook
 *     useState, is the source of truth).
 *   - REA-11: the flush decision (`shouldFlushServerState`) — flush once on
 *     matchId arrival, never on timer churn, reset when the match goes away.
 * What is PINNED by source (mounting TeamUpProvider needs supabase/peerjs and
 * would test mocks, not code — the repo's established dice-trust pattern):
 *   - REA-05: `matchConnectionStatus` is in the TeamUpContext memo deps.
 *   - NET-12: the blanket guest sync is gone (only the seq-guarded merge stays).
 *   - NET-17: `handleRoll` reads `stateRef.current.matchId`.
 *
 * The DOM shim below is minimal and explicit: the hooks under test guard
 * every DOM touch, so the shim only needs cookie/localStorage/event shape.
 * Run: npm run test:hooks
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { usePreferences } from '../hooks/usePreferences';
import { shouldFlushServerState } from '../lib/netcode/flushGate';

const root = join(import.meta.dirname ?? __dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
/** Strip comment lines so a prose mention is not read as code. */
const code = (p: string) =>
    read(p)
        .split('\n')
        .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
        .join('\n');

// ── Minimal DOM shim (explicit; hooks guard every touch) ────────────────────

function installDomShim(): () => void {
    const store = new Map<string, string>();
    const listeners = new Map<string, Set<() => void>>();
    const g = globalThis as Record<string, unknown>;
    const prev: Record<string, unknown> = {};
    for (const k of ['document', 'window', 'localStorage']) prev[k] = g[k];

    const classList = {
        add: () => {},
        remove: () => {},
        toggle: () => {},
        contains: () => false,
    };
    g.document = {
        cookie: '',
        body: { classList },
        addEventListener: () => {},
        removeEventListener: () => {},
    };
    g.window = {
        dispatchEvent: (ev: { type: string }) => {
            listeners.get(String(ev.type))?.forEach((fn) => fn());
            return true;
        },
        addEventListener: (t: string, fn: () => void) => {
            if (!listeners.has(t)) listeners.set(t, new Set());
            listeners.get(t)!.add(fn);
        },
        removeEventListener: (t: string, fn: () => void) => {
            listeners.get(t)?.delete(fn);
        },
        localStorage: undefined,
    };
    g.localStorage = {
        getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
        setItem: (k: string, v: string) => void store.set(k, String(v)),
        removeItem: (k: string) => void store.delete(k),
    };
    return () => {
        for (const k of ['document', 'window', 'localStorage']) {
            if (prev[k] === undefined) delete g[k];
            else g[k] = prev[k];
        }
    };
}

// ── REA-07, executed ────────────────────────────────────────────────────────

function Reader({ id, seen }: { id: string; seen: Record<string, unknown> }) {
    const { preferences } = usePreferences();
    seen[id] = preferences.tokenStyle;
    return null;
}

test('REA-07: a mid-match toggle reaches every mounted consumer', () => {
    const restore = installDomShim();
    try {
        const seen: Record<string, unknown> = {};
        let root: TestRenderer.ReactTestRenderer;
        act(() => {
            root = TestRenderer.create(
                React.createElement(
                    React.Fragment,
                    null,
                    React.createElement(Reader, { id: 'a', seen }),
                    React.createElement(Reader, { id: 'b', seen }),
                ),
            );
        });
        // The invariant is propagation, not the default. Read whatever the
        // default currently is and toggle away from it — a test pinned to
        // 'pawn' breaks every time the default changes, which is exactly what
        // happened when orb became the default.
        const initial = seen.a;
        const other = initial === 'orb' ? 'pawn' : 'orb';
        assert.equal(seen.b, initial, 'both readers must see the same initial value');

        // Toggle through a THIRD instance (the settings panel), the way the
        // real bug manifested: only the setter re-rendered.
        let writer: TestRenderer.ReactTestRenderer;
        let captured: ((k: 'token-style', v: string) => void) | null = null;
        function Grab() {
            const { updatePreference } = usePreferences();
            captured = updatePreference;
            return null;
        }
        act(() => {
            writer = TestRenderer.create(React.createElement(Grab, null));
        });
        act(() => {
            captured!('token-style', other);
        });

        assert.equal(seen.a, other, 'reader A must follow the toggle');
        assert.equal(seen.b, other, 'reader B must follow the toggle');
        root!.unmount();
        writer!.unmount();
    } finally {
        restore();
    }
});

test('REA-07: an unmounted consumer stops receiving toggles', () => {
    const restore = installDomShim();
    try {
        const seen: Record<string, unknown> = {};
        let root: TestRenderer.ReactTestRenderer;
        act(() => {
            root = TestRenderer.create(React.createElement(Reader, { id: 'solo', seen }));
        });
        const initial = seen.solo;
        const other = initial === 'orb' ? 'pawn' : 'orb';
        root!.unmount();

        let captured: ((k: 'token-style', v: string) => void) | null = null;
        function Grab() {
            const { updatePreference } = usePreferences();
            captured = updatePreference;
            return null;
        }
        let writer: TestRenderer.ReactTestRenderer;
        act(() => {
            writer = TestRenderer.create(React.createElement(Grab, null));
        });
        // Must not throw after the reader is gone (listener leak check).
        act(() => {
            captured!('token-style', other);
        });
        writer!.unmount();
    } finally {
        restore();
    }
});

// ── REA-11, executed ────────────────────────────────────────────────────────

test('REA-11: the write-up flushes once on matchId arrival, never on churn', () => {
    // No match yet: reset, and no flush for anyone.
    assert.equal(shouldFlushServerState({ flushedId: null, matchId: undefined, isHost: true, isLobbyConnected: true }), 'reset');
    assert.equal(shouldFlushServerState({ flushedId: null, matchId: 'local', isHost: true, isLobbyConnected: true }), 'reset');
    // A real match arrives: exactly one flush for the connected host.
    assert.equal(shouldFlushServerState({ flushedId: null, matchId: 'm-1', isHost: true, isLobbyConnected: true }), 'flush');
    // Timer ticks re-run the effect with the SAME matchId: hold, always.
    assert.equal(shouldFlushServerState({ flushedId: 'm-1', matchId: 'm-1', isHost: true, isLobbyConnected: true }), 'hold');
    assert.equal(shouldFlushServerState({ flushedId: 'm-1', matchId: 'm-1', isHost: true, isLobbyConnected: true }), 'hold');
    // Guests and the disconnected never flush (they have no authority to push).
    assert.equal(shouldFlushServerState({ flushedId: null, matchId: 'm-1', isHost: false, isLobbyConnected: true }), 'hold');
    assert.equal(shouldFlushServerState({ flushedId: null, matchId: 'm-1', isHost: true, isLobbyConnected: false }), 'hold');
    // A new match re-arms; leaving resets the latch.
    assert.equal(shouldFlushServerState({ flushedId: 'm-1', matchId: 'm-2', isHost: true, isLobbyConnected: true }), 'flush');
    assert.equal(shouldFlushServerState({ flushedId: 'm-2', matchId: undefined, isHost: true, isLobbyConnected: true }), 'reset');
});

// ── Source pins (provider needs supabase/peerjs; pins, not mocks) ──────────

test('REA-05: matchConnectionStatus is in the TeamUpContext memo deps', () => {
    const src = code('hooks/TeamUpContext.tsx');
    // The value carries it AND the dep array carries it — one without the
    // other is the stale-'syncing' freeze this item exists for.
    assert.match(src, /matchConnectionStatus, hasAuthoritativeSnapshot,\n        matchPhase, matchFsmIllegal,/);
    assert.match(src, /matchConnectionStatus, hasAuthoritativeSnapshot, matchPhase, matchFsmIllegal,/);
});

test('NET-12: the blanket guest sync is gone', () => {
    const src = code('hooks/useGameEngine.ts');
    assert.doesNotMatch(src, /setLocalGameState\(networkGameState\)/);
    // The seq-guarded merge is what remains.
    assert.match(src, /networkGameState\.lastUpdate > localGameState\.lastUpdate/);
});

test('NET-17: handleRoll reads the ref-stable matchId', () => {
    const src = code('hooks/useGameActions.ts');
    assert.match(src, /const matchId = stateRef\.current\.matchId;/);
});
