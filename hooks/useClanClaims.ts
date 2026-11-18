/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useAccount, useWriteContract, useSwitchChain, usePublicClient } from "wagmi";
import { encodeFunctionData } from "viem";
import { showTxPrompt, updateAuthPromptStatus } from "@/hooks/useAuthPrompt";
import { useAppSession } from "@/hooks/useAppSession";
import { usePlayerSigner } from "@/hooks/usePlayerSigner";
import { useCdpUserOp } from "@/hooks/useCdpUserOp";
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
    const publicClient = usePublicClient();
    const player = usePlayerSigner();
    const cdpUserOp = useCdpUserOp();

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

        const sid = peekAppSession();
        if (!sid) {
            setClaims([]);
            return;
        }

        setIsLoading(true);
        setError(null);

        try {
            const headers: Record<string, string> = {
                "Content-Type": "application/json",
                Authorization: `Bearer ${sid}`,
            };

            const res = await fetch("/api/clans/claims", {
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
    const requestVoucher = useCallback(async (claimId: string, sessionId: string): Promise<IssuedClanClaimVoucher> => {
        if (!address) throw new Error("Wallet not connected");

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
    }, [address, chainId]);

    /**
     * Confirm claimed rows on the server once the on-chain tx confirms.
     */
    const confirmClaimsOnServer = useCallback(async (claimIds: string[], txHash: string, sessionId: string) => {
        if (!address || !claimIds.length) return;
        const res = await fetch("/api/clans/claims", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${sessionId}`,
            },
            body: JSON.stringify({
                action: "confirm_claim",
                claimIds,
                txHash,
                walletAddress: address,
                sessionId,
            }),
        });
        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.error || "Failed to confirm claim status");
        }
    }, [address]);

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
            const sessionId = await ensureAppSession();
            if (!sessionId) throw new Error("Session required to claim");

            hidePrompt = showTxPrompt({
                context: "clan-claim",
                title: "CLAIM CLAN REWARD",
                statusText: `Please approve the transaction in your wallet to withdraw ${Number(claimItem.amount).toLocaleString()} CHIPS.`,
            });

            updateAuthPromptStatus("Requesting cryptographic claim voucher...", "Issuing Voucher");
            const issued = await requestVoucher(claimItem.id, sessionId);

            const voucherTuple = {
                claimId: issued.voucher.claimId,
                clanId: issued.voucher.clanId,
                recipient: issued.voucher.recipient,
                amount: BigInt(issued.voucher.amount),
                claimType: issued.voucher.claimType,
                nonce: BigInt(issued.voucher.nonce),
                deadline: BigInt(issued.voucher.deadline),
            };

            let txHash: string | undefined;
            if (player.mode === "ingame" && cdpUserOp.isInGame) {
                const calldata = encodeFunctionData({
                    abi: CLAN_CLAIM_ABI,
                    functionName: "claimReward",
                    args: [voucherTuple, issued.signature],
                });
                txHash = await cdpUserOp.sendCallsAndWait([{ to: issued.clanClaimContract, data: calldata }]);
            } else {
                if (chainId && chainId !== DEFAULT_CHAIN_ID) {
                    await switchChainAsync({ chainId: DEFAULT_CHAIN_ID });
                }

                updateAuthPromptStatus("Awaiting on-chain transaction approval...", "Awaiting Signature");
                const hash = await writeContractAsync({
                    address: issued.clanClaimContract,
                    abi: CLAN_CLAIM_ABI,
                    functionName: "claimReward",
                    args: [voucherTuple, issued.signature],
                });
                txHash = hash;

                if (publicClient && hash) {
                    updateAuthPromptStatus("Claim broadcast! Confirming on Base Sepolia...", "Confirming On-Chain");
                    await publicClient.waitForTransactionReceipt({ hash });
                }
            }

            if (txHash) {
                updateAuthPromptStatus("Syncing claim ledger...", "Syncing Ledger");
                await confirmClaimsOnServer([claimItem.id], txHash, sessionId);
            }
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
    }, [
        address,
        cdpUserOp,
        chainId,
        confirmClaimsOnServer,
        ensureAppSession,
        player.mode,
        publicClient,
        refresh,
        requestVoucher,
        switchChainAsync,
        writeContractAsync,
    ]);

    /**
     * Batch claim all pending vouchers in a single gas-efficient transaction.
     */
    const claimAll = useCallback(async () => {
        if (!address || claims.length === 0) return;
        setIsClaimingAll(true);
        setError(null);
        let hidePrompt: (() => void) | undefined;

        try {
            const sessionId = await ensureAppSession();
            if (!sessionId) throw new Error("Session required to claim");

            hidePrompt = showTxPrompt({
                context: "clan-batch-claim",
                title: "BATCH CLAIM CLAN REWARDS",
                statusText: `Please approve the batch transaction to withdraw ${totalClaimableChips.toLocaleString()} CHIPS across ${claims.length} claims.`,
            });

            updateAuthPromptStatus(`Issuing ${claims.length} cryptographic vouchers...`, "Preparing Vouchers");
            const vouchers: Array<{
                claimId: `0x${string}`;
                clanId: `0x${string}`;
                recipient: `0x${string}`;
                amount: bigint;
                claimType: number;
                nonce: bigint;
                deadline: bigint;
            }> = [];
            const signatures: `0x${string}`[] = [];
            let contractAddress: `0x${string}` | null = null;

            for (const item of claims) {
                const issued = await requestVoucher(item.id, sessionId);
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

            let txHash: string | undefined;
            if (player.mode === "ingame" && cdpUserOp.isInGame) {
                const calldata = encodeFunctionData({
                    abi: CLAN_CLAIM_ABI,
                    functionName: "claimBatch",
                    args: [vouchers, signatures],
                });
                txHash = await cdpUserOp.sendCallsAndWait([{ to: contractAddress, data: calldata }]);
            } else {
                if (chainId && chainId !== DEFAULT_CHAIN_ID) {
                    await switchChainAsync({ chainId: DEFAULT_CHAIN_ID });
                }

                updateAuthPromptStatus("Awaiting batch transaction confirmation...", "Awaiting Signature");
                const hash = await writeContractAsync({
                    address: contractAddress,
                    abi: CLAN_CLAIM_ABI,
                    functionName: "claimBatch",
                    args: [vouchers, signatures],
                });
                txHash = hash;

                if (publicClient && hash) {
                    updateAuthPromptStatus("Batch claim broadcast! Confirming on Base Sepolia...", "Confirming On-Chain");
                    await publicClient.waitForTransactionReceipt({ hash });
                }
            }

            if (txHash) {
                updateAuthPromptStatus("Syncing claim ledger...", "Syncing Ledger");
                await confirmClaimsOnServer(claims.map((c) => c.id), txHash, sessionId);
            }
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
    }, [
        address,
        cdpUserOp,
        chainId,
        claims,
        confirmClaimsOnServer,
        ensureAppSession,
        player.mode,
        publicClient,
        refresh,
        requestVoucher,
        switchChainAsync,
        totalClaimableChips,
        writeContractAsync,
    ]);

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
