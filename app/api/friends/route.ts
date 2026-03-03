import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const fid = searchParams.get('fid');

    if (!fid) return NextResponse.json({ error: 'No FID provided' }, { status: 400 });

    try {
        // Fetch the user's following list from Neynar
        const response = await fetch(`https://api.neynar.com/v2/farcaster/following?fid=${fid}&limit=50`, {
            headers: {
                'accept': 'application/json',
                'api_key': process.env.NEYNAR_API_KEY || ''
            }
        });

        const data = await response.json();
        if (!data.users) return NextResponse.json({ friends: [] });

        // Extract the wallet addresses of the people they follow
        // Neynar returns verified_addresses.eth_addresses array
        const followingWallets = data.users.flatMap((u: any) => u.verified_addresses?.eth_addresses || [])
            .map((address: string) => address.toLowerCase());

        if (followingWallets.length === 0) return NextResponse.json({ friends: [] });

        // Intersect with our Supabase players table
        const { data: registeredFriends, error } = await supabase
            .from('players')
            .select('wallet_address, username, avatar_url, total_wins')
            .in('wallet_address', followingWallets);

        if (error) throw error;

        return NextResponse.json({ friends: registeredFriends });
    } catch (error) {
        console.error("Friends API failure:", error);
        return NextResponse.json({ error: 'API failure' }, { status: 500 });
    }
}
