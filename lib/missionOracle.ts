/**
 * Off-chain → on-chain progress bridge for the fully on-chain MissionSystem.
 *
 * The contract (contracts/src/MissionSystem.sol) is the single authority on mission
 * completion and CHIPS payout. A trusted "progress oracle" — a server-owned key —
 * reports gameplay progress via `recordProgress`, and the contract (not this code)
 * decides completion. This module is that oracle's client.
 *
 * WIRING: call `void reportProgress(wallet, missionId, delta)` next to every existing
 * off-chain progress write:
 *   - app/api/match/record/route.ts   (daily_win_1, daily_play_3, weekly_win_3,
 *                                      weekly_play_10, weekly_pvp_2, and the
 *                                      signature-attested daily_capture_2 /
 *                                      weekly_capture_10)
 *   - app/api/social/poke/route.ts    (daily_poke_back)
 *   - app/api/messages/route.ts       (weekly_friend_dm_3, via recordSocialOnboarding)
 *   - app/api/spectator-bets/route.ts (weekly_spectate_5 on bet placement;
 *                                      daily_predict_1 on a WON bet)
 *   - app/api/missions/daily-bonus    (daily_bonus — a claim, target 0)
 *   - lib/onboardingProgressWriter.ts (onboarding tracks + weekly_friend_dm_3)
 *
 * CAPTURES: the per-player capture counts the host computed in-engine
 * (`GameState.matchStats[color].kicks`) are attested in the signed match-record
 * payload — the `captures:` line of buildMatchRecordMessage — so the server can
 * trust them and report daily_capture_2 / weekly_capture_10. A body whose
 * captures differ from the signed line fails the canonical-message check.
 *
 * DAILY BONUS: MissionSystem pays CHIPS on completion, so POST
 * /api/missions/daily-bonus marks the `player_missions` row claimed (which also
 * blocks the legacy EIP-712 voucher — no double payout). When the oracle is not
 * reporting, that endpoint falls back to issuing the earlier voucher instead.
 *
 * RETURN VALUE: resolves `true` only when a tx was actually submitted. Fire-and-
 * forget callers keep using `void reportProgress(...)`; the daily-bonus endpoint
 * awaits it so it can fall back when the chain did not get the report.
 *
 * SAFETY: reportProgress is CONFIG-GATED and NEVER THROWS.
 *   - No-op unless NEXT_PUBLIC_MISSION_SYSTEM_ADDRESS and MISSION_PROGRESS_PRIVATE_KEY
 *     are both set — safe to wire in before the contract is deployed.
 *   - All errors are caught and logged; a failed on-chain sync must NEVER break the
 *     game API or the Postgres write that already happened.
 *
 * SETUP (later deploy phase — not required for the code to be safe):
 *   1. Deploy MissionSystem (script/DeployMissionSystem.s.sol); set
 *      NEXT_PUBLIC_MISSION_SYSTEM_ADDRESS.
 *   2. Fund a dedicated oracle wallet with Base Sepolia ETH; put its private key in
 *      MISSION_PROGRESS_PRIVATE_KEY (server-only — never NEXT_PUBLIC_).
 *   3. Set that wallet as progressOracle on the contract (constructor arg, or
 *      setProgressOracle). The oracle address is the public key derived from the
 *      private key above.
 *
 * The missionId bytes32 passed on-chain MUST equal keccak256(toBytes(missionId)) —
 * the exact value lib/missionCatalog.ts exports as missionIdBytes32 and the contract
 * keys on. Use the SAME mission_id strings already used off-chain.
 */
import { createWalletClient, encodeFunctionData, http, keccak256, toBytes } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { viemChainFor, verifyRpcUrl } from '@/lib/chains';

const CHAIN_ID = 84532 as const; // Base Sepolia — the only supported signing chain

// Minimal ABI for the single function the oracle calls.
const MISSION_SYSTEM_ABI = [
    {
        type: 'function',
        name: 'recordProgress',
        stateMutability: 'nonpayable',
        inputs: [
            { name: 'wallet', type: 'address' },
            { name: 'missionId', type: 'bytes32' },
            { name: 'delta', type: 'uint256' },
        ],
        outputs: [],
    },
] as const;

