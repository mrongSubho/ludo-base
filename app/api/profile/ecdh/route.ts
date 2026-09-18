import { NextResponse } from 'next/server';
import { buildEcdhMessage, isFreshIssuedAt } from '@/lib/matchProof';
import { verifyPersonalSign } from '@/lib/walletVerify';
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
        // 6492-aware (EOA ecrecover + 1271/6492 validator on Base 8453).
        // Same broken primitive caused the ECDH half of the signing storm.
        const verdict = await verifyPersonalSign({
            address: String(walletAddress),
            message,
            signature,
        });
        if (!verdict.ok) {
            const error = verdict.code === 'ecrecover-invalid' ? 'Invalid signature' : 'Signer mismatch';
            return NextResponse.json({ error, code: verdict.code }, { status: 401 });
        }
        const recovered = String(walletAddress).toLowerCase();
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
