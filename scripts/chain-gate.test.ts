/**
 * Dual-chain gate tests (node --test). Run: npm test
 * Proves Sepolia (84532) signatures verify on 84532 and FAIL on 8453
 * (cross-chain replay protection), and vice versa — offline via the EOA
 * ecrecover fast path (no RPC needed).
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

test('parseChainId allowlists exactly 84532 and 8453', () => {
    assert.equal(parseChainId(84532), 84532);
    assert.equal(parseChainId(8453), 8453);
    assert.equal(parseChainId('84532'), 84532);
    assert.equal(parseChainId(1), null);
    assert.equal(parseChainId(9999), null);
    assert.equal(parseChainId(undefined), null);
    assert.equal(parseChainId('mainnet'), null);
    assert.equal(isSupportedChainId(84532), true);
    assert.equal(isSupportedChainId(1), false);
    assert.equal(DEFAULT_CHAIN_ID, 8453);
});

test('buildSiweMessage renders the requested chain and rejects others', () => {
    const base = {
        domain: 'localhost:3000',
        address: '0x1234567890123456789012345678901234567890',
        issuedAt: new Date().toISOString(),
        expirationTime: new Date(Date.now() + 1000).toISOString(),
        nonce: 'n',
    };
    assert.match(buildSiweMessage(base), /Chain ID: 8453/);
    assert.match(buildSiweMessage({ ...base, chainId: 84532 }), /Chain ID: 84532/);
    assert.throws(() => buildSiweMessage({ ...base, chainId: 1 }), /Unsupported signing chain/);
});

test('buildSessionDomain is per-chain and throws off-allowlist', () => {
    assert.equal(buildSessionDomain(84532).chainId, 84532);
    assert.equal(buildSessionDomain(8453).chainId, 8453);
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

test('mainnet SIWE signature fails on Sepolia', async () => {
    const acct = privateKeyToAccount(generatePrivateKey());
    const msg = buildSiweMessage({
        domain: 'localhost:3000',
        address: acct.address,
        issuedAt: new Date().toISOString(),
        expirationTime: new Date(Date.now() + 60_000).toISOString(),
        nonce: 'chain-gate-mainnet',
    });
    const signature = await acct.signMessage({ message: msg });

    const okMainnet = await verifyPersonalSign({ address: acct.address, message: msg, signature, chainId: 8453 });
    assert.equal(okMainnet.ok, true, 'mainnet sig must verify on mainnet');

    const replaySepolia = await verifyPersonalSign({ address: acct.address, message: msg, signature, chainId: 84532 });
    assert.equal(replaySepolia.ok, false, 'mainnet sig must NOT verify as Sepolia');
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
