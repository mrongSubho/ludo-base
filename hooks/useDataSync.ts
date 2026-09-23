/* eslint-disable @typescript-eslint/no-explicit-any -- legacy wire/UI types; typed burn-down tracked in docs/ops/DEPLOY_OPS.md */
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

        // Leaderboard/Profile Realtime
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
                            const prog = getProgression(updatedPlayer.lxp || 0, updatedPlayer.rxp || 0);
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
            supabase.removeChannel(playersChannel);
            supabase.removeChannel(missionsChannel);
        };
    }, [address, isBootComplete, setMyProfile, setLeaderboard, setMessages, setRawConversations, setProfilesMap, decryptStoredContent]);

};
