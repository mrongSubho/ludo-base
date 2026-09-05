import { useEffect, useState } from 'react';
import { useAccount } from 'wagmi';
import { supabase } from '@/lib/supabase';
import { GUEST_EVENT, getGuestId, isGuestActive, migrateGuestStash } from '@/lib/guest';

export function useCurrentUser() {
    const { address: wagmiAddress, isConnected: isWalletConnected } = useAccount();
    const [guestTick, setGuestTick] = useState(0);
    const [profile, setProfile] = useState<{
        username: string | null;
        avatar_url: string | null;
        displayName: string;
        lxp?: number;
        rxp?: number;
        coins?: number;
        total_wins?: number | null;
        total_games?: number | null;
    } | null>(null);

    // Guest session is wallet-free: refresh identity when it changes.
    useEffect(() => {
        const refresh = () => setGuestTick(t => t + 1);
        window.addEventListener(GUEST_EVENT, refresh);
        return () => window.removeEventListener(GUEST_EVENT, refresh);
    }, []);

    // Active guest only counts while no wallet is connected — a wallet always wins.
    const guestId = !wagmiAddress && isGuestActive() ? getGuestId() : null;
    void guestTick;
    const address = wagmiAddress ?? guestId ?? undefined;
    const isGuest = !wagmiAddress && !!guestId;
    const isConnected = isWalletConnected || isGuest;

    useEffect(() => {
        async function fetchProfile() {
            if (isWalletConnected && wagmiAddress) {
                // Stash migration: a previous guest session's local finds move
                // to the wallet once, then guest state is dropped.
                const pendingGuest = getGuestId();
                if (pendingGuest) migrateGuestStash(pendingGuest, wagmiAddress);

                const { data, error } = await supabase
                    .from('players')
                    .select('username, avatar_url, lxp, rxp, coins, total_wins, total_games')
                    .or(`wallet_address.ilike.${wagmiAddress},wallet_address.eq.${wagmiAddress.toLowerCase()},wallet_address.eq.${wagmiAddress}`)
                    .limit(1);

                if (data && data.length > 0) {
                    const player = data[0];
                    setProfile({
                        ...player,
                        displayName: (player.username && !player.username.startsWith('0x')) ? player.username : "Guest " + wagmiAddress.slice(-6).toUpperCase()
                    });
                } else if (error) {
                    console.error('Profile fetch error:', error);
                }
            } else if (isGuest && guestId) {
                // Wallet-free trial identity: local-only, zeroed stats.
                const tag = guestId.slice(-4).toUpperCase();
                setProfile({
                    username: `Guest ${tag}`,
                    avatar_url: null,
                    displayName: `Guest ${tag}`,
                    lxp: 0,
                    rxp: 0,
                    coins: 0,
                    total_wins: 0,
                    total_games: 0,
                });
            } else {
                setProfile(null);
            }
        }

        fetchProfile();

        if (isWalletConnected && wagmiAddress) {
            // Set up a Realtime listener to catch immediate updates from ProfileSyncer
            const channel = supabase
                .channel('user-profile-sync')
                .on(
                    'postgres_changes',
                    {
                        event: 'UPDATE',
                        schema: 'public',
                        table: 'players',
                        filter: `wallet_address=eq.${wagmiAddress.toLowerCase()}`
                    },
                    (payload) => {
                        setProfile({
                            username: payload.new.username,
                            avatar_url: payload.new.avatar_url,
                            lxp: payload.new.lxp,
                            rxp: payload.new.rxp,
                            coins: payload.new.coins,
                            total_wins: payload.new.total_wins,
                            total_games: payload.new.total_games,
                            displayName: (payload.new.username && !payload.new.username.startsWith('0x')) ? payload.new.username : "Guest " + wagmiAddress.slice(-6).toUpperCase()
                        });
                    }
                )
                .subscribe();

            return () => {
                supabase.removeChannel(channel);
            };
        }
    }, [wagmiAddress, isWalletConnected, isGuest, guestId]);

    const displayName = (profile?.username && !profile.username.startsWith('0x')) ? profile.username : (address ? "Guest " + address.slice(-6).toUpperCase() : 'Guest');

    return { profile, address, isConnected, displayName, isGuest };
}
