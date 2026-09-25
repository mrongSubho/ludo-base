/**
 * CHIPS indexer worker (Phase-1 item 3 / next-checklist #5).
 * Polls MatchPool events on Base Sepolia and upserts to Supabase chips_events.
 *
 * npx tsx scripts/chips-indexer-worker.ts
 * Env: SEPOLIA_RPC, MATCH_POOL_ADDRESS, NEXT_PUBLIC_SUPABASE_URL,
 *      SUPABASE_SERVICE_ROLE_KEY, FROM_BLOCK (optional)
 */
import {
    createPublicClient,
    http,
    parseAbiItem,
    type Address,
    type Hex,
} from "viem";
import { viemChainFor, parseChainId } from "../lib/chains";

const EVENTS = [
    parseAbiItem(
        "event PoolCreated(bytes32 indexed poolId, address indexed authority, uint128 entryFee, uint8 maxSeats)",
    ),
    parseAbiItem(
        "event PoolJoined(bytes32 indexed poolId, address indexed player, uint8 seatIndex, uint128 entryFee)",
    ),
    parseAbiItem(
        "event PoolSettled(bytes32 indexed poolId, uint8 mode, bytes32 resultHash, uint256 prizeFund)",
    ),
    parseAbiItem(
        "event PrizeClaimed(bytes32 indexed poolId, address indexed player, uint256 amount)",
    ),
];

async function upsertRest(
    url: string,
    serviceKey: string,
    table: string,
    rows: Record<string, unknown>[],
) {
    if (!rows.length) return 0;
    const res = await fetch(`${url.replace(/\/$/, "")}/rest/v1/${table}`, {
        method: "POST",
        headers: {
            apikey: serviceKey,
            Authorization: `Bearer ${serviceKey}`,
            "Content-Type": "application/json",
            Prefer: "resolution=merge-duplicates,return=minimal",
        },
        body: JSON.stringify(rows),
    });
    if (!res.ok) throw new Error(`${table}: ${await res.text()}`);
    return rows.length;
}

async function main() {
    const chainId = parseChainId(Number(process.env.CHAIN_ID ?? 84532));
    if (!chainId) throw new Error("bad CHAIN_ID");
    const rpc = process.env.SEPOLIA_RPC ?? "https://sepolia.base.org";
    const pool = process.env.MATCH_POOL_ADDRESS as Address;
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!pool || !supabaseUrl || !serviceKey) throw new Error("missing env");

    const client = createPublicClient({ chain: viemChainFor(chainId), transport: http(rpc) });
    const tip = await client.getBlockNumber();
    const confirmations = BigInt(process.env.CONFIRMATIONS ?? 12);
    const toBlock = tip > confirmations ? tip - confirmations : tip;
    const fromBlock = BigInt(process.env.FROM_BLOCK ?? 47250000);

    const logs = [];
    // Base public RPC: eth_getLogs max 1000-block range — chunk.
    const CHUNK = BigInt(900);
    for (let from = fromBlock; from <= toBlock; from += CHUNK) {
        const to = from + CHUNK - BigInt(1) > toBlock ? toBlock : from + CHUNK - BigInt(1);
        const batch = await client.getLogs({
            address: pool,
            fromBlock: from,
            toBlock: to,
            events: EVENTS,
        });
        logs.push(...batch);
    }

    const rows = logs.map((log) => ({
        chain_id: chainId,
        tx_hash: log.transactionHash as Hex,
        log_index: log.logIndex ?? 0,
        event_name: log.eventName ?? "Unknown",
        wallet_address: (log.args as { player?: Address }).player ?? null,
        amount:
            (log.args as { amount?: bigint; entryFee?: bigint }).amount?.toString()
            ?? (log.args as { entryFee?: bigint }).entryFee?.toString()
            ?? null,
        payload: JSON.parse(
            JSON.stringify(log.args ?? {}, (_k, v) => (typeof v === "bigint" ? v.toString() : v)),
        ),
    }));

    const n = await upsertRest(supabaseUrl, serviceKey, "chips_events", rows);
    console.log(`ingested ${n} / ${logs.length} logs [${fromBlock}..${toBlock}]`);
    console.log("next FROM_BLOCK=", toBlock.toString());
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
