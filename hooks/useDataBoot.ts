"use client";

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { getProgression } from '@/lib/progression';
import { UserProfile, LeaderboardEntry, Friend, MessageData } from './GameDataContext';

export const useDataBoot = (address: string | undefined) => {
    const [isBooting, setIsBooting] = useState(false);
    const [isBootComplete, setIsBootComplete] = useState(false);
    const [myProfile, setMyProfile] = useState<UserProfile | null>(null);
    const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
    const [friends, setFriends] = useState<{ onchainFriends: Friend[], gameFriends: Friend[] }>({ onchainFriends: [], gameFriends: [] });
    const [messages, setMessages] = useState<MessageData[]>([]);
    const [rawConversations, setRawConversations] = useState<any[]>([]);
    const [profilesMap, setProfilesMap] = useState<Record<string, UserProfile>>({});

    // --- DECRYPTION HELPER (Proxy) ---
    // Note: The context will provide the actual decrypt helper to avoid circular deps if needed, 
    // but we can define a basic one or pass it in. For now, we'll assume we pass it or handle sync.
    
    const bootSequence = useCallback(async (decryptStoredContent: (content: string, otherId: string) => Promise<string>) => {
        if (!address) return;
        const lowerAddr = address.toLowerCase();
        setIsBooting(true);

        console.log("🚀 [GameData] Initiating Boot Sequence Payload...");
        try {
            const [
                profileRes,
                leaderboardRes,
                friendsRes,
                convoRes,
                msgRes
            ] = await Promise.all([
                supabase.from('players').select('*').eq('wallet_address', lowerAddr).maybeSingle(),
                (supabase.from('players') as any).select('wallet_address, username, avatar_url, total_wins, last_played_at, status, xp, rating, rank_tier').order('total_wins', { ascending: false }).limit(50),
                fetch(`/api/friends?wallet=${lowerAddr}`).then(res => res.json()),
                supabase.from('conversations').select('*').or(`user_a.eq.${lowerAddr},user_b.eq.${lowerAddr}`).order('last_message_at', { ascending: false }),
                supabase.from('messages').select('*').or(`sender_id.ilike.${lowerAddr},receiver_id.ilike.${lowerAddr}`).order('created_at', { ascending: false }).limit(30)
            ]);

            // Process Profile
            if (profileRes.data) {
                setMyProfile(profileRes.data);
                localStorage.setItem(`cache_profile_${lowerAddr}`, JSON.stringify(profileRes.data));
            }

            // Process Leaderboard
            if (leaderboardRes.data) {
                const formattedLeaders = leaderboardRes.data.map(p => {
                    const prog = getProgression(p.xp || 0, p.rating || 1200);
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
                formattedLeaders.forEach(l => pMap[l.wallet_address] = l);
                if (profileRes.data) pMap[lowerAddr] = profileRes.data;
                setProfilesMap(prev => ({ ...prev, ...pMap }));
            }

            // Process Friends
            if (friendsRes) {
                setFriends({
                    onchainFriends: friendsRes.onchainFriends || [],
                    gameFriends: friendsRes.gameFriends || []
                });
                const fMap: Record<string, UserProfile> = {};
                (friendsRes.gameFriends || []).forEach((f: any) => fMap[f.wallet_address] = f);
                setProfilesMap(prev => ({ ...prev, ...fMap }));
            }

            // Process Conversations
            if (convoRes.data) {
                setRawConversations(convoRes.data);
            }

            // Process Messages
            if (msgRes.data) {
                const decryptedMessages = await Promise.all(msgRes.data.map(async (m: any) => {
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
                setMessages(visible);
            }

            setIsBootComplete(true);
            console.log("✅ [GameData] Boot Sequence Complete");

        } catch (err) {
            console.error("❌ [GameData] Boot Sequence Failed:", err);
        } finally {
            setIsBooting(false);
        }
    }, [address]);

    // Initial Hydration
    useEffect(() => {
        if (!address) return;
        const lowerAddr = address.toLowerCase();
        try {
            const cachedProfile = localStorage.getItem(`cache_profile_${lowerAddr}`);
            if (cachedProfile) setMyProfile(JSON.parse(cachedProfile));

            const cachedLeaders = localStorage.getItem(`cache_leaderboard`);
            if (cachedLeaders) setLeaderboard(JSON.parse(cachedLeaders));
        } catch (e) {
            console.error("Local Cache Hydration Failed", e);
        }
    }, [address]);

    return {
        isBooting,
        isBootComplete,
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
        bootSequence
    };
};
