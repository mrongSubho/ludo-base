/**
 * N0 unit tests — peer factory pin + resync session proof.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildResyncRequest, isResyncRequest } from '../lib/netcode/resyncProof';
import { peerServerConfig, resetPeerFactoryForTests } from '../lib/peerFactory';

test('N0 resync requires session + actor', () => {
    const bad = buildResyncRequest({ matchId: 'm1', sessionId: undefined, actor: '0xabc' });
    assert.equal(bad.ok, false);
    assert.equal(bad.ok === false && bad.reason, 'SESSION_REQUIRED');

    const noActor = buildResyncRequest({ matchId: 'm1', sessionId: 's1', actor: '' });
    assert.equal(noActor.ok, false);

    const local = buildResyncRequest({ matchId: 'local', sessionId: 's1', actor: '0xabc' });
    assert.equal(local.ok, false);

    const ok = buildResyncRequest({
        matchId: 'm1',
        sessionId: 'sess-1',
        actor: '0xABC',
        sinceSeq: 3,
    });
    assert.equal(ok.ok, true);
    if (ok.ok) {
        assert.equal(ok.request.action, 'resync');
        assert.equal(ok.request.actor, '0xabc', 'actor is lowercased');
        assert.equal(ok.request.sessionId, 'sess-1');
        assert.equal(ok.request.sinceSeq, 3);
    }
});

test('N0 isResyncRequest parse-or-drop', () => {
    assert.equal(isResyncRequest({
        action: 'resync',
        matchId: 'm',
        sessionId: 's',
        actor: 'a',
    }), true);
    assert.equal(isResyncRequest({ action: 'get', matchId: 'm', sessionId: 's', actor: 'a' }), false);
    assert.equal(isResyncRequest({ action: 'resync', matchId: 'm', sessionId: 's', actor: 'a', sinceSeq: 'x' }), false);
    assert.equal(isResyncRequest(null), false);
});

test('N0 peer factory config: no CDN; optional self-host', () => {
    resetPeerFactoryForTests();
    delete process.env.NEXT_PUBLIC_PEERJS_HOST;
    const cloud = peerServerConfig();
    assert.equal(cloud.host, undefined, 'cloud default must not hardcode a host');
    assert.ok(cloud.config?.iceServers?.length);

    process.env.NEXT_PUBLIC_PEERJS_HOST = 'peer.ludo.test';
    process.env.NEXT_PUBLIC_PEERJS_PORT = '9443';
    process.env.NEXT_PUBLIC_PEERJS_PATH = '/ludo';
    process.env.NEXT_PUBLIC_PEERJS_KEY = 'k';
    process.env.NEXT_PUBLIC_PEERJS_SECURE = '0';
    const selfHosted = peerServerConfig();
    assert.equal(selfHosted.host, 'peer.ludo.test');
    assert.equal(selfHosted.port, 9443);
    assert.equal(selfHosted.path, '/ludo');
    assert.equal(selfHosted.secure, false);
    delete process.env.NEXT_PUBLIC_PEERJS_HOST;
    delete process.env.NEXT_PUBLIC_PEERJS_PORT;
    delete process.env.NEXT_PUBLIC_PEERJS_PATH;
    delete process.env.NEXT_PUBLIC_PEERJS_KEY;
    delete process.env.NEXT_PUBLIC_PEERJS_SECURE;
});

test('N0 peerFactory source file has no esm.sh peerjs', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../lib/peerFactory.ts', import.meta.url), 'utf8');
    assert.ok(!src.includes('esm.sh/peerjs'), 'must not load peerjs from CDN');
    assert.ok(src.includes("from 'peerjs'") || src.includes('import(\'peerjs\')'));
});
