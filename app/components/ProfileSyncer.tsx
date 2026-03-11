"use client";

import React, { useEffect, useState } from 'react';
import { useAccount } from 'wagmi';
import { useName, useAvatar } from '@coinbase/onchainkit/identity';
import { sdk } from '@farcaster/frame-sdk';
import { useGameData } from '@/hooks/GameDataContext';
import { supabase } from '@/lib/supabase';

export default function ProfileSyncer() {
    const { address, isConnected } = useAccount();
    const { data: onchainName } = useName({ address: address as `0x${string}` });
    const { data: onchainAvatar } = useAvatar({ ensName: onchainName ?? '' }, { enabled: !!onchainName });
    const [fcContext, setFcContext] = useState<any>(null);
    const { updateMyProfileOptimistic, isBootComplete, myProfile } = useGameData();

    useEffect(() => {
        const loadSdk = async () => {
            const context = await sdk.context;
            setFcContext(context);
        };
        loadSdk();
    }, []);

    useEffect(() => {
        async function syncProfile() {
            if (isConnected && address) {
                // 1. Try Frame SDK (if in Warpcast)
                const fcUser = fcContext?.user;
                let finalName = fcUser?.displayName || fcUser?.username || null;
                let finalAvatar = fcUser?.pfpUrl || null;

                // 2. Try Neynar API fallback (if in Base App or normal browser)
                if (!finalName) {
                    try {
                        const res = await fetch(`/api/farcaster?wallet=${address}`);
                        if (res.ok) {
                            const fcData = await res.json();
                            finalName = fcData.displayName || fcData.username;
                            finalAvatar = fcData.avatarUrl;
                        }
                    } catch (e) {
                        console.error("Farcaster API fallback failed", e);
                    }
                }

                // 3. Fallback to OnchainKit (Base/ENS)
                if (!finalName) finalName = onchainName || null;
                if (!finalAvatar) finalAvatar = onchainAvatar || null;

                const updateData: any = {
                    wallet_address: address.toLowerCase(),
                    avatar_url: finalAvatar,
                    last_played_at: new Date().toISOString()
                };

                // Only overwrite username if we actually found a real decentralized name
                if (finalName) {
                    updateData.username = finalName;
                }

                // Optimization: Don't dispatch update if nothing changed
                const isNameDifferent = updateData.username && myProfile?.username !== updateData.username;
                const isAvatarDifferent = updateData.avatar_url && myProfile?.avatar_url !== updateData.avatar_url;
                
                // Always update `last_played_at`, but we don't need a loud optimistic re-render just for that unless it's their very first boot.
                if (!myProfile || isNameDifferent || isAvatarDifferent) {
                     updateMyProfileOptimistic(updateData);
                } else {
                     // Silently touch last_played_at
                     supabase.from('players').upsert(updateData, { onConflict: 'wallet_address' }).then();
                }
            }
        }

        if (isBootComplete) {
            syncProfile();
        }
    }, [isConnected, address, onchainName, onchainAvatar, fcContext, isBootComplete, myProfile, updateMyProfileOptimistic]);

    return null;
}


