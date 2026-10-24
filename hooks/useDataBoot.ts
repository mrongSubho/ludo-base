/* eslint-disable @typescript-eslint/no-explicit-any -- legacy wire/UI types; typed burn-down tracked in docs/ops/DEPLOY_OPS.md */
"use client";

import { useState, useEffect, useCallback } from 'react';
import { getProgression } from '@/lib/progression';
import { UserProfile, LeaderboardEntry, Friend, MessageData } from './GameDataContext';
import { supabase } from '@/lib/supabase';
import { useAppSession } from './useAppSession';
import { loadOutbox } from '@/lib/messageOutbox';

/**
 * REA-03: cheap structural compare for the identity fields the realtime
 * channel can change. Deliberately not a deep equal — the context only
 * re-renders on identity, and this is the hot path.
 */
function profilesEqual(a: UserProfile, b: UserProfile): boolean {
    return a.wallet_address === b.wallet_address
        && (a.username ?? null) === (b.username ?? null)
        && (a.avatar_url ?? null) === (b.avatar_url ?? null)
        && (a.status ?? null) === (b.status ?? null)
        && (a.lxp ?? null) === (b.lxp ?? null)
        && (a.rxp ?? null) === (b.rxp ?? null)
        && (a.total_wins ?? null) === (b.total_wins ?? null)
        && (a.coins ?? null) === (b.coins ?? null)
        && (a.peer_id ?? null) === (b.peer_id ?? null);
}

