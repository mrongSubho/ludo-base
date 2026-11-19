"use client";

import { useCallback, useEffect, useState } from "react";
import { useAccount, usePublicClient, useSwitchChain, useWriteContract } from "wagmi";
import { encodeFunctionData, parseUnits, type Address } from "viem";
import { useAppSession } from "@/hooks/useAppSession";
import { usePlayerSigner } from "@/hooks/usePlayerSigner";
import { useCdpUserOp } from "@/hooks/useCdpUserOp";
import { showTxPrompt, updateAuthPromptStatus } from "@/hooks/useAuthPrompt";
import { readAllowanceDirect } from "@/hooks/useChipsAllowance";
import { ARENA_VAULT_ABI, CHIPS_ERC20_ABI, arenaVaultAddress, chipsAddress } from "@/lib/chips";
import { DEFAULT_CHAIN_ID } from "@/lib/chains";
import type { ArenaVaultClaimItem } from "@/lib/arenaVaultService";
import type { IssuedVaultVoucher } from "@/lib/arenaVaultVoucher";

const VAULT_EVENT = "ludo-arena-vault-updated";
const DEFAULT_CHIPS_ADDRESS: Address = "0xB200000000000000000000821408122b9Ed3d05B";

function notifyVaultUpdated() {
    if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent(VAULT_EVENT));
    }
}

