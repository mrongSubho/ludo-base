"use client";

import { useCallback, useMemo } from "react";
import { useAccount, useReadContract, useWriteContract, useSwitchChain } from "wagmi";
import { baseSepolia } from "wagmi/chains";
import {
    createPublicClient,
    http,
    encodeFunctionData,
    formatUnits,
    getAddress,
    isAddress,
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
    isChipsConfigured,
} from "@/lib/chips";

export const CHIPS_CHAIN_ID = baseSepolia.id;

export type AllowanceTokenType = "chips" | "usdc";

export interface AllowancePreset {
    label: string;
    chips: number; // units (in CHIPS or USDC dollars)
    amount: bigint;
    hint: string;
    recommended?: boolean;
    isUnlimited?: boolean;
}

export interface UsdcAllowancePreset {
    label: string;
    value: number;
    amount: bigint;
    hint: string;
    recommended?: boolean;
    isUnlimited?: boolean;
}

/**
 * Standard user-friendly presets for CHIPS ranked matchmaking budgets.
 * 10k Starter, 100k Tactical (Recommended), 1M Pro Player, Never ask again (Unlimited).
 */
export const CHIPS_ALLOWANCE_PRESETS: readonly AllowancePreset[] = [
    {
        label: "10k Starter",
        chips: 10_000,
        amount: BigInt(10_000) * BigInt(10 ** 18),
        hint: "~100 ranked matches",
        recommended: false,
    },
    {
        label: "100k Tactical",
        chips: 100_000,
        amount: BigInt(100_000) * BigInt(10 ** 18),
        hint: "~1,000 matches (Recommended)",
        recommended: true,
    },
    {
        label: "1M Pro Player",
        chips: 1_000_000,
        amount: BigInt(1_000_000) * BigInt(10 ** 18),
        hint: "Heavy tournament grinding",
        recommended: false,
    },
    {
        label: "Never ask again (Unlimited)",
        chips: Infinity,
        amount: (BigInt(1) << BigInt(256)) - BigInt(1),
        hint: "Never prompt for approvals again",
        isUnlimited: true,
        recommended: false,
    },
] as const;

/** Alias for backwards compatibility */
export const ALLOWANCE_PRESETS = CHIPS_ALLOWANCE_PRESETS;

/**
 * Standard presets for USDC marketplace item budgets.
 * $5 Starter, $20 Regular (Recommended), $50 Collector, Never ask again (Unlimited).
 */
export const USDC_ALLOWANCE_PRESETS: readonly UsdcAllowancePreset[] = [
    {
        label: "$5 Starter",
        value: 5,
        amount: BigInt(5) * BigInt(10 ** 6),
        hint: "Casual cosmetics & emotes",
        recommended: false,
    },
    {
        label: "$20 Regular",
        value: 20,
        amount: BigInt(20) * BigInt(10 ** 6),
        hint: "Popular bundles (Recommended)",
        recommended: true,
    },
    {
        label: "$50 Collector",
        value: 50,
        amount: BigInt(50) * BigInt(10 ** 6),
        hint: "Premium boards & sets",
        recommended: false,
    },
    {
        label: "Never ask again (Unlimited)",
        value: Infinity,
        amount: (BigInt(1) << BigInt(256)) - BigInt(1),
        hint: "Never prompt for approvals again",
        isUnlimited: true,
        recommended: false,
    },
] as const;

export const DEFAULT_TACTICAL_ALLOWANCE = BigInt(500) * BigInt(10 ** 18);

export const USDC_BASE_SEPOLIA: Address = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

export function usdcTokenAddress(): Address {
    const envAddr = process.env.NEXT_PUBLIC_USDC_ADDRESS;
    return (envAddr && isAddress(envAddr) ? getAddress(envAddr) : USDC_BASE_SEPOLIA) as Address;
}

export function marketplaceSpenderAddress(): Address {
    const envAddr = process.env.NEXT_PUBLIC_MARKETPLACE_ADDRESS || process.env.NEXT_PUBLIC_CLAIM_HUB_ADDRESS;
    return (envAddr && isAddress(envAddr) ? getAddress(envAddr) : "0x15dF536466Ef58f77e95D7432089DeEBDf276821") as Address;
}

