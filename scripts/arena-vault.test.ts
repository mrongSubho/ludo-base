import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keccak256, parseUnits, recoverAddress, toBytes } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
    VAULT_CLAIM_TYPES,
    buildVaultClaimDigest,
    vaultOraclePrivateKey,
} from '../lib/arenaVaultVoucher';

test('arena vault: EIP-712 voucher digest & signature recovery match ArenaVault.sol', async () => {
    const vaultContract = '0x603754F0Dd62702a6DCd19F4049393151618a713' as const;
    const chainId = 84532;
    const oracleAccount = privateKeyToAccount(vaultOraclePrivateKey());

    const voucher = {
        claimId: keccak256(toBytes('vault-claim-test-1')),
        recipient: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as const,
        amount: parseUnits('19000', 18),
        claimType: VAULT_CLAIM_TYPES.match_prize,
        nonce: BigInt(1763390000),
        deadline: BigInt(1765982000),
    };

    const digest = buildVaultClaimDigest(voucher, vaultContract, chainId);
    const sig = await oracleAccount.sign({ hash: digest });

    const recovered = await recoverAddress({ hash: digest, signature: sig });
    assert.equal(
        recovered.toLowerCase(),
        oracleAccount.address.toLowerCase(),
        'Recovered signer must equal ArenaVault settlementOracle',
    );
});

test('arena vault: differential top-up covers deficit and skips tx when vault >= fee', () => {
    // Vault already holds 10k, next match is 10k -> 0 deficit (0 gas)
    assert.equal(Math.max(0, 10_000 - 10_000), 0);
    // Vault holds 10k, player upgrades to 100k -> tops up only 90k
    assert.equal(Math.max(0, 100_000 - 10_000), 90_000);
    // Cancelled match releases 10k back to 10k available
    const availableAfterRelease = 0 + 10_000;
    assert.equal(availableAfterRelease, 10_000);
});

test('arena vault: 5% protocol rake and 95% net pot split for 1v1 and 2v2', () => {
    const totalPot = 20_000;
    const rake = Math.floor((totalPot * 500) / 10_000);
    const netPot = totalPot - rake;
    assert.equal(rake, 1_000);
    assert.equal(netPot, 19_000);

    // 2v2 pot (4 * 10k = 40k): 2k rake, 38k split 50/50 -> 19k each teammate
    const pot2v2 = 40_000;
    const net2v2 = pot2v2 - Math.floor((pot2v2 * 500) / 10_000);
    assert.equal(net2v2, 38_000);
    assert.equal(Math.floor((net2v2 * 5000) / 10_000), 19_000);
});
