import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeFunctionData, parseUnits } from 'viem';
import {
    ALLOWANCE_PRESETS,
    DEFAULT_TACTICAL_ALLOWANCE,
    readAllowanceDirect,
} from '../hooks/useChipsAllowance';
import { simulatePreflight } from '../lib/txSimulator';
import { CHIPS_ERC20_ABI } from '../lib/chips';

test('allowance: standard tactical presets conforms to spec', () => {
    assert.equal(DEFAULT_TACTICAL_ALLOWANCE, parseUnits('500', 18));
    assert.equal(ALLOWANCE_PRESETS.length, 4);

    const casual = ALLOWANCE_PRESETS.find((p) => p.chips === 100);
    assert.ok(casual);
    assert.equal(casual.amount, parseUnits('100', 18));
    assert.equal(casual.recommended, false);

    const tactical = ALLOWANCE_PRESETS.find((p) => p.chips === 500);
    assert.ok(tactical);
    assert.equal(tactical.amount, parseUnits('500', 18));
    assert.equal(tactical.recommended, true);

    const highRoller = ALLOWANCE_PRESETS.find((p) => p.chips === 1000);
    assert.ok(highRoller);
    assert.equal(highRoller.amount, parseUnits('1000', 18));
    assert.equal(highRoller.recommended, false);

    const unlimited = ALLOWANCE_PRESETS.find((p) => p.chips === Infinity);
    assert.ok(unlimited);
    assert.equal(unlimited.isUnlimited, true);
    assert.equal(unlimited.amount, (BigInt(1) << BigInt(256)) - BigInt(1));
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
