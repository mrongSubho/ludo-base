import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: Request) {
    try {
        const { walletAddress, sessionId, username, avatarUrl, peerId } = await request.json();
        const wallet = String(walletAddress || '').toLowerCase();
        if (!/^0x[a-f0-9]{40}$/.test(wallet) || !sessionId) {
            return NextResponse.json({ error: 'Invalid profile proof' }, { status: 401 });
        }

        const { data: session } = await supabase
            .from('app_sessions')
            .select('wallet_address, expires_at, revoked_at')
            .eq('id', sessionId)
            .maybeSingle();
        if (!session || session.revoked_at || new Date(session.expires_at).getTime() <= Date.now() ||
            String(session.wallet_address).toLowerCase() !== wallet) {
            return NextResponse.json({ error: 'Invalid profile session' }, { status: 401 });
        }

        const updates: Record<string, string | null> = {};
        if (username !== undefined) updates.username = username === null ? null : String(username).slice(0, 80);
        if (avatarUrl !== undefined) updates.avatar_url = avatarUrl === null ? null : String(avatarUrl).slice(0, 500);
        if (peerId !== undefined) updates.peer_id = peerId === null ? null : String(peerId).slice(0, 200);
        if (Object.keys(updates).length === 0) return NextResponse.json({ success: true });

        const { error } = await supabase.from('players').upsert(
            { wallet_address: wallet, ...updates },
            { onConflict: 'wallet_address' }
        );
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json({ success: true });
    } catch (error) {
        return NextResponse.json({ error: (error as Error).message }, { status: 500 });
    }
}
