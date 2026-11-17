import {
    type Address,
    type Hex,
    encodeAbiParameters,
    encodePacked,
    keccak256,
    parseAbiParameters,
    parseUnits,
    toBytes,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { serviceDb } from '@/lib/serverAuth';
import { arenaVaultAddress } from '@/lib/chips';

export const VAULT_CLAIM_TYPES: Record<string, number> = {
    match_prize: 0,
    vault_withdraw: 1,
    match_refund: 2,
};

export const VAULT_CLAIM_TYPEHASH = keccak256(
    toBytes(
        'VaultVoucher(bytes32 claimId,address recipient,uint256 amount,uint8 claimType,uint256 nonce,uint64 deadline)',
    ),
);

export function vaultOraclePrivateKey(): Hex {
    const pk =
        process.env.MISSION_OP_PRIVATE_KEY ||
        process.env.SETTLEMENT_OP_KEY ||
        process.env.EDGE_SETTLE_PRIVATE_KEY ||
        '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
    return (pk.startsWith('0x') ? pk : `0x${pk}`) as Hex;
}

export function arenaVaultDomainSeparator(contractAddress: Address, chainId: number = 84532): Hex {
    return keccak256(
        encodeAbiParameters(
            parseAbiParameters('bytes32, bytes32, bytes32, uint256, address'),
            [
                keccak256(
                    toBytes('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)'),
                ),
                keccak256(toBytes('ArenaVault')),
                keccak256(toBytes('1')),
                BigInt(chainId),
                contractAddress,
            ],
        ),
    );
}

export function buildVaultClaimDigest(
    voucher: {
        claimId: Hex;
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
            parseAbiParameters('bytes32, bytes32, address, uint256, uint8, uint256, uint64'),
            [
                VAULT_CLAIM_TYPEHASH,
                voucher.claimId,
                voucher.recipient,
                voucher.amount,
                voucher.claimType,
                voucher.nonce,
                voucher.deadline,
            ],
        ),
    );

    const domainSeparator = arenaVaultDomainSeparator(contractAddress, chainId);
    return keccak256(
        encodePacked(['string', 'bytes32', 'bytes32'], ['\x19\x01', domainSeparator, structHash]),
    );
}

export interface IssuedVaultVoucher {
    id: string;
    arenaVaultContract: Address;
    chainId: number;
    voucher: {
        claimId: Hex;
        recipient: Address;
        amount: string;
        claimType: number;
        nonce: string;
        deadline: string;
    };
    signature: Hex;
}

export async function issueVaultVoucher(params: {
    claimId: string;
    walletAddress: string;
    chainId?: number;
}): Promise<IssuedVaultVoucher> {
    const db = serviceDb() as unknown as {
        from: (t: string) => {
            select: (cols: string) => {
                eq: (c: string, v: string) => {
                    eq: (c2: string, v2: string) => {
                        maybeSingle: () => Promise<{
                            data: {
                                id: string;
                                claim_type: string;
                                amount: number | string;
                                status: string;
                                created_at: string;
                            } | null;
                            error: { message: string } | null;
                        }>;
                    };
                };
            };
        };
    };

    const wallet = params.walletAddress.toLowerCase() as Address;
    const chainId = params.chainId ?? 84532;

    const { data: claim, error } = await db
        .from('arena_vault_claims')
        .select('*')
        .eq('id', params.claimId)
        .eq('wallet_address', wallet)
        .maybeSingle();

    if (error || !claim) {
        throw new Error('Vault claim not found for this wallet');
    }
    if (claim.status !== 'claimable') {
        throw new Error('Claim has already been executed or rolled into vault');
    }

    const claimTypeEnum = VAULT_CLAIM_TYPES[claim.claim_type];
    if (claimTypeEnum === undefined) {
        throw new Error(`Unknown claim type: ${claim.claim_type}`);
    }

    const contractAddress = arenaVaultAddress();
    if (!contractAddress) {
        throw new Error('ArenaVault contract address is not configured');
    }

    const claimIdBytes32 = keccak256(toBytes(claim.id));
    const amountWei = parseUnits(String(claim.amount), 18);
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 30 * 86400);
    const nonce = BigInt(Math.floor(new Date(claim.created_at).getTime() / 1000));

    const voucherData = {
        claimId: claimIdBytes32,
        recipient: wallet,
        amount: amountWei,
        claimType: claimTypeEnum,
        nonce,
        deadline,
    };

    const digest = buildVaultClaimDigest(voucherData, contractAddress, chainId);
    const account = privateKeyToAccount(vaultOraclePrivateKey());
    const signature = (await account.sign({ hash: digest })) as Hex;

    return {
        id: claim.id,
        arenaVaultContract: contractAddress,
        chainId,
        voucher: {
            claimId: claimIdBytes32,
            recipient: wallet,
            amount: amountWei.toString(),
            claimType: claimTypeEnum,
            nonce: nonce.toString(),
            deadline: deadline.toString(),
        },
        signature,
    };
}
