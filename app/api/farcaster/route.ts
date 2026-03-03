import { NextResponse } from 'next/server';

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const wallet = searchParams.get('wallet');

    if (!wallet) return NextResponse.json({ error: 'No wallet provided' }, { status: 400 });

    try {
        const response = await fetch(`https://api.neynar.com/v2/farcaster/user/bulk-by-address?addresses=${wallet}`, {
            headers: {
                'accept': 'application/json',
                'api_key': process.env.NEYNAR_API_KEY || ''
            }
        });
        const data = await response.json();

        // Extract the first user found for this wallet
        const user = data[wallet.toLowerCase()]?.[0];

        if (user) {
            return NextResponse.json({
                fid: user.fid,
                displayName: user.display_name,
                username: user.username,
                avatarUrl: user.pfp_url
            });
        }
        return NextResponse.json({ error: 'No Farcaster profile found' }, { status: 404 });
    } catch (error) {
        return NextResponse.json({ error: 'API failure' }, { status: 500 });
    }
}
