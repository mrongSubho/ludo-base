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

/** Canonical period id: UTC day `YYYY-MM-DD`. */
export function periodIdDay(d = new Date()): Hex {
    return keccak256(toBytes(d.toISOString().slice(0, 10)));
}

/**
 * ISO-8601 week label `YYYY-Www`, computed in UTC.
 *
 * ISO week-*year*, not calendar year — the two differ around New Year
 * (2025-12-29 is 2026-W01), so the year is taken from the Thursday of the week
 * rather than from `getUTCFullYear()`. Normalised to UTC midnight first so the
 * weekday cannot drift by host timezone.
 */
export function isoWeekLabel(d = new Date()): string {
    const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    const isoDow = t.getUTCDay() === 0 ? 7 : t.getUTCDay();
    t.setUTCDate(t.getUTCDate() + 4 - isoDow);
    const year = t.getUTCFullYear();
    const yearStart = new Date(Date.UTC(year, 0, 1));
    const week = Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
    return `${year}-W${String(week).padStart(2, "0")}`;
}

/** Canonical period id for a week bucket: keccak of the ISO week label. */
export function periodIdWeek(d = new Date()): Hex {
    return keccak256(toBytes(isoWeekLabel(d)));
}

export function parseChainForMission(input: unknown): SupportedChainId {
    const n = parseChainId(input);
    if (n == null) throw new Error("Unsupported chainId");
    return n;
}
