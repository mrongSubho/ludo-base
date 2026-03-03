import { useEffect, useState } from 'react';
import { useAccount } from 'wagmi';
import { supabase } from '@/lib/supabase';

export function useCurrentUser() {
    const { address, isConnected } = useAccount();
    const [profile, setProfile] = useState<{ username: string | null; avatar_url: string | null; displayName: string } | null>(null);

    useEffect(() => {
        async function fetchProfile() {
            if (isConnected && address) {
                const { data, error } = await supabase
                    .from('players')
                    .select('username, avatar_url')
                    .or(`wallet_address.ilike.${address},wallet_address.eq.${address.toLowerCase()},wallet_address.eq.${address}`)
                    .limit(1);

                if (data && data.length > 0) {
                    const player = data[0];
                    setProfile({
                        ...player,
                        displayName: (player.username && !player.username.startsWith('0x')) ? player.username : "Guest " + address.slice(-6).toUpperCase()
                    });
                } else if (error) {
                    console.error('Profile fetch error:', error);
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
                        setProfile({
                            username: payload.new.username,
                            avatar_url: payload.new.avatar_url,
                            displayName: (payload.new.username && !payload.new.username.startsWith('0x')) ? payload.new.username : "Guest " + address.slice(-6).toUpperCase()
                        });
                    }
                )
                .subscribe();

            return () => {
                supabase.removeChannel(channel);
            };
        }
    }, [address, isConnected]);

    const displayName = (profile?.username && !profile.username.startsWith('0x')) ? profile.username : (address ? "Guest " + address.slice(-6).toUpperCase() : 'Guest');

    return { profile, address, isConnected, displayName };
}
