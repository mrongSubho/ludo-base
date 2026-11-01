"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useAccount } from "wagmi";
import { useAppSession } from "@/hooks/useAppSession";
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

export function useClanData() {
    const { address } = useAccount();
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

    /**
     * Create a new clan (debited from escrow).
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

        const res = await fetch("/api/clans", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${sessionId}`,
            },
            body: JSON.stringify({
                walletAddress: address,
                sessionId,
                ...params,
            }),
        });

        const data = await res.json();
        if (!res.ok) {
            throw new Error(data.error || "Failed to create clan");
        }

        await refresh();
        return data;
    }, [address, ensureAppSession, refresh]);

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
