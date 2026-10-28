import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeFunctionData, parseUnits, parseEther } from 'viem';
import {
    simulatePreflight,
} from '../lib/txSimulator';
import { MISSION_SYSTEM_ABI } from '../lib/missionSystem';
import { CHIPS_ERC20_ABI, MATCH_POOL_ABI } from '../lib/chips';
import {
    isAuthPromptOpen,
    getAuthPromptState,
    hideAuthPrompt,
} from '../hooks/useAuthPrompt';
import { wrapEip1193Provider, type Eip1193Provider } from '../lib/walletGuard';

test('preflight: decodes native ETH transfer without calldata', async () => {
    const res = await simulatePreflight({
        to: '0x1111111111111111111111111111111111111111',
        value: parseEther('0.05'),
    });

    assert.equal(res.methodName, 'Native ETH Transfer');
    assert.equal(res.assetFlow.sending[0].amount, '0.05 ETH');
    assert.equal(res.assetFlow.receiving[0].amount, 'Payment Received');
});

test('preflight: decodes mission claim call correctly', async () => {
    const fakeMissionId = '0x1234567890123456789012345678901234567890123456789012345678901234' as `0x${string}`;
    const data = encodeFunctionData({
        abi: MISSION_SYSTEM_ABI,
        functionName: 'claimMission',
        args: [fakeMissionId],
    });

    const res = await simulatePreflight({
        to: '0x1111111111111111111111111111111111111111',
        data,
    });

    assert.equal(res.methodName, 'Claim Mission Reward');
    assert.equal(res.assetFlow.receiving[0].label, 'Mission Payout');
    assert.equal(res.assetFlow.receiving[0].amount, '+Reward CHIPS');
});

test('preflight: flags unlimited ERC-20 approval with caution warning', async () => {
    const maxUint256 = (BigInt(1) << BigInt(256)) - BigInt(1);
    const data = encodeFunctionData({
        abi: CHIPS_ERC20_ABI,
        functionName: 'approve',
        args: ['0x2222222222222222222222222222222222222222', maxUint256],
    });

    const res = await simulatePreflight({
        to: '0x1111111111111111111111111111111111111111',
        data,
    });

    assert.equal(res.methodName, 'Token Allowance Approval');
    assert.equal(res.approvalSafety, 'warning');
    assert.equal(res.assetFlow.sending[0].amount, 'Unlimited CHIPS');
});

test('preflight: marks exact ERC-20 approval as safe', async () => {
    const exactAmount = parseUnits('100', 18);
    const data = encodeFunctionData({
        abi: CHIPS_ERC20_ABI,
        functionName: 'approve',
        args: ['0x2222222222222222222222222222222222222222', exactAmount],
    });

    const res = await simulatePreflight({
        to: '0x1111111111111111111111111111111111111111',
        data,
    });

    assert.equal(res.methodName, 'Token Allowance Approval');
    assert.equal(res.approvalSafety, 'safe');
    assert.equal(res.assetFlow.sending[0].amount, '100 CHIPS');
});

test('preflight: decodes match pool entry fee and state change', async () => {
    const data = encodeFunctionData({
        abi: MATCH_POOL_ABI,
        functionName: 'joinPool',
        args: ['0x0000000000000000000000000000000000000000000000000000000000000001'],
    });

    const res = await simulatePreflight({
        to: '0x1111111111111111111111111111111111111111',
        data,
    });

    assert.equal(res.methodName, 'Join Ranked Pool');
    assert.equal(res.assetFlow.sending[0].label, 'Entry Fee');
    assert.equal(res.assetFlow.receiving[0].label, 'Pool Registration');
});

test('preflight: walletGuard streams simulation telemetry into the modal', async () => {
    hideAuthPrompt();
    assert.equal(isAuthPromptOpen(), false);

    const mockProvider: Eip1193Provider = {
        request: async ({ method }) => {
            assert.equal(method, 'eth_sendTransaction');
            assert.equal(isAuthPromptOpen(), true);
            const state = getAuthPromptState();
            assert.equal(state.mode, 'transaction');
            assert.ok(state.telemetry != null, 'telemetry should be populated');
            assert.equal(state.telemetry?.methodName, 'Native ETH Transfer');
            return '0xtxhash';
        },
    };

    wrapEip1193Provider(mockProvider);
    await mockProvider.request({
        method: 'eth_sendTransaction',
        params: [
            {
                to: '0x1111111111111111111111111111111111111111',
                value: parseEther('0.01'),
            },
        ],
    });

    assert.equal(isAuthPromptOpen(), false);
});
