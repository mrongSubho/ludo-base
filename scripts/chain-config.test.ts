import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chipsAddress, claimHubAddress, matchPoolAddress } from '../lib/chips';
import { liveInventory } from '../lib/engine/core';

test('CHAIN-05: matchPoolAddress / chipsAddress fail closed on malformed or invalid addresses', () => {
    const origPool = process.env.NEXT_PUBLIC_MATCH_POOL_ADDRESS;
    const origChips = process.env.NEXT_PUBLIC_CHIPS_ADDRESS;

    try {
        // 1. Invalid address formats: must fail closed and return undefined
        process.env.NEXT_PUBLIC_MATCH_POOL_ADDRESS = '0x123'; // too short
        assert.equal(matchPoolAddress(), undefined, 'short hex must fail closed');

        process.env.NEXT_PUBLIC_MATCH_POOL_ADDRESS = 'not_an_address';
        assert.equal(matchPoolAddress(), undefined, 'non-hex must fail closed');

        // 2. Valid 20-byte address: must return checksummed address
        const validAddr = '0x0000000000000000000000000000000000000001';
        process.env.NEXT_PUBLIC_MATCH_POOL_ADDRESS = validAddr;
        assert.equal(matchPoolAddress(), validAddr);

        // 3. Lowercase address gets EIP-55 checksummed
        const mixedAddr = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed';
        process.env.NEXT_PUBLIC_CHIPS_ADDRESS = mixedAddr.toLowerCase();
        assert.equal(chipsAddress(), mixedAddr, 'must normalize to EIP-55 checksum');
    } finally {
        process.env.NEXT_PUBLIC_MATCH_POOL_ADDRESS = origPool;
        process.env.NEXT_PUBLIC_CHIPS_ADDRESS = origChips;
    }
});

test('PW-5: liveInventory filters expired items based on timestamp', () => {
    const mockState = {
        playerPowers: {
            green: [
                { type: 'boost' as const, expiresAt: 1000 },
                { type: 'shield' as const, expiresAt: 2000 },
            ],
        },
    };

    // At t=500: both powers are live
    const invAt500 = liveInventory(mockState as any, 'green', 500);
    assert.equal(invAt500.length, 2);

    // At t=1500: boost expired, shield live
    const invAt1500 = liveInventory(mockState as any, 'green', 1500);
    assert.equal(invAt1500.length, 1);
    assert.equal(invAt1500[0].type, 'shield');

    // At t=2500: both expired
    const invAt2500 = liveInventory(mockState as any, 'green', 2500);
    assert.equal(invAt2500.length, 0);
});
