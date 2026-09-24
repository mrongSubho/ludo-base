/**
 * MissionClaim EIP-712 vouchers — must match contracts/src/MissionClaim.sol.
 * Op key: MISSION_OP_PRIVATE_KEY (server-only).
 */
import {
    type Address,
    type Hex,
    encodeAbiParameters,
    encodePacked,
    keccak256,
    parseAbiParameters,
    toBytes,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { parseChainId, type SupportedChainId } from "@/lib/chains";

export const MISSION_VOUCHER_TYPEHASH = keccak256(
    toBytes(
        "MissionVoucher(address wallet,bytes32 missionId,uint256 amount,bytes32 periodId,uint64 deadline,uint256 nonce)",
    ),
);

export interface MissionVoucher {
    wallet: Address;
    missionId: Hex;
    amount: bigint;
    periodId: Hex;
    deadline: bigint;
    nonce: bigint;
}

export function missionDomainSeparator(missionClaim: Address, chainId: SupportedChainId): Hex {
    return keccak256(
        encodeAbiParameters(
            parseAbiParameters("bytes32, bytes32, bytes32, uint256, address"),
            [
                keccak256(
                    toBytes(
                        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)",
                    ),
                ),
                keccak256(toBytes("LudoBase MissionClaim")),
                keccak256(toBytes("1")),
                BigInt(chainId),
                missionClaim,
            ],
        ),
    );
}

export function missionVoucherDigest(
    v: MissionVoucher,
    missionClaim: Address,
    chainId: SupportedChainId,
): Hex {
    const structHash = keccak256(
        encodeAbiParameters(
            parseAbiParameters("bytes32, address, bytes32, uint256, bytes32, uint64, uint256"),
            [MISSION_VOUCHER_TYPEHASH, v.wallet, v.missionId, v.amount, v.periodId, v.deadline, v.nonce],
        ),
    );
    return keccak256(
        encodePacked(
            ["string", "bytes32", "bytes32"],
            ["\x19\x01", missionDomainSeparator(missionClaim, chainId), structHash],
        ),
    );
}

export function missionOpPrivateKey(): Hex {
    const pk = process.env.MISSION_OP_PRIVATE_KEY;
    if (!pk) throw new Error("MISSION_OP_PRIVATE_KEY not configured");
    return (pk.startsWith("0x") ? pk : `0x${pk}`) as Hex;
}

export async function signMissionVoucher(
    v: MissionVoucher,
    missionClaim: Address,
    chainId: SupportedChainId,
): Promise<Hex> {
    const account = privateKeyToAccount(missionOpPrivateKey());
    return (await account.sign({ hash: missionVoucherDigest(v, missionClaim, chainId) })) as Hex;
}

export function missionClaimAddress(): Address | undefined {
    const a = process.env.NEXT_PUBLIC_MISSION_CLAIM_ADDRESS;
    return a && a.startsWith("0x") ? (a as Address) : undefined;
}

/** Canonical period id: UTC day `YYYY-MM-DD` or week `YYYY-Www`. */
export function periodIdDay(d = new Date()): Hex {
    return keccak256(toBytes(d.toISOString().slice(0, 10)));
}

/** Welcome grant + daily table (planning 7.7) — amounts in whole CHIPS. */
export const ONBOARDING_REWARDS: Record<string, number> = {
    welcome_grant: 50,
    tutorial: 100,
    ai_classic: 100,
    ai_power: 100,
    ai_snakes: 100,
    pvp: 150,
    playtime: 150,
    daily_bonus: 20,
    daily_play_3: 40,
    daily_win_1: 50,
};

export function parseChainForMission(input: unknown): SupportedChainId {
    const n = parseChainId(input);
    if (n == null) throw new Error("Unsupported chainId");
    return n;
}
