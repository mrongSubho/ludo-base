/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useAccount, useWriteContract, useSwitchChain } from "wagmi";
import { showTxPrompt, updateAuthPromptStatus } from "@/hooks/useAuthPrompt";
import { useAppSession } from "@/hooks/useAppSession";
import { DEFAULT_CHAIN_ID } from "@/lib/chains";
import type { ClanClaimItem, IssuedClanClaimVoucher } from "@/lib/clan/types";

export const CLAN_CLAIM_ABI = [
    {
        name: "claimReward",
        type: "function",
        stateMutability: "nonpayable",
        inputs: [
            {
                name: "voucher",
                type: "tuple",
                components: [
                    { name: "claimId", type: "bytes32" },
                    { name: "clanId", type: "bytes32" },
                    { name: "recipient", type: "address" },
                    { name: "amount", type: "uint256" },
                    { name: "claimType", type: "uint8" },
                    { name: "nonce", type: "uint256" },
                    { name: "deadline", type: "uint64" },
                ],
            },
            { name: "signature", type: "bytes" },
        ],
        outputs: [],
    },
    {
        name: "claimBatch",
        type: "function",
        stateMutability: "nonpayable",
        inputs: [
            {
                name: "vouchers",
                type: "tuple[]",
                components: [
                    { name: "claimId", type: "bytes32" },
                    { name: "clanId", type: "bytes32" },
                    { name: "recipient", type: "address" },
                    { name: "amount", type: "uint256" },
                    { name: "claimType", type: "uint8" },
                    { name: "nonce", type: "uint256" },
                    { name: "deadline", type: "uint64" },
                ],
            },
            { name: "signatures", type: "bytes[]" },
        ],
        outputs: [],
    },
] as const;