export const useDataBoot = (address: string | undefined) => {
    const { peekAppSession } = useAppSession();
    const [isBooting, setIsBooting] = useState(false);
    const [isBootComplete, setIsBootComplete] = useState(false);
    const [myProfile, setMyProfile] = useState<UserProfile | null>(null);
    const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
    const [friends, setFriends] = useState<{ onchainFriends: Friend[], gameFriends: Friend[] }>({ onchainFriends: [], gameFriends: [] });
    const [messages, setMessages] = useState<MessageData[]>([]);
    const [rawConversations, setRawConversations] = useState<any[]>([]);
    const [profilesMap, setProfilesMap] = useState<Record<string, UserProfile>>({});
    /** REA-04: section keys that failed, for the retry affordance. */
    const [sectionsFailed, setSectionsFailed] = useState<string[]>([]);

    // --- DECRYPTION HELPER (Proxy) ---
    // Note: The context will provide the actual decrypt helper to avoid circular deps if needed, 
    // but we can define a basic one or pass it in. For now, we'll assume we pass it or handle sync.
    
    const bootSequence = useCallback(async (decryptStoredContent: (content: string, otherId: string) => Promise<string>) => {
        if (!address) return;
        const lowerAddr = address.toLowerCase();
        setIsBooting(true);
        // REA-04: a retry starts from a clean slate, not the last attempt's scars.
        setSectionsFailed([]);

        console.log("🚀 [GameData] Initiating Boot Sequence Payload...");
        try {
            // Boot must never open a wallet popup — cached session only.
            const sessionId = peekAppSession();
            // REA-04: this used to throw on a 403 and abort ALL FOUR sections
            // below (Promise.all rejects on the first), leaving the dashboard
            // permanently on its boot loader with no data and no retry. Scoped:
            // a private-section failure degrades to empty, everything else
            // still lands, and the caller learns it failed via `sectionsFailed`.
            const privateData = sessionId
                ? fetch(`/api/messages?walletAddress=${encodeURIComponent(lowerAddr)}&sessionId=${encodeURIComponent(sessionId)}`).then(async res => {
                    if (!res.ok) throw new Error(`Messages API failed: ${res.status}`);
                    return res.json();
                }).catch((err) => {
                    console.warn('[GameData] private section degraded:', err);
                    return { conversations: [], messages: [], __failed: true };
                })
                : Promise.resolve({ conversations: [], messages: [] });
            const [
                profileRes,
                leaderboardRes,
                friendsRes,
                privateRes
            ] = await Promise.all([
                // Baseline directory grant only (peer_id + coins are server-only —
                // peer_id/coins merge in from GET /api/profile below).
                (supabase.from('players') as any).select('wallet_address, username, avatar_url, lxp, rxp, status, classic_played, power_played, ai_played, total_wins, total_games, rank_tier, last_played_at, created_at').eq('wallet_address', lowerAddr).maybeSingle(),
                (supabase.from('players') as any).select('wallet_address, username, avatar_url, total_wins, last_played_at, status, lxp, rxp, rank_tier').order('total_wins', { ascending: false }).limit(50),
                // SEC-08: the route now requires a session and only answers for
                // the caller's own wallet. A 401 is not data — resolve to empty
                // lists so a missing session degrades the panel instead of
                // poisoning it.
                fetch(`/api/friends?wallet=${encodeURIComponent(lowerAddr)}&walletAddress=${encodeURIComponent(lowerAddr)}`, {
                    headers: sessionId ? {
                        Authorization: `Bearer ${sessionId}`,
                        'x-session-id': sessionId,
                    } : undefined,
                })
                    .then(async res => (res.ok ? res.json() : { onchainFriends: [], gameFriends: [], acceptedFriends: [] })),
                privateData
            ]);

            // Process Profile
            // Coins path: merge the session-gated service profile (GET /api/profile)
            // so myProfile.coins survives default-deny (baseline grant excludes it).
            if (sessionId && profileRes.data) {
                try {
                    const svcRes = await fetch(`/api/profile?walletAddress=${encodeURIComponent(lowerAddr)}&sessionId=${encodeURIComponent(sessionId)}`);
                    if (svcRes.ok) {
                        const svc = await svcRes.json();
                        if (typeof svc?.coins === 'number') profileRes.data.coins = svc.coins;
                        if (svc?.peer_id !== undefined) profileRes.data.peer_id = svc.peer_id;
                    }
                } catch {
                    /* offline — profile stands without coins */
                }
            }
            if (profileRes.data) {
                setMyProfile(profileRes.data);
                localStorage.setItem(`cache_profile_${lowerAddr}`, JSON.stringify(profileRes.data));
            }

            // Process Leaderboard
            if (leaderboardRes.data) {
                const formattedLeaders = leaderboardRes.data.map((p: { lxp?: number | null; rxp?: number | null; rank_tier?: string | null; wallet_address: string; username?: string | null; avatar_url?: string | null; total_wins?: number | null; last_played_at?: string | null; status?: string | null; coins?: number | null }) => {
                    const prog = getProgression(p.lxp || 0, p.rxp || 1200);
                    return {
                        ...p,
                        tierName: p.rank_tier || prog.tier,
                        subRank: prog.subRank,
                        level: prog.level
                    } as LeaderboardEntry;
                });
                setLeaderboard(formattedLeaders);
                localStorage.setItem(`cache_leaderboard`, JSON.stringify(formattedLeaders));

                const pMap: Record<string, UserProfile> = {};
                // REA-03: bounded projection — the leaderboard query is already
                // `.limit(50)`, so this map is capped by construction. Without
                // the cap an unbounded directory map was the perf failure.
                formattedLeaders.forEach((l: LeaderboardEntry) => pMap[l.wallet_address] = l);
                if (profileRes.data) pMap[lowerAddr] = profileRes.data;
                // REA-03: equality guard. `{ ...prev, ...pMap }` allocates a new
                // object on EVERY boot even when nothing changed, re-rendering
                // every consumer of the context ~1Hz.
                setProfilesMap(prev => {
                    const entries = Object.entries(pMap);
                    const unchanged = entries.every(([addr, row]) => {
                        const cur = prev[addr];
                        return cur !== undefined && profilesEqual(cur, row);
                    });
                    return unchanged ? prev : { ...prev, ...pMap };
                });
            }

            // Process Friends
            if (friendsRes) {
                setFriends({
                    onchainFriends: friendsRes.onchainFriends || [],
                    gameFriends: friendsRes.gameFriends || []
                });
                const fMap: Record<string, UserProfile> = {};
                (friendsRes.gameFriends || []).forEach((f: any) => fMap[f.wallet_address] = f);
                setProfilesMap(prev => {
                    const unchanged = Object.entries(fMap).every(([addr, row]) => {
                        const cur = prev[addr];
                        return cur !== undefined && profilesEqual(cur, row);
                    });
                    return unchanged ? prev : { ...prev, ...fMap };
                });
            }

            // Process Conversations
            if (privateRes.conversations) {
                setRawConversations(privateRes.conversations);
            }
            if ((privateRes as { __failed?: boolean }).__failed) {
                setSectionsFailed(prev => (prev.includes('messages') ? prev : [...prev, 'messages']));
            }

            // Process Messages
            if (privateRes.messages) {
                const decryptedMessages = await Promise.all(privateRes.messages.map(async (m: any) => {
                    const otherId = m.sender_id.toLowerCase() === lowerAddr ? m.receiver_id : m.sender_id;
                    return {
                        ...m,
                        content: await decryptStoredContent(m.content, otherId)
                    };
                }));

                const isVisibleToMe = (msg: MessageData, myAddr: string) => {
                    const low = myAddr.toLowerCase();
                    if (msg.sender_id.toLowerCase() === low && msg.deleted_by_sender) return false;
                    if (msg.receiver_id.toLowerCase() === low && msg.deleted_by_receiver) return false;
                    return true;
                };
                const visible = decryptedMessages.reverse().filter(m => isVisibleToMe(m, lowerAddr));
                const outbox = loadOutbox(lowerAddr);
                const serverIds = new Set(visible.map(m => m.id));
                const pending = outbox.filter(m => !serverIds.has(m.id));
                setMessages([...visible, ...pending]);
            }

            console.log("✅ [GameData] Boot Sequence Complete");

        } catch (err) {
            // REA-04: an aborted boot used to leave isBootComplete false
            // forever — the loader never resolves and no panel ever renders.
            console.error("❌ [GameData] Boot Sequence Failed:", err);
            setSectionsFailed(prev => (prev.includes('boot') ? prev : [...prev, 'boot']));
        } finally {
            // REA-04: complete in `finally`, whatever happened. A boot that
            // returns partial data is strictly better than a permanent loader.
            setIsBootComplete(true);
            setIsBooting(false);
        }
    }, [address, peekAppSession]);

    // Initial Hydration
    useEffect(() => {
        if (!address) return;
        const lowerAddr = address.toLowerCase();
        try {
            const cachedProfile = localStorage.getItem(`cache_profile_${lowerAddr}`);
            if (cachedProfile) setMyProfile(JSON.parse(cachedProfile));

            const cachedLeaders = localStorage.getItem(`cache_leaderboard`);
            if (cachedLeaders) setLeaderboard(JSON.parse(cachedLeaders));

            const initialOutbox = loadOutbox(lowerAddr);
            if (initialOutbox.length > 0) {
                setMessages(initialOutbox);
            }
        } catch (e) {
            console.error("Local Cache Hydration Failed", e);
        }
    }, [address]);

    /**
     * Re-pull the private message section without re-running the whole boot.
     * Same endpoint, same decrypt, same visibility filter as the boot path —
     * a live nudge must not invent a second message shape.
     */
    const refreshMessages = useCallback(async (
        decryptStoredContent: (content: string, otherId: string) => Promise<string>,
    ) => {
        if (!address) return;
        const lowerAddr = address.toLowerCase();
        const sessionId = peekAppSession();
        if (!sessionId) return;
        try {
            const res = await fetch(`/api/messages?walletAddress=${encodeURIComponent(lowerAddr)}&sessionId=${encodeURIComponent(sessionId)}`);
            if (!res.ok) return;
            const data = await res.json();
            if (data.conversations) setRawConversations(data.conversations);
            if (!data.messages) return;

            const decrypted = await Promise.all((data.messages as MessageData[]).map(async (m) => {
                const otherId = m.sender_id.toLowerCase() === lowerAddr ? m.receiver_id : m.sender_id;
                return { ...m, content: await decryptStoredContent(m.content, otherId) };
            }));

            const visible = decrypted.reverse().filter((msg) => {
                if (msg.sender_id.toLowerCase() === lowerAddr && msg.deleted_by_sender) return false;
                if (msg.receiver_id.toLowerCase() === lowerAddr && msg.deleted_by_receiver) return false;
                return true;
            });
            const outbox = loadOutbox(lowerAddr);
            const serverIds = new Set(visible.map(m => m.id));
            const pending = outbox.filter(m => !serverIds.has(m.id));
            setMessages([...visible, ...pending]);
        } catch (err) {
            console.warn('[GameData] message refresh failed:', err);
        }
    }, [address, peekAppSession]);

    return {
        isBooting,
        isBootComplete,
        sectionsFailed,
        myProfile,
        leaderboard,
        friends,
        messages,
        rawConversations,
        profilesMap,
        setMyProfile,
        setLeaderboard,
        setFriends,
        setMessages,
        setRawConversations,
        setProfilesMap,
        bootSequence,
        refreshMessages
    };
};
