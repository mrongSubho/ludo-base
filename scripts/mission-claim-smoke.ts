/**
 * Mission voucher live smoke — issue API voucher then MissionClaim.claim on Sepolia.
 * Requires: MISSION_OP_PRIVATE_KEY (matches on-chain opKey), NEXT_PUBLIC_MISSION_CLAIM_ADDRESS
 * Optional live check: npx tsx scripts/mission-claim-smoke.ts
 */
import { missionVoucherDigest, periodIdDay, type MissionVoucher } from "../lib/missionVoucher";
import { parseChainId } from "../lib/chains";
import {
    createPublicClient,
    createWalletClient,
    encodeFunctionData,
    http,
    parseUnits,
    type Address,
    type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { viemChainFor } from "../lib/chains";

const MISSION_CLAIM_ABI = [
    {
        type: "function",
        name: "claim",
        stateMutability: "nonpayable",
        inputs: [
            { name: "wallet", type: "address" },
            { name: "missionId", type: "bytes32" },
            { name: "amount", type: "uint256" },
            { name: "periodId", type: "bytes32" },
            { name: "deadline", type: "uint64" },
            { name: "nonce", type: "uint256" },
            { name: "sig", type: "bytes" },
        ],
        outputs: [],
    },
] as const;

async function main() {
    const chainId = parseChainId(Number(process.env.CHAIN_ID ?? 84532));
    if (!chainId) throw new Error("bad CHAIN_ID");
    const claim = (process.env.NEXT_PUBLIC_MISSION_CLAIM_ADDRESS ?? "") as Address;
    const opPk = process.env.MISSION_OP_PRIVATE_KEY as Hex;
    const playerPk = process.env.PLAYER_PK as Hex;
    if (!claim || !opPk || !playerPk) throw new Error("need MISSION_CLAIM, MISSION_OP_PRIVATE_KEY, PLAYER_PK");

    const account = privateKeyToAccount(playerPk);
    const op = privateKeyToAccount(opPk);
    const voucher: MissionVoucher = {
        wallet: account.address,
        missionId: periodIdDay(new Date()), // placeholder overwritten below
        amount: parseUnits("50", 18),
        periodId: periodIdDay(new Date()),
        deadline: BigInt(Math.floor(Date.now() / 1000) + 7 * 86400),
        nonce: BigInt(Date.now()),
    };
    // missionId = keccak("welcome_grant") via periodIdDay-like helper
    const { keccak256, toBytes } = await import("viem");
    voucher.missionId = keccak256(toBytes("welcome_grant"));
    const digest = missionVoucherDigest(voucher, claim, chainId);
    const sig = await op.sign({ hash: digest });

    const wallet = createWalletClient({ account, chain: viemChainFor(chainId), transport: http(process.env.SEPOLIA_RPC ?? "https://sepolia.base.org") });
    const publicClient = createPublicClient({ chain: viemChainFor(chainId), transport: http(process.env.SEPOLIA_RPC ?? "https://sepolia.base.org") });

    const hash = await wallet.sendTransaction({
        to: claim,
        data: encodeFunctionData({
            abi: MISSION_CLAIM_ABI,
            functionName: "claim",
            args: [
                voucher.wallet,
                voucher.missionId,
                voucher.amount,
                voucher.periodId,
                voucher.deadline,
                voucher.nonce,
                sig,
            ],
        }),
    });
    console.log("claim tx", hash);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    console.log("status", receipt.status);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
