/**
 * Season merkle leaf builder (ops).
 * npx tsx scripts/buildSeasonLeaves.ts [out.json] [wallet:amountWei ...]
 * Env: SEASON_CLAIM_ADDRESS, CHAIN_ID, SEASON_EPOCH
 * Without rows, writes a 2-leaf demo tree (safe for dry-runs).
 */
import { writeFileSync } from "node:fs";
import { encodePacked, keccak256, type Address, type Hex } from "viem";
import { parseChainId } from "../lib/chains";

function leaf(chainId: number, claim: Address, epoch: bigint, wallet: Address, amount: bigint): Hex {
    return keccak256(
        encodePacked(
            ["uint256", "address", "uint256", "address", "uint256"],
            [BigInt(chainId), claim, epoch, wallet, amount],
        ),
    );
}

function pair(a: Hex, b: Hex): Hex {
    return a.toLowerCase() <= b.toLowerCase()
        ? keccak256(encodePacked(["bytes32", "bytes32"], [a, b]))
        : keccak256(encodePacked(["bytes32", "bytes32"], [b, a]));
}

function merkle(leaves: Hex[]): { root: Hex; proofs: Hex[][] } {
    if (leaves.length === 0) throw new Error("no leaves");
    let level = leaves.slice();
    const layers: Hex[][] = [level];
    while (level.length > 1) {
        const next: Hex[] = [];
        for (let i = 0; i < level.length; i += 2) {
            const left = level[i];
            const right = i + 1 < level.length ? level[i + 1] : left;
            next.push(pair(left, right));
        }
        level = next;
        layers.push(level);
    }
    const root = level[0];
    const proofs: Hex[][] = leaves.map((_, idx) => {
        const proof: Hex[] = [];
        let i = idx;
        for (let d = 0; d < layers.length - 1; d++) {
            const layer = layers[d];
            const sib = i % 2 === 0 ? i + 1 : i - 1;
            if (sib < layer.length) proof.push(layer[sib]);
            i = Math.floor(i / 2);
        }
        return proof;
    });
    return { root, proofs };
}

function main() {
    const outPath = process.argv[2] ?? "season-leaves.json";
    const pairs = process.argv.slice(3);
    const rows =
        pairs.length > 0
            ? pairs.map((p) => {
                  const [wallet, amt] = p.split(":");
                  return { wallet: wallet.toLowerCase() as Address, amount: BigInt(amt) };
              })
            : [
                  {
                      wallet: "0x0000000000000000000000000000000000000001" as Address,
                      amount: BigInt(100) * BigInt(10) ** BigInt(18),
                  },
                  {
                      wallet: "0x0000000000000000000000000000000000000002" as Address,
                      amount: BigInt(200) * BigInt(10) ** BigInt(18),
                  },
              ];
    const chainId = parseChainId(Number(process.env.CHAIN_ID ?? 84532));
    if (chainId == null) throw new Error("bad CHAIN_ID");
    const claim = (process.env.SEASON_CLAIM_ADDRESS ??
        "0x83ae874e85c94920540f43fc6706ee485be44cbe") as Address;
    const epoch = BigInt(process.env.SEASON_EPOCH ?? "1");
    const leaves = rows.map((r) => leaf(chainId, claim, epoch, r.wallet, r.amount));
    const { root, proofs } = merkle(leaves);
    writeFileSync(
        outPath,
        JSON.stringify(
            {
                chainId,
                claim,
                epoch: epoch.toString(),
                root,
                entries: rows.map((r, i) => ({
                    wallet: r.wallet,
                    amount: r.amount.toString(),
                    leaf: leaves[i],
                    proof: proofs[i],
                })),
            },
            null,
            2,
        ),
    );
    console.log("root", root);
    console.log("entries", rows.length);
    console.log("wrote", outPath);
}

main();
