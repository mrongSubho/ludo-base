/**
 * Wallet-address validation, shared.
 *
 * SEC-08 and its siblings all reduce to one rule: an address that came off the
 * wire must be proven to be an address **before** it reaches a PostgREST filter
 * string, an upstream URL, or a service-role query.
 *
 * The reason is not tidiness. `.or('user_address.eq.' + input)` is not a query
 * API — it is a string format, and a crafted value can close the term and add
 * its own. Through the service role that bypasses RLS entirely.
 *
 * One predicate, one place to change it if the chain ever supports something
 * other than 20-byte hex.
 */

// Case-insensitive on the prefix too: EIP-55 checksummed addresses carry
// uppercase hex digits, and a caller that uppercases a whole address turns the
// `0x` into `0X`. Rejecting that would refuse a legitimate wallet.
const ETH_ADDRESS = /^0x[a-f0-9]{40}$/i;

export function isWalletAddress(value: unknown): value is string {
    return typeof value === 'string' && ETH_ADDRESS.test(value);
}

/**
 * Lowercase an address if it is one, otherwise return null.
 *
 * Callers should branch on the result rather than passing the raw input onward:
 * an unparseable value must never become a query fragment.
 */
export function normalizeWallet(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return ETH_ADDRESS.test(trimmed) ? trimmed.toLowerCase() : null;
}

/**
 * Keep only the values that are addresses, preserving order and dropping
 * duplicates. For interpolating several validated values into one filter.
 */
export function sanitizeWalletList(values: readonly unknown[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const v of values) {
        const w = normalizeWallet(v);
        if (w && !seen.has(w)) {
            seen.add(w);
            out.push(w);
        }
    }
    return out;
}
