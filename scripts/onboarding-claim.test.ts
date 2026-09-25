/**
 * Onboarding claim + Galxe HMAC unit tests (node --test).
 * Run: npx tsx --test scripts/onboarding-claim.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import {
    checkTrackClaimable,
    checkWelcomeGrantClaimable,
    isCorePackageComplete,
    normalizeReferralCode,
    referralCodeFor,
    referralTierForSuccessOrder,
    verifyGalxeHmac,
    ONBOARDING_TRACKS,
} from '../lib/onboardingServer';

const SECRET = 'test-galxe-secret';
const BODY = JSON.stringify({ event: 'quest_completed', walletAddress: '0xabc', track: 'social', delta: 1 });

function signHex(body: string, secret: string): string {
    return createHmac('sha256', secret).update(body, 'utf8').digest('hex');
}

function signBase64(body: string, secret: string): string {
    return createHmac('sha256', secret).update(body, 'utf8').digest('base64');
}

test('verifyGalxeHmac accepts hex and base64 digests of the raw body', () => {
    assert.equal(verifyGalxeHmac(BODY, signHex(BODY, SECRET), SECRET), true);
    assert.equal(verifyGalxeHmac(BODY, signBase64(BODY, SECRET), SECRET), true);
    assert.equal(verifyGalxeHmac(BODY, `sha256=${signHex(BODY, SECRET)}`, SECRET), true);
});

test('verifyGalxeHmac fails closed on bad secret, bad body, or missing header', () => {
    assert.equal(verifyGalxeHmac(BODY, signHex(BODY, 'other-secret'), SECRET), false);
    assert.equal(verifyGalxeHmac(`${BODY} `, signHex(BODY, SECRET), SECRET), false);
    assert.equal(verifyGalxeHmac(BODY, signHex(BODY, SECRET), ''), false);
    assert.equal(verifyGalxeHmac(BODY, null, SECRET), false);
    assert.equal(verifyGalxeHmac(BODY, 'not-a-signature', SECRET), false);
    assert.equal(verifyGalxeHmac('', signHex('', SECRET), SECRET), false);
});

test('checkTrackClaimable refuses double-claim via is_claimed', () => {
    const done = { progress: 1, target: 1, is_claimed: true };
    const first = checkTrackClaimable('tutorial', done, true);
    assert.equal(first.ok, false);
    assert.equal(first.ok === false && first.status, 400);
    assert.equal(first.ok === false && first.error, 'Already claimed');
});

test('checkTrackClaimable refuses incomplete tracks and locks extended behind core', () => {
    const incomplete = { progress: 0, target: 1, is_claimed: false };
    const a = checkTrackClaimable('pvp', incomplete, true);
    assert.equal(a.ok, false);
    assert.equal(a.ok === false && a.error, 'Mission not completed');

    const readyExtended = { progress: 10, target: 10, is_claimed: false };
    const locked = checkTrackClaimable('friend_dm', readyExtended, false);
    assert.equal(locked.ok, false);
    assert.equal(locked.ok === false && locked.status, 403);

    const open = checkTrackClaimable('friend_dm', readyExtended, true);
    assert.equal(open.ok, true);
});

test('checkTrackClaimable allows first claim of a completed track', () => {
    const row = { progress: ONBOARDING_TRACKS.playtime.target, target: ONBOARDING_TRACKS.playtime.target, is_claimed: false };
    assert.equal(checkTrackClaimable('playtime', row, true).ok, true);
    assert.equal(checkTrackClaimable('nope', row, true).ok, false);
});

test('welcome grant is one-time', () => {
    assert.equal(checkWelcomeGrantClaimable(false).ok, true);
    const again = checkWelcomeGrantClaimable(true);
    assert.equal(again.ok, false);
    assert.equal(again.ok === false && again.error, 'Already claimed');
});

test('core package completeness and referral helpers', () => {
    const coreTracks = Object.keys(ONBOARDING_TRACKS).filter((k) => ONBOARDING_TRACKS[k as keyof typeof ONBOARDING_TRACKS].core);
    const allClaimed = coreTracks.map((track) => ({ track, is_claimed: true }));
    assert.equal(isCorePackageComplete(allClaimed), true);
    assert.equal(isCorePackageComplete(allClaimed.slice(1)), false);

    assert.equal(referralCodeFor('0xABCDEF1234567890'), 'abcdef12');
    assert.deepEqual(normalizeReferralCode('0xABCDEF1234567890ABCDEF1234567890ABCDEF12'), {
        kind: 'wallet',
        wallet: '0xabcdef1234567890abcdef1234567890abcdef12',
    });
    assert.deepEqual(normalizeReferralCode('abcdef12'), { kind: 'code', code: 'abcdef12' });
    assert.equal(normalizeReferralCode('!!!'), null);

    assert.equal(referralTierForSuccessOrder(0), 50);
    assert.equal(referralTierForSuccessOrder(9), 50);
    assert.equal(referralTierForSuccessOrder(10), 10);
});

test('aiTrackForGameMode maps classic/power/snakes and ignores pvp', async () => {
    const { aiTrackForGameMode } = await import('../lib/onboardingProgressWriter');
    assert.equal(aiTrackForGameMode('classic'), 'ai_classic');
    assert.equal(aiTrackForGameMode('power'), 'ai_power');
    assert.equal(aiTrackForGameMode('snakes'), 'ai_snakes');
    assert.equal(aiTrackForGameMode('ranked'), null);
    assert.equal(aiTrackForGameMode(null), null);
});
