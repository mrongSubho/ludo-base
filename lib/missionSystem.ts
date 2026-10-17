/**
 * On-chain reader for the MissionSystem contract (Base Sepolia 84532).
 *
 * This module is CLIENT-SAFE: it only imports from `viem` (no server-only
 * `serviceDb` / `serverAuth`). The missionId bytes32 is derived with the same
 * `keccak256(bytes(id))` the `InitMissionSystem` script used, so it matches the
 * on-chain `missions(bytes32)` keys exactly.
 *
 * Read functions used (see contracts/src/MissionSystem.sol):
 *   - currentPeriod(bytes32 missionId) -> bytes32          (rolling day/week/once bucket)
 *   - getProgress(address,missionId,period) -> (uint256,bool) (accumulated + done)
 *   - isCompleted(address,missionId) -> bool               (done in current period)
 *
 * The contract is the PAYOUT authority: on completion (reserve funded) it
 * transfers CHIPS immediately, so a `completed == true` read means the reward
 * is already in the wallet — there is nothing left to claim via the legacy
 * voucher path.
 */
import { createPublicClient, http } from "viem";
import { baseSepolia } from "viem/chains";
import { keccak256, toBytes, type Address, type Hex } from "viem";

export const MISSION_SYSTEM_ABI = [
  {
    type: "function",
    name: "currentPeriod",
    stateMutability: "view",
    inputs: [{ name: "missionId", type: "bytes32" }],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    type: "function",
    name: "getProgress",
    stateMutability: "view",
    inputs: [
      { name: "wallet", type: "address" },
      { name: "missionId", type: "bytes32" },
      { name: "period", type: "bytes32" },
    ],
    outputs: [
      { name: "p", type: "uint256" },
      { name: "done", type: "bool" },
    ],
  },
  {
    type: "function",
    name: "isCompleted",
    stateMutability: "view",
    inputs: [
      { name: "wallet", type: "address" },
      { name: "missionId", type: "bytes32" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

export function missionSystemAddress(): Address | undefined {
  const a = process.env.NEXT_PUBLIC_MISSION_SYSTEM_ADDRESS;
  return a && /^0x[a-fA-F0-9]{40}$/.test(a) ? (a as Address) : undefined;
}

export function isMissionSystemConfigured(): boolean {
  return missionSystemAddress() !== undefined;
}

/** Canonical missionId bytes32 — matches `keccak256(bytes(id))` on-chain. */
export function missionIdBytes32(missionId: string): Hex {
  return keccak256(toBytes(missionId));
}

export interface OnChainMissionState {
  missionId: string;
  /** Current-period progress (capped at the mission target; values <= 10). */
  progress: number;
  /** True if the wallet completed the mission in its current period. */
  completed: boolean;
}

// NOTE: the client type is left inferred (via ReturnType) rather than annotated
// with viem's `PublicClient`. The workspace has a second, unrelated viem copy
// (node_modules/@walletconnect/utils/node_modules/viem), so an explicit
// `import type { PublicClient } from "viem"` triggers TS2719 "two different
// types with this name exist". Inference matches how the rest of the codebase
// (useWalletActivity / walletVerify / chipsIndexer) builds public clients.
function makeClient() {
  const rpc = process.env.NEXT_PUBLIC_MISSION_RPC_URL?.trim();
  // Empty url -> viem falls back to the chain's public endpoint (dev/test only).
  return createPublicClient({
    chain: baseSepolia,
    transport: http(rpc || undefined),
  });
}
let _client: ReturnType<typeof makeClient> | undefined;
function getClient() {
  _client ??= makeClient();
  return _client;
}

/**
 * Batch-read on-chain progress + completion for a wallet's missions.
 *
 * Two multicall round-trips: first `currentPeriod` per mission, then
 * `getProgress(wallet, id, period)`. Per-call reverts are skipped (the mission
 * is simply absent from the returned map) so a single bad mission can't blank
 * the whole panel. A total failure returns `{}` and the caller falls back to
 * its DB-derived values.
 */
export async function readMissionStates(
  wallet: Address,
  missionIds: string[],
): Promise<Record<string, OnChainMissionState>> {
  const addr = missionSystemAddress();
  if (!addr || missionIds.length === 0) return {};

  const client = getClient();
  const ids = missionIds.map(missionIdBytes32);

  try {
    const periods = await client.multicall({
      contracts: ids.map((id) => ({
        address: addr,
        abi: MISSION_SYSTEM_ABI,
        functionName: "currentPeriod",
        args: [id],
      })),
    });

    const progress = await client.multicall({
      contracts: ids.map((id, i) => ({
        address: addr,
        abi: MISSION_SYSTEM_ABI,
        functionName: "getProgress",
        args: [wallet, id, (periods[i].result ?? ("0x" as Hex)) as Hex],
      })),
    });

    const out: Record<string, OnChainMissionState> = {};
    missionIds.forEach((mid, i) => {
      const pr = progress[i];
      if (pr.status === "success" && Array.isArray(pr.result)) {
        const [p, done] = pr.result as [bigint, boolean];
        out[mid] = {
          missionId: mid,
          progress: Number(p), // safe: contract caps progress at target (<= 10)
          completed: Boolean(done),
        };
      }
    });
    return out;
  } catch (e) {
    console.error("[missionSystem] readMissionStates failed:", e);
    return {};
  }
}
