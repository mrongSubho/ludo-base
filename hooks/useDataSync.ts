"use client";

import { useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { getProgression } from '@/lib/progression';
import { UserProfile, MessageData } from './GameDataContext';

interface SyncProps {
    address: string | undefined;
    isBootComplete: boolean;
    setMyProfile: (p: UserProfile | null) => void;
    setLeaderboard: (fn: (prev: any[]) => any[]) => void;
    setFriends: (fn: (prev: any) => any) => void;
    setMessages: (fn: (prev: MessageData[]) => MessageData[]) => void;
    setRawConversations: (fn: (prev: any[]) => any[]) => void;
    setProfilesMap: (fn: (prev: Record<string, UserProfile>) => Record<string, UserProfile>) => void;
    decryptStoredContent: (content: string, otherId: string) => Promise<string>;
}

export const useDataSync = ({
    address,
    isBootComplete,
    setMyProfile,
    setLeaderboard,
    setMessages,
    setRawConversations,
    setProfilesMap,
    decryptStoredContent
}: SyncProps) => {

    useEffect(() => {
        if (!address || !isBootComplete) return;
        const lowerAddr = address.toLowerCase();

        // 1. Messages Realtime
        const msgChannel = supabase
            .channel(`gamedata-messages-${lowerAddr}`)
            .on(
                'postgres_changes',
                { event: 'INSERT', schema: 'public', table: 'messages' },
                async (payload) => {
                    const rawMsg = payload.new as MessageData;
                    const otherId = rawMsg.sender_id.toLowerCase() === lowerAddr ? rawMsg.receiver_id : rawMsg.sender_id;
                    const decryptedContent = await decryptStoredContent(rawMsg.content, otherId);
                    
                    const newMsg = { ...rawMsg, content: decryptedContent };
                    
                    const isVisibleToMe = (msg: MessageData, myAddr: string) => {
                        const low = myAddr.toLowerCase();
                        if (msg.sender_id.toLowerCase() === low && msg.deleted_by_sender) return false;
                        if (msg.receiver_id.toLowerCase() === low && msg.deleted_by_receiver) return false;
                        return true;
                    };

                    if (isVisibleToMe(newMsg, lowerAddr)) {
                        setMessages((prev) => {
                            if (prev.some(m => m.id === newMsg.id)) return prev;
                            return [...prev, newMsg].slice(-50);
                        });
                    }
                }
            )
            .subscribe();

        // 2. Conversations Realtime
        const convoChannel = supabase
            .channel(`gamedata-convos-${lowerAddr}`)
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'conversations' },
                (payload) => {
                    if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
                        const newConvo = payload.new;
                        if (newConvo.user_a === lowerAddr || newConvo.user_b === lowerAddr) {
                            setRawConversations(prev => {
                                const filtered = prev.filter(c => c.id !== newConvo.id);
                                return [newConvo, ...filtered].sort((a, b) =>
                                    new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime()
                                );
                            });
                        }
                    }
                }
            )
            .subscribe();
            
        // 3. Leaderboard/Profile Realtime
        const playersChannel = supabase
            .channel('gamedata-players-sync')
            .on(
                'postgres_changes',
                { event: 'UPDATE', schema: 'public', table: 'players' },
                (payload) => {
                    const updatedPlayer = payload.new as UserProfile;
                    const addr = updatedPlayer.wallet_address.toLowerCase();

                    setProfilesMap(prev => ({ ...prev, [addr]: updatedPlayer }));

                    if (addr === lowerAddr) {
                        setMyProfile(updatedPlayer);
                        localStorage.setItem(`cache_profile_${lowerAddr}`, JSON.stringify(updatedPlayer));
                    }

                    setLeaderboard(prev => {
                        const idx = prev.findIndex(p => p.wallet_address === addr);
                        if (idx !== -1) {
                            const newArr = [...prev];
                            const prog = getProgression(updatedPlayer.xp || 0, updatedPlayer.rating || 0);
                            newArr[idx] = { 
                                ...updatedPlayer, 
                                tierName: prog.tier,
                                subRank: prog.subRank,
                                level: prog.level
                            };
                            
                            newArr.sort((a, b) => (b.total_wins || 0) - (a.total_wins || 0));
                            localStorage.setItem(`cache_leaderboard`, JSON.stringify(newArr));
                            return newArr;
                        }
                        return prev;
                    });
                }
            )
            .subscribe();

        // 4. Missions Realtime
        const missionsChannel = supabase
            .channel(`gamedata-missions-${lowerAddr}`)
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'player_missions', filter: `player_id=eq.${lowerAddr}` },
                () => {
                    window.dispatchEvent(new CustomEvent('mission-update'));
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(msgChannel);
            supabase.removeChannel(convoChannel);
            supabase.removeChannel(playersChannel);
            supabase.removeChannel(missionsChannel);
        };
    }, [address, isBootComplete, setMyProfile, setLeaderboard, setMessages, setRawConversations, setProfilesMap, decryptStoredContent]);

};
