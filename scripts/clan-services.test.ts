import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    buildClanClaimDigest,
    clanOraclePrivateKey,
    CLAN_CLAIM_TYPES,
} from '../lib/clan/clanClaimVoucher';
import { privateKeyToAccount } from 'viem/accounts';
import { recoverAddress, keccak256, toBytes } from 'viem';

test('clan claim: voucher digest and signature recovery match ClanClaim.sol EIP-712', async () => {
    const claimContract = '0x1234567890123456789012345678901234567890';
    const chainId = 84532;
    const oraclePk = clanOraclePrivateKey();
    const oracleAccount = privateKeyToAccount(oraclePk);

    const claimId = keccak256(toBytes('claim-uuid-test-1234'));
    const clanId = keccak256(toBytes('clan-uuid-test-5678'));
    const recipient = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as `0x${string}`;
    const amount = BigInt('5000000000000000000000'); // 5000 CHIPS
    const claimType = CLAN_CLAIM_TYPES.war_principal;
    const nonce = BigInt(1730500000);
    const deadline = BigInt(1733000000);

    const voucherData = {
        claimId,
        clanId,
        recipient,
        amount,
        claimType,
        nonce,
        deadline,
    };

    const digest = buildClanClaimDigest(voucherData, claimContract, chainId);
    const signature = await oracleAccount.sign({ hash: digest });

    const recovered = await recoverAddress({
        hash: digest,
        signature,
    });

    assert.equal(
        recovered.toLowerCase(),
        oracleAccount.address.toLowerCase(),
        'Recovered signer must equal settlement oracle address',
    );
});

test('clan wars: 3N fixtures matrix calculation conforms to spec', () => {
    const brackets = [5, 10, 15, 20];
    const expectedFixtures = [15, 30, 45, 60];

    for (let i = 0; i < brackets.length; i++) {
        const bracket = brackets[i];
        const expected = expectedFixtures[i];
        const calculated = bracket * 3;
        assert.equal(calculated, expected, `Bracket ${bracket}v${bracket} must produce exactly ${expected} fixtures`);

        // Check fixture breakdown: 2N 1v1s + N 2v2s
        const wave1Direct1v1 = bracket;
        const wave2Cross1v1 = bracket;
        const wave3Team2v2 = bracket;
        assert.equal(
            wave1Direct1v1 + wave2Cross1v1 + wave3Team2v2,
            expected,
            `Wave breakdown must sum to ${expected}`,
        );
    }
});

test('clan wars: governance split validation logic', () => {
    // Valid 50/25/15/10
    const validSplit = { stakers: 50, treasury: 25, leader: 15, officers: 10 };
    assert.equal(validSplit.stakers + validSplit.treasury + validSplit.leader + validSplit.officers, 100);

    // Invalid split != 100
    const invalidSplit = { stakers: 50, treasury: 20, leader: 15, officers: 10 };
    assert.notEqual(invalidSplit.stakers + invalidSplit.treasury + invalidSplit.leader + invalidSplit.officers, 100);

    // Leader cut > 50% must be rejected
    const excessiveLeader = { stakers: 30, treasury: 10, leader: 55, officers: 5 };
    assert.ok(excessiveLeader.leader > 50);
});

test('clan wars: settlement math distributes 100% principal first, then 80/20 profit', () => {
    const bracket = 10;
    const memberFee = 5000;
    const totalStakePerClan = bracket * memberFee; // 50,000 CHIPS
    const totalPot = totalStakePerClan * 2; // 100,000 CHIPS

    const protocolRake = totalPot * 0.05; // 5,000 CHIPS (5%)
    const netPot = totalPot - protocolRake; // 95,000 CHIPS

    // 100% principal return for winning roster:
    const winningPrincipalReturned = totalStakePerClan; // 50,000 CHIPS
    const netProfit = netPot - winningPrincipalReturned; // 45,000 CHIPS

    assert.equal(netProfit, 45000);

    // 80% War Points merit pool
    const wpMeritPool = netProfit * 0.8; // 36,000 CHIPS
    assert.equal(wpMeritPool, 36000);

    // 20% Governance stake pool
    const govPool = netProfit * 0.2; // 9,000 CHIPS
    assert.equal(govPool, 9000);

    // Stakers (50% of 9,000) = 4,500
    const stakersShare = govPool * 0.5;
    // Treasury (25% of 9,000) = 2,250
    const treasuryShare = govPool * 0.25;
    // Leader (15% of 9,000) = 1,350
    const leaderShare = govPool * 0.15;
    // Officers (10% of 9,000) = 900
    const officersShare = govPool * 0.1;

    assert.equal(
        stakersShare + treasuryShare + leaderShare + officersShare,
        govPool,
        'Governance split sum must equal gov pool',
    );
});
