/**
 * MatchPool / ClaimHub / CHIPS ABIs + addresses for app join/claim (Phase 1).
 * Addresses live in env (NEXT_PUBLIC_*); fill TOKEN_PARAMS.md at deploy.
 */
import { encodeAbiParameters, keccak256, parseAbiParameters, toBytes, toHex } from "viem";

export const MATCH_POOL_ABI = [
    {
        type: "function",
        name: "joinPool",
        stateMutability: "nonpayable",
        inputs: [{ name: "poolId", type: "bytes32" }],
        outputs: [],
    },
    {
        type: "function",
        name: "claimMatch",
        stateMutability: "nonpayable",
        inputs: [{ name: "poolId", type: "bytes32" }],
        outputs: [],
    },
    {
        type: "function",
        name: "refundJoin",
        stateMutability: "nonpayable",
        inputs: [{ name: "poolId", type: "bytes32" }],
        outputs: [],
    },
    {
        type: "function",
        name: "claimable",
        stateMutability: "view",
        inputs: [
            { name: "poolId", type: "bytes32" },
            { name: "player", type: "address" },
        ],
        outputs: [{ name: "", type: "uint256" }],
    },
    {
        type: "function",
        name: "getPoolSummary",
        stateMutability: "view",
        inputs: [{ name: "poolId", type: "bytes32" }],
        outputs: [
            { name: "status", type: "uint8" },
            { name: "maxSeats", type: "uint8" },
            { name: "filledSeats", type: "uint8" },
            { name: "authority", type: "address" },
            { name: "entryFee", type: "uint128" },
            { name: "gross", type: "uint128" },
            { name: "prizeFund", type: "uint128" },
            { name: "hostBond", type: "uint128" },
            { name: "settleBy", type: "uint64" },
            { name: "claimUnlockAt", type: "uint64" },
        ],
    },
] as const;

export const CHIPS_ERC20_ABI = [
    {
        type: "function",
        name: "approve",
        stateMutability: "nonpayable",
        inputs: [
            { name: "spender", type: "address" },
            { name: "amount", type: "uint256" },
        ],
        outputs: [{ name: "", type: "bool" }],
    },
    {
        type: "function",
        name: "allowance",
        stateMutability: "view",
        inputs: [
            { name: "owner", type: "address" },
            { name: "spender", type: "address" },
        ],
        outputs: [{ name: "", type: "uint256" }],
    },
    {
        type: "function",
        name: "balanceOf",
        stateMutability: "view",
        inputs: [{ name: "account", type: "address" }],
        outputs: [{ name: "", type: "uint256" }],
    },
] as const;

export function matchPoolAddress(): `0x${string}` | undefined {
    const a = process.env.NEXT_PUBLIC_MATCH_POOL_ADDRESS;
    return a && a.startsWith("0x") ? (a as `0x${string}`) : undefined;
}

export function chipsAddress(): `0x${string}` | undefined {
    const a = process.env.NEXT_PUBLIC_CHIPS_ADDRESS;
    return a && a.startsWith("0x") ? (a as `0x${string}`) : undefined;
}

/** Pool status enum from MatchPool. */
export const PoolStatus = {
    Open: 0,
    Funded: 1,
    Locked: 2,
    Settled: 3,
    Cancelled: 4,
    Expired: 5,
} as const;

/**
 * Deterministic pool id — must match Edge `createPool` (MatchPool comment:
 * keccak(chainId, matchId, roomCode, chainSalt)).
 */
export function derivePoolId(params: {
    chainId: number;
    matchId: string;
    roomCode: string;
    salt?: string;
}): `0x${string}` {
    const matchIdB32 = keccak256(toBytes(params.matchId));
    const roomB32 = keccak256(toBytes(params.roomCode));
    const saltB32 = keccak256(toBytes(params.salt ?? "ludo-base-pool-v1"));
    return keccak256(
        encodeAbiParameters(parseAbiParameters("uint256, bytes32, bytes32, bytes32"), [
            BigInt(params.chainId),
            matchIdB32,
            roomB32,
            saltB32,
        ]),
    );
}

export function isChipsConfigured(): boolean {
    return Boolean(matchPoolAddress() && chipsAddress());
}

/** Compact 0xabc…def for UI. */
export function shortHex(h: string | undefined | null): string {
    if (!h || h.length < 12) return h || "";
    return `${h.slice(0, 6)}…${h.slice(-4)}`;
}

export function formatChips(raw: bigint | number | undefined | null): string {
    if (raw == null) return "0";
    const n = typeof raw === "bigint" ? Number(raw) / 1e18 : raw;
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1)}K`;
    return String(Math.floor(n));
}

export { toHex };
