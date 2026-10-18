import { NextResponse } from 'next/server';
import { requireSessionWallet, serviceDb } from '@/lib/serverAuth';

/** Guest polls pending invites for the wallet bound to its app session. */
export async function GET(request: Request) {
    try {
        const authed = await requireSessionWallet(request, { scope: 'app' });
        if (!authed) {
            return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
        }
        const wallet = authed;
        const since = new Date(Date.now() - 2 * 60_000).toISOString();
        const { data, error } = await serviceDb()
            .from('game_invites')
            .select('id, room_code, host_address, match_type, entry_fee, validation_token, status, created_at')
            .eq('guest_address', wallet)
            .eq('status', 'pending')
            .gt('created_at', since)
            .order('created_at', { ascending: false })
            .limit(5);
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json({ invites: data || [] });
    } catch (err) {
        return NextResponse.json({ error: (err as Error).message }, { status: 500 });
    }
}
