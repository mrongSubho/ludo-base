import { useEffect, useState } from 'react';
import { useAccount } from 'wagmi';
import { useCurrentUser as useCdpSignedInUser, useIsInitialized } from '@coinbase/cdp-hooks';
import { supabase } from '@/lib/supabase';
import { GUEST_EVENT, getGuestId, isGuestActive, migrateGuestStash } from '@/lib/guest';
import { useAppSession } from './useAppSession';

export function useCurrentUser() {
    const { address: wagmiAddress, isConnected: isWalletConnected, status: wagmiStatus } = useAccount();
    // In-game CDP smart account (dual-path). Never the owner EOA. Read the
    // address straight off the CDP session: routing this through
    // useCdpParentSigner pulled @coinbase/cdp-core, viem
    // account-abstraction and a public client onto the boot graph just to
    // obtain one address string. useCdpParentSigner is still the right entry
    // point for signing, and it is only imported by wallet/signing surfaces.
    const { currentUser: cdpUser } = useCdpSignedInUser();
    const { isInitialized: isCdpInitialized } = useIsInitialized();
    const { sessionId: appSessionId, ready: isAppSessionReady } = useAppSession();
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
        classic_played?: number;
        power_played?: number;
        ai_played?: number;
        is_public?: boolean;
        allow_requests?: boolean;
        clan_tag?: string | null;
        clan_name?: string | null;
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
    const cdpAddress = cdpUser?.evmSmartAccountObjects?.[0]?.address as string | undefined;
    const address = wagmiAddress ?? cdpAddress ?? guestId ?? undefined;
    const isGuest = !wagmiAddress && !cdpAddress && !!guestId;
    const isConnected = isWalletConnected || Boolean(cdpAddress) || isGuest;

    // Session checking is in flight if no active session is found yet AND
    // connectors/providers are still in their boot/reconnection/init stage.
    const isSessionChecking = !isConnected && (
        wagmiStatus === 'reconnecting' ||
        wagmiStatus === 'connecting' ||
        !isCdpInitialized ||
        !isAppSessionReady
    );

    useEffect(() => {
        async function fetchProfile() {
            const walletForProfile = wagmiAddress ?? cdpAddress;
            if (walletForProfile) {
                // Stash migration: a previous guest session's local finds move
                // to the wallet once, then guest state is dropped.
                const pendingGuest = getGuestId();
                if (pendingGuest && wagmiAddress) migrateGuestStash(pendingGuest, wagmiAddress);

                const { data, error } = await supabase
                    .from('players')
                    .select('username, avatar_url, lxp, rxp, total_wins, total_games')
                    .or(`wallet_address.ilike.${walletForProfile},wallet_address.eq.${walletForProfile.toLowerCase()},wallet_address.eq.${walletForProfile}`)
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
                        displayName: (player.username && !player.username.startsWith('0x')) ? player.username : "User " + walletForProfile.slice(-4).toUpperCase()
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

        if ((isWalletConnected && wagmiAddress) || cdpAddress) {
            // Set up a Realtime listener to catch immediate updates from ProfileSyncer
            const channel = supabase
                .channel('user-profile-sync')
                .on(
                    'postgres_changes',
                    {
                        event: 'UPDATE',
                        schema: 'public',
                        table: 'players',
                        filter: `wallet_address=eq.${(wagmiAddress ?? cdpAddress ?? '').toLowerCase()}`
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
                            displayName: (payload.new.username && !payload.new.username.startsWith('0x')) ? payload.new.username : "User " + (wagmiAddress ?? cdpAddress ?? "").slice(-4).toUpperCase()
                        }));
                    }
                )
                .subscribe();

            return () => {
                supabase.removeChannel(channel);
            };
        }
    }, [wagmiAddress, cdpAddress, isWalletConnected, isGuest, guestId]);

    // Coins & privacy preferences path: the baseline players grant excludes
    // `coins` (and `clan_tag` lives on clan tables). Merge from GET /api/profile
    // whenever the app session lands or `ludo-profile-refresh` fires.
    useEffect(() => {
        const activeWallet = wagmiAddress ?? cdpAddress;
        if (!activeWallet || !appSessionId) return;
        let cancelled = false;
        const refreshServiceProfile = async () => {
            try {
                const res = await fetch(
                    `/api/profile?walletAddress=${encodeURIComponent(activeWallet)}&sessionId=${encodeURIComponent(appSessionId)}`
                );
                if (!res.ok) return;
                const data = await res.json();
                if (cancelled || !data) return;
                setProfile((prev) => {
                    const nextUsername = data.username !== undefined ? data.username : (prev?.username ?? null);
                    const nextDisplay = (nextUsername && !nextUsername.startsWith('0x'))
                        ? nextUsername
                        : `User ${activeWallet.slice(-4).toUpperCase()}`;
                    return {
                        ...(prev || { username: nextUsername, avatar_url: null, displayName: nextDisplay }),
                        username: nextUsername,
                        avatar_url: data.avatar_url !== undefined ? data.avatar_url : (prev?.avatar_url ?? null),
                        displayName: nextDisplay,
                        lxp: typeof data.lxp === 'number' ? data.lxp : prev?.lxp,
                        rxp: typeof data.rxp === 'number' ? data.rxp : prev?.rxp,
                        coins: typeof data.coins === 'number' ? data.coins : prev?.coins,
                        total_wins: typeof data.total_wins === 'number' ? data.total_wins : prev?.total_wins,
                        total_games: typeof data.total_games === 'number' ? data.total_games : prev?.total_games,
                        classic_played: typeof data.classic_played === 'number' ? data.classic_played : prev?.classic_played,
                        power_played: typeof data.power_played === 'number' ? data.power_played : prev?.power_played,
                        ai_played: typeof data.ai_played === 'number' ? data.ai_played : prev?.ai_played,
                        is_public: typeof data.is_public === 'boolean' ? data.is_public : prev?.is_public,
                        allow_requests: typeof data.allow_requests === 'boolean' ? data.allow_requests : prev?.allow_requests,
                        clan_tag: data.clan_tag !== undefined ? data.clan_tag : prev?.clan_tag,
                        clan_name: data.clan_name !== undefined ? data.clan_name : prev?.clan_name,
                    };
                });
            } catch {
                /* offline — balance stays as-is */
            }
        };
        void refreshServiceProfile();
        const onRefresh = () => {
            void refreshServiceProfile();
        };
        window.addEventListener('ludo-profile-refresh', onRefresh);
        return () => {
            cancelled = true;
            window.removeEventListener('ludo-profile-refresh', onRefresh);
        };
    }, [wagmiAddress, cdpAddress, appSessionId]);

    const walletLabel = wagmiAddress ?? cdpAddress;
    const displayName = (profile?.username && !profile.username.startsWith('0x'))
        ? profile.username
        : isGuest && guestId
            ? `Guest ${guestId.slice(-4).toUpperCase()}`
            : walletLabel
                ? `User ${walletLabel.slice(-4).toUpperCase()}`
                : 'Guest';

    return { profile, address, isConnected, displayName, isGuest, isSessionChecking };
}
