/**
 * Minimal event indexer skeleton (Phase 1).
 * Watches MatchPool + SeasonClaim + LegacyClaim + CHIPS burns into an in-memory
 * / Supabase-shaped cache. Production: dedicated RPC, reorg depth 12, 100ms polls.
 */
import {
    type Address,
    type Hex,
    createPublicClient,
    http,
    parseAbiItem,
} from "viem";
import { viemChainFor, parseChainId, type SupportedChainId } from "@/lib/chains";

export interface PoolCacheRow {
    poolId: Hex;
    status: number;
    entryFee: string;
    gross: string;
    prizeFund: string;
    hostBond: string;
    settleBy: string;
    claimUnlockAt: string;
    updatedAt: number;
}

export interface ChainEventRow {
    chainId: number;
    txHash: Hex;
    logIndex: number;
    eventName: string;
    wallet?: Address;
    amount?: string;
    memoTag?: string;
    payload?: Record<string, unknown>;
}

const POOL_JOINED = parseAbiItem(
    "event PoolJoined(bytes32 indexed poolId, address indexed player, uint8 seatIndex, uint128 entryFee)",
);
const POOL_SETTLED = parseAbiItem(
    "event PoolSettled(bytes32 indexed poolId, uint8 mode, bytes32 resultHash, uint256 prizeFund)",
);
const PRIZE_CLAIMED = parseAbiItem(
    "event PrizeClaimed(bytes32 indexed poolId, address indexed player, uint256 amount)",
);
const SEASON_CLAIMED = parseAbiItem(
    "event SeasonClaimed(uint256 indexed epoch, address indexed wallet, uint256 amount)",
);
const LEGACY_CLAIMED = parseAbiItem("event LegacyClaimed(address indexed wallet, uint256 amount)");

export class ChipsIndexer {
    /** Narrow pull surface — avoids brittle dual-viem PublicClient generics. */
    readonly client: { getLogs: (args: Record<string, unknown>) => Promise<Array<Record<string, unknown> & { transactionHash?: Hex; logIndex?: number; eventName?: string; args?: unknown }>> };
    readonly chainId: SupportedChainId;
    private seen = new Set<string>();
    readonly events: ChainEventRow[] = [];
    readonly pools = new Map<string, PoolCacheRow>();

    constructor(opts: { chainId: number; rpcUrl?: string }) {
        const chainId = parseChainId(opts.chainId);
        if (!chainId) throw new Error("Unsupported chainId");
        this.chainId = chainId;
        this.client = createPublicClient({
            chain: viemChainFor(chainId),
            transport: http(opts.rpcUrl),
        }) as unknown as ChipsIndexer["client"];
    }

    private key(tx: Hex, logIndex: number) {
        return `${tx.toLowerCase()}:${logIndex}`;
    }

    ingest(row: ChainEventRow) {
        const k = this.key(row.txHash, row.logIndex);
        if (this.seen.has(k)) return false;
        this.seen.add(k);
        this.events.push(row);
        return true;
    }

    /** Pull recent logs for a contract and ingest idempotently. */
    async pull(address: Address, fromBlock: bigint, toBlock: bigint) {
        const logs = await this.client.getLogs({
            address,
            fromBlock,
            toBlock,
            events: [POOL_JOINED, POOL_SETTLED, PRIZE_CLAIMED, SEASON_CLAIMED, LEGACY_CLAIMED],
        });
        for (const log of logs) {
            const tx = (log.transactionHash ?? "0x0") as Hex;
            this.ingest({
                chainId: this.chainId,
                txHash: tx,
                logIndex: log.logIndex ?? 0,
                eventName: log.eventName ?? "Unknown",
                wallet: (log.args as { player?: Address; wallet?: Address }).player
                    ?? (log.args as { wallet?: Address }).wallet,
                amount: (log.args as { amount?: bigint }).amount?.toString(),
                payload: log.args as Record<string, unknown>,
            });
        }
        return logs.length;
    }

    upsertPool(row: PoolCacheRow) {
        this.pools.set(row.poolId.toLowerCase(), row);
    }

    getPool(poolId: Hex) {
        return this.pools.get(poolId.toLowerCase());
    }

    /** Idempotent write of ingested events to Supabase (service role). */
    async persistToSupabase(supabase: {
        from: (t: string) => {
            upsert: (rows: unknown, opts?: unknown) => PromiseLike<{ error: unknown }>;
        };
    }): Promise<number> {
        if (!this.events.length) return 0;
        const rows = this.events.map((e) => ({
            chain_id: e.chainId,
            tx_hash: e.txHash,
            log_index: e.logIndex,
            event_name: e.eventName,
            wallet_address: e.wallet ?? null,
            amount: e.amount ?? null,
            memo_tag: e.memoTag ?? null,
            payload: e.payload ?? {},
        }));
        const { error } = await supabase
            .from("chips_events")
            .upsert(rows, { onConflict: "chain_id,tx_hash,log_index" });
        if (error) throw error;
        return rows.length;
    }

    async persistPools(supabase: {
        from: (t: string) => {
            upsert: (rows: unknown, opts?: unknown) => PromiseLike<{ error: unknown }>;
        };
    }): Promise<number> {
        const rows = [...this.pools.values()].map((p) => ({
            pool_id: p.poolId,
            status: p.status,
            entry_fee: p.entryFee,
            gross: p.gross,
            prize_fund: p.prizeFund,
            host_bond: p.hostBond,
            chain_id: this.chainId,
            updated_at: new Date(p.updatedAt).toISOString(),
        }));
        if (!rows.length) return 0;
        const { error } = await supabase.from("chips_pools").upsert(rows, { onConflict: "pool_id" });
        if (error) throw error;
        return rows.length;
    }

    /** Burn total from ingested burn memos (if payload carries memoTag). */
    burnedTotal(): bigint {
        let sum = BigInt(0);
        for (const e of this.events) {
            if (e.eventName === "Burned" || e.memoTag === "match:burn") {
                sum += BigInt(e.amount ?? "0");
            }
        }
        return sum;
    }
}

export function createChipsIndexer(chainId: number, rpcUrl?: string) {
    return new ChipsIndexer({ chainId, rpcUrl });
}