function getRpcClient() {
    return createPublicClient({
        chain: baseSepolia,
        transport: http(),
    });
}

export function formatAllowanceDisplay(amount: bigint, tokenType: AllowanceTokenType): string {
    if (amount >= (BigInt(1) << BigInt(250))) return "Unlimited";
    if (amount === BigInt(0)) return tokenType === "chips" ? "0 CHIPS" : "$0 USDC";

    if (tokenType === "chips") {
        const whole = Number(formatUnits(amount, 18));
        if (whole >= 1_000_000) {
            return `${Number((whole / 1_000_000).toFixed(1)).toString()}M CHIPS`;
        }
        if (whole >= 1_000) {
            return `${Number((whole / 1_000).toFixed(1)).toString()}k CHIPS`;
        }
        return `${whole} CHIPS`;
    } else {
        const whole = Number(formatUnits(amount, 6));
        return `$${whole.toLocaleString()} USDC`;
    }
}

/**
 * Static reader for checking allowances imperatively inside async match actions.
 */
export async function readAllowanceDirect(
    owner: Address,
    spender: Address = matchPoolAddress() as Address,
    tokenAddress: Address = chipsAddress() as Address,
): Promise<bigint> {
    if (!tokenAddress || !owner || !spender) return BigInt(0);

    try {
        const client = getRpcClient();
        const data = await client.readContract({
            address: tokenAddress,
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

export function useTokenAllowance(
    tokenType: AllowanceTokenType = "chips",
    customSpender?: `0x${string}`,
) {
    const { address: wagmiAddress, chainId } = useAccount();
    const { switchChainAsync } = useSwitchChain();
    const player = usePlayerSigner();
    const cdpUserOp = useCdpUserOp();
    const { writeContractAsync, isPending: isWriting } = useWriteContract();

    const address = wagmiAddress ?? (player.address as `0x${string}` | undefined);

    const token = tokenType === "chips" ? chipsAddress() : usdcTokenAddress();
    const defaultSpender = tokenType === "chips" ? matchPoolAddress() : marketplaceSpenderAddress();
    const spender = customSpender ?? defaultSpender;
    const decimals = tokenType === "chips" ? 18 : 6;
    const symbol = tokenType === "chips" ? "CHIPS" : "USDC";
    const targetName = tokenType === "chips" ? "Ranked Matches" : "Marketplace Items";

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
        return formatAllowanceDisplay(allowance, tokenType);
    }, [enabled, rawAllowance, allowance, tokenType]);

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
            const humanAmount = formatAllowanceDisplay(amount, tokenType);

            let hidePrompt: (() => void) | undefined;
            try {
                hidePrompt = showTxPrompt({
                    context: "contract-call",
                    title: isRevoke ? `RESET ${symbol} BUDGET` : `SET ${symbol} BUDGET`,
                    statusText: isRevoke
                        ? `Please confirm resetting your ${symbol} allowance to 0 in your wallet.`
                        : `Please approve the ${humanAmount} budget for ${targetName}.`,
                    explanationText: isRevoke
                        ? "Revoking resets your pre-approved budget back to 0. Funds stay safe in your wallet."
                        : `Pre-approving allows 1-click entry for ${targetName} without popup interruptions.`,
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
                            console.warn("[useTokenAllowance] Network switch before approve failed:", err);
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
        [address, token, spender, tokenType, symbol, targetName, player.mode, cdpUserOp, writeContractAsync, refetch, chainId, switchChainAsync],
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
        tokenType,
        symbol,
        decimals,
        targetName,
        spender,
        allowance,
        allowanceHuman,
        isUnlimited,
        hasAllowance,
        approve,
        revoke,
        refetch,
        isPending: isWriting || isFetching,
        configured: tokenType === "chips" ? isChipsConfigured() : Boolean(token && spender),
        mode: player.mode,
        readError,
    };
}

export function useChipsAllowance(customSpender?: `0x${string}`) {
    return useTokenAllowance("chips", customSpender);
}
