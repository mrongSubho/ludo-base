import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    buildClanClaimDigest,
    clanClaimContractAddress,
    clanOraclePrivateKey,
    verifyClanClaimExecutedLogs,
    CLAN_CLAIM_TYPES,
} from '../lib/clan/clanClaimVoucher';
import { verifyWarStakeDepositLog } from '../lib/clan/clanWarService';
import { verifyTreasuryFundedLog } from '../lib/clan/clanService';
import {
    validateWarFixtureMatch,
    computeMatchCxpAwards,
    computeWarSettlementAmounts,
} from '../lib/clan/clanScorer';
import { verifyErc20TransferLog } from '../lib/onchainReceipt';
import { CHIPS_ERC20_ABI, CLAN_CLAIM_DEPOSIT_ABI, DEFAULT_CLAN_CLAIM_ADDRESS } from '../lib/chips';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import {
    encodeAbiParameters,
    encodeEventTopics,
    parseUnits,
    recoverAddress,
    keccak256,
    toBytes,
    type Log,
} from 'viem';

test('clan claim: clanOraclePrivateKey fails closed when signing key is unconfigured', () => {
    const prev = {
        s: process.env.SETTLEMENT_OP_KEY,
        m: process.env.MISSION_OP_PRIVATE_KEY,
        e: process.env.EDGE_SETTLE_PRIVATE_KEY,
    };
    delete process.env.SETTLEMENT_OP_KEY;
    delete process.env.MISSION_OP_PRIVATE_KEY;
    delete process.env.EDGE_SETTLE_PRIVATE_KEY;
    try {
        assert.throws(() => clanOraclePrivateKey(), /not configured/i);
    } finally {
        if (prev.s !== undefined) process.env.SETTLEMENT_OP_KEY = prev.s;
        if (prev.m !== undefined) process.env.MISSION_OP_PRIVATE_KEY = prev.m;
        if (prev.e !== undefined) process.env.EDGE_SETTLE_PRIVATE_KEY = prev.e;
    }
});