export function useArenaVault() {
    const { address: wagmiAddress, chainId } = useAccount();
    const { switchChainAsync } = useSwitchChain();
    const { writeContractAsync } = useWriteContract();
    const publicClient = usePublicClient();
    const player = usePlayerSigner();
    const address = (player.address ?? wagmiAddress) as Address | undefined;
    const cdpUserOp = useCdpUserOp();
    const { sessionId: activeSessionId, ensureAppSession, peekAppSession } = useAppSession();

    const [availableChips, setAvailableChips] = useState<number>(0);
    const [reservedChips, setReservedChips] = useState<number>(0);
    const [claims, setClaims] = useState<ArenaVaultClaimItem[]>([]);
    const [totalClaimableChips, setTotalClaimableChips] = useState<number>(0);
    const [prizeTotalChips, setPrizeTotalChips] = useState<number>(0);
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [isActing, setIsActing] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);

    const refresh = useCallback(async (forceSessionId?: string) => {
        if (!address) {
            setAvailableChips(0);
            setReservedChips(0);
            setClaims([]);
            setTotalClaimableChips(0);
            setPrizeTotalChips(0);
            return null;
        }

        const sid = forceSessionId || activeSessionId || peekAppSession();
        if (!sid) return null;

        setIsLoading(true);
        try {
            const res = await fetch(`/api/vault?walletAddress=${encodeURIComponent(address)}`, {
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${sid}`,
                },
                cache: "no-store",
            });
            if (!res.ok) return null;
            const data = await res.json();
            setAvailableChips(Number(data.availableChips ?? 0));
            setReservedChips(Number(data.reservedChips ?? 0));
            setClaims(Array.isArray(data.claims) ? data.claims : []);
            setTotalClaimableChips(Number(data.totalClaimableChips ?? 0));
            setPrizeTotalChips(Number(data.prizeTotalChips ?? 0));
            return Number(data.availableChips ?? 0);
        } catch (err) {
            console.warn("[useArenaVault:refresh]", err);
            return null;
        } finally {
            setIsLoading(false);
        }
    }, [activeSessionId, address, peekAppSession]);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    useEffect(() => {
        if (typeof window === "undefined") return;
        const onUpdate = () => {
            void refresh();
        };
        window.addEventListener(VAULT_EVENT, onUpdate);
        window.addEventListener("ludo-chips-refresh", onUpdate);
        return () => {
            window.removeEventListener(VAULT_EVENT, onUpdate);
            window.removeEventListener("ludo-chips-refresh", onUpdate);
        };
    }, [refresh]);

    /**
     * Deposit CHIPS on-chain into ArenaVault.sol (`depositVault`) and credit reusable Match Vault.
     */
    const topUpVault = useCallback(
        async (amountChips: number, overrideSessionId?: string): Promise<number> => {
            if (!address) throw new Error("Wallet not connected");
            if (!Number.isFinite(amountChips) || amountChips <= 0) {
                throw new Error("Deposit amount must be greater than 0");
            }

            const sessionId = overrideSessionId || (await ensureAppSession());
            if (!sessionId) throw new Error("Session required to top up Match Vault");

            const vaultContract = arenaVaultAddress();
            const chipsToken = chipsAddress() || DEFAULT_CHIPS_ADDRESS;
            if (!vaultContract) throw new Error("ArenaVault contract is not configured");

            const cleanAmount = Math.ceil(amountChips);
            const amountWei = parseUnits(String(cleanAmount), 18);

            setIsActing(true);
            setError(null);
            let hidePrompt: (() => void) | undefined;
            let txHash: string | undefined;

            try {
                const currentAllowance = await readAllowanceDirect(address as Address, vaultContract);
                const hasAllowance = currentAllowance >= amountWei;

                hidePrompt = showTxPrompt({
                    context: "vault-deposit",
                    title: "TOP UP MATCH VAULT",
                    statusText: hasAllowance
                        ? `Approve deposit of ${cleanAmount.toLocaleString()} CHIPS into your reusable Match Vault.`
                        : `Approve CHIPS allowance and deposit ${cleanAmount.toLocaleString()} CHIPS into your Match Vault.`,
                    explanationText:
                        "Unused fees stay safely in your Match Vault across cancelled searches & rooms with 0 repeat gas.",
                });

                const depositData = encodeFunctionData({
                    abi: ARENA_VAULT_ABI,
                    functionName: "depositVault",
                    args: [amountWei],
                });

                if (player.mode === "ingame" && cdpUserOp.isInGame) {
                    const calls = hasAllowance
                        ? [{ to: vaultContract, data: depositData }]
                        : [
                              {
                                  to: chipsToken,
                                  data: encodeFunctionData({
                                      abi: CHIPS_ERC20_ABI,
                                      functionName: "approve",
                                      args: [vaultContract, amountWei],
                                  }),
                              },
                              { to: vaultContract, data: depositData },
                          ];
                    txHash = await cdpUserOp.sendCallsAndWait(calls);
                } else {
                    if (chainId && chainId !== DEFAULT_CHAIN_ID) {
                        try {
                            await switchChainAsync({ chainId: DEFAULT_CHAIN_ID });
                        } catch (err) {
                            console.warn("[useArenaVault] Network switch failed:", err);
                        }
                    }

                    if (!hasAllowance) {
                        updateAuthPromptStatus(
                            `Step 1/2: Approve ${cleanAmount.toLocaleString()} CHIPS allowance in your wallet...`,
                            "Awaiting Approval",
                        );
                        const approveHash = await writeContractAsync({
                            address: chipsToken,
                            abi: CHIPS_ERC20_ABI,
                            functionName: "approve",
                            args: [vaultContract, amountWei],
                        });
                        if (publicClient && approveHash) {
                            updateAuthPromptStatus(
                                "Allowance submitted! Confirming on Base Sepolia...",
                                "Confirming Approval",
                            );
                            await publicClient.waitForTransactionReceipt({ hash: approveHash });
                        }
                    }

                    updateAuthPromptStatus(
                        `${hasAllowance ? "" : "Step 2/2: "}Confirm ${cleanAmount.toLocaleString()} CHIPS deposit to Match Vault...`,
                        "Awaiting Deposit",
                    );
                    const depositHash = await writeContractAsync({
                        address: vaultContract,
                        abi: ARENA_VAULT_ABI,
                        functionName: "depositVault",
                        args: [amountWei],
                    });
                    txHash = depositHash;

                    if (publicClient && depositHash) {
                        updateAuthPromptStatus(
                            "Deposit broadcast! Confirming on Base Sepolia...",
                            "Confirming On-Chain",
                        );
                        await publicClient.waitForTransactionReceipt({ hash: depositHash });
                    }
                }
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                setError(msg);
                throw err;
            } finally {
                hidePrompt?.();
            }

            try {
                if (!txHash) throw new Error("Vault deposit transaction was cancelled");
                const res = await fetch("/api/vault", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${sessionId}`,
                    },
                    body: JSON.stringify({
                        action: "deposit",
                        walletAddress: address,
                        sessionId,
                        txHash,
                        amountChips: cleanAmount,
                    }),
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || "Failed to credit Match Vault deposit");
                await refresh(sessionId);
                notifyVaultUpdated();
                return Number(data.balance ?? 0);
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                setError(msg);
                throw err;
            } finally {
                setIsActing(false);
            }
        },
        [address, chainId, cdpUserOp, ensureAppSession, player.mode, publicClient, refresh, switchChainAsync, writeContractAsync],
    );

    /**
     * Execute pull-claim transactions on ArenaVault.sol for an array of issued EIP-712 vouchers.
     */
    const executeVoucherPull = useCallback(
        async (vouchers: IssuedVaultVoucher[], sessionId: string, titleOverride?: string) => {
            if (!vouchers.length || !address) return;
            const contractAddr = vouchers[0].arenaVaultContract;
            let hidePrompt: (() => void) | undefined;
            let txHash: string | undefined;

            try {
                hidePrompt = showTxPrompt({
                    context: "vault-claim",
                    title: titleOverride || "CLAIM FROM ARENA VAULT",
                    statusText:
                        vouchers.length === 1
                            ? "Approve the pull-claim transaction in your wallet to receive your CHIPS."
                            : `Approve batch pull-claim across ${vouchers.length} rewards/withdrawals.`,
                });

                if (chainId && chainId !== DEFAULT_CHAIN_ID && !(player.mode === "ingame" && cdpUserOp.isInGame)) {
                    try {
                        await switchChainAsync({ chainId: DEFAULT_CHAIN_ID });
                    } catch (err) {
                        console.warn("[useArenaVault] Network switch before claim failed:", err);
                    }
                }

                const formatted = vouchers.map((v) => ({
                    claimId: v.voucher.claimId,
                    recipient: v.voucher.recipient,
                    amount: BigInt(v.voucher.amount),
                    claimType: v.voucher.claimType,
                    nonce: BigInt(v.voucher.nonce),
                    deadline: BigInt(v.voucher.deadline),
                }));

                if (vouchers.length === 1) {
                    const hash = await writeContractAsync({
                        address: contractAddr,
                        abi: ARENA_VAULT_ABI,
                        functionName: "claimReward",
                        args: [formatted[0], vouchers[0].signature],
                    });
                    txHash = hash;
                } else {
                    const hash = await writeContractAsync({
                        address: contractAddr,
                        abi: ARENA_VAULT_ABI,
                        functionName: "claimBatch",
                        args: [formatted, vouchers.map((v) => v.signature)],
                    });
                    txHash = hash;
                }

                if (publicClient && txHash) {
                    updateAuthPromptStatus(
                        "Claim broadcast! Confirming CHIPS transfer on Base Sepolia...",
                        "Confirming On-Chain",
                    );
                    await publicClient.waitForTransactionReceipt({ hash: txHash as `0x${string}` });
                }

                await fetch("/api/vault", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${sessionId}`,
                    },
                    body: JSON.stringify({
                        action: "confirm_claim",
                        walletAddress: address,
                        sessionId,
                        claimIds: vouchers.map((v) => v.id),
                        txHash: txHash || "0x0",
                    }),
                });
            } finally {
                hidePrompt?.();
            }
        },
        [address, cdpUserOp.isInGame, chainId, player.mode, publicClient, switchChainAsync, writeContractAsync],
    );

    /**
     * Ensure at least `amountChips` is available in Match Vault.
     * - If `availableChips >= amountChips`: 0 wallet popups, 0 gas.
     * - If short: checks CHIPS allowance via `readAllowanceDirect`, opens wallet modal
     *   for approval (if needed) and deposits only the deficit (`amountChips - availableChips`).
     */
    const ensureVaultForStake = useCallback(
        async (amountChips: number, overrideSessionId?: string): Promise<{ balance: number; toppedUp: number }> => {
            if (!address) throw new Error("Wallet not connected");
            const needed = Math.ceil(Number(amountChips));
            if (!Number.isFinite(needed) || needed <= 0) {
                throw new Error("Amount must be greater than 0");
            }

            const sessionId = overrideSessionId || (await ensureAppSession());
            if (!sessionId) throw new Error("Session required");

            const liveBalance = (await refresh(sessionId)) ?? availableChips;
            const deficit = Math.max(0, needed - liveBalance);

            if (deficit > 0) {
                const updatedBal = await topUpVault(deficit, sessionId);
                return { balance: updatedBal, toppedUp: deficit };
            }

            return { balance: liveBalance, toppedUp: 0 };
        },
        [address, availableChips, ensureAppSession, refresh, topUpVault],
    );

    /**
     * Smart differential top-up + reservation before starting Quick Match or TeamUp.
     * - If `vaultBalance >= entryFee`: 0 wallet popups, 0 gas, instant reserve!
     * - If `vaultBalance < entryFee`: prompts ONLY for `entryFee - vaultBalance` difference!
     */
    const ensureVaultAndReserve = useCallback(
        async (params: { matchKey: string; entryFeeChips: number }) => {
            if (!address) throw new Error("Wallet not connected");
            if (params.entryFeeChips <= 0) return { balance: availableChips, reserved: 0, toppedUp: 0 };

            const sessionId = await ensureAppSession();
            if (!sessionId) throw new Error("Session required");

            setIsActing(true);
            setError(null);
            try {
                const liveBalance = (await refresh(sessionId)) ?? availableChips;
                const deficit = Math.max(0, params.entryFeeChips - liveBalance);

                if (deficit > 0) {
                    await topUpVault(deficit, sessionId);
                }

                const res = await fetch("/api/vault", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${sessionId}`,
                    },
                    body: JSON.stringify({
                        action: "reserve",
                        walletAddress: address,
                        sessionId,
                        matchKey: params.matchKey,
                        amountChips: params.entryFeeChips,
                    }),
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || "Failed to reserve match fee from Vault");
                await refresh(sessionId);
                notifyVaultUpdated();
                return {
                    balance: Number(data.balance ?? 0),
                    reserved: Number(data.reserved ?? params.entryFeeChips),
                    toppedUp: deficit,
                };
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                setError(msg);
                throw err;
            } finally {
                setIsActing(false);
            }
        },
        [address, availableChips, ensureAppSession, refresh, topUpVault],
    );

    /**
     * Release unused match reservation straight back into Match Vault (0 gas).
     */
    const releaseMatchStake = useCallback(
        async (matchKey: string): Promise<number> => {
            if (!address || !matchKey) return 0;
            const sessionId = peekAppSession();
            if (!sessionId) return 0;

            try {
                const res = await fetch("/api/vault", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${sessionId}`,
                    },
                    body: JSON.stringify({
                        action: "release",
                        walletAddress: address,
                        sessionId,
                        matchKey,
                    }),
                });
                if (!res.ok) return 0;
                const data = await res.json();
                await refresh(sessionId);
                notifyVaultUpdated();
                return Number(data.released ?? 0);
            } catch {
                return 0;
            }
        },
        [address, peekAppSession, refresh],
    );

    /**
     * Withdraw idle Match Vault funds back to player's wallet (1-click voucher + pull-claim; user pays gas).
     */
    const withdrawFromVault = useCallback(
        async (amountChips: number) => {
            if (!address) throw new Error("Wallet not connected");
            const sessionId = await ensureAppSession();
            if (!sessionId) throw new Error("Session required");

            setIsActing(true);
            setError(null);
            try {
                const res = await fetch("/api/vault", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${sessionId}`,
                    },
                    body: JSON.stringify({
                        action: "withdraw",
                        walletAddress: address,
                        sessionId,
                        amountChips,
                        chainId: chainId || DEFAULT_CHAIN_ID,
                    }),
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || "Withdrawal request failed");

                await executeVoucherPull([data.issuedVoucher], sessionId, "WITHDRAW MATCH VAULT");
                await refresh(sessionId);
                notifyVaultUpdated();
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                setError(msg);
                throw err;
            } finally {
                setIsActing(false);
            }
        },
        [address, chainId, ensureAppSession, executeVoucherPull, refresh],
    );

    /**
     * Pull-claim one or all claimable ArenaVault claims (match prizes, refunds, pending withdrawals).
     */
    const claimVaultClaims = useCallback(
        async (claimIds?: string[]) => {
            if (!address) return;
            const targetIds = claimIds && claimIds.length > 0 ? claimIds : claims.map((c) => c.id);
            if (!targetIds.length) return;

            const sessionId = await ensureAppSession();
            if (!sessionId) throw new Error("Session required");

            setIsActing(true);
            setError(null);
            try {
                const res = await fetch("/api/vault", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${sessionId}`,
                    },
                    body: JSON.stringify({
                        action: "issue_vouchers",
                        walletAddress: address,
                        sessionId,
                        claimIds: targetIds,
                        chainId: chainId || DEFAULT_CHAIN_ID,
                    }),
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || "Failed to issue claim vouchers");

                await executeVoucherPull(data.vouchers || [], sessionId);
                await refresh(sessionId);
                notifyVaultUpdated();
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                setError(msg);
                throw err;
            } finally {
                setIsActing(false);
            }
        },
        [address, chainId, claims, ensureAppSession, executeVoucherPull, refresh],
    );

    /**
     * Move a claimable match prize straight into Match Vault with 0 gas so player can keep playing.
     */
    const rollPrizeToVault = useCallback(
        async (claimId: string) => {
            if (!address) return;
            const sessionId = await ensureAppSession();
            if (!sessionId) throw new Error("Session required");

            setIsActing(true);
            setError(null);
            try {
                const res = await fetch("/api/vault", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${sessionId}`,
                    },
                    body: JSON.stringify({
                        action: "roll_prize",
                        walletAddress: address,
                        sessionId,
                        claimId,
                    }),
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || "Failed to move prize into vault");
                await refresh(sessionId);
                notifyVaultUpdated();
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                setError(msg);
                throw err;
            } finally {
                setIsActing(false);
            }
        },
        [address, ensureAppSession, refresh],
    );

    return {
        availableChips,
        reservedChips,
        claims,
        totalClaimableChips,
        prizeTotalChips,
        isLoading,
        isActing,
        error,
        refresh,
        topUpVault,
        ensureVaultForStake,
        ensureVaultAndReserve,
        releaseMatchStake,
        withdrawFromVault,
        claimVaultClaims,
        rollPrizeToVault,
    };
}
