import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    extractCountryCode,
    isBlockedCountry,
    isEuDmaCountry,
    requirePaidPlayCompliance,
} from '../lib/compliance';
import { DEFAULT_CONFIG_BUCKETS } from '../lib/configRegistry';

test('compliance geo and EU/DMA checks behave deterministically', async () => {
    const kpReq = new Request('https://arena.example/api/vault', {
        headers: { 'cf-ipcountry': 'kp' },
    });
    assert.equal(extractCountryCode(kpReq), 'KP');
    assert.equal(isBlockedCountry('KP', DEFAULT_CONFIG_BUCKETS), true);
    assert.equal(isEuDmaCountry('DE', DEFAULT_CONFIG_BUCKETS), true);
    assert.equal(isEuDmaCountry('NO', DEFAULT_CONFIG_BUCKETS), true);
    assert.equal(isEuDmaCountry('US', DEFAULT_CONFIG_BUCKETS), false);

    const kpVerdict = await requirePaidPlayCompliance(kpReq, '', 'paidPools', DEFAULT_CONFIG_BUCKETS);
    assert.equal(kpVerdict.ok, false);
    if (!kpVerdict.ok) {
        assert.equal(kpVerdict.status, 451);
        assert.equal(kpVerdict.code, 'GEO_RESTRICTED');
    }

    const disabledCfg = structuredClone(DEFAULT_CONFIG_BUCKETS);
    disabledCfg[1004].spectatorBetting = false;
    const usReq = new Request('https://arena.example/api/spectator-bets', {
        headers: { 'cf-ipcountry': 'US' },
    });
    const flagVerdict = await requirePaidPlayCompliance(usReq, '', 'spectatorBetting', disabledCfg);
    assert.equal(flagVerdict.ok, false);
    if (!flagVerdict.ok) {
        assert.equal(flagVerdict.status, 503);
        assert.equal(flagVerdict.code, 'FEATURE_DISABLED');
    }

    const noConsentVerdict = await requirePaidPlayCompliance(usReq, '', 'paidPools', DEFAULT_CONFIG_BUCKETS);
    assert.equal(noConsentVerdict.ok, false);
    if (!noConsentVerdict.ok) {
        assert.equal(noConsentVerdict.status, 403);
        assert.equal(noConsentVerdict.code, 'COMPLIANCE_REQUIRED');
        assert.ok(noConsentVerdict.missing?.includes('age_18'));
        assert.ok(noConsentVerdict.missing?.includes('tos'));
    }

    const euNoAckVerdict = await requirePaidPlayCompliance(
        new Request('https://arena.example/api/vault', { headers: { 'cf-ipcountry': 'FR' } }),
        '',
        'arenaVaultDeposits',
        DEFAULT_CONFIG_BUCKETS,
    );
    assert.equal(euNoAckVerdict.ok, false);
    if (!euNoAckVerdict.ok) {
        assert.ok(euNoAckVerdict.missing?.includes('eu_dma'));
    }
});

test('compliance source invariants: entry actions gated, exit actions never blocked, consent opt-in only', () => {
    const root = process.cwd();
    const vaultSrc = readFileSync(join(root, 'app/api/vault/route.ts'), 'utf8');
    assert.match(
        vaultSrc,
        /action === 'deposit' \|\| action === 'reserve' \|\| action === 'roll_prize'[\s\S]*requirePaidPlayCompliance/,
    );
    const withdrawSection = vaultSrc.slice(vaultSrc.indexOf("action === 'withdraw'"), vaultSrc.indexOf("action === 'roll_prize'"));
    assert.doesNotMatch(withdrawSection, /requirePaidPlayCompliance/);

    const betsSrc = readFileSync(join(root, 'app/api/spectator-bets/route.ts'), 'utf8');
    const cashOutIdx = betsSrc.indexOf("action === 'cash_out'");
    const complianceIdx = betsSrc.lastIndexOf('requirePaidPlayCompliance(request');
    assert.ok(cashOutIdx > 0 && complianceIdx > cashOutIdx, 'cash_out must execute before compliance gate');

    const joinSrc = readFileSync(join(root, 'app/api/matchmaking/join/route.ts'), 'utf8');
    assert.match(joinSrc, /if \(effectiveWager > 0\)[\s\S]*requirePaidPlayCompliance/);

    const warBuyinSrc = readFileSync(join(root, 'app/api/clans/war/buyin/route.ts'), 'utf8');
    assert.match(warBuyinSrc, /requirePaidPlayCompliance\(request,\s*authed,\s*'clanWars'\)/);

    const cardSrc = readFileSync(join(root, 'app/components/WalletConnectCard.tsx'), 'utf8');
    assert.match(cardSrc, /useState\(false\)/);
    assert.doesNotMatch(cardSrc, /\[agreed,\s*setAgreed\]\s*=\s*useState\(true\)/);

    const providersSrc = readFileSync(join(root, 'app/Providers.tsx'), 'utf8');
    assert.match(providersSrc, /hasAnalyticsConsent\(\)/);
    assert.match(providersSrc, /onAnalyticsConsentChange/);
});
