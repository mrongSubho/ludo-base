import { NextResponse } from 'next/server';
import { requireAppSession, serviceDb } from '@/lib/serverAuth';

// Prices are server-owned; the browser only submits SKU identifiers.
const PRICES: Record<string, number> = {
    'theme-daybreak': 500, 'dice-midnight': 300, 'dice-gold': 800,
    'tokens-orb': 300, s1: 180, s2: 300, s3: 2000, s4: 100, s5: 240, s6: 60,
};

export async function POST(request: Request) {
    try {
        const { walletAddress, sessionId, itemIds, requestId } = await request.json();
        const wallet = await requireAppSession(walletAddress, sessionId);
        if (!wallet) return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
        const ids = Array.isArray(itemIds) ? [...new Set(itemIds.map(String))] : [];
        const id = String(requestId || '');
        if (!ids.length || ids.length > 30 || !id || ids.some(sku => !PRICES[sku])) {
            return NextResponse.json({ error: 'Invalid purchase' }, { status: 400 });
        }
        const { data, error } = await serviceDb().rpc('purchase_marketplace' as never, {
            p_wallet: wallet, p_request_id: id.slice(0, 100), p_item_ids: ids,
            p_total: ids.reduce((sum, sku) => sum + PRICES[sku], 0),
        } as never);
        if (error) return NextResponse.json({ error: error.message }, { status: 409 });
        return NextResponse.json({ success: true, balance: data?.balance, itemIds: ids });
    } catch (error) {
        return NextResponse.json({ error: (error as Error).message }, { status: 500 });
    }
}
