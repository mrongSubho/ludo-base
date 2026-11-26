import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { webcrypto } from 'node:crypto';
import {
    DEFAULT_CONFIG_BUCKETS,
    assertFeatureEnabled,
    getServerConfigEnvelope,
    signConfigEnvelope,
    verifyConfigEnvelope,
} from '../lib/configRegistry';
import {
    BASE_MAINNET_RPC_FALLBACKS,
    BASE_SEPOLIA_RPC_FALLBACKS,
    createFallbackRpcTransport,
} from '../lib/rpcTransport';

test('configRegistry signs and verifies ECDSA P-256 envelopes and rejects tampering', async () => {
    const pair = await webcrypto.subtle.generateKey(
        { name: 'ECDSA', namedCurve: 'P-256' },
        true,
        ['sign', 'verify'],
    );
    const privJwk = (await webcrypto.subtle.exportKey('jwk', pair.privateKey)) as JsonWebKey;
    const pubJwk = (await webcrypto.subtle.exportKey('jwk', pair.publicKey)) as JsonWebKey;

    const envelope = await signConfigEnvelope(DEFAULT_CONFIG_BUCKETS, privJwk, {
        version: 1,
        issuedAt: '2026-11-27T00:00:00.000Z',
        keyId: 'test-k1',
    });

    assert.equal(envelope.alg, 'ECDSA-P256-SHA256');
    assert.equal(await verifyConfigEnvelope(envelope, pubJwk), true);

    const tampered = structuredClone(envelope);
    tampered.buckets[1001].maxWagerChips = 999999;
    assert.equal(await verifyConfigEnvelope(tampered, pubJwk), false);

    const badSig = { ...envelope, signature: 'invalid-signature-xyz' };
    assert.equal(await verifyConfigEnvelope(badSig, pubJwk), false);
});

test('getServerConfigEnvelope fails closed to defaults on untrusted KV payloads', async () => {
    const pair = await webcrypto.subtle.generateKey(
        { name: 'ECDSA', namedCurve: 'P-256' },
        true,
        ['sign', 'verify'],
    );
    const privJwk = (await webcrypto.subtle.exportKey('jwk', pair.privateKey)) as JsonWebKey;
    const pubJwk = JSON.stringify(await webcrypto.subtle.exportKey('jwk', pair.publicKey));

    const customBuckets = structuredClone(DEFAULT_CONFIG_BUCKETS);
    customBuckets[1004].spectatorBetting = false;
    const validSigned = await signConfigEnvelope(customBuckets, privJwk);

    const validEnv = await getServerConfigEnvelope({
        kv: { async get() { return JSON.stringify(validSigned); } },
        pubKeyRaw: pubJwk,
        forceFresh: true,
    });
    assert.equal(validEnv.buckets[1004].spectatorBetting, false);
    assert.equal(validEnv.signature, validSigned.signature);

    const tamperedSigned = structuredClone(validSigned);
    tamperedSigned.buckets[1004].paidPools = false;
    tamperedSigned.buckets[1001].maxWagerChips = 1;
    const rejectedEnv = await getServerConfigEnvelope({
        kv: { async get() { return JSON.stringify(tamperedSigned); } },
        pubKeyRaw: pubJwk,
        forceFresh: true,
    });
    assert.equal(rejectedEnv.signature, '');
    assert.equal(rejectedEnv.buckets[1004].paidPools, true);
});

test('assertFeatureEnabled enforces kill switches with 503', async () => {
    const ok = await assertFeatureEnabled('paidPools', DEFAULT_CONFIG_BUCKETS);
    assert.equal(ok.ok, true);

    const disabled = structuredClone(DEFAULT_CONFIG_BUCKETS);
    disabled[1004].paidPools = false;
    const blocked = await assertFeatureEnabled('paidPools', disabled);
    assert.equal(blocked.ok, false);
    if (!blocked.ok) {
        assert.equal(blocked.status, 503);
    }
});

test('fallback RPC transport exposes multiple endpoints and replaces bare http()', () => {
    assert.ok(BASE_SEPOLIA_RPC_FALLBACKS.length >= 2);
    assert.ok(BASE_MAINNET_RPC_FALLBACKS.length >= 2);
    const transport = createFallbackRpcTransport(84532);
    assert.equal(typeof transport, 'function');

    const root = process.cwd();
    const providers = readFileSync(join(root, 'app/Providers.tsx'), 'utf8');
    const poolAuth = readFileSync(join(root, 'lib/poolAuthority.ts'), 'utf8');
    const txSim = readFileSync(join(root, 'lib/txSimulator.ts'), 'utf8');
    assert.match(providers, /createFallbackRpcTransport/);
    assert.doesNotMatch(providers, /\[baseSepolia\.id\]:\s*http\(\)/);
    assert.match(poolAuth, /createFallbackRpcTransport/);
    assert.match(txSim, /createFallbackRpcTransport/);
});
