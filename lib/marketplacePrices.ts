/**
 * Marketplace prices in whole CHIPS — the single source of truth, imported by
 * BOTH the server route (`app/api/marketplace/purchase/route.ts`, which
 * charges) and the client panel (which builds the signed purchase intent).
 * Sharing the table makes a client/server total mismatch structurally
 * impossible: the message the buyer signs always prices what the server
 * charges. Product-tunable here; rarity bands live in the panel.
 */
export const MARKETPLACE_PRICES: Record<string, number> = {
    'theme-daybreak': 500, 'dice-midnight': 300, 'dice-gold': 800,
    'tokens-orb-prism': 300, s1: 180, s2: 300, s3: 2000, s4: 100, s5: 240, s6: 60,
};

export type MarketCurrency = 'CHIPS' | 'USDC' | 'ETH';

export const MARKET_CURRENCIES: readonly MarketCurrency[] = ['CHIPS', 'USDC', 'ETH'];

export const DEFAULT_TREASURY_WALLET = '0xbcCa5DcBF293D98A627fD3814D5AE8249bB1DFaF' as const;
export const DEFAULT_CHIPS_ADDRESS = '0xB200000000000000000000821408122b9Ed3d05B' as const;
export const DEFAULT_USDC_SEPOLIA_ADDRESS = '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as const;

/** Base Sepolia USDC address (safe for both server routes and client hooks). */
export function usdcAddress(): `0x${string}` {
    const raw = (process.env.NEXT_PUBLIC_USDC_ADDRESS || DEFAULT_USDC_SEPOLIA_ADDRESS).trim();
    return (/^0x[0-9a-fA-F]{40}$/.test(raw) ? raw : DEFAULT_USDC_SEPOLIA_ADDRESS) as `0x${string}`;
}

/** Treasury address receiving Base Sepolia marketplace payments. */
export function treasuryWalletAddress(): `0x${string}` {
    const raw = (process.env.NEXT_PUBLIC_TREASURY_WALLET || DEFAULT_TREASURY_WALLET).trim();
    return (/^0x[0-9a-fA-F]{40}$/.test(raw) ? raw : DEFAULT_TREASURY_WALLET) as `0x${string}`;
}

export function marketCurrencyDecimals(currency: MarketCurrency): number {
    return currency === 'USDC' ? 6 : 18;
}

/**
 * Convert a base whole-CHIPS catalog price into atomic token units on Base Sepolia.
 * Reference parity: 100 CHIPS = 1 USDC (6 dec) = 0.0004 ETH (18 dec).
 */
const BI_ZERO = BigInt(0);
const BI_100 = BigInt(100);
const BI_E18 = BigInt(10) ** BigInt(18);
const BI_USDC_UNIT = BigInt(10_000);
const BI_ETH_UNIT = BigInt(4_000_000_000_000);

export function marketCurrencyAmountWei(wholeChips: number, currency: MarketCurrency): bigint {
    if (!Number.isFinite(wholeChips) || wholeChips <= 0) return BI_ZERO;
    const scaled = BigInt(Math.round(wholeChips * 100)); // 2 decimal precision guard
    if (currency === 'CHIPS') {
        return (scaled * BI_E18) / BI_100;
    }
    if (currency === 'USDC') {
        // 100 CHIPS = 1_000_000 (1e6) USDC base units => 1 CHIP = 10_000 base units
        return (scaled * BI_USDC_UNIT) / BI_100;
    }
    // 100 CHIPS = 0.0004 ETH = 4e14 wei => 1 CHIP = 4e12 wei
    return (scaled * BI_ETH_UNIT) / BI_100;
}

/** Convert a base whole-CHIPS catalog price into human display number. */
export function marketCurrencyDisplayValue(wholeChips: number, currency: MarketCurrency): number {
    if (!Number.isFinite(wholeChips) || wholeChips <= 0) return 0;
    if (currency === 'CHIPS') return wholeChips;
    if (currency === 'USDC') return Number((wholeChips / 100).toFixed(4));
    return Number((wholeChips * 0.000004).toFixed(6));
}

export function formatMarketAmount(wholeChips: number, currency: MarketCurrency): string {
    const val = marketCurrencyDisplayValue(wholeChips, currency);
    if (currency === 'CHIPS') return `${Math.round(val).toLocaleString()} CHIPS`;
    if (currency === 'USDC') return `${val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })} USDC`;
    return `${val.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 6 })} ETH`;
}

export function formatCustomCurrencyAmount(amount: number, currency: MarketCurrency): string {
    if (!Number.isFinite(amount) || amount <= 0) return `0 ${currency}`;
    if (currency === 'CHIPS') return `${Math.round(amount).toLocaleString()} CHIPS`;
    if (currency === 'USDC') return `${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })} USDC`;
    return `${amount.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 6 })} ETH`;
}

/** Whole-CHIPS total for SKUs, or null when any SKU is unknown. */
export function marketplaceTotalChips(ids: string[]): number | null {
    let total = 0;
    for (const id of ids) {
        const price = MARKETPLACE_PRICES[id];
        if (price === undefined) return null;
        total += price;
    }
    return total;
}
