import { NextResponse } from 'next/server';
import { requireAppSession, serviceDb } from '@/lib/serverAuth';

/**
 * GET /api/chips/escrow-balance?walletAddress=…&sessionId=…
 * Session-scoped read of the caller's own escrowed CHIPS balance
 * (`chips_escrow_accounts`, server-only under default-deny). Feeds the
 * marketplace spendable-balance gate; never another wallet's row.
 */
export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const wallet = await requireAppSession(
            searchParams.get('walletAddress'),
            searchParams.get('sessionId'),
        );
        if (!wallet) return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
        const { data, error } = await serviceDb()
            .from('chips_escrow_accounts')
            .select('balance')
            .eq('wallet_address', wallet)
            .maybeSingle();
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json({ balance: data?.balance ?? 0 });
    } catch (error) {
        return NextResponse.json({ error: (error as Error).message }, { status: 500 });
    }
}
