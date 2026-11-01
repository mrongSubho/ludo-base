/* eslint-disable @typescript-eslint/no-explicit-any */
import {
    type Address,
    type Hex,
    encodeAbiParameters,
    encodePacked,
    keccak256,
    parseAbiParameters,
    toBytes,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { serviceDb } from '@/lib/serverAuth';
import { chipsToBaseUnits } from '@/lib/missionCatalog';
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
    const addr = process.env.NEXT_PUBLIC_CLAN_CLAIM_ADDRESS;
    if (addr && addr.startsWith('0x') && addr.length === 42) {
        return addr as Address;
    }
    // Fallback deterministic address on Base Sepolia
    return '0x1234567890123456789012345678901234567890' as Address;
}

export function clanOraclePrivateKey(): Hex {
    const pk =
        process.env.SETTLEMENT_OP_KEY ||
        process.env.MISSION_OP_PRIVATE_KEY ||
        process.env.EDGE_SETTLE_PRIVATE_KEY ||
        '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'; // standard foundry test key 0
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
