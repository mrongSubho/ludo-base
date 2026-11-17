"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useAccount, useWriteContract, useSwitchChain, usePublicClient } from "wagmi";
import { encodeFunctionData, parseUnits, type Address } from "viem";
import { usePlayerSigner } from "@/hooks/usePlayerSigner";
import { useCdpUserOp } from "@/hooks/useCdpUserOp";
import { showTxPrompt, updateAuthPromptStatus } from "@/hooks/useAuthPrompt";
import { CHIPS_ERC20_ABI, chipsAddress } from "@/lib/chips";
import { DEFAULT_CHAIN_ID } from "@/lib/chains";
import { useAppSession } from "@/hooks/useAppSession";
import { supabase } from "@/lib/supabase";
import type {
    Clan,
    ClanMember,
    ClanLevelConfig,
    ClanChatMessage,
    ClanJoinRequest,
    ClanRole,
    ClanJoinPolicy,
    ClanCrest,
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
    const [members, setMembers] = useState<ClanMember[]>([]);
    const [joinRequests, _setJoinRequests] = useState<ClanJoinRequest[]>([]);
    const [chatMessages, setChatMessages] = useState<ClanChatMessage[]>([]);
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);

    const clanIdRef = useRef<string | null>(null);
    clanIdRef.current = clan?.id || null;

    /**
     * Refresh caller's clan status, members, and chat feed.
     */
    const refresh = useCallback(async () => {
        if (!address) {
            setClan(null);
            setMember(null);
            setLevelConfig(null);
            setMembers([]);
            setChatMessages([]);
            return;
        }

        setIsLoading(true);
        setError(null);

        try {
            const sid = peekAppSession();
            const headers: Record<string, string> = { "Content-Type": "application/json" };
            if (sid) headers["Authorization"] = `Bearer ${sid}`;

            const res = await fetch(`/api/clans?mine=true&wallet=${encodeURIComponent(address)}`, {
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

            if (data.clan?.id) {
                // Fetch members and chat
                const [chatRes, clanRes] = await Promise.all([
                    fetch(`/api/clans/chat?clanId=${data.clan.id}&wallet=${encodeURIComponent(address)}`, {
                        headers,
                        cache: "no-store",
                    }),
                    fetch(`/api/clans?clanId=${data.clan.id}`, { cache: "no-store" }),
                ]);

                if (chatRes.ok) {
                    const chatData = await chatRes.json();
                    setChatMessages(chatData.messages || []);
                }

                if (clanRes.ok) {
                    const clanData = await clanRes.json();
                    if (clanData.clan) setClan(clanData.clan);
                }
            }
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.warn("[useClanData:refresh]", msg);
            setError(msg);
        } finally {
            setIsLoading(false);
        }
    }, [address, peekAppSession]);

    // Initial load and wallet change
    useEffect(() => {
        void refresh();
    }, [refresh]);

    // Realtime broadcast subscription for live chat and clan events
    useEffect(() => {
        if (!clan?.id) return;
        const topic = `clan-${clan.id}`;
        const channel = supabase.channel(topic, {
            config: { broadcast: { self: false } },
        });

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
     * Create a new clan by executing on-chain 10,000 CHIPS creation fee to Protocol Treasury.
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
                const res = await cdpUserOp.sendCalls([{ to: tokenAddress, data }]);
                txHash = res.userOperationHash;
            } else {
                if (chainId && chainId !== DEFAULT_CHAIN_ID) {
                    try {
                        await switchChainAsync({ chainId: DEFAULT_CHAIN_ID });
                    } catch (err) {
                        console.warn("[useClanData] Network switch failed:", err);
                    }
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
    }, [address, chainId, cdpUserOp, ensureAppSession, player.mode, publicClient, refresh, switchChainAsync, writeContractAsync]);

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
            setChatMessages((prev) => [...prev, data.message]);
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

    return {
        clan,
        member,
        levelConfig,
        members,
        joinRequests,
        chatMessages,
        isLoading,
        error,
        refresh,
        createClan,
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
        }) => executeAction("update_settings", { updates }),
    };
}
