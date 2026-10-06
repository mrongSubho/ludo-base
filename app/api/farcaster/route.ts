/* eslint-disable @typescript-eslint/no-unused-vars -- lint burn-down quarantine 2026-09-23 */
import { NextResponse } from 'next/server';
import { normalizeWallet } from '@/lib/validation/wallet';

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const raw = searchParams.get('wallet');

    if (!raw) return NextResponse.json({ error: 'No wallet provided' }, { status: 400 });

    // SEC-23: validate BEFORE the upstream call. `wallet` was interpolated into
    // a Neynar URL verbatim, so a crafted value could append query parameters or
    // a second address and make this endpoint request something else with our
    // API key.
    const wallet = normalizeWallet(raw);
    if (!wallet) return NextResponse.json({ error: 'Invalid wallet address' }, { status: 400 });

    try {
        const response = await fetch(
            `https://api.neynar.com/v2/farcaster/user/bulk-by-address?addresses=${encodeURIComponent(wallet)}`, {
            headers: {
                'accept': 'application/json',
                'api_key': process.env.NEYNAR_API_KEY || ''
            }
        });
        const data = await response.json();

        // Extract the user found for this wallet (Case-Insensitive)
        const lowWallet = wallet;
        const userKey = Object.keys(data).find(k => k.toLowerCase() === lowWallet);
        const user = userKey ? data[userKey]?.[0] : null;

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
