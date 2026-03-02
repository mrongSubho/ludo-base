"use client";

import { useEffect } from 'react';
import { useAccount } from 'wagmi';
import { supabase } from '@/lib/supabase';
import { useName, useAvatar } from '@coinbase/onchainkit/identity';

export default function ProfileSyncer() {
    const { address, isConnected } = useAccount();
    const { data: name } = useName({ address: address as `0x${string}` });
    const { data: avatar } = useAvatar({ ensName: name ?? '' }, { enabled: !!name });

    useEffect(() => {
        async function syncProfile() {
            if (isConnected && address) {
                console.log('🔄 Attempting to sync wallet to Supabase:', address);

                const { data, error } = await supabase
                    .from('players')
                    .upsert({
                        wallet_address: address,
                        last_played_at: new Date().toISOString(),
                        username: name || null,
                        avatar_url: avatar || null
                    })
                    .select(); // Force it to return the row so we know it worked

                if (error) {
                    console.error('❌ Supabase Error:', error.message, error.details, error.hint);
                } else {
                    console.log('✅ Profile successfully saved to Supabase!', data);
                }
            }
        }

        syncProfile();
    }, [isConnected, address, name, avatar]);

    return null;
}


