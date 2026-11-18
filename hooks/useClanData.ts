"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useAccount, useWriteContract, useSwitchChain, usePublicClient } from "wagmi";
import { encodeFunctionData, keccak256, parseUnits, toBytes, type Address } from "viem";
import { usePlayerSigner } from "@/hooks/usePlayerSigner";
import { useCdpUserOp } from "@/hooks/useCdpUserOp";
import { showTxPrompt, updateAuthPromptStatus } from "@/hooks/useAuthPrompt";
import { readAllowanceDirect } from "@/hooks/useChipsAllowance";
import {
    CHIPS_ERC20_ABI,
    CLAN_CLAIM_DEPOSIT_ABI,
    DEFAULT_CLAN_CLAIM_ADDRESS,
    chipsAddress,
    clanClaimAddress,
} from "@/lib/chips";
import { DEFAULT_CHAIN_ID } from "@/lib/chains";
import { useAppSession } from "@/hooks/useAppSession";
import { createPrivateChannel, supabase } from "@/lib/supabase";
import type {
    Clan,
    ClanMember,
    ClanLevelConfig,
    ClanChatMessage,
    ClanJoinRequest,
    ClanRole,
    ClanJoinPolicy,
    ClanCrest,
    ClanTreasuryLedgerEntry,
    ClanMissionContract,
    ClanWeeklyVaultSummary,
    ClanProfileDossier,
} from "@/lib/clan/types";

const PROTOCOL_TREASURY_WALLET: Address =
    (process.env.NEXT_PUBLIC_TREASURY_WALLET as Address) ||
    "0xbcCa5DcBF293D98A627fD3814D5AE8249bB1DFaF";

