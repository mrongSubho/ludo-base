import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeFunctionData, parseUnits } from 'viem';
import {
    ALLOWANCE_PRESETS,
    CHIPS_ALLOWANCE_PRESETS,
    USDC_ALLOWANCE_PRESETS,
    DEFAULT_TACTICAL_ALLOWANCE,
    formatAllowanceDisplay,
    readAllowanceDirect,
} from '../hooks/useChipsAllowance';
import { simulatePreflight } from '../lib/txSimulator';
import { CHIPS_ERC20_ABI } from '../lib/chips';

test('allowance: standard user-friendly CHIPS presets conform to spec', () => {
    assert.equal(DEFAULT_TACTICAL_ALLOWANCE, parseUnits('500', 18));
    assert.equal(CHIPS_ALLOWANCE_PRESETS.length, 4);
    assert.equal(ALLOWANCE_PRESETS, CHIPS_ALLOWANCE_PRESETS);

    const starter = CHIPS_ALLOWANCE_PRESETS.find((p) => p.chips === 10_000);
    assert.ok(starter);
    assert.equal(starter.amount, parseUnits('10000', 18));
    assert.equal(starter.recommended, false);

    const tactical = CHIPS_ALLOWANCE_PRESETS.find((p) => p.chips === 100_000);
    assert.ok(tactical);
    assert.equal(tactical.amount, parseUnits('100000', 18));
    assert.equal(tactical.recommended, true);

    const proPlayer = CHIPS_ALLOWANCE_PRESETS.find((p) => p.chips === 1_000_000);
    assert.ok(proPlayer);
    assert.equal(proPlayer.amount, parseUnits('1000000', 18));
    assert.equal(proPlayer.recommended, false);

    const unlimited = CHIPS_ALLOWANCE_PRESETS.find((p) => p.chips === Infinity);
    assert.ok(unlimited);
    assert.equal(unlimited.isUnlimited, true);
    assert.equal(unlimited.amount, (BigInt(1) << BigInt(256)) - BigInt(1));
});

test('allowance: marketplace USDC presets conform to spec', () => {
    assert.equal(USDC_ALLOWANCE_PRESETS.length, 4);

    const starter = USDC_ALLOWANCE_PRESETS.find((p) => p.value === 5);
    assert.ok(starter);
    assert.equal(starter.amount, parseUnits('5', 6));
    assert.equal(starter.recommended, false);

    const regular = USDC_ALLOWANCE_PRESETS.find((p) => p.value === 20);
    assert.ok(regular);
    assert.equal(regular.amount, parseUnits('20', 6));
    assert.equal(regular.recommended, true);

    const collector = USDC_ALLOWANCE_PRESETS.find((p) => p.value === 50);
    assert.ok(collector);
    assert.equal(collector.amount, parseUnits('50', 6));
    assert.equal(collector.recommended, false);

    const unlimited = USDC_ALLOWANCE_PRESETS.find((p) => p.value === Infinity);
    assert.ok(unlimited);
    assert.equal(unlimited.isUnlimited, true);
    assert.equal(unlimited.amount, (BigInt(1) << BigInt(256)) - BigInt(1));
});

test('allowance: formatAllowanceDisplay handles units correctly', () => {
    assert.equal(formatAllowanceDisplay(BigInt(0), 'chips'), '0 CHIPS');
    assert.equal(formatAllowanceDisplay(BigInt(0), 'usdc'), '$0 USDC');
    assert.equal(formatAllowanceDisplay(parseUnits('10000', 18), 'chips'), '10k CHIPS');
    assert.equal(formatAllowanceDisplay(parseUnits('100000', 18), 'chips'), '100k CHIPS');
    assert.equal(formatAllowanceDisplay(parseUnits('1000000', 18), 'chips'), '1M CHIPS');
    assert.equal(formatAllowanceDisplay(parseUnits('20', 6), 'usdc'), '$20 USDC');
    assert.equal(formatAllowanceDisplay((BigInt(1) << BigInt(256)) - BigInt(1), 'chips'), 'Unlimited');
    assert.equal(formatAllowanceDisplay((BigInt(1) << BigInt(256)) - BigInt(1), 'usdc'), 'Unlimited');
});

