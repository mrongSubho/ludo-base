import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { formatCompactChips, computeTotalChipsBreakdown } from '../lib/chips';

const WEI = BigInt('1000000000000000000');

function readRepoFile(relPath: string): string {
    return fs.readFileSync(path.resolve(process.cwd(), relPath), 'utf8');
}

test('formatCompactChips: formats zero, whole numbers, k/M/B truncation, and invalid values', () => {
    assert.equal(formatCompactChips(0), '0');
    assert.equal(formatCompactChips(42), '42');
    assert.equal(formatCompactChips(999), '999');
    assert.equal(formatCompactChips(1_000), '1k');
    assert.equal(formatCompactChips(1_100), '1.1k');
    assert.equal(formatCompactChips(1_190), '1.19k');
    assert.equal(formatCompactChips(1_199), '1.19k');
    assert.equal(formatCompactChips(999_999), '999.99k');
    assert.equal(formatCompactChips(1_000_000), '1M');
    assert.equal(formatCompactChips(3_920_000), '3.92M');
    assert.equal(formatCompactChips(3_929_999), '3.92M');
    assert.equal(formatCompactChips(1_500_000_000), '1.5B');

    assert.equal(formatCompactChips(null), '0');
    assert.equal(formatCompactChips(undefined), '0');
    assert.equal(formatCompactChips(-500), '0');
    assert.equal(formatCompactChips(Number.NaN), '0');
    assert.equal(formatCompactChips(Number.POSITIVE_INFINITY), '0');
});

test('formatCompactChips: converts 18-decimal bigint wei balances accurately', () => {
    assert.equal(formatCompactChips(BigInt(0)), '0');
    assert.equal(formatCompactChips(BigInt(-10) * WEI), '0');
    assert.equal(formatCompactChips(BigInt(999) * WEI), '999');
    assert.equal(formatCompactChips(BigInt(1_000) * WEI), '1k');
    assert.equal(formatCompactChips(BigInt(1_199) * WEI), '1.19k');
    assert.equal(formatCompactChips(BigInt(3_929_999) * WEI), '3.92M');
    assert.equal(formatCompactChips(BigInt(1_500_000_000) * WEI), '1.5B');
});

test('computeTotalChipsBreakdown: sums disjoint wallet, vaults, unclaimed rewards, and escrow without double counting', () => {
    const breakdown = computeTotalChipsBreakdown({
        walletChips: 500,
        vaultAvailableChips: 300,
        vaultReservedChips: 200,
        vaultClaimableChips: 100,
        clanClaimableChips: 50,
        legacyClaimableChips: 40,
        escrowChips: 10,
    });

    assert.equal(breakdown.walletChips, 500);
    assert.equal(breakdown.vaultAvailableChips, 300);
    assert.equal(breakdown.vaultReservedChips, 200);
    assert.equal(breakdown.vaultTotalChips, 500);
    assert.equal(breakdown.vaultClaimableChips, 100);
    assert.equal(breakdown.clanClaimableChips, 50);
    assert.equal(breakdown.legacyClaimableChips, 40);
    assert.equal(breakdown.unclaimedChips, 190);
    assert.equal(breakdown.escrowChips, 10);
    assert.equal(breakdown.totalChips, 1200);
    assert.equal(breakdown.totalFormatted, '1.2k');
});

test('computeTotalChipsBreakdown: sanitizes negative and non-finite inputs', () => {
    const breakdown = computeTotalChipsBreakdown({
        walletChips: -100,
        vaultAvailableChips: Number.NaN,
        vaultReservedChips: Number.POSITIVE_INFINITY,
        vaultClaimableChips: 1_199,
        clanClaimableChips: -5,
        legacyClaimableChips: 0,
        escrowChips: Number.NEGATIVE_INFINITY,
    });

    assert.equal(breakdown.walletChips, 0);
    assert.equal(breakdown.vaultAvailableChips, 0);
    assert.equal(breakdown.vaultReservedChips, 0);
    assert.equal(breakdown.vaultTotalChips, 0);
    assert.equal(breakdown.vaultClaimableChips, 1_199);
    assert.equal(breakdown.clanClaimableChips, 0);
    assert.equal(breakdown.legacyClaimableChips, 0);
    assert.equal(breakdown.unclaimedChips, 1_199);
    assert.equal(breakdown.escrowChips, 0);
    assert.equal(breakdown.totalChips, 1_199);
    assert.equal(breakdown.totalFormatted, '1.19k');
});

test('HeaderNavPanel & BoardHeaderCompact: render compact grand-total CHIPS without extra CHIPS/COINS sub-label', () => {
    const headerSrc = readRepoFile('app/components/HeaderNavPanel.tsx');
    assert.match(headerSrc, /useTotalChips/);
    assert.match(headerSrc, /formatCompactChips/);
    assert.doesNotMatch(headerSrc, />\s*(CHIPS|COINS)\s*<\/span>/);

    const compactSrc = readRepoFile('app/components/BoardHeaderCompact.tsx');
    assert.match(compactSrc, /useTotalChips/);
    assert.match(compactSrc, /formatCompactChips/);
});

test('WalletPanel: separates CHIPS breakdown buckets and keeps USD portfolio total USDC-only', () => {
    const walletSrc = readRepoFile('app/components/WalletPanel.tsx');
    assert.match(walletSrc, /useTotalChips/);
    assert.match(walletSrc, /formatCompactChips/);
    assert.match(walletSrc, /CHIPS Breakdown/);
    assert.match(walletSrc, /In Wallet/);
    assert.match(walletSrc, /Arena Match Vault/);
    assert.match(walletSrc, /Locked in Match/);
    assert.match(walletSrc, /Unclaimed Rewards/);
    assert.match(walletSrc, /Marketplace Escrow/);
    assert.match(walletSrc, /formatUnits\(usdc \?\? BigInt\(0\), 6\)/);
});
