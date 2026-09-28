/**
 * Chain gate tests (node --test). Run: npm test
 * App is **Base Sepolia only** (84532) until mainnet launch — 8453 is
 * rejected everywhere. Offline via the EOA ecrecover fast path.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import {
    parseChainId,
    isSupportedChainId,
    extractMessageChainId,
    DEFAULT_CHAIN_ID,
} from '../lib/chains';
import { buildSiweMessage, buildSessionDomain } from '../lib/sessionProof';
import { verifyPersonalSign } from '../lib/walletVerify';

test('parseChainId allowlists exactly 84532 (Base Sepolia only)', () => {
    assert.equal(parseChainId(84532), 84532);
    assert.equal(parseChainId('84532'), 84532);
    assert.equal(parseChainId(8453), null);
    assert.equal(parseChainId(1), null);
    assert.equal(parseChainId(9999), null);
    assert.equal(parseChainId(undefined), null);
    assert.equal(parseChainId('mainnet'), null);
    assert.equal(isSupportedChainId(84532), true);
    assert.equal(isSupportedChainId(8453), false);
    assert.equal(isSupportedChainId(1), false);
    assert.equal(DEFAULT_CHAIN_ID, 84532);
});

test('buildSiweMessage renders the requested chain and rejects others', () => {
    const base = {
        domain: 'localhost:3000',
        address: '0x1234567890123456789012345678901234567890',
        issuedAt: new Date().toISOString(),
        expirationTime: new Date(Date.now() + 1000).toISOString(),
        nonce: 'n',
    };
    assert.match(buildSiweMessage(base), /Chain ID: 84532/);
    assert.match(buildSiweMessage({ ...base, chainId: 84532 }), /Chain ID: 84532/);
    assert.throws(() => buildSiweMessage({ ...base, chainId: 8453 }), /Unsupported signing chain/);
    assert.throws(() => buildSiweMessage({ ...base, chainId: 1 }), /Unsupported signing chain/);
});

test('buildSessionDomain is Sepolia-only and throws off-allowlist', () => {
    assert.equal(buildSessionDomain(84532).chainId, 84532);
    assert.throws(() => buildSessionDomain(8453), /Unsupported signing chain/);
    assert.throws(() => buildSessionDomain(1), /Unsupported signing chain/);
});

test('extractMessageChainId parses the Chain ID line', () => {
    assert.equal(extractMessageChainId('hello\nChain ID: 84532\nbye'), 84532);
    assert.equal(extractMessageChainId('no chain here'), null);
});

test('Sepolia SIWE signature verifies on 84532 and fails on 8453', async () => {
    const acct = privateKeyToAccount(generatePrivateKey());
    const issuedAt = new Date().toISOString();
    const expirationTime = new Date(Date.now() + 60_000).toISOString();
    const msg = buildSiweMessage({
        domain: 'localhost:3000',
        address: acct.address,
        issuedAt,
        expirationTime,
        nonce: 'chain-gate-sepolia',
        chainId: 84532,
    });
    const signature = await acct.signMessage({ message: msg });

    const okSepolia = await verifyPersonalSign({ address: acct.address, message: msg, signature, chainId: 84532 });
    assert.equal(okSepolia.ok, true, 'Sepolia sig must verify on Sepolia');

    const replayMainnet = await verifyPersonalSign({ address: acct.address, message: msg, signature, chainId: 8453 });
    assert.equal(replayMainnet.ok, false, 'Sepolia sig must NOT verify as mainnet');

    const inferred = await verifyPersonalSign({ address: acct.address, message: msg, signature });
    assert.equal(inferred.ok, true, 'chain inferred from message text must verify');
});

test('mainnet chain is rejected (not launched)', async () => {
    const acct = privateKeyToAccount(generatePrivateKey());
    // Message tagged mainnet — chain gate must refuse the expected chain id.
    const msg = buildSiweMessage({
        domain: 'localhost:3000',
        address: acct.address,
        issuedAt: new Date().toISOString(),
        expirationTime: new Date(Date.now() + 60_000).toISOString(),
        nonce: 'chain-gate-mainnet',
        chainId: 84532, // only builder-accepted chain
    });
    const signature = await acct.signMessage({ message: msg });

    const onMainnet = await verifyPersonalSign({ address: acct.address, message: msg, signature, chainId: 8453 });
    assert.equal(onMainnet.ok, false, 'mainnet expected-chain must be rejected');
});

test('unsupported explicit chain fails closed', async () => {
    const acct = privateKeyToAccount(generatePrivateKey());
    const msg = buildSiweMessage({
        domain: 'localhost:3000',
        address: acct.address,
        issuedAt: new Date().toISOString(),
        expirationTime: new Date(Date.now() + 60_000).toISOString(),
        nonce: 'chain-gate-bad',
    });
    const signature = await acct.signMessage({ message: msg });
    const bad = await verifyPersonalSign({ address: acct.address, message: msg, signature, chainId: 1 });
    assert.equal(bad.ok, false, 'chain 1 must fail closed');
});