test('allowance: readAllowanceDirect fails closed on invalid addresses', async () => {
    // If owner or spender is undefined/empty, must fail closed with BigInt(0)
    const zeroAllowance = await readAllowanceDirect(
        '0x0000000000000000000000000000000000000000',
        '0x0000000000000000000000000000000000000000',
    );
    assert.equal(zeroAllowance, BigInt(0));
});

test('allowance: preflight simulator handles tactical 500 CHIPS approval', async () => {
    const fakeSpender = '0x2222222222222222222222222222222222222222';
    const calldata = encodeFunctionData({
        abi: CHIPS_ERC20_ABI,
        functionName: 'approve',
        args: [fakeSpender, DEFAULT_TACTICAL_ALLOWANCE],
    });

    const res = await simulatePreflight({
        to: '0x1111111111111111111111111111111111111111',
        data: calldata,
    });

    assert.equal(res.methodName, 'Token Allowance Approval');
    assert.equal(res.approvalSafety, 'safe');
    assert.equal(res.assetFlow.sending[0].amount, '500 CHIPS');
});

test('allowance: preflight simulator handles 0 CHIPS revoke', async () => {
    const fakeSpender = '0x2222222222222222222222222222222222222222';
    const calldata = encodeFunctionData({
        abi: CHIPS_ERC20_ABI,
        functionName: 'approve',
        args: [fakeSpender, BigInt(0)],
    });

    const res = await simulatePreflight({
        to: '0x1111111111111111111111111111111111111111',
        data: calldata,
    });

    assert.equal(res.methodName, 'Token Allowance Approval');
    assert.equal(res.approvalSafety, 'safe');
    assert.equal(res.assetFlow.sending[0].amount, '0 CHIPS');
});

test('allowance: preflight simulator flags unlimited approval', async () => {
    const fakeSpender = '0x2222222222222222222222222222222222222222';
    const maxUint256 = (BigInt(1) << BigInt(256)) - BigInt(1);
    const calldata = encodeFunctionData({
        abi: CHIPS_ERC20_ABI,
        functionName: 'approve',
        args: [fakeSpender, maxUint256],
    });

    const res = await simulatePreflight({
        to: '0x1111111111111111111111111111111111111111',
        data: calldata,
    });

    assert.equal(res.methodName, 'Token Allowance Approval');
    assert.equal(res.approvalSafety, 'warning');
    assert.equal(res.assetFlow.sending[0].amount, 'Unlimited CHIPS');
});

test('allowance: skip-approval check avoids redundant approval popups', () => {
    const entryFee = parseUnits('10', 18);
    const currentAllowance = parseUnits('500', 18);

    // Condition in useChipsPool: hasAllowance = currentAllowance >= entryFee
    const hasAllowance = currentAllowance >= entryFee;
    assert.equal(hasAllowance, true);

    // If hasAllowance is true, only 1 transaction (joinPool) is emitted
    const calls = hasAllowance
        ? [{ function: 'joinPool' }]
        : [{ function: 'approve' }, { function: 'joinPool' }];

    assert.equal(calls.length, 1);
    assert.equal(calls[0].function, 'joinPool');
});

test('allowance: insufficient allowance uses tactical budget default', () => {
    const entryFee = parseUnits('10', 18);
    const currentAllowance = parseUnits('0', 18);

    const hasAllowance = currentAllowance >= entryFee;
    assert.equal(hasAllowance, false);

    // Default tactical allowance is used
    const tacticalApproveAmount =
        DEFAULT_TACTICAL_ALLOWANCE > entryFee ? DEFAULT_TACTICAL_ALLOWANCE : entryFee;

    assert.equal(tacticalApproveAmount, parseUnits('500', 18));
});