export function useClanData() {
    const { address, chainId } = useAccount();
    const { switchChainAsync } = useSwitchChain();
    const { writeContractAsync } = useWriteContract();
    const publicClient = usePublicClient();
    const player = usePlayerSigner();
    const cdpUserOp = useCdpUserOp();
    const { ensureAppSession, peekAppSession } = useAppSession();

    const [clan, setClan] = useState<Clan | null>(null);
    const [member, setMember] = useState<ClanMember | null>(null);
    const [levelConfig, setLevelConfig] = useState<ClanLevelConfig | null>(null);
    const [nextLevelConfig, setNextLevelConfig] = useState<ClanLevelConfig | null>(null);
    const [members, setMembers] = useState<ClanMember[]>([]);
    const [joinRequests, setJoinRequests] = useState<ClanJoinRequest[]>([]);
    const [treasuryLedger, setTreasuryLedger] = useState<ClanTreasuryLedgerEntry[]>([]);
    const [missions, setMissions] = useState<ClanMissionContract[]>([]);
    const [weeklyVault, setWeeklyVault] = useState<ClanWeeklyVaultSummary | null>(null);
    const [dossier, setDossier] = useState<ClanProfileDossier | null>(null);
    const [chatMessages, setChatMessages] = useState<ClanChatMessage[]>([]);
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);

    const clanIdRef = useRef<string | null>(null);
    clanIdRef.current = clan?.id || null;

    /**
     * Refresh caller's clan status, members, join requests, treasury, missions, and chat feed.
     */
    const refresh = useCallback(async () => {
        if (!address) {
            setClan(null);
            setMember(null);
            setLevelConfig(null);
            setNextLevelConfig(null);
            setMembers([]);
            setJoinRequests([]);
            setTreasuryLedger([]);
            setMissions([]);
            setWeeklyVault(null);
            setDossier(null);
            setChatMessages([]);
            return;
        }

        const sid = peekAppSession();
        if (!sid) {
            // Do not fire unauthenticated ?mine=true calls before session sign-in
            return;
        }

        setIsLoading(true);
        setError(null);

        try {
            const headers: Record<string, string> = {
                "Content-Type": "application/json",
                Authorization: `Bearer ${sid}`,
            };

            const res = await fetch("/api/clans?mine=true", {
                headers,
                cache: "no-store",
            });

            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.error || "Failed to load clan");
            }

            const data = await res.json();
            setClan(data.clan || null);
            setMember(data.member || null);
            setLevelConfig(data.levelConfig || null);
            setNextLevelConfig(data.nextLevelConfig || null);
            setMembers(data.members || []);
            setJoinRequests(data.joinRequests || []);
            setTreasuryLedger(data.treasuryLedger || []);
            setMissions(data.missions || []);
            setWeeklyVault(data.weeklyVault || null);
            setDossier(data.dossier || null);

            if (data.clan?.id) {
                const chatRes = await fetch(`/api/clans/chat?clanId=${data.clan.id}`, {
                    headers,
                    cache: "no-store",
                });

                if (chatRes.ok) {
                    const chatData = await chatRes.json();
                    setChatMessages(chatData.messages || []);
                }
            } else {
                setChatMessages([]);
            }
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.warn("[useClanData:refresh]", msg);
            setError(msg);
        } finally {
            setIsLoading(false);
        }
    }, [address, peekAppSession]);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    // Private Realtime subscription for live chat and clan events
    useEffect(() => {
        if (!clan?.id) return;
        const topic = `clan-${clan.id}`;
        const channel = createPrivateChannel(topic);

        channel
            .on("broadcast", { event: "clan_chat_message" }, (payload: { payload?: { message?: ClanChatMessage } }) => {
                if (payload?.payload?.message) {
                    const msg: ClanChatMessage = payload.payload.message;
                    setChatMessages((prev) => {
                        if (prev.some((m) => m.id === msg.id)) return prev;
                        return [...prev, msg];
                    });
                }
            })
            .on("broadcast", { event: "clan_updated" }, () => {
                void refresh();
            })
            .subscribe();

        return () => {
            void supabase.removeChannel(channel);
        };
    }, [clan?.id, refresh]);

    /**
     * Pre-flight availability and CHIPS balance check before signing creation tx.
     */
    const checkClanAvailability = useCallback(async (name: string, tag: string) => {
        const sessionId = await ensureAppSession();
        if (!sessionId) throw new Error("Session required");

        const res = await fetch(
            `/api/clans?check=true&name=${encodeURIComponent(name)}&tag=${encodeURIComponent(tag)}`,
            {
                headers: { Authorization: `Bearer ${sessionId}` },
                cache: "no-store",
            },
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Pre-flight check failed");
        return data as {
            available: boolean;
            reason?: string;
            onChainChips: string;
            hasEnoughChips: boolean;
        };
    }, [ensureAppSession]);

    /**
     * Create a new clan with pre-flight validation + 10,000 CHIPS creation fee transfer.
     */
    const createClan = useCallback(async (params: {
        name: string;
        tag: string;
        bio?: string;
        crest?: ClanCrest;
    }): Promise<{ clanId: string }> => {
        if (!address) throw new Error("Wallet not connected");
        const sessionId = await ensureAppSession();
        if (!sessionId) throw new Error("Session required to create clan");

        // Pre-flight check BEFORE user signs on-chain transfer
        const check = await checkClanAvailability(params.name, params.tag);
        if (!check.available) {
            throw new Error(check.reason || "Clan name or tag is unavailable");
        }
        if (!check.hasEnoughChips) {
            throw new Error("Insufficient on-chain CHIPS balance (10,000 CHIPS required)");
        }

        const tokenAddress = chipsAddress() || ("0xB200000000000000000000821408122b9Ed3d05B" as Address);
        const treasuryAddress = PROTOCOL_TREASURY_WALLET;
        const feeAmount = parseUnits("10000", 18);

        let hidePrompt: (() => void) | undefined;
        let txHash: string | undefined;

        try {
            hidePrompt = showTxPrompt({
                context: "clan-create",
                title: "FORGE CLAN",
                statusText: "Please approve the 10,000 CHIPS creation fee transfer in your wallet.",
                explanationText: "10,000 CHIPS one-time fee transferred directly to protocol treasury on Base Sepolia.",
            });

            const data = encodeFunctionData({
                abi: CHIPS_ERC20_ABI,
                functionName: "transfer",
                args: [treasuryAddress, feeAmount],
            });

            if (player.mode === "ingame" && cdpUserOp.isInGame) {
                txHash = await cdpUserOp.sendCallsAndWait([{ to: tokenAddress, data }]);
            } else {
                if (chainId && chainId !== DEFAULT_CHAIN_ID) {
                    await switchChainAsync({ chainId: DEFAULT_CHAIN_ID });
                }
                const hash = await writeContractAsync({
                    address: tokenAddress,
                    abi: CHIPS_ERC20_ABI,
                    functionName: "transfer",
                    args: [treasuryAddress, feeAmount],
                });
                txHash = hash;
                if (publicClient && hash) {
                    updateAuthPromptStatus("Transfer broadcast! Confirming on-chain...", "Confirming On-Chain");
                    await publicClient.waitForTransactionReceipt({ hash });
                }
            }
        } finally {
            hidePrompt?.();
        }

        if (!txHash) {
            throw new Error("Transaction was cancelled or failed");
        }

        const res = await fetch("/api/clans", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${sessionId}`,
            },
            body: JSON.stringify({
                walletAddress: address,
                sessionId,
                txHash,
                ...params,
            }),
        });

        const data = await res.json();
        if (!res.ok) {
            throw new Error(data.error || "Failed to create clan");
        }

        await refresh();
        return data;
    }, [
        address,
        chainId,
        cdpUserOp,
        checkClanAvailability,
        ensureAppSession,
        player.mode,
        publicClient,
        refresh,
        switchChainAsync,
        writeContractAsync,
    ]);

    /**
     * Fund the clan treasury on-chain via `ClanClaim.fundTreasury` and record it in DB.
     */
    const fundTreasury = useCallback(async (amountChips: number) => {
        if (!clan?.id || !address) throw new Error("Not in a clan");
        const cleanAmount = Math.floor(Number(amountChips));
        if (!Number.isFinite(cleanAmount) || cleanAmount <= 0) {
            throw new Error("Enter a positive CHIPS amount");
        }

        const sessionId = await ensureAppSession();
        if (!sessionId) throw new Error("Session required");

        const chipsToken = chipsAddress() || ("0xB200000000000000000000821408122b9Ed3d05B" as Address);
        const claimContract = clanClaimAddress() || DEFAULT_CLAN_CLAIM_ADDRESS;
        const clanIdBytes32 = keccak256(toBytes(clan.id));
        const amountWei = parseUnits(String(cleanAmount), 18);

        let hidePrompt: (() => void) | undefined;
        let txHash: string | undefined;

        try {
            const currentAllowance = await readAllowanceDirect(address as Address, claimContract);
            const hasAllowance = currentAllowance >= amountWei;

            hidePrompt = showTxPrompt({
                context: "clan-treasury-fund",
                title: "FUND CLAN TREASURY",
                statusText: hasAllowance
                    ? `Confirm ${cleanAmount.toLocaleString()} CHIPS deposit to your clan treasury.`
                    : `Approve CHIPS allowance and deposit ${cleanAmount.toLocaleString()} CHIPS to your clan treasury.`,
                explanationText: "Funds are held non-custodially in ClanClaim on Base Sepolia for war subsidies and grants.",
            });

            const fundData = encodeFunctionData({
                abi: CLAN_CLAIM_DEPOSIT_ABI,
                functionName: "fundTreasury",
                args: [clanIdBytes32, amountWei],
            });

            if (player.mode === "ingame" && cdpUserOp.isInGame) {
                const calls = hasAllowance
                    ? [{ to: claimContract, data: fundData }]
                    : [
                          {
                              to: chipsToken,
                              data: encodeFunctionData({
                                  abi: CHIPS_ERC20_ABI,
                                  functionName: "approve",
                                  args: [claimContract, amountWei],
                              }),
                          },
                          { to: claimContract, data: fundData },
                      ];
                txHash = await cdpUserOp.sendCallsAndWait(calls);
            } else {
                if (chainId && chainId !== DEFAULT_CHAIN_ID) {
                    await switchChainAsync({ chainId: DEFAULT_CHAIN_ID });
                }
                if (!hasAllowance) {
                    updateAuthPromptStatus(
                        `Step 1/2: Approve ${cleanAmount.toLocaleString()} CHIPS allowance...`,
                        "Awaiting Approval",
                    );
                    const approveHash = await writeContractAsync({
                        address: chipsToken,
                        abi: CHIPS_ERC20_ABI,
                        functionName: "approve",
                        args: [claimContract, amountWei],
                    });
                    if (publicClient && approveHash) {
                        await publicClient.waitForTransactionReceipt({ hash: approveHash });
                    }
                }
                updateAuthPromptStatus(
                    `${hasAllowance ? "" : "Step 2/2: "}Confirm ${cleanAmount.toLocaleString()} CHIPS treasury deposit...`,
                    "Awaiting Deposit",
                );
                const hash = await writeContractAsync({
                    address: claimContract,
                    abi: CLAN_CLAIM_DEPOSIT_ABI,
                    functionName: "fundTreasury",
                    args: [clanIdBytes32, amountWei],
                });
                txHash = hash;
                if (publicClient && hash) {
                    updateAuthPromptStatus("Deposit broadcast! Confirming on-chain...", "Confirming On-Chain");
                    await publicClient.waitForTransactionReceipt({ hash });
                }
            }
        } finally {
            hidePrompt?.();
        }

        if (!txHash) throw new Error("Treasury deposit cancelled");

        const res = await fetch("/api/clans/action", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${sessionId}`,
            },
            body: JSON.stringify({
                action: "fund_treasury",
                clanId: clan.id,
                amountChips: cleanAmount,
                txHash,
                walletAddress: address,
                sessionId,
            }),
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to credit treasury");

        await refresh();
        return data;
    }, [
        address,
        cdpUserOp,
        chainId,
        clan?.id,
        ensureAppSession,
        player.mode,
        publicClient,
        refresh,
        switchChainAsync,
        writeContractAsync,
    ]);

    /**
     * Send message in clan chat.
     */
    const sendChatMessage = useCallback(async (content: string) => {
        if (!clan?.id || !address) return;
        const sessionId = await ensureAppSession();
        if (!sessionId) throw new Error("Session required");

        const res = await fetch("/api/clans/chat", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${sessionId}`,
            },
            body: JSON.stringify({
                clanId: clan.id,
                content,
                walletAddress: address,
                sessionId,
            }),
        });

        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.error || "Failed to send message");
        }

        const data = await res.json();
        if (data.message) {
            setChatMessages((prev) => {
                if (prev.some((m) => m.id === data.message.id)) return prev;
                return [...prev, data.message];
            });
        }
    }, [clan?.id, address, ensureAppSession]);

    /**
     * Execute member management actions.
     */
    const executeAction = useCallback(async (action: string, payload: Record<string, unknown> = {}) => {
        const clanId = (payload.clanId as string) || clan?.id;
        if (!clanId) throw new Error("Clan ID required");

        const sessionId = await ensureAppSession();
        if (!sessionId) throw new Error("Session required");

        const res = await fetch("/api/clans/action", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${sessionId}`,
            },
            body: JSON.stringify({
                action,
                clanId,
                walletAddress: address,
                sessionId,
                ...payload,
            }),
        });

        const data = await res.json();
        if (!res.ok) {
            throw new Error(data.error || `Action ${action} failed`);
        }

        await refresh();
        return data;
    }, [clan?.id, address, ensureAppSession, refresh]);

    /**
     * Fetch public or member-authenticated clan dossier by UUID or tag.
     */
    const fetchClanDossier = useCallback(async (targetIdOrTag: string): Promise<ClanProfileDossier | null> => {
        const sid = peekAppSession();
        const headers: Record<string, string> = {};
        if (sid) headers.Authorization = `Bearer ${sid}`;

        const res = await fetch(`/api/clans?profile=${encodeURIComponent(targetIdOrTag)}`, {
            headers,
            cache: "no-store",
        });
        if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            throw new Error(errData.error || "Failed to load clan dossier");
        }
        const data = await res.json();
        return (data.dossier || null) as ClanProfileDossier | null;
    }, [peekAppSession]);

    /**
     * Rebrand clan name and/or tag (commander-only, escalating CHIPS transfer on Base Sepolia).
     */
    const renameClan = useCallback(async (params: {
        newName?: string;
        newTag?: string;
        feeChips: number;
    }) => {
        if (!clan?.id || !address) throw new Error("Not in a clan");
        const sessionId = await ensureAppSession();
        if (!sessionId) throw new Error("Session required");

        const feeClean = Math.max(2000, Math.round(params.feeChips));
        const tokenAddress = chipsAddress() || ("0xB200000000000000000000821408122b9Ed3d05B" as Address);
        const feeAmount = parseUnits(String(feeClean), 18);

        let hidePrompt: (() => void) | undefined;
        let txHash: string | undefined;

        try {
            hidePrompt = showTxPrompt({
                context: "clan-rename",
                title: "REBRAND CLAN",
                statusText: `Approve the ${feeClean.toLocaleString()} CHIPS rebrand fee transfer in your wallet.`,
                explanationText: `${feeClean.toLocaleString()} CHIPS rebrand fee transferred directly to protocol treasury on Base Sepolia.`,
            });

            const data = encodeFunctionData({
                abi: CHIPS_ERC20_ABI,
                functionName: "transfer",
                args: [PROTOCOL_TREASURY_WALLET, feeAmount],
            });

            if (player.mode === "ingame" && cdpUserOp.isInGame) {
                txHash = await cdpUserOp.sendCallsAndWait([{ to: tokenAddress, data }]);
            } else {
                if (chainId && chainId !== DEFAULT_CHAIN_ID) {
                    await switchChainAsync({ chainId: DEFAULT_CHAIN_ID });
                }
                const hash = await writeContractAsync({
                    address: tokenAddress,
                    abi: CHIPS_ERC20_ABI,
                    functionName: "transfer",
                    args: [PROTOCOL_TREASURY_WALLET, feeAmount],
                });
                txHash = hash;
                if (publicClient && hash) {
                    updateAuthPromptStatus("Rebrand transfer broadcast! Confirming on-chain...", "Confirming On-Chain");
                    await publicClient.waitForTransactionReceipt({ hash });
                }
            }
        } finally {
            hidePrompt?.();
        }

        if (!txHash) throw new Error("Rebrand transaction cancelled");

        const res = await fetch("/api/clans/action", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${sessionId}`,
            },
            body: JSON.stringify({
                action: "rename_clan",
                clanId: clan.id,
                newName: params.newName,
                newTag: params.newTag,
                txHash,
                walletAddress: address,
                sessionId,
            }),
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to rebrand clan");

        await refresh();
        return data;
    }, [
        address,
        cdpUserOp,
        chainId,
        clan?.id,
        ensureAppSession,
        player.mode,
        publicClient,
        refresh,
        switchChainAsync,
        writeContractAsync,
    ]);

    return {
        clan,
        member,
        levelConfig,
        nextLevelConfig,
        members,
        joinRequests,
        treasuryLedger,
        missions,
        weeklyVault,
        dossier,
        chatMessages,
        isLoading,
        error,
        refresh,
        fetchClanDossier,
        checkClanAvailability,
        createClan,
        fundTreasury,
        renameClan,
        updateCrest: (crest: Partial<ClanCrest>) => executeAction("update_crest", { crest }),
        sendChatMessage,
        requestJoin: (clanId: string) => executeAction("request_join", { clanId }),
        cancelRequest: (clanId: string) => executeAction("cancel_request", { clanId }),
        reviewRequest: (clanId: string, targetWallet: string, decision: "accept" | "reject") =>
            executeAction("review_request", { clanId, targetWallet, decision }),
        leaveClan: () => executeAction("leave"),
        kickMember: (targetWallet: string) => executeAction("kick", { targetWallet }),
        updateRole: (targetWallet: string, newRole: ClanRole) =>
            executeAction("update_role", { targetWallet, newRole }),
        updateSettings: (updates: {
            bio?: string;
            join_policy?: ClanJoinPolicy;
            min_rxp?: number;
            min_level?: number;
            farcaster_channel?: string;
            treasury_public?: boolean;
        }) => executeAction("update_settings", { updates }),
    };
}
