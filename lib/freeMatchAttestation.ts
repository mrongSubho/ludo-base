import type { Address, Hex } from "viem";
import {
    encodeAbiParameters,
    encodePacked,
    keccak256,
    parseAbiParameters,
    toBytes,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { SupportedChainId } from "@/lib/chains";

export interface FreeMatchAttestation {
    matchId: Hex;
    player: Address;
    won: number;
    isPvp: number;
    captures: number;
    playedAt: number;
    deadline: number;
}

export const FREE_MATCH_TYPEHASH: Hex = keccak256(
    toBytes(
        "FreeMatchAttestation(bytes32 matchId,address player,uint8 won,uint8 isPvp,uint16 captures,uint64 playedAt,uint64 deadline)",
    ),
);

export function freeMatchDomainSeparator(missionSystem: Address, chainId: SupportedChainId): Hex {
    return keccak256(
        encodeAbiParameters(
            parseAbiParameters("bytes32, bytes32, bytes32, uint256, address"),
            [
                keccak256(
                    toBytes(
                        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)",
                    ),
                ),
                keccak256(toBytes("LudoBase MissionSystem")),
                keccak256(toBytes("1")),
                BigInt(chainId),
                missionSystem,
            ],
        ),
    );
}

export function freeMatchStructHash(m: FreeMatchAttestation): Hex {
    return keccak256(
        encodeAbiParameters(
            parseAbiParameters("bytes32, bytes32, address, uint8, uint8, uint16, uint64, uint64"),
            [
                FREE_MATCH_TYPEHASH,
                m.matchId,
                m.player,
                m.won,
                m.isPvp,
                m.captures,
                BigInt(m.playedAt),
                BigInt(m.deadline),
            ],
        ),
    );
}

export function freeMatchDigest(
    m: FreeMatchAttestation,
    missionSystem: Address,
    chainId: SupportedChainId,
): Hex {
    return keccak256(
        encodePacked(
            ["string", "bytes32", "bytes32"],
            ["\x19\x01", freeMatchDomainSeparator(missionSystem, chainId), freeMatchStructHash(m)],
        ),
    );
}

export function missionOraclePrivateKey(): Hex {
    const raw = process.env.MISSION_PROGRESS_PRIVATE_KEY;
    if (!raw) throw new Error("MISSION_PROGRESS_PRIVATE_KEY not configured");
    const pk = raw.trim();
    return (pk.startsWith("0x") || pk.startsWith("0X") ? pk : `0x${pk}`) as Hex;
}

export async function signFreeMatchAttestation(
    m: FreeMatchAttestation,
    missionSystem: Address,
    chainId: SupportedChainId,
): Promise<Hex> {
    const account = privateKeyToAccount(missionOraclePrivateKey());
    const digest = freeMatchDigest(m, missionSystem, chainId);
    return (await account.sign({ hash: digest })) as Hex;
}