function missionIdBytes32(missionId: string): `0x${string}` {
    return keccak256(toBytes(missionId));
}

let warnedMissingConfig = false;

type Clients = {
    address: `0x${string}`;
    walletClient: ReturnType<typeof createWalletClient>;
    account: ReturnType<typeof privateKeyToAccount>;
};

/**
 * Lazily build (and memoise) the viem clients. Returns null when unconfigured or
 * the private key is malformed — never throws.
 */
async function getClients(): Promise<Clients | null> {
    const address = (process.env.NEXT_PUBLIC_MISSION_SYSTEM_ADDRESS || '').trim();
    const rawPk = (process.env.MISSION_PROGRESS_PRIVATE_KEY || '').trim();
    // Accept the key with or without a 0x prefix (env managers often omit it).
    const pk = rawPk.startsWith('0x') || rawPk.startsWith('0X') ? rawPk : `0x${rawPk}`;
    if (!address || !pk) {
        if (!warnedMissingConfig) {
            warnedMissingConfig = true;
            console.warn(
                '[missionOracle] NEXT_PUBLIC_MISSION_SYSTEM_ADDRESS or MISSION_PROGRESS_PRIVATE_KEY ' +
                    'unset — reportProgress is a no-op. Set both to enable on-chain mission progress.',
            );
        }
        return null;
    }
    if (!/^0x[0-9a-fA-F]{64}$/.test(pk)) {
        if (!warnedMissingConfig) {
            warnedMissingConfig = true;
            console.warn(
                '[missionOracle] MISSION_PROGRESS_PRIVATE_KEY is not a valid 0x private key — ' +
                    'reportProgress is disabled.',
            );
        }
        return null;
    }

    const chain = viemChainFor(CHAIN_ID);
    const rpc = verifyRpcUrl(CHAIN_ID) || undefined; // '' => viem public endpoint (dev fallback)
    const account = privateKeyToAccount(pk as `0x${string}`);
    const walletClient = createWalletClient({ account, chain, transport: http(rpc) });
    return { address: address as `0x${string}`, walletClient, account };
}

/**
 * Report `delta` units of progress for `wallet` on `missionId` to the on-chain
 * MissionSystem.
 *
 * Fire-and-forget friendly and NEVER THROWS — callers that do not need the
 * outcome should `void reportProgress(...)` so the game API never waits on chain
 * latency. Returns `true` only when a tx was actually submitted (configured,
 * valid args, and the node accepted the send); `false` otherwise, so the
 * daily-bonus endpoint can await it and fall back to the voucher path.
 *
 * The contract accumulates progress and flips completion (paying CHIPS) once the
 * target is reached; further calls for the same (wallet, mission, period) are
 * idempotent. `daily_bonus` has target 0, so a single call completes + pays it.
 */
export async function reportProgress(
    wallet: string,
    missionId: string,
    delta: number | bigint,
): Promise<boolean> {
    const clients = await getClients();
    if (!clients) return false;

    const w = String(wallet || '').toLowerCase();
    if (!/^0x[a-f0-9]{40}$/.test(w)) return false;
    if (!missionId || typeof missionId !== 'string') return false;
    const amount = typeof delta === 'bigint' ? delta : BigInt(Math.max(0, Math.floor(Number(delta))));
    if (amount <= BigInt(0)) return false;

    try {
        const data = encodeFunctionData({
            abi: MISSION_SYSTEM_ABI,
            functionName: 'recordProgress',
            args: [w as `0x${string}`, missionIdBytes32(missionId), amount],
        });
        const hash = (await clients.walletClient.request({
            method: 'eth_sendTransaction',
            params: [{ from: clients.account.address, to: clients.address, data }],
        })) as `0x${string}`;
        console.info(
            `[missionOracle] recordProgress ${missionId} -> ${w} delta ${amount.toString()} tx ${hash}`,
        );
        return true;
    } catch (err) {
        // Never break the request. The Postgres write already succeeded.
        console.error(`[missionOracle] recordProgress failed for ${missionId}/${w}:`, err);
        return false;
    }
}
