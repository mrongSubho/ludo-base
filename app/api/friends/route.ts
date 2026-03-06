import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const wallet = searchParams.get('wallet');

    if (!wallet) return NextResponse.json({ error: 'No wallet provided' }, { status: 400 });

    try {
        // 1. Fetch the user's Farcaster profile by wallet address
        const profileRes = await fetch(`https://api.neynar.com/v2/farcaster/user/bulk-by-address?addresses=${wallet}`, {
            headers: {
                'accept': 'application/json',
                'api_key': process.env.NEYNAR_API_KEY || ''
            }
        });

        const profileData = await profileRes.json();
        const userProfile = profileData[wallet.toLowerCase()]?.[0];

        if (!userProfile?.fid) {
            // No connected Farcaster account, but we can still fetch Game Friends
            const { data: gameFriends } = await supabase
                .from('players')
                .select('wallet_address, username, avatar_url, total_wins')
                .neq('wallet_address', wallet.toLowerCase())
                .order('last_played_at', { ascending: false, nullsFirst: false })
                .limit(20);

            return NextResponse.json({ onchainFriends: [], gameFriends: gameFriends || [] });
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
        if (followingWallets.length > 0) {
            const orQuery = followingWallets.map((addr: string) => `wallet_address.ilike.${addr}`).join(',');
            const { data, error } = await supabase
                .from('players')
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
            .neq('wallet_address', wallet.toLowerCase())
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
            gameFriends: healStatus(gameFriends || [])
        });
    } catch (error) {
        console.error("Friends API failure:", error);
        return NextResponse.json({ error: 'API failure' }, { status: 500 });
    }
}
