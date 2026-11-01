/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useState, useEffect, useCallback } from "react";
import { useAccount } from "wagmi";
import { useAppSession } from "@/hooks/useAppSession";
import type {
    ClanWarCall,
    ClanWarStake,
    ClanWar,
    ClanWarFixture,
} from "@/lib/clan/types";

export function useClanWar(clanId: string | null | undefined) {
    const { address } = useAccount();
    const { ensureAppSession, peekAppSession } = useAppSession();

    const [warCall, setWarCall] = useState<ClanWarCall | null>(null);
    const [stakes, setStakes] = useState<ClanWarStake[]>([]);
    const [totalCommitted, setTotalCommitted] = useState<number>(0);
    const [activeWar, setActiveWar] = useState<ClanWar | null>(null);
    const [fixtures, setFixtures] = useState<ClanWarFixture[]>([]);
    const [warBoard, setWarBoard] = useState<Array<ClanWarCall & { clan: any }>>([]);
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);

    const refresh = useCallback(async () => {
        if (!clanId) {
            setWarCall(null);
            setStakes([]);
            setActiveWar(null);
            setFixtures([]);
            return;
        }

        setIsLoading(true);
        setError(null);

        try {
            const sid = peekAppSession();
            const headers: Record<string, string> = { "Content-Type": "application/json" };
            if (sid) headers["Authorization"] = `Bearer ${sid}`;

            // Fetch notice / call status
            const noticeRes = await fetch(`/api/clans/war/notice?clanId=${clanId}`, {
                headers,
                cache: "no-store",
            });

            if (noticeRes.ok) {
                const noticeData = await noticeRes.json();
                setWarCall(noticeData.warCall || null);
                setStakes(noticeData.stakes || []);
                setTotalCommitted(noticeData.totalCommitted || 0);
            }

            // If war is matched or in progress, fetch fixtures
            if (activeWar?.id) {
                const fixRes = await fetch(`/api/clans/war/fixture?warId=${activeWar.id}`, {
                    headers,
                    cache: "no-store",
                });
                if (fixRes.ok) {
                    const fixData = await fixRes.json();
                    setFixtures(fixData.fixtures || []);
                }
            }
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.warn("[useClanWar:refresh]", msg);
            setError(msg);
        } finally {
            setIsLoading(false);
        }
    }, [clanId, activeWar?.id, peekAppSession]);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    /**
     * Post a new War Notice (Commander / Officer).
     */
    const postNotice = useCallback(async (params: {
        bracket: 5 | 10 | 15 | 20;
        memberFee: number;
        stakersPct: number;
        treasuryPct: number;
        leaderPct: number;
        officersPct: number;
        treasurySubsidy?: number;
    }) => {
        if (!clanId || !address) return;
        const sessionId = await ensureAppSession();
        if (!sessionId) throw new Error("Session required");

        const res = await fetch("/api/clans/war/notice", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${sessionId}`,
            },
            body: JSON.stringify({
                clanId,
                walletAddress: address,
                sessionId,
                ...params,
            }),
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to post war notice");

        await refresh();
        return data.warCall;
    }, [clanId, address, ensureAppSession, refresh]);

    /**
     * Cancel an open War Notice.
     */
    const cancelNotice = useCallback(async () => {
        if (!clanId || !address) return;
        const sessionId = await ensureAppSession();
        if (!sessionId) throw new Error("Session required");

        const res = await fetch("/api/clans/war/notice", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${sessionId}`,
            },
            body: JSON.stringify({
                clanId,
                action: "cancel",
                walletAddress: address,
                sessionId,
            }),
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to cancel notice");

        await refresh();
    }, [clanId, address, ensureAppSession, refresh]);

    /**
     * Member fee buy-in / lock.
     */
    const buyIn = useCallback(async (stakeAmount: number) => {
        if (!clanId || !address) return;
        const sessionId = await ensureAppSession();
        if (!sessionId) throw new Error("Session required");

        const res = await fetch("/api/clans/war/buyin", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${sessionId}`,
            },
            body: JSON.stringify({
                clanId,
                stakeAmount,
                walletAddress: address,
                sessionId,
            }),
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Buy-in failed");

        await refresh();
        return data.stake;
    }, [clanId, address, ensureAppSession, refresh]);

    /**
     * Start search once roster is complete.
     */
    const startSearch = useCallback(async () => {
        if (!clanId || !address) return;
        const sessionId = await ensureAppSession();
        if (!sessionId) throw new Error("Session required");

        const res = await fetch("/api/clans/war/buyin", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${sessionId}`,
            },
            body: JSON.stringify({
                clanId,
                action: "start_search",
                walletAddress: address,
                sessionId,
            }),
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Search start failed");

        await refresh();
    }, [clanId, address, ensureAppSession, refresh]);

    /**
     * Fetch Open War Board.
     */
    const fetchWarBoard = useCallback(async (bracket?: number) => {
        const url = bracket ? `/api/clans/war/board?bracket=${bracket}` : "/api/clans/war/board";
        const res = await fetch(url, { cache: "no-store" });
        if (res.ok) {
            const data = await res.json();
            setWarBoard(data.board || []);
            return data.board;
        }
        return [];
    }, []);

    /**
     * Match two searching clans.
     */
    const matchOpponent = useCallback(async (callAId: string, callBId: string) => {
        if (!address) return;
        const sessionId = await ensureAppSession();
        if (!sessionId) throw new Error("Session required");

        const res = await fetch("/api/clans/war/board", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${sessionId}`,
            },
            body: JSON.stringify({
                callAId,
                callBId,
                walletAddress: address,
                sessionId,
            }),
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Matching failed");

        setActiveWar(data.war);
        await refresh();
        return data.war;
    }, [address, ensureAppSession, refresh]);

    /**
     * Bilateral fixture time agreement.
     */
    const scheduleFixture = useCallback(async (fixtureId: string, scheduledAt: string) => {
        if (!address) return;
        const sessionId = await ensureAppSession();
        if (!sessionId) throw new Error("Session required");

        const res = await fetch("/api/clans/war/fixture", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${sessionId}`,
            },
            body: JSON.stringify({
                fixtureId,
                scheduledAt,
                walletAddress: address,
                sessionId,
            }),
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Fixture schedule failed");

        await refresh();
    }, [address, ensureAppSession, refresh]);

    return {
        warCall,
        stakes,
        totalCommitted,
        activeWar,
        fixtures,
        warBoard,
        isLoading,
        error,
        refresh,
        postNotice,
        cancelNotice,
        buyIn,
        startSearch,
        fetchWarBoard,
        matchOpponent,
        scheduleFixture,
    };
}
