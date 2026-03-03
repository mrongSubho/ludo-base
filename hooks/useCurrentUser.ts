import { useEffect, useState } from 'react';
import { useAccount } from 'wagmi';
import { supabase } from '@/lib/supabase';

export function useCurrentUser() {
    const { address, isConnected } = useAccount();
    const [profile, setProfile] = useState<{ username: string | null; avatar_url: string | null } | null>(null);

    useEffect(() => {
        async function fetchProfile() {
            if (isConnected && address) {
                const { data } = await supabase
                    .from('players')
                    .select('username, avatar_url')
                    .eq('wallet_address', address.toLowerCase())
                    .single();

                if (data) {
                    setProfile(data);
                }
            } else {
                setProfile(null);
            }
        }

        fetchProfile();

        if (isConnected && address) {
            // Set up a Realtime listener to catch immediate updates from ProfileSyncer
            const channel = supabase
                .channel('user-profile-sync')
                .on(
                    'postgres_changes',
                    {
                        event: 'UPDATE',
                        schema: 'public',
                        table: 'players',
                        filter: `wallet_address=eq.${address.toLowerCase()}`
                    },
                    (payload) => {
                        setProfile({ username: payload.new.username, avatar_url: payload.new.avatar_url });
                    }
                )
                .subscribe();

            return () => {
                supabase.removeChannel(channel);
            };
        }
    }, [address, isConnected]);

    return { profile, address, isConnected };
}
