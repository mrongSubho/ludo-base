/**
 * Legacy coins → CHIPS snapshot builder (100:1, 50M cap).
 * npx tsx scripts/build-legacy-snapshot.ts
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, LEGACY_CLAIM_ADDRESS, CHAIN_ID
 * Out: legacy-snapshot.json { root, leaves[] } for LegacyClaim.setSnapshotRoot
 */
import { writeFileSync } from "node:fs";
import { encodePacked, keccak256, type Address, type Hex } from "viem";
import { parseChainId } from "../lib/chains";

function leaf(chainId: number, claim: Address, wallet: Address, amount: bigint): Hex {
    return keccak256(
        encodePacked(
            ["uint256", "address", "address", "uint256"],
            [BigInt(chainId), claim, wallet.toLowerCase() as Address, amount],
        ),
    );
}

function pair(a: Hex, b: Hex): Hex {
    return a.toLowerCase() <= b.toLowerCase()
        ? keccak256(encodePacked(["bytes32", "bytes32"], [a, b]))
        : keccak256(encodePacked(["bytes32", "bytes32"], [b, a]));
}

function merkle(leaves: Hex[]): { root: Hex; proofs: Hex[][] } {
    if (leaves.length === 0) throw new Error("empty snapshot");
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

async function main() {
    const chainId = parseChainId(Number(process.env.CHAIN_ID ?? 84532));
    if (!chainId) throw new Error("bad CHAIN_ID");
    const claim = (process.env.LEGACY_CLAIM_ADDRESS ??
        "0x140b790ea880ca7da31f88db75058964699e7ebd") as Address;
    const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error("missing SUPABASE_URL / SERVICE_ROLE_KEY");

    const res = await fetch(
        `${url.replace(/\/$/, "")}/rest/v1/players?select=wallet_address,coins&coins=gt.0`,
        { headers: { apikey: key, Authorization: `Bearer ${key}` } },
    );
    if (!res.ok) throw new Error(await res.text());
    const rows = (await res.json()) as { wallet_address: string; coins: number }[];

    const RATE = 100; // 100 legacy = 1 CHIPS
    const entries = rows
        .map((r) => ({
            wallet: r.wallet_address.toLowerCase() as Address,
            legacyCoins: String(r.coins),
            chipsAmount: BigInt(Math.floor(Number(r.coins) / RATE)) * BigInt(10) ** BigInt(18),
        }))
        .filter((e) => e.chipsAmount > BigInt(0))
        .slice(0, 100_000);

    const leaves = entries.map((e) => leaf(chainId, claim, e.wallet, e.chipsAmount));
    const { root, proofs } = merkle(leaves);
    writeFileSync(
        "legacy-snapshot.json",
        JSON.stringify(
            {
                chainId,
                claim,
                rate: RATE,
                root,
                entries: entries.map((e, i) => ({
                    wallet: e.wallet,
                    legacyCoins: e.legacyCoins,
                    amount: e.chipsAmount.toString(),
                    proof: proofs[i],
                })),
            },
            null,
            2,
        ),
    );
    console.log("root", root);
    console.log("entries", entries.length);
    console.log("wrote legacy-snapshot.json");
    console.log("publish root + 7d challenge, then setSnapshotRoot on LegacyClaim");
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
