"use client";

import { useEffect } from 'react';
import { useAccount } from 'wagmi';
import { supabase } from '@/lib/supabase';

export default function ProfileSyncer() {
    const { address, isConnected } = useAccount();

    useEffect(() => {
        async function syncProfile() {
            if (isConnected && address) {
                console.log('🔄 Attempting to sync wallet to Supabase:', address);

                const { data, error } = await supabase
                    .from('players')
                    .upsert({
                        wallet_address: address,
                        last_played_at: new Date().toISOString()
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
    }, [isConnected, address]);

    return null;
}

