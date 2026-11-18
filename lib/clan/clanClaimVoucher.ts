/* eslint-disable @typescript-eslint/no-explicit-any */
import {
    type Address,
    type Hex,
    type Log,
    encodeAbiParameters,
    encodePacked,
    keccak256,
    parseAbiParameters,
    parseEventLogs,
    toBytes,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { serviceDb } from '@/lib/serverAuth';
import { chipsToBaseUnits } from '@/lib/missionCatalog';
import {
    CLAN_CLAIM_DEPOSIT_ABI,
    DEFAULT_CLAN_CLAIM_ADDRESS,
    clanClaimAddress,
} from '@/lib/chips';
import { waitForConfirmedReceipt } from '@/lib/onchainReceipt';
import type { IssuedClanClaimVoucher, ClanClaimItem, ClanClaimVoucherPayload } from './types';
import { ClanServiceError } from './clanService';

export const CLAN_CLAIM_TYPES: Record<string, number> = {
    war_principal: 0,
    war_merit_wp: 1,
    war_gov_share: 2,
    war_refund: 3,
    weekly_vault: 4,
    treasury_grant: 5,
};

export const CLAN_CLAIM_TYPEHASH = keccak256(
    toBytes(
        'ClaimVoucher(bytes32 claimId,bytes32 clanId,address recipient,uint256 amount,uint8 claimType,uint256 nonce,uint64 deadline)',
    ),
);

export function clanClaimContractAddress(): Address {
    return clanClaimAddress() || DEFAULT_CLAN_CLAIM_ADDRESS;
}

export function clanOraclePrivateKey(): Hex {
    const pk =
        process.env.SETTLEMENT_OP_KEY ||
        process.env.MISSION_OP_PRIVATE_KEY ||
        process.env.EDGE_SETTLE_PRIVATE_KEY;
    if (!pk) {
        throw new Error('ClanClaim oracle signing key is not configured');
    }
    return (pk.startsWith('0x') ? pk : `0x${pk}`) as Hex;
}

export function clanClaimDomainSeparator(contractAddress: Address, chainId: number = 84532): Hex {
    return keccak256(
        encodeAbiParameters(
            parseAbiParameters('bytes32, bytes32, bytes32, uint256, address'),
            [
                keccak256(
                    toBytes('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)'),
                ),
                keccak256(toBytes('ClanClaim')),
                keccak256(toBytes('1')),
                BigInt(chainId),
                contractAddress,
            ],
        ),
    );
}

export function buildClanClaimDigest(
    voucher: {
        claimId: Hex;
        clanId: Hex;
        recipient: Address;
        amount: bigint;
        claimType: number;
        nonce: bigint;
        deadline: bigint;
    },
    contractAddress: Address,
    chainId: number = 84532,
): Hex {
    const structHash = keccak256(
        encodeAbiParameters(
            parseAbiParameters('bytes32, bytes32, bytes32, address, uint256, uint8, uint256, uint64'),
            [
                CLAN_CLAIM_TYPEHASH,
                voucher.claimId,
                voucher.clanId,
                voucher.recipient,
                voucher.amount,
                voucher.claimType,
                voucher.nonce,
                voucher.deadline,
            ],
        ),
    );

    const domainSeparator = clanClaimDomainSeparator(contractAddress, chainId);
    return keccak256(
        encodePacked(['string', 'bytes32', 'bytes32'], ['\x19\x01', domainSeparator, structHash]),
    );
}

/**
 * Issue an authoritative EIP-712 signed voucher for an unclaimed clan reward/refund.
 */
export async function issueClanClaimVoucher(params: {
    claimId: string;
    walletAddress: string;
    chainId?: number;
}): Promise<IssuedClanClaimVoucher> {
    const db = serviceDb();
    const wallet = params.walletAddress.toLowerCase() as Address;
    const chainId = params.chainId ?? 84532;

    const { data: claim, error } = await (db as any)
        .from('clan_claims')
        .select('*')
        .eq('id', params.claimId)
        .eq('wallet_address', wallet)
        .maybeSingle();

    if (error || !claim) {
        throw new ClanServiceError('Claim not found or not owned by caller', 404);
    }

    if (claim.status !== 'claimable') {
        throw new ClanServiceError('Claim is already claimed or expired', 409);
    }

    const claimTypeEnum = CLAN_CLAIM_TYPES[claim.claim_type];
    if (claimTypeEnum === undefined) {
        throw new ClanServiceError(`Unknown claim type: ${claim.claim_type}`, 400);
    }

    const claimContract = clanClaimContractAddress();
    const claimIdBytes32 = keccak256(toBytes(claim.id));
    const clanIdBytes32 = keccak256(toBytes(claim.clan_id));
    const baseUnitsAmount = chipsToBaseUnits(Number(claim.amount));

    // Deadline 30 days from now
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 30 * 86400);
    // Nonce derived from claim timestamp
    const nonce = BigInt(Math.floor(new Date(claim.created_at).getTime() / 1000));

    const voucherData = {
        claimId: claimIdBytes32,
        clanId: clanIdBytes32,
        recipient: wallet,
        amount: baseUnitsAmount,
        claimType: claimTypeEnum,
        nonce,
        deadline,
    };

    const digest = buildClanClaimDigest(voucherData, claimContract, chainId);
    const account = privateKeyToAccount(clanOraclePrivateKey());
    const signature = (await account.sign({ hash: digest })) as Hex;

    const voucherPayload: ClanClaimVoucherPayload = {
        claimId: claimIdBytes32,
        clanId: clanIdBytes32,
        recipient: wallet,
        amount: baseUnitsAmount.toString(),
        claimType: claimTypeEnum,
        nonce: nonce.toString(),
        deadline: deadline.toString(),
    };

    return {
        clanClaimContract: claimContract,
        chainId,
        voucher: voucherPayload,
        signature,
    };
}

