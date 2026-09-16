import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { recoverMessageAddress } from 'viem';
import { buildEcdhMessage, isFreshIssuedAt } from '@/lib/matchProof';

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

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
        const { error } = await supabase.from('players').upsert(
            { wallet_address: recovered, ecdh_pubkey: publicKey },
            { onConflict: 'wallet_address' },
        );
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json({ success: true });
    } catch (error) {
        return NextResponse.json({ error: (error as Error).message }, { status: 400 });
    }
}