export function useClanClaims() {
    const { address, chainId } = useAccount();
    const { switchChainAsync } = useSwitchChain();
    const { ensureAppSession, peekAppSession } = useAppSession();
    const { writeContractAsync, isPending: isWriting } = useWriteContract();

    const [claims, setClaims] = useState<ClanClaimItem[]>([]);
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [claimingId, setClaimingId] = useState<string | null>(null);
    const [isClaimingAll, setIsClaimingAll] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);

    const refresh = useCallback(async () => {
        if (!address) {
            setClaims([]);
            return;
        }

        setIsLoading(true);
        setError(null);

        try {
            const sid = peekAppSession();
            const headers: Record<string, string> = { "Content-Type": "application/json" };
            if (sid) headers["Authorization"] = `Bearer ${sid}`;

            const res = await fetch(`/api/clans/claims?wallet=${encodeURIComponent(address)}`, {
                headers,
                cache: "no-store",
            });

            if (res.ok) {
                const data = await res.json();
                setClaims(data.claims || []);
            }
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.warn("[useClanClaims:refresh]", msg);
            setError(msg);
        } finally {
            setIsLoading(false);
        }
    }, [address, peekAppSession]);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    const totalClaimableChips = useMemo(() => {
        return claims.reduce((sum, c) => sum + Number(c.amount), 0);
    }, [claims]);

    /**
     * Request an EIP-712 signed claim voucher from server authority.
     */
    const requestVoucher = useCallback(async (claimId: string): Promise<IssuedClanClaimVoucher> => {
        if (!address) throw new Error("Wallet not connected");
        const sessionId = await ensureAppSession();
        if (!sessionId) throw new Error("Session required to request voucher");

        const res = await fetch("/api/clans/claims", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${sessionId}`,
            },
            body: JSON.stringify({
                claimId,
                walletAddress: address,
                sessionId,
                chainId: chainId || DEFAULT_CHAIN_ID,
            }),
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to issue claim voucher");

        return data as IssuedClanClaimVoucher;
    }, [address, chainId, ensureAppSession]);

    /**
     * Claim an individual reward on ClanClaim.sol.
     * User pays gas on Base Sepolia (D16).
     */
    const claimSingle = useCallback(async (claimItem: ClanClaimItem) => {
        if (!address) return;
        setClaimingId(claimItem.id);
        setError(null);
        let hidePrompt: (() => void) | undefined;

        try {
            if (chainId && chainId !== DEFAULT_CHAIN_ID) {
                await switchChainAsync({ chainId: DEFAULT_CHAIN_ID });
            }

            hidePrompt = showTxPrompt({
                context: "clan-claim",
                title: "CLAIM CLAN REWARD",
                statusText: `Please approve the transaction in your wallet to withdraw ${claimItem.amount} CHIPS.`,
            });

            // 1. Fetch voucher from backend
            updateAuthPromptStatus("Requesting cryptographic claim voucher...", "Issuing Voucher");
            const issued = await requestVoucher(claimItem.id);

            // 2. Submit on-chain claim
            updateAuthPromptStatus("Awaiting on-chain transaction approval...", "Awaiting Signature");
            const voucherTuple = {
                claimId: issued.voucher.claimId,
                clanId: issued.voucher.clanId,
                recipient: issued.voucher.recipient,
                amount: BigInt(issued.voucher.amount),
                claimType: issued.voucher.claimType,
                nonce: BigInt(issued.voucher.nonce),
                deadline: BigInt(issued.voucher.deadline),
            };

            await writeContractAsync({
                address: issued.clanClaimContract,
                abi: CLAN_CLAIM_ABI,
                functionName: "claimReward",
                args: [voucherTuple, issued.signature],
            });

            updateAuthPromptStatus("Claim broadcast! Confirming on Base Sepolia...", "Confirming On-Chain");
            await refresh();
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error("[useClanClaims:claimSingle]", msg);
            setError(msg);
            throw err;
        } finally {
            setClaimingId(null);
            hidePrompt?.();
        }
    }, [address, chainId, switchChainAsync, requestVoucher, writeContractAsync, refresh]);

    /**
     * Batch claim all pending vouchers in a single gas-efficient transaction.
     */
    const claimAll = useCallback(async () => {
        if (!address || claims.length === 0) return;
        setIsClaimingAll(true);
        setError(null);
        let hidePrompt: (() => void) | undefined;

        try {
            if (chainId && chainId !== DEFAULT_CHAIN_ID) {
                await switchChainAsync({ chainId: DEFAULT_CHAIN_ID });
            }

            hidePrompt = showTxPrompt({
                context: "clan-batch-claim",
                title: "BATCH CLAIM CLAN REWARDS",
                statusText: `Please approve the batch transaction to withdraw ${totalClaimableChips} CHIPS across ${claims.length} claims.`,
            });

            // 1. Request all vouchers
            updateAuthPromptStatus(`Issuing ${claims.length} cryptographic vouchers...`, "Preparing Vouchers");
            const vouchers: any[] = [];
            const signatures: `0x${string}`[] = [];
            let contractAddress: `0x${string}` | null = null;

            for (const item of claims) {
                const issued = await requestVoucher(item.id);
                if (!contractAddress) contractAddress = issued.clanClaimContract;
                vouchers.push({
                    claimId: issued.voucher.claimId,
                    clanId: issued.voucher.clanId,
                    recipient: issued.voucher.recipient,
                    amount: BigInt(issued.voucher.amount),
                    claimType: issued.voucher.claimType,
                    nonce: BigInt(issued.voucher.nonce),
                    deadline: BigInt(issued.voucher.deadline),
                });
                signatures.push(issued.signature);
            }

            if (!contractAddress) throw new Error("No claim contract resolved");

            // 2. Submit batch claim
            updateAuthPromptStatus("Awaiting batch transaction confirmation...", "Confirming On-Chain");
            await writeContractAsync({
                address: contractAddress,
                abi: CLAN_CLAIM_ABI,
                functionName: "claimBatch",
                args: [vouchers, signatures],
            });

            await refresh();
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error("[useClanClaims:claimAll]", msg);
            setError(msg);
            throw err;
        } finally {
            setIsClaimingAll(false);
            hidePrompt?.();
        }
    }, [address, claims, totalClaimableChips, chainId, switchChainAsync, requestVoucher, writeContractAsync, refresh]);

    return {
        claims,
        totalClaimableChips,
        isLoading,
        isWriting,
        claimingId,
        isClaimingAll,
        error,
        refresh,
        claimSingle,
        claimAll,
    };
}
