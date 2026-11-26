import { NextResponse } from 'next/server';
import { requireAppSession, requireSessionWallet, serviceDb } from '@/lib/serverAuth';

const BASE_OWNED_SKUS = [
    'theme-3077',
    'theme-retro',
    'dice-classic',
    'tokens-orb',
    'tokens-pawn',
] as const;

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const rawWallet = searchParams.get('walletAddress') || undefined;
        const authHeader = request.headers.get('authorization');
        const bearer = authHeader?.toLowerCase().startsWith('bearer ') ? authHeader.slice(7).trim() : null;
        const headerSid = request.headers.get('x-session-id')?.trim() || bearer || undefined;

        const wallet =
            (await requireSessionWallet(request, { scope: 'app', expectedWallet: rawWallet })) ||
            (rawWallet && headerSid ? await requireAppSession(rawWallet, headerSid) : null);

        if (!wallet) {
            return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
        }

        const db = serviceDb();
        const { data, error } = await db
            .from('chips_marketplace_purchases')
            .select('item_ids')
            .eq('wallet_address', wallet.toLowerCase());

        if (error) {
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        const purchased: string[] = [];
        for (const row of data ?? []) {
            if (Array.isArray(row?.item_ids)) {
                for (const id of row.item_ids) {
                    if (typeof id === 'string' && id) purchased.push(id);
                }
            }
        }

        const owned = [...new Set<string>([...BASE_OWNED_SKUS, ...purchased])];
        return NextResponse.json({ owned });
    } catch (err: unknown) {
        return NextResponse.json(
            { error: (err as Error).message || 'Failed to load marketplace inventory' },
            { status: 500 },
        );
    }
}
