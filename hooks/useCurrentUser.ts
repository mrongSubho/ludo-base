import { useEffect, useState } from 'react';
import { useAccount } from 'wagmi';
import { supabase } from '@/lib/supabase';
import { GUEST_EVENT, getGuestId, isGuestActive, migrateGuestStash } from '@/lib/guest';
import { useAppSession } from './useAppSession';

export function useCurrentUser() {
    const { address: wagmiAddress, isConnected: isWalletConnected } = useAccount();
    const { sessionId: appSessionId } = useAppSession();
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
                    .select('username, avatar_url, lxp, rxp, total_wins, total_games')
                    .or(`wallet_address.ilike.${wagmiAddress},wallet_address.eq.${wagmiAddress.toLowerCase()},wallet_address.eq.${wagmiAddress}`)
                    .limit(1);

                if (data && data.length > 0) {
                    const player = data[0];
                    setProfile({
                        username: player.username,
                        avatar_url: player.avatar_url,
                        lxp: player.lxp ?? undefined,
                        rxp: player.rxp ?? undefined,
                        total_wins: player.total_wins,
                        total_games: player.total_games,
                        displayName: (player.username && !player.username.startsWith('0x')) ? player.username : "User " + wagmiAddress.slice(-4).toUpperCase()
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
                        setProfile(prev => ({
                            username: payload.new.username,
                            avatar_url: payload.new.avatar_url,
                            lxp: payload.new.lxp,
                            rxp: payload.new.rxp,
                            // Default-deny RLS strips ungranted columns from anon
                            // payloads — never let a missing coins wipe the
                            // service-fetched balance.
                            coins: typeof payload.new.coins === 'number' ? payload.new.coins : prev?.coins,
                            total_wins: payload.new.total_wins,
                            total_games: payload.new.total_games,
                            displayName: (payload.new.username && !payload.new.username.startsWith('0x')) ? payload.new.username : "User " + wagmiAddress.slice(-4).toUpperCase()
                        }));
                    }
                )
                .subscribe();

            return () => {
                supabase.removeChannel(channel);
            };
        }
    }, [wagmiAddress, isWalletConnected, isGuest, guestId]);

    // Coins path: the baseline players grant excludes `coins`, so the anon
    // select above can never see the balance. Merge it from the session-gated
    // service profile (GET /api/profile). Re-runs when the SIWE session lands
    // and on demand via `window.dispatchEvent(new CustomEvent('ludo-profile-refresh'))`
    // after coin mutations (marketplace purchase, mission claim, poke-back).
    useEffect(() => {
        if (!isWalletConnected || !wagmiAddress || !appSessionId) return;
        let cancelled = false;
        const refreshCoins = async () => {
            try {
                const res = await fetch(
                    `/api/profile?walletAddress=${encodeURIComponent(wagmiAddress)}&sessionId=${encodeURIComponent(appSessionId)}`
                );
                if (!res.ok) return;
                const data = await res.json();
                if (cancelled || typeof data?.coins !== 'number') return;
                setProfile(prev => (prev ? { ...prev, coins: data.coins } : prev));
            } catch {
                /* offline — balance stays as-is */
            }
        };
        void refreshCoins();
        const onRefresh = () => {
            void refreshCoins();
        };
        window.addEventListener('ludo-profile-refresh', onRefresh);
        return () => {
            cancelled = true;
            window.removeEventListener('ludo-profile-refresh', onRefresh);
        };
    }, [wagmiAddress, isWalletConnected, appSessionId]);

    const displayName = (profile?.username && !profile.username.startsWith('0x'))
        ? profile.username
        : isGuest && guestId
            ? `Guest ${guestId.slice(-4).toUpperCase()}`
            : wagmiAddress
                ? `User ${wagmiAddress.slice(-4).toUpperCase()}`
                : 'Guest';

    return { profile, address, isConnected, displayName, isGuest };
}
