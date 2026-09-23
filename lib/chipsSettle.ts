/**
 * MatchPool EIP-712 helpers — must match contracts/src/MatchPool.sol exactly.
 *
 * Domain: EIP712Domain(name="LudoBase MatchPool", version="1", chainId, verifyingContract)
 * Struct hashes use the same abi.encode layout as the contract (not nested
 * Solidity structs for settle — planHash is a flat bytes32).
 *
 * Edge co-signer key lives in server env only (EDGE_SETTLE_PRIVATE_KEY).
 * Never expose this key to the client. Phase-1 single-key Sepolia; mainnet = HSM.
 */
import {
    type Address,
    type Hex,
    encodeAbiParameters,
    encodePacked,
    keccak256,
    parseAbiParameters,
    toBytes,
    toHex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { parseChainId, type SupportedChainId } from "@/lib/chains";

export const MATCH_POOL_DOMAIN_NAME = "LudoBase MatchPool";
export const EIP712_VERSION = "1";

export const LOBBY_TYPEHASH = keccak256(
    toBytes(
        "LobbyTicket(bytes32 roomCode,bytes32 matchId,address host,bytes32 seatsHash,uint8 gameMode,uint8 maxSeats,uint64 issuedAt)",
    ),
);
export const SETTLE_TYPEHASH = keccak256(
    toBytes(
        "ChipsMatchSettle(bytes32 poolId,bytes32 planHash,uint256 nonce,uint64 deadline,address authority)",
    ),
);
export const ABANDON_TYPEHASH = keccak256(
    toBytes(
        "ChipsMatchAbandon(bytes32 poolId,address accusedSeat,uint64 seqAtDisconnect,uint8 afkStrikes,uint64 deadline)",
    ),
);

export interface LobbyTicketFields {
    roomCode: Hex;
    matchId: Hex;
    host: Address;
    seatsHash: Hex;
    gameMode: number;
    maxSeats: number;
    issuedAt: bigint;
}

export interface PayoutEntry {
    addr: Address;
    amount: bigint;
}

export function domainSeparator(matchPool: Address, chainId: SupportedChainId): Hex {
    return keccak256(
        encodeAbiParameters(
            parseAbiParameters("bytes32, bytes32, bytes32, uint256, address"),
            [
                keccak256(
                    toBytes(
                        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)",
                    ),
                ),
                keccak256(toBytes(MATCH_POOL_DOMAIN_NAME)),
                keccak256(toBytes(EIP712_VERSION)),
                BigInt(chainId),
                matchPool,
            ],
        ),
    );
}

export function eip712Digest(domainSep: Hex, structHash: Hex): Hex {
    return keccak256(encodePacked(["string", "bytes32", "bytes32"], ["\x19\x01", domainSep, structHash]));
}

export function lobbyTicketStructHash(t: LobbyTicketFields): Hex {
    return keccak256(
        encodeAbiParameters(
            parseAbiParameters("bytes32, bytes32, bytes32, address, bytes32, uint8, uint8, uint64"),
            [
                LOBBY_TYPEHASH,
                t.roomCode,
                t.matchId,
                t.host,
                t.seatsHash,
                t.gameMode,
                t.maxSeats,
                t.issuedAt,
            ],
        ),
    );
}

export function lobbyTicketDigest(
    t: LobbyTicketFields,
    matchPool: Address,
    chainId: SupportedChainId,
): Hex {
    return eip712Digest(domainSeparator(matchPool, chainId), lobbyTicketStructHash(t));
}

/** MatchPool.settleStructHash — keccak(abi.encode(Payout[])) then flat settle struct. */
export function payoutPlanHash(plan: PayoutEntry[]): Hex {
    // Solidity abi.encode(Payout[] memory): 0x20 offset ++ length ++ (addr ++ amount)*
    const encoded = encodeAbiParameters(
        [
            {
                type: "tuple[]",
                components: [
                    { name: "addr", type: "address" },
                    { name: "amount", type: "uint256" },
                ],
            },
        ] as const,
        [plan.map((p) => ({ addr: p.addr, amount: p.amount }))],
    );
    return keccak256(encoded);
}

export function settleStructHash(params: {
    poolId: Hex;
    planHash: Hex;
    nonce: bigint;
    deadline: bigint;
    authority: Address;
}): Hex {
    return keccak256(
        encodeAbiParameters(
            parseAbiParameters("bytes32, bytes32, bytes32, uint256, uint64, address"),
            [
                SETTLE_TYPEHASH,
                params.poolId,
                params.planHash,
                params.nonce,
                params.deadline,
                params.authority,
            ],
        ),
    );
}

export function settleDigest(
    params: {
        poolId: Hex;
        plan: PayoutEntry[];
        nonce: bigint;
        deadline: bigint;
        authority: Address;
    },
    matchPool: Address,
    chainId: SupportedChainId,
): Hex {
    const planHash = payoutPlanHash(params.plan);
    const structHash = settleStructHash({
        poolId: params.poolId,
        planHash,
        nonce: params.nonce,
        deadline: params.deadline,
        authority: params.authority,
    });
    return eip712Digest(domainSeparator(matchPool, chainId), structHash);
}

export function abandonDigest(
    params: {
        poolId: Hex;
        accusedSeat: Address;
        seqAtDisconnect: bigint;
        afkStrikes: number;
        deadline: bigint;
    },
    matchPool: Address,
    chainId: SupportedChainId,
): Hex {
    const structHash = keccak256(
        encodeAbiParameters(
            parseAbiParameters("bytes32, bytes32, address, uint64, uint8, uint64"),
            [
                ABANDON_TYPEHASH,
                params.poolId,
                params.accusedSeat,
                params.seqAtDisconnect,
                params.afkStrikes,
                params.deadline,
            ],
        ),
    );
    return eip712Digest(domainSeparator(matchPool, chainId), structHash);
}

/** Seats hash binding used in lobby tickets (matches createPool). */
export function seatsHash(seatWallets: Address[], seatColors: number[]): Hex {
    return keccak256(
        encodeAbiParameters(parseAbiParameters("address[], uint8[]"), [seatWallets, seatColors]),
    );
}

/**
 * Edge / settlement co-signer. Phase 1: env private key on the Edge/API host.
 * Mainnet: replace with threshold/HSM — same interface.
 */
export function edgeSettlePrivateKey(): Hex {
    const pk = process.env.EDGE_SETTLE_PRIVATE_KEY;
    if (!pk) throw new Error("EDGE_SETTLE_PRIVATE_KEY not configured");
    return (pk.startsWith("0x") ? pk : `0x${pk}`) as Hex;
}

export function edgeSignerAddress(): Address {
    return privateKeyToAccount(edgeSettlePrivateKey()).address;
}

/** Sign a raw EIP-712 digest with the Edge settlement key (65-byte r‖s‖v). */
export async function edgeSign(digest: Hex): Promise<Hex> {
    const account = privateKeyToAccount(edgeSettlePrivateKey());
    return (await account.sign({ hash: digest })) as Hex;
}

export function parseRequestedChainId(input: unknown): SupportedChainId {
    const n = parseChainId(input);
    if (n == null) throw new Error("Unsupported chainId");
    return n;
}

export function toHex32(s: string): Hex {
    if (/^0x[0-9a-fA-F]{64}$/.test(s)) return s as Hex;
    return keccak256(toBytes(s));
}
