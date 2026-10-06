/* eslint-disable @typescript-eslint/no-explicit-any -- legacy wire/UI types; typed burn-down tracked in docs/ops/DEPLOY_OPS.md */
import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { requireAppSession, serviceDb } from '@/lib/serverAuth';
import { isWalletAddress, normalizeWallet } from '@/lib/validation/wallet';
import { checkRateLimit, clientIp, rateKey, rateLimitHeaders } from '@/lib/rateLimit';

// Accepted game friendships for a wallet (both directions), lowercase.
// Served via service role: friendships has no anon SELECT policy, and this
// field is consumed as DM/friend evidence (PublicProfileModal, RankingsPanel).
async function fetchAcceptedFriends(walletLower: string): Promise<string[]> {
    const db = serviceDb();
    // SEC-08: two explicit .eq() queries merged in JS. This used to interpolate
    // the wallet into a PostgREST `.or()` filter string, so a crafted `wallet`
    // could inject filter syntax and read friendships rows it had no business
    // seeing — through the service role, which bypasses RLS.
    const [asUser, asFriend] = await Promise.all([
        db.from('friendships')
            .select('user_address, friend_address')
            .eq('status', 'accepted')
            .eq('user_address', walletLower),
        db.from('friendships')
            .select('user_address, friend_address')
            .eq('status', 'accepted')
            .eq('friend_address', walletLower),
    ]);
    const error = asUser.error || asFriend.error;
    if (error) throw error;
    const rows = [...(asUser.data || []), ...(asFriend.data || [])];
    return [...new Set(rows.map((r: any) =>
        (r.user_address || '').toLowerCase() === walletLower
            ? (r.friend_address || '').toLowerCase()
            : (r.user_address || '').toLowerCase()
    ).filter(Boolean))];
}

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const raw = searchParams.get('wallet');

    // SEC-08: every call here spends NEYNAR_API_KEY twice (profile + following).
    // A session gates it now, but the session lasts 7 days, so the key still
    // needs its own bound rather than relying on the session alone.
    const limit = checkRateLimit(rateKey('friends', clientIp(request)), 10, 60_000);
    if (!limit.ok) {
        return NextResponse.json(
            { error: 'Too many requests', retryAfter: limit.retryAfterSec },
            { status: 429, headers: rateLimitHeaders(limit) },
        );
    }

    if (!raw) return NextResponse.json({ error: 'No wallet provided' }, { status: 400 });

    // SEC-08: validate BEFORE any query. `raw` used to flow straight into a
    // PostgREST filter string and an upstream Neynar URL.
    const wallet = normalizeWallet(raw);
    if (!isWalletAddress(wallet)) {
        return NextResponse.json({ error: 'Invalid wallet address' }, { status: 400 });
    }

    // SEC-08: require a session, and only ever answer for the caller's own
    // wallet. This endpoint spent a service-role key on an unauthenticated
    // caller-supplied address. Same `walletAddress` + `sessionId` shape the
    // other authenticated routes use.
    const session = await requireAppSession(
        searchParams.get('walletAddress'),
        searchParams.get('sessionId'),
    );
    if (!session) return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
    if (session !== wallet) {
        return NextResponse.json({ error: 'Not your wallet' }, { status: 403 });
    }

    try {
        // 1. Fetch the user's Farcaster profile by wallet address
        const profileRes = await fetch(`https://api.neynar.com/v2/farcaster/user/bulk-by-address?addresses=${encodeURIComponent(wallet)}`, {
            headers: {
                'accept': 'application/json',
                'api_key': process.env.NEYNAR_API_KEY || ''
            }
        });

        const profileData = await profileRes.json();
        const userProfile = profileData[wallet]?.[0];

        if (!userProfile?.fid) {
            // No connected Farcaster account, but we can still fetch Game Friends
            const { data: gameFriends } = await supabase
                .from('players')
                .select('wallet_address, username, avatar_url, total_wins')
                .neq('wallet_address', wallet)
                .order('last_played_at', { ascending: false, nullsFirst: false })
                .limit(20);

            const acceptedFriends = await fetchAcceptedFriends(wallet);
            return NextResponse.json({ onchainFriends: [], gameFriends: gameFriends || [], acceptedFriends });
        }

        const fid = userProfile.fid;

        // 2. Fetch the user's following list from Neynar using their FID
        const response = await fetch(`https://api.neynar.com/v2/farcaster/following?fid=${fid}&limit=50`, {
            headers: {
                'accept': 'application/json',
                'api_key': process.env.NEYNAR_API_KEY || ''
            }
        });

        const data = await response.json();
        const users = data.users || [];

        // 3. Extract the wallet addresses of the people they follow
        // Neynar returns verified_addresses.eth_addresses array
        const followingWallets = users.flatMap((u: any) => u.verified_addresses?.eth_addresses || [])
            .map((address: string) => address.toLowerCase());

        // 4. Intersect with our Supabase players table (Case-Insensitive)
        let onchainFriends: any[] = [];
        // Neynar-sourced addresses are still untrusted input, so they are
        // re-validated before they reach a filter string. Cap the set too:
        // an unbounded `.or()` is a query the caller can make expensive.
        const safeFollowing = followingWallets.filter(isWalletAddress).slice(0, 50);
        if (safeFollowing.length > 0) {
            const orQuery = safeFollowing.map((addr: string) => `wallet_address.ilike.${addr}`).join(',');
            const { data, error } = await supabase
                .from('players')
                // Baseline directory grant only: wallet_address, username,
                // avatar_url, lxp, rxp, status, classic/power/ai_played,
                // total_wins, total_games, rank_tier, last_played_at, created_at.
                // (current_room_code is server-only — never select it via anon.)
                .select('wallet_address, username, avatar_url, total_wins, status, last_played_at')
                .or(orQuery);
            if (error) {
                console.error("Supabase Onchain Friends Fetch Error:", error);
            } else {
                onchainFriends = data || [];
            }
        }

        // 5. Fetch "Game Friends" (Recent Active Players) from Supabase
        const { data: gameFriends, error: gameError } = await supabase
            .from('players')
            .select('wallet_address, username, avatar_url, total_wins, status, last_played_at')
            .neq('wallet_address', wallet)
            .order('last_played_at', { ascending: false, nullsFirst: false })
            .limit(20);

        if (gameError) {
            console.error("Supabase Game Friends Fetch Error:", gameError);
        }

        // Self-Healing Status Logic: If 'Online' but last_played_at > 5 mins ago, force 'Offline'
        const now = new Date().getTime();
        const driftLimit = 5 * 60 * 1000; // 5 minutes

        const healStatus = (list: any[]) => list.map(f => {
            if (f.status === 'Online' && f.last_played_at) {
                const lastSeen = new Date(f.last_played_at).getTime();
                if (now - lastSeen > driftLimit) {
                    return { ...f, status: 'Offline' };
                }
            }
            return f;
        });

        return NextResponse.json({
            onchainFriends: healStatus(onchainFriends),
            gameFriends: healStatus(gameFriends || []),
            acceptedFriends: await fetchAcceptedFriends(wallet),
        });
    } catch (error) {
        console.error("Friends API failure:", error);
        return NextResponse.json({ error: 'API failure' }, { status: 500 });
    }
}
