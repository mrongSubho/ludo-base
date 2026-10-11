/**
 * EdgeServerClient liveness (Phase 6 / NET-25).
 *
 * - connect() must time out instead of hanging when the server never answers.
 * - findMatch/validateGameResult must stop waiting on a CONNECTING socket.
 * - disconnect() must clear handlers so reconnects don't fire stale closures.
 *
 * A stub WebSocket stands in for the server (no `ws` dependency).
 * Run: npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { EdgeServerClient } from '../lib/teamup/edge-server-client';

type StubCfg = {
    /** ms until the socket opens; null = never opens. */
    openAfterMs: number | null;
    /** Answer find_match with a canned room. */
    answerFindMatch: boolean;
};

class FakeSocket {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;
    readyState = FakeSocket.CONNECTING;
    onopen: (() => void) | null = null;
    onmessage: ((ev: { data: string }) => void) | null = null;
    onerror: ((err: unknown) => void) | null = null;
    onclose: (() => void) | null = null;
    closed = false;
    constructor(
        public readonly url: string,
        private readonly cfg: StubCfg,
    ) {
        if (cfg.openAfterMs !== null) {
            setTimeout(() => {
                if (this.closed) return;
                this.readyState = FakeSocket.OPEN;
                this.onopen?.();
            }, cfg.openAfterMs);
        }
    }
    send(raw: string): void {
        if (!this.cfg.answerFindMatch) return;
        const msg = JSON.parse(raw) as { type: string; requestId: string };
        if (msg.type === 'find_match') {
            queueMicrotask(() => {
                this.onmessage?.({
                    data: JSON.stringify({ type: 'match_found', requestId: msg.requestId, data: { room: 'R1' } }),
                });
            });
        }
    }
    close(): void {
        this.closed = true;
        this.readyState = FakeSocket.CLOSED;
        this.onclose?.();
    }
}

async function withStub<T>(cfg: StubCfg, fn: (sockets: () => FakeSocket[]) => Promise<T>): Promise<T> {
    const RealWebSocket = globalThis.WebSocket;
    const seen: FakeSocket[] = [];
    const Ctor = function (this: unknown, url: string) {
        const sock = new FakeSocket(url, cfg);
        seen.push(sock);
        return sock;
    } as unknown as typeof WebSocket;
    (Ctor as unknown as Record<string, unknown>).CONNECTING = 0;
    (Ctor as unknown as Record<string, unknown>).OPEN = 1;
    (Ctor as unknown as Record<string, unknown>).CLOSING = 2;
    (Ctor as unknown as Record<string, unknown>).CLOSED = 3;
    (globalThis as Record<string, unknown>).WebSocket = Ctor;
    try {
        return await fn(() => seen);
    } finally {
        (globalThis as Record<string, unknown>).WebSocket = RealWebSocket;
    }
}

test('NET-25: connect times out instead of hanging on a silent server', async () => {
    const client = new EdgeServerClient('ws://silent', { connectTimeoutMs: 60, pollIntervalMs: 5 });
    await withStub({ openAfterMs: null, answerFindMatch: false }, async (sockets) => {
        await assert.rejects(client.connect(), /timed out/);
        assert.equal(sockets().length, 1);
        assert.equal(sockets()[0].closed, true, 'the dead socket must be closed, not leaked');
        // A second connect after a timeout starts fresh, not on the corpse.
        await assert.rejects(client.connect(), /timed out/);
        assert.equal(sockets().length, 2);
    });
});

test('NET-25: a CONNECTING socket bounds the wait instead of polling forever', async () => {
    const client = new EdgeServerClient('ws://stuck', { connectTimeoutMs: 120, pollIntervalMs: 5 });
    await withStub({ openAfterMs: null, answerFindMatch: false }, async () => {
        // connect() pending (CONNECTING) while findMatch arrives: the wait
        // must reject at the deadline rather than poll every 100ms forever.
        const start = Date.now();
        const [c, f] = await Promise.allSettled([client.connect(), client.findMatch({} as never)]);
        const elapsed = Date.now() - start;
        assert.equal(c.status, 'rejected');
        assert.equal(f.status, 'rejected');
        assert.ok(elapsed < 2000, `must reject promptly, took ${elapsed}ms`);
    });
});

test('NET-25: slow opens still succeed inside the bound', async () => {
    const client = new EdgeServerClient('ws://slow', { connectTimeoutMs: 2000, pollIntervalMs: 5 });
    await withStub({ openAfterMs: 40, answerFindMatch: true }, async () => {
        await client.connect();
        const res = await client.findMatch({ mode: 'test' } as never);
        assert.deepEqual(res, { room: 'R1' });
        assert.equal(client.listenerCount('match_found'), 0, 'per-request handlers are removed');
        assert.equal(client.listenerCount('match_error'), 0);
    });
});

test('NET-25: disconnect clears handlers and drops the socket', async () => {
    const client = new EdgeServerClient('ws://live', { connectTimeoutMs: 500, pollIntervalMs: 5 });
    client.addEventListener('match_found', () => {});
    client.addEventListener('match_found', () => {});
    assert.equal(client.listenerCount('match_found'), 2);
    client.disconnect();
    assert.equal(client.listenerCount('match_found'), 0, 'stale closures must not survive teardown');
    await assert.rejects(client.findMatch({} as never), /cleared|not connected/);
});
