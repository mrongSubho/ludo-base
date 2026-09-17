import { NextResponse } from 'next/server';
import { recoverMessageAddress } from 'viem';
import { buildEcdhMessage, isFreshIssuedAt } from '@/lib/matchProof';
import { requireAppSession, serviceDb } from '@/lib/serverAuth';

/** Recipient ECDH pubkey lookup for DM sealing (service role: ecdh_pubkey is server-only). */
export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const target = (searchParams.get('wallet') || '').toLowerCase();
        if (!/^0x[a-f0-9]{40}$/.test(target)) {
            return NextResponse.json({ error: 'Invalid wallet' }, { status: 400 });
        }
        const requester = await requireAppSession(
            searchParams.get('walletAddress'),
            searchParams.get('sessionId'),
        );
        if (!requester) return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
        const { data, error } = await serviceDb().from('players')
            .select('ecdh_pubkey').eq('wallet_address', target).maybeSingle();
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json({ publicKey: (data?.ecdh_pubkey as unknown) ?? null });
    } catch (error) {
        return NextResponse.json({ error: (error as Error).message }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const { walletAddress, publicKey, issuedAt, message, signature } = await request.json();
        if (!walletAddress || !publicKey || !issuedAt || !message || !signature || !isFreshIssuedAt(issuedAt)) {
            return NextResponse.json({ error: 'Missing or expired key proof' }, { status: 401 });
        }
        const expected = buildEcdhMessage(String(walletAddress), publicKey, issuedAt);
        if (message !== expected) return NextResponse.json({ error: 'Message mismatch' }, { status: 401 });
        let recovered: string;
        try {
            recovered = (await recoverMessageAddress({ message, signature: signature as `0x${string}` })).toLowerCase();
        } catch {
            return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
        }
        if (recovered !== String(walletAddress).toLowerCase()) return NextResponse.json({ error: 'Signer mismatch' }, { status: 403 });
        // Service role: players writes are default-deny; proof is the wallet signature above.
        const { error } = await serviceDb().from('players').upsert(
            { wallet_address: recovered, ecdh_pubkey: publicKey },
            { onConflict: 'wallet_address' },
        );
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json({ success: true });
    } catch (error) {
        return NextResponse.json({ error: (error as Error).message }, { status: 400 });
    }
}
