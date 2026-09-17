import { createClient, SupabaseClient } from '@supabase/supabase-js';

let admin: SupabaseClient | null = null;

export function serviceDb() {
    if (admin) return admin;
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('Supabase service role is not configured');
    admin = createClient(url, key);
    return admin;
}

export async function requireAppSession(walletAddress: unknown, sessionId: unknown) {
    const wallet = String(walletAddress || '').toLowerCase();
    const id = String(sessionId || '');
    if (!/^0x[a-f0-9]{40}$/.test(wallet) || !id) return null;
    const { data } = await serviceDb().from('app_sessions')
        .select('wallet_address, expires_at, revoked_at').eq('id', id).maybeSingle();
    if (!data || data.revoked_at || new Date(data.expires_at).getTime() <= Date.now() ||
        String(data.wallet_address).toLowerCase() !== wallet) return null;
    return wallet;
}
