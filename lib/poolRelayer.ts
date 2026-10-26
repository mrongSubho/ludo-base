import { createWalletClient, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { MATCH_POOL_ABI, matchPoolAddress } from "@/lib/chips";
import { viemChainFor, verifyRpcUrl } from "@/lib/chains";
import { reportProgress } from "@/lib/missionOracle";
import type { PayoutEntry } from "@/lib/chipsSettle";

const CHAIN_ID = 84532 as const; // Base Sepolia

export function getRelayerAccount() {
    const rawPk = process.env.EDGE_SETTLE_PRIVATE_KEY || process.env.MISSION_PROGRESS_PRIVATE_KEY;
    if (!rawPk) return null;
    const pk = rawPk.startsWith("0x") || rawPk.startsWith("0X") ? rawPk : `0x${rawPk}`;
    if (!/^0x[0-9a-fA-F]{64}$/.test(pk)) return null;
    return privateKeyToAccount(pk as Hex);
}

/**
 * Server Relayer (Option 2): Auto-broadcasts settlePool for Paid Matches
 * and Arena Betting pools, funded by the protocol rake.
 */
export async function relaySettlePool(args: {
    poolId: Hex;
    payoutPlan: PayoutEntry[];
    deadline: bigint;
    nonce: bigint;
    hostSig: Hex;
    edgeSig: Hex;
    winnerAddresses?: Address[];
    participants?: Address[];
}): Promise<Hex | null> {
    const pool = matchPoolAddress();
    const account = getRelayerAccount();
    if (!pool || !account) {
        console.warn("[poolRelayer] MatchPool or relayer account not configured; skipping auto-settle");
        return null;
    }

    try {
        const chain = viemChainFor(CHAIN_ID);
        const rpc = verifyRpcUrl(CHAIN_ID) || undefined;
        const walletClient = createWalletClient({ account, chain, transport: http(rpc) });

        const tx = await walletClient.writeContract({
            address: pool,
            abi: MATCH_POOL_ABI,
            functionName: "settlePool",
            args: [
                args.poolId,
                args.payoutPlan.map((p) => ({ addr: p.addr, amount: p.amount })),
                args.deadline,
                args.nonce,
                args.hostSig,
                args.edgeSig,
            ],
        });

        console.info(`[poolRelayer] auto-settled pool ${args.poolId} in tx ${tx}`);

        // On-chain progress reporting for paid match participants
        if (args.winnerAddresses && args.winnerAddresses.length > 0) {
            for (const w of args.winnerAddresses) {
                void reportProgress(w, "daily_win_1", 1);
                void reportProgress(w, "weekly_win_3", 1);
            }
        }
        if (args.participants && args.participants.length > 0) {
            for (const p of args.participants) {
                void reportProgress(p, "daily_play_3", 1);
                void reportProgress(p, "weekly_play_10", 1);
            }
        }

        return tx;
    } catch (err: unknown) {
        console.error("[poolRelayer] failed to auto-settle pool:", err);
        return null;
    }
}
