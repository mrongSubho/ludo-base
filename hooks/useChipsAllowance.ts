"use client";

import { useCallback, useMemo } from "react";
import { useAccount, useReadContract, useWriteContract, useSwitchChain } from "wagmi";
import { baseSepolia } from "wagmi/chains";
import {
    createPublicClient,
    http,
    encodeFunctionData,
    type Address,
    type Hex,
} from "viem";
import { usePlayerSigner } from "@/hooks/usePlayerSigner";
import { useCdpUserOp } from "@/hooks/useCdpUserOp";
import { showTxPrompt } from "@/hooks/useAuthPrompt";
import {
    CHIPS_ERC20_ABI,
    chipsAddress,
    matchPoolAddress,
    formatChips,
    isChipsConfigured,
} from "@/lib/chips";

export const CHIPS_CHAIN_ID = baseSepolia.id;

export interface AllowancePreset {
    label: string;
    chips: number;
    amount: bigint;
    hint: string;
    recommended?: boolean;
    isUnlimited?: boolean;
}

/**
 * Standard tactical budget presets for ranked matchmaking allowances.
 */
export const ALLOWANCE_PRESETS: readonly AllowancePreset[] = [
    {
        label: "Casual (100 CHIPS)",
        chips: 100,
        amount: BigInt(100) * BigInt(10 ** 18),
        hint: "~10 ranked matches",
        recommended: false,
    },
    {
        label: "Tactical (500 CHIPS)",
        chips: 500,
        amount: BigInt(500) * BigInt(10 ** 18),
        hint: "~50 ranked matches (Recommended)",
        recommended: true,
    },
    {
        label: "High Roller (1,000 CHIPS)",
        chips: 1000,
        amount: BigInt(1000) * BigInt(10 ** 18),
        hint: "Heavy tournament grinding",
        recommended: false,
    },
    {
        label: "Unlimited",
        chips: Infinity,
        amount: (BigInt(1) << BigInt(256)) - BigInt(1),
        hint: "DeFi permanent approval",
        isUnlimited: true,
        recommended: false,
    },
] as const;

export const DEFAULT_TACTICAL_ALLOWANCE = BigInt(500) * BigInt(10 ** 18);

function getRpcClient() {
    return createPublicClient({
        chain: baseSepolia,
        transport: http(),
    });
}

/**
 * Static reader for checking allowances imperatively inside async match actions.
 */
export async function readAllowanceDirect(
    owner: Address,
    spender: Address = matchPoolAddress() as Address,
): Promise<bigint> {
    const token = chipsAddress();
    if (!token || !owner || !spender) return BigInt(0);

    try {
        const client = getRpcClient();
        const data = await client.readContract({
            address: token,
            abi: CHIPS_ERC20_ABI,
            functionName: "allowance",
            args: [owner, spender],
        });
        return typeof data === "bigint" ? data : BigInt(0);
    } catch (e) {
        console.warn("[useChipsAllowance] readAllowanceDirect failed:", e);
        return BigInt(0);
    }
}

export function useChipsAllowance(customSpender?: `0x${string}`) {
    const { address: wagmiAddress, chainId } = useAccount();
    const { switchChainAsync } = useSwitchChain();
    const player = usePlayerSigner();
    const cdpUserOp = useCdpUserOp();
    const { writeContractAsync, isPending: isWriting } = useWriteContract();

    const address = wagmiAddress ?? (player.address as `0x${string}` | undefined);
    const token = chipsAddress();
    const defaultSpender = matchPoolAddress();
    const spender = customSpender ?? defaultSpender;

    const enabled = Boolean(address && token && spender);

    const {
        data: rawAllowance,
        refetch,
        isFetching,
        error: readError,
    } = useReadContract({
        address: token,
        abi: CHIPS_ERC20_ABI,
        functionName: "allowance",
        args: address && spender ? [address, spender] : undefined,
        chainId: CHIPS_CHAIN_ID,
        query: {
            enabled,
            refetchInterval: 20_000,
            staleTime: 10_000,
        },
    });

    const allowance = typeof rawAllowance === "bigint" ? rawAllowance : BigInt(0);
    const isUnlimited = allowance >= (BigInt(1) << BigInt(250));

    const allowanceHuman = useMemo(() => {
        if (!enabled || rawAllowance == null) return "—";
        if (isUnlimited) return "Unlimited";
        if (allowance === BigInt(0)) return "0 CHIPS";
        return `${formatChips(allowance)} CHIPS`;
    }, [enabled, rawAllowance, isUnlimited, allowance]);

    const hasAllowance = useCallback(
        (neededAmount: bigint) => {
            if (isUnlimited) return true;
            return allowance >= neededAmount;
        },
        [isUnlimited, allowance],
    );

    /**
     * Approves an allowance amount on-chain.
     */
    const approve = useCallback(
        async (amount: bigint) => {
            if (!address || !token || !spender) {
                throw new Error("Wallet, token, or spender not configured");
            }

            const isRevoke = amount === BigInt(0);
            const isUnlim = amount >= (BigInt(1) << BigInt(250));
            const humanAmount = isRevoke ? "0 CHIPS" : isUnlim ? "Unlimited CHIPS" : `${formatChips(amount)} CHIPS`;

            let hidePrompt: (() => void) | undefined;
            try {
                hidePrompt = showTxPrompt({
                    context: "contract-call",
                    title: isRevoke ? "REVOKE TOKEN ALLOWANCE" : "SET CHIPS ALLOWANCE",
                    statusText: isRevoke
                        ? "Please approve resetting your CHIPS allowance to 0 in your wallet."
                        : `Please approve the ${humanAmount} allowance for ranked match matchmaking.`,
                    explanationText: isRevoke
                        ? "Revoking resets spender permissions back to 0."
                        : "Pre-authorizing avoids approval popups on subsequent matches.",
                });

                if (player.mode === "ingame" && cdpUserOp.isInGame) {
                    const approveData = encodeFunctionData({
                        abi: CHIPS_ERC20_ABI,
                        functionName: "approve",
                        args: [spender, amount],
                    });
                    await cdpUserOp.sendCalls([{ to: token, data: approveData as Hex }]);
                } else {
                    if (chainId && chainId !== CHIPS_CHAIN_ID) {
                        try {
                            await switchChainAsync({ chainId: CHIPS_CHAIN_ID });
                        } catch (err) {
                            console.warn("[useChipsAllowance] Network switch before approve failed:", err);
                        }
                    }
                    await writeContractAsync({
                        address: token,
                        abi: CHIPS_ERC20_ABI,
                        functionName: "approve",
                        args: [spender, amount],
                        chainId: CHIPS_CHAIN_ID,
                    });
                }

                await refetch();
            } finally {
                hidePrompt?.();
            }
        },
        [address, token, spender, player.mode, cdpUserOp, writeContractAsync, refetch, chainId, switchChainAsync],
    );

    /**
     * Resets allowance back to 0.
     */
    const revoke = useCallback(async () => {
        return approve(BigInt(0));
    }, [approve]);

    return {
        address,
        token,
        spender,
        allowance,
        allowanceHuman,
        isUnlimited,
        hasAllowance,
        approve,
        revoke,
        refetch,
        isPending: isWriting || isFetching,
        configured: isChipsConfigured(),
        mode: player.mode,
        readError,
    };
}
