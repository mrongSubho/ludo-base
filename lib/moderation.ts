import { isWalletAddress } from './validation/wallet';
export { containsProfanity, filterProfanity } from './profanity';

export interface BlockQueryDb {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- accepts serviceDb() Supabase client or test stub
    from: (table: string) => any;
}

/**
 * Checks bidirectional block state (`A -> B` or `B -> A`) in `user_blocks`.
 */
export async function isBlockedBetween(db: BlockQueryDb, walletA: string, walletB: string): Promise<boolean> {
    const a = walletA.trim().toLowerCase();
    const b = walletB.trim().toLowerCase();
    if (!isWalletAddress(a) || !isWalletAddress(b) || a === b) return false;

    const [ab, ba] = await Promise.all([
        db.from('user_blocks').select('id').eq('blocker_address', a).eq('blocked_address', b).limit(1),
        db.from('user_blocks').select('id').eq('blocker_address', b).eq('blocked_address', a).limit(1),
    ]);
    return Boolean((ab?.data && ab.data.length > 0) || (ba?.data && ba.data.length > 0));
}

/**
 * Returns the lowercase set of wallets blocked by `wallet` or that blocked `wallet`.
 */
export async function getBlockedWallets(db: BlockQueryDb, wallet: string): Promise<Set<string>> {
    const me = wallet.trim().toLowerCase();
    const out = new Set<string>();
    if (!isWalletAddress(me)) return out;

    const [outgoing, incoming] = await Promise.all([
        db.from('user_blocks').select('blocked_address').eq('blocker_address', me),
        db.from('user_blocks').select('blocker_address').eq('blocked_address', me),
    ]);
    for (const row of outgoing?.data || []) {
        const w = String(row?.blocked_address || '').trim().toLowerCase();
        if (w) out.add(w);
    }
    for (const row of incoming?.data || []) {
        const w = String(row?.blocker_address || '').trim().toLowerCase();
        if (w) out.add(w);
    }
    return out;
}
