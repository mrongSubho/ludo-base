"use client";

import { useEffect } from 'react';
import { useAccount } from 'wagmi';
import { supabase } from '@/lib/supabase';

export default function ProfileSyncer() {
    const { address, isConnected } = useAccount();

    useEffect(() => {
        const syncProfile = async () => {
            if (isConnected && address) {
                try {
                    const { error } = await supabase
                        .from('players')
                        .upsert({
                            wallet_address: address,
                            last_played_at: new Date().toISOString()
                        }, {
                            onConflict: 'wallet_address'
                        });

                    if (error) {
                        console.error('Error syncing profile to Supabase:', error.message);
                    } else {
                        console.log('Profile synced to Supabase for address:', address);
                    }
                } catch (err) {
                    console.error('Unexpected error syncing profile:', err);
                }
            }
        };

        syncProfile();
    }, [address, isConnected]);

    return null;
}
