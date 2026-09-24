/**
 * Season merkle + legacy snapshot helpers (client/ops).
 */
import { encodePacked, keccak256, type Address, type Hex } from "viem";

export function seasonLeaf(
    chainId: number,
    seasonClaim: Address,
    epoch: bigint,
    wallet: Address,
    amount: bigint,
): Hex {
    return keccak256(
        encodePacked(
            ["uint256", "address", "uint256", "address", "uint256"],
            [BigInt(chainId), seasonClaim, epoch, wallet, amount],
        ),
    );
}

export function legacyLeaf(
    chainId: number,
    legacyClaim: Address,
    wallet: Address,
    chipsAmount: bigint,
): Hex {
    return keccak256(
        encodePacked(
            ["uint256", "address", "address", "uint256"],
            [BigInt(chainId), legacyClaim, wallet, chipsAmount],
        ),
    );
}

/** Sorted-pair keccak (OpenZeppelin MerkleProof compatible). */
export function hashPair(a: Hex, b: Hex): Hex {
    return a.toLowerCase() <= b.toLowerCase()
        ? keccak256(encodePacked(["bytes32", "bytes32"], [a, b]))
        : keccak256(encodePacked(["bytes32", "bytes32"], [b, a]));
}

/** Build a simple 2-leaf tree (dev/ops). For large seasons use a proper merkle lib. */
export function twoLeafRoot(a: Hex, b: Hex): { root: Hex; proofA: Hex[]; proofB: Hex[] } {
    const root = hashPair(a, b);
    return { root, proofA: [b], proofB: [a] };
}