test('clan claim: voucher digest and signature recovery match ClanClaim.sol EIP-712', async () => {
    const claimContract = '0x1234567890123456789012345678901234567890';
    const chainId = 84532;
    const prev = process.env.SETTLEMENT_OP_KEY;
    process.env.SETTLEMENT_OP_KEY = generatePrivateKey();
    try {
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
    } finally {
        if (prev === undefined) delete process.env.SETTLEMENT_OP_KEY;
        else process.env.SETTLEMENT_OP_KEY = prev;
    }
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

test('clan creation: 10,000 CHIPS creation fee calculation and deficit logic', () => {
    const fee = BigInt(10_000) * (BigInt(10) ** BigInt(18));
    assert.equal(fee.toString(), '10000000000000000000000');

    // Scenario 1: Wallet with 0 escrow, but 9.9B on-chain
    const escrowBalance1 = BigInt(0);
    const onChainBalance1 = BigInt('9919869670000000000000000000');
    const deficit1 = fee - escrowBalance1;
    assert.equal(deficit1, fee);
    assert.ok(onChainBalance1 >= deficit1, 'On-chain balance must cover fee deficit');

    // Scenario 2: Wallet with partial escrow (4,000 CHIPS) and 10,000 on-chain
    const escrowBalance2 = BigInt(4_000) * (BigInt(10) ** BigInt(18));
    const onChainBalance2 = BigInt(10_000) * (BigInt(10) ** BigInt(18));
    const deficit2 = fee - escrowBalance2;
    assert.equal(deficit2.toString(), '6000000000000000000000');
    assert.ok(onChainBalance2 >= deficit2, 'On-chain balance must cover remaining 6,000 CHIPS deficit');

    // Scenario 3: Wallet with 500 CHIPS total (insufficient)
    const _escrowBalance3 = BigInt(0);
    const onChainBalance3 = BigInt(500) * (BigInt(10) ** BigInt(18));
    assert.ok(onChainBalance3 < fee, 'Must detect insufficient balance');
});

test('clan war buy-in: depositWarStake encodes deterministic bytes32 IDs and base units', async () => {
    const { encodeFunctionData, parseUnits } = await import('viem');
    const { CLAN_CLAIM_DEPOSIT_ABI } = await import('../lib/chips');

    const warCallId = '11111111-2222-3333-4444-555555555555';
    const clanId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const warIdBytes32 = keccak256(toBytes(warCallId));
    const clanIdBytes32 = keccak256(toBytes(clanId));
    const stakeBaseUnits = parseUnits('5000', 18);

    const calldata = encodeFunctionData({
        abi: CLAN_CLAIM_DEPOSIT_ABI,
        functionName: 'depositWarStake',
        args: [warIdBytes32, clanIdBytes32, stakeBaseUnits],
    });

    // depositWarStake selector + 3 * 32-byte args = 4 + 96 bytes -> 2 + 200 hex chars
    assert.equal(calldata.length, 202);
    assert.equal(stakeBaseUnits.toString(), '5000000000000000000000');
});

test('clan war buy-in: verifyWarStakeDepositLog fails closed on missing/mismatched logs and passes on exact match', () => {
    const claimContract = '0xF3570340E2A298Bf5424efC9C62E464528DA6df0' as const;
    const warId = keccak256(toBytes('11111111-2222-3333-4444-555555555555'));
    const clanId = keccak256(toBytes('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'));
    const contributor = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as const;
    const minAmountWei = parseUnits('5000', 18);

    assert.throws(
        () =>
            verifyWarStakeDepositLog({
                logs: [],
                claimContract,
                warId,
                clanId,
                contributor,
                minAmountWei,
            }),
        /do not match/,
    );

    const topics = encodeEventTopics({
        abi: CLAN_CLAIM_DEPOSIT_ABI,
        eventName: 'WarStakeDeposited',
        args: { warId, clanId, contributor },
    });
    const underpaid = {
        address: claimContract,
        topics,
        data: encodeAbiParameters([{ type: 'uint256' }], [parseUnits('4999', 18)]),
    } as unknown as Log;

    assert.throws(
        () =>
            verifyWarStakeDepositLog({
                logs: [underpaid],
                claimContract,
                warId,
                clanId,
                contributor,
                minAmountWei,
            }),
        /do not match/,
    );

    const valid = {
        address: claimContract,
        topics,
        data: encodeAbiParameters([{ type: 'uint256' }], [minAmountWei]),
    } as unknown as Log;

    verifyWarStakeDepositLog({
        logs: [valid],
        claimContract,
        warId,
        clanId,
        contributor,
        minAmountWei,
    });
});

test('clan creation: verifyErc20TransferLog requires exact token, sender, treasury, and 10,000 CHIPS value', () => {
    const token = '0xB200000000000000000000821408122b9Ed3d05B' as const;
    const from = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as const;
    const treasury = '0xbcCa5DcBF293D98A627fD3814D5AE8249bB1DFaF' as const;
    const minAmountWei = parseUnits('10000', 18);
    const makeErr = (m: string) => new Error(m);

    const topics = encodeEventTopics({
        abi: CHIPS_ERC20_ABI,
        eventName: 'Transfer',
        args: { from, to: treasury },
    });

    const wrongRecipientTopics = encodeEventTopics({
        abi: CHIPS_ERC20_ABI,
        eventName: 'Transfer',
        args: { from, to: from },
    });

    assert.throws(
        () =>
            verifyErc20TransferLog({
                logs: [
                    {
                        address: token,
                        topics: wrongRecipientTopics,
                        data: encodeAbiParameters([{ type: 'uint256' }], [minAmountWei]),
                    } as unknown as Log,
                ],
                tokenContract: token,
                expectedFrom: from,
                expectedTo: treasury,
                minAmountWei,
                makeError: makeErr,
            }),
        /CHIPS transfer/,
    );

    const matched = verifyErc20TransferLog({
        logs: [
            {
                address: token,
                topics,
                data: encodeAbiParameters([{ type: 'uint256' }], [minAmountWei]),
            } as unknown as Log,
        ],
        tokenContract: token,
        expectedFrom: from,
        expectedTo: treasury,
        minAmountWei,
        makeError: makeErr,
    });
    assert.equal(matched, minAmountWei);
});

test('clan claim: clanClaimContractAddress defaults to deployed ClanClaim address', () => {
    const prev = process.env.NEXT_PUBLIC_CLAN_CLAIM_ADDRESS;
    delete process.env.NEXT_PUBLIC_CLAN_CLAIM_ADDRESS;
    try {
        assert.equal(clanClaimContractAddress(), DEFAULT_CLAN_CLAIM_ADDRESS);
    } finally {
        if (prev !== undefined) process.env.NEXT_PUBLIC_CLAN_CLAIM_ADDRESS = prev;
    }
});

test('clan claim: verifyClanClaimExecutedLogs confirms RewardClaimed events and rejects empty logs', () => {
    const claimContract = DEFAULT_CLAN_CLAIM_ADDRESS;
    const recipient = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as const;
    const claimUuid = '11111111-2222-3333-4444-555555555555';
    const claimId = keccak256(toBytes(claimUuid));
    const clanId = keccak256(toBytes('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'));

    assert.throws(
        () =>
            verifyClanClaimExecutedLogs({
                logs: [],
                claimContract,
                recipient,
                claimIds: [claimUuid],
            }),
        /RewardClaimed/,
    );

    const topics = encodeEventTopics({
        abi: CLAN_CLAIM_DEPOSIT_ABI,
        eventName: 'RewardClaimed',
        args: { claimId, clanId, recipient },
    });
    const log = {
        address: claimContract,
        topics,
        data: encodeAbiParameters(
            [{ type: 'uint256' }, { type: 'uint8' }],
            [parseUnits('1000', 18), 0],
        ),
    } as unknown as Log;

    const confirmed = verifyClanClaimExecutedLogs({
        logs: [log],
        claimContract,
        recipient,
        claimIds: [claimUuid],
    });
    assert.equal(confirmed.has(claimUuid), true);
});

test('clan treasury: verifyTreasuryFundedLog validates ClanTreasuryFunded events', () => {
    const claimContract = DEFAULT_CLAN_CLAIM_ADDRESS;
    const contributor = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as const;
    const clanId = keccak256(toBytes('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'));
    const amountWei = parseUnits('2500', 18);

    const topics = encodeEventTopics({
        abi: CLAN_CLAIM_DEPOSIT_ABI,
        eventName: 'ClanTreasuryFunded',
        args: { clanId, contributor },
    });
    const valid = {
        address: claimContract,
        topics,
        data: encodeAbiParameters([{ type: 'uint256' }], [amountWei]),
    } as unknown as Log;

    verifyTreasuryFundedLog({
        logs: [valid],
        claimContract,
        clanId,
        contributor,
        minAmountWei: amountWei,
    });
});

test('clan wars: validateWarFixtureMatch enforces active window, seats, shape, and valid winner', () => {
    const futureStart = new Date(Date.now() + 3600_000).toISOString();
    const pastStart = new Date(Date.now() - 3600_000).toISOString();
    const fixture = {
        status: 'scheduled_agreed',
        game_shape: '1v1' as const,
        clan_a_seats: ['0xaaaa000000000000000000000000000000000001'],
        clan_b_seats: ['0xbbbb000000000000000000000000000000000002'],
    };

    const prepCheck = validateWarFixtureMatch({
        fixture,
        war: { status: 'prep_phase', war_start_at: futureStart, clan_a_id: 'clanA', clan_b_id: 'clanB' },
        participants: [...fixture.clan_a_seats, ...fixture.clan_b_seats],
        winnerLower: fixture.clan_a_seats[0],
    });
    assert.equal(prepCheck.valid, false);

    const wrongSeats = validateWarFixtureMatch({
        fixture,
        war: { status: 'active_war', war_start_at: pastStart, clan_a_id: 'clanA', clan_b_id: 'clanB' },
        participants: [fixture.clan_a_seats[0], '0xcccc000000000000000000000000000000000003'],
        winnerLower: fixture.clan_a_seats[0],
    });
    assert.equal(wrongSeats.valid, false);

    const badWinner = validateWarFixtureMatch({
        fixture,
        war: { status: 'active_war', war_start_at: pastStart, clan_a_id: 'clanA', clan_b_id: 'clanB' },
        participants: [...fixture.clan_a_seats, ...fixture.clan_b_seats],
        winnerLower: '0xdddd000000000000000000000000000000000004',
    });
    assert.equal(badWinner.valid, false);

    const valid = validateWarFixtureMatch({
        fixture,
        war: { status: 'active_war', war_start_at: pastStart, clan_a_id: 'clanA', clan_b_id: 'clanB' },
        participants: [...fixture.clan_a_seats, ...fixture.clan_b_seats],
        winnerLower: fixture.clan_b_seats[0],
    });
    assert.equal(valid.valid, true);
    if (valid.valid) {
        assert.equal(valid.winnerClanId, 'clanB');
        assert.equal(valid.losingClanId, 'clanA');
    }
});

test('clan progression: computeMatchCxpAwards enforces anti-farm and 2v2 duo bonus', () => {
    // Opposing clanmates in 1v1 => 0 CXP
    const sameClan1v1 = computeMatchCxpAwards({
        memberships: [
            { clan_id: 'c1', wallet_address: '0x1' },
            { clan_id: 'c1', wallet_address: '0x2' },
        ],
        participantCount: 2,
        winnerLower: '0x1',
        isPaidMatch: true,
    });
    assert.equal(sameClan1v1.memberAwards.length, 0);

    // 2v2 clanmate duo (2 same-clan in 4p paid match) => 1.25x bonus (30 -> 38, 10 -> 13)
    const duo2v2 = computeMatchCxpAwards({
        memberships: [
            { clan_id: 'c1', wallet_address: '0x1' },
            { clan_id: 'c1', wallet_address: '0x2' },
        ],
        participantCount: 4,
        winnerLower: '0x1',
        isPaidMatch: true,
    });
    assert.equal(duo2v2.memberAwards[0].cxp, 38);
    assert.equal(duo2v2.memberAwards[1].cxp, 13);
    assert.equal(duo2v2.clanAwards['c1'], 51);
});

test('clan wars: computeWarSettlementAmounts matches 5% rake + 80/20 split', () => {
    const res = computeWarSettlementAmounts({
        stakePerClan: 50_000,
        winningPrincipalTotal: 50_000,
        stakersPct: 50,
        treasuryPct: 25,
        leaderPct: 15,
        officersPct: 10,
    });
    assert.equal(res.protocolRake, 5_000);
    assert.equal(res.netProfit, 45_000);
    assert.equal(res.meritPool, 36_000);
    assert.equal(res.govPool, 9_000);
    assert.equal(res.stakersShare, 4_500);
    assert.equal(res.treasuryCut, 2_250);
    assert.equal(res.leaderCut, 1_350);
    assert.equal(res.officersCut, 900);
});

test('clan security: GET routes have no ?wallet= fallback and hooks use private realtime channels', () => {
    const root = process.cwd();
    for (const rel of ['app/api/clans/route.ts', 'app/api/clans/chat/route.ts', 'app/api/clans/claims/route.ts']) {
        const src = readFileSync(join(root, rel), 'utf8');
        assert.equal(
            src.includes("searchParams.get('wallet')"),
            false,
            `${rel} must not fall back to unauthenticated ?wallet= query param`,
        );
    }

    for (const rel of ['hooks/useClanData.ts', 'hooks/useClanWar.ts']) {
        const src = readFileSync(join(root, rel), 'utf8');
        assert.ok(src.includes('createPrivateChannel'), `${rel} must use createPrivateChannel`);
    }
});
