import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

let _sb: SupabaseClient | null = null;
function db(): SupabaseClient {
    if (_sb) return _sb;
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) throw new Error('Supabase is not configured');
    _sb = createClient(url, key);
    return _sb;
}

/** Guest polls pending invites for their wallet (no Supabase Auth). */
export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const wallet = (searchParams.get('wallet') || '').trim().toLowerCase();
        if (!wallet) return NextResponse.json({ error: 'wallet required' }, { status: 400 });

        const since = new Date(Date.now() - 2 * 60_000).toISOString();
        const { data, error } = await db()
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
