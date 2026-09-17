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

/**
 * Ensure a players row exists for a wallet that may never have connected
 * (invite/friend-request/poke targets). Fresh-DB FKs reject rows referencing
 * unknown wallets, so any server flow that stores a third-party address must
 * provision first. Idempotent, defaults fill the rest. Returns an error
 * string on failure, null on success.
 */
export async function ensurePlayerRow(walletAddress: string): Promise<string | null> {
    const wallet = String(walletAddress || '').toLowerCase();
    if (!/^0x[a-f0-9]{40}$/.test(wallet) && !wallet.startsWith('guest_')) {
        return 'Invalid wallet address';
    }
    const { error } = await serviceDb()
        .from('players')
        .upsert({ wallet_address: wallet }, { onConflict: 'wallet_address', ignoreDuplicates: true });
    return error ? error.message : null;
}
