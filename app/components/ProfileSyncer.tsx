"use client";

import React, { useEffect, useState } from 'react';
import { useAccount } from 'wagmi';
import { supabase } from '@/lib/supabase';
import { useName, useAvatar } from '@coinbase/onchainkit/identity';
import { sdk } from '@farcaster/frame-sdk';

export default function ProfileSyncer() {
    const { address, isConnected } = useAccount();
    const { data: onchainName } = useName({ address: address as `0x${string}` });
    const { data: onchainAvatar } = useAvatar({ ensName: onchainName ?? '' }, { enabled: !!onchainName });
    const [fcContext, setFcContext] = useState<any>(null);

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

                // 3. Fallback to OnchainKit (Base/ENS) or Wallet Address
                if (!finalName) finalName = onchainName || address.slice(0, 6) + '...' + address.slice(-4);
                if (!finalAvatar) finalAvatar = onchainAvatar || null;

                console.log('🔄 Syncing Profile:', { address, finalName, finalAvatar });

                const { error } = await supabase
                    .from('players')
                    .upsert({
                        wallet_address: address.toLowerCase(),
                        username: finalName,
                        avatar_url: finalAvatar,
                        last_played_at: new Date().toISOString()
                    });

                if (error) {
                    console.error('❌ Supabase Sync Error:', error.message);
                }
            }
        }

        syncProfile();
    }, [isConnected, address, onchainName, onchainAvatar, fcContext]);

    return null;
}