/**
 * List all claimable items for a wallet.
 */
export async function getClaimableList(walletAddress: string): Promise<ClanClaimItem[]> {
    const db = serviceDb();
    const wallet = walletAddress.toLowerCase();

    const { data, error } = await (db as any)
        .from('clan_claims')
        .select(`
            *,
            clan:clans (
                name,
                tag
            )
        `)
        .eq('wallet_address', wallet)
        .eq('status', 'claimable')
        .order('created_at', { ascending: false });

    if (error) throw new ClanServiceError(error.message, 500);
    return (data || []) as ClanClaimItem[];
}

/**
 * Verify that `logs` from a confirmed receipt contain `RewardClaimed` events
 * from `claimContract` for every `claimId` and `recipient`.
 * Exported for unit testing.
 */
export function verifyClanClaimExecutedLogs(params: {
    logs: Log[];
    claimContract: Address;
    recipient: Address;
    claimIds: string[];
}): Set<string> {
    const decoded = parseEventLogs({
        abi: CLAN_CLAIM_DEPOSIT_ABI,
        logs: params.logs,
        eventName: 'RewardClaimed',
    });

    const contractLower = params.claimContract.toLowerCase();
    const recipientLower = params.recipient.toLowerCase();

    const matchedBytes32 = new Set<string>();
    for (const log of decoded) {
        if (log.address.toLowerCase() !== contractLower) continue;
        const args = log.args as { claimId?: Hex; recipient?: string };
        if (args.recipient?.toLowerCase() === recipientLower && args.claimId) {
            matchedBytes32.add(args.claimId.toLowerCase());
        }
    }

    const confirmedIds = new Set<string>();
    for (const id of params.claimIds) {
        const expectedHex = keccak256(toBytes(id)).toLowerCase();
        if (matchedBytes32.has(expectedHex)) {
            confirmedIds.add(id);
        }
    }

    if (confirmedIds.size === 0) {
        throw new ClanServiceError(
            'Transaction receipt does not contain matching ClanClaim RewardClaimed events',
            400,
        );
    }

    return confirmedIds;
}

/**
 * Confirm on-chain claim execution and mark matching `clan_claims` rows as `claimed`.
 */
export async function confirmClanClaimsExecuted(params: {
    walletAddress: string;
    claimIds: string[];
    txHash: string;
}): Promise<{ confirmedIds: string[] }> {
    const db = serviceDb();
    const wallet = params.walletAddress.toLowerCase() as Address;
    const txHash = params.txHash.trim();

    if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
        throw new ClanServiceError('Invalid transaction hash format', 400);
    }
    if (!params.claimIds.length) {
        throw new ClanServiceError('At least one claimId is required', 400);
    }

    // Load only still-claimable rows owned by caller
    const { data: rows, error: fetchErr } = await (db as any)
        .from('clan_claims')
        .select('id')
        .eq('wallet_address', wallet)
        .eq('status', 'claimable')
        .in('id', params.claimIds);

    if (fetchErr) throw new ClanServiceError(fetchErr.message, 500);
    const pendingIds: string[] = (rows || []).map((r: { id: string }) => r.id);
    if (pendingIds.length === 0) {
        return { confirmedIds: [] };
    }

    const claimContract = clanClaimContractAddress();
    const receipt = await waitForConfirmedReceipt(
        txHash,
        (msg, status = 400) => new ClanServiceError(msg, status),
    );

    const confirmed = verifyClanClaimExecutedLogs({
        logs: receipt.logs,
        claimContract,
        recipient: wallet,
        claimIds: pendingIds,
    });
    const confirmedList = Array.from(confirmed);

    const { error: updErr } = await (db as any)
        .from('clan_claims')
        .update({
            status: 'claimed',
            tx_hash: txHash,
            claimed_at: new Date().toISOString(),
        })
        .eq('wallet_address', wallet)
        .eq('status', 'claimable')
        .in('id', confirmedList);

    if (updErr) throw new ClanServiceError(updErr.message, 500);

    return { confirmedIds: confirmedList };
}
