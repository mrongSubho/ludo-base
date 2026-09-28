/**
 * R4 — Base-only swap token list (CDP / Coinbase swap engine).
 * CHIPS is not a swap asset until a real market exists (H2).
 * Addresses are Base mainnet (8453). ETH maps to WETH in quotes.
 */

export type SwapToken = {
    symbol: string;
    name: string;
    address: `0x${string}`;
    decimals: number;
    /** Coin / stable group for UI clustering. */
    group: "native" | "stable" | "blue" | "defi";
};

/** WETH on Base used as native-ETH stand-in in Coinbase swap quotes. */
export const WETH_BASE = "0x4200000000000000000000000000000000000006" as const;

export const BASE_SWAP_TOKENS: SwapToken[] = [
    { symbol: "ETH", name: "Ethereum", address: WETH_BASE, decimals: 18, group: "native" },
    {
        symbol: "USDC",
        name: "USD Coin",
        address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        decimals: 6,
        group: "stable",
    },
    {
        symbol: "USDT",
        name: "Tether USD",
        address: "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2",
        decimals: 6,
        group: "stable",
    },
    {
        symbol: "DAI",
        name: "Dai Stablecoin",
        address: "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb",
        decimals: 18,
        group: "stable",
    },
    {
        symbol: "USDbC",
        name: "Bridged USDC",
        address: "0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA",
        decimals: 6,
        group: "stable",
    },
    {
        symbol: "cbBTC",
        name: "Coinbase Wrapped BTC",
        address: "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf",
        decimals: 8,
        group: "blue",
    },
    {
        symbol: "cbETH",
        name: "Coinbase Wrapped ETH",
        address: "0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22",
        decimals: 18,
        group: "blue",
    },
    {
        symbol: "wstETH",
        name: "Wrapped stETH",
        address: "0xc1CBa3fEA344f73F911E4546C687288E5F2636A1",
        decimals: 18,
        group: "blue",
    },
    {
        symbol: "AERO",
        name: "Aerodrome",
        address: "0x940181a94A35A4569E4529A3CDfB74e38FD98631",
        decimals: 18,
        group: "defi",
    },
    {
        symbol: "DEGEN",
        name: "Degen",
        address: "0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed",
        decimals: 18,
        group: "defi",
    },
    {
        symbol: "TOSHI",
        name: "Toshi",
        address: "0xAC1Bd2486aAf3B5C0fc3Fd868558b082a531B2B4",
        decimals: 18,
        group: "defi",
    },
    {
        symbol: "BRETT",
        name: "Brett",
        address: "0x532f27101965dd16442E59d40670FaF5eBB142E4",
        decimals: 18,
        group: "defi",
    },
    {
        symbol: "VIRTUAL",
        name: "Virtuals",
        address: "0x0b3e328455c4059eeb9e3f84b5543f74e24e7e1b",
        decimals: 18,
        group: "defi",
    },
    {
        symbol: "ZORA",
        name: "Zora",
        address: "0x1111111111166b7fe7bd91427724b487980afc69",
        decimals: 18,
        group: "defi",
    },
];

export function findSwapToken(symbol: string): SwapToken | undefined {
    return BASE_SWAP_TOKENS.find((t) => t.symbol.toLowerCase() === symbol.toLowerCase());
}

export function findSwapTokenByAddress(address: string): SwapToken | undefined {
    const a = String(address || "").toLowerCase();
    return BASE_SWAP_TOKENS.find((t) => t.address.toLowerCase() === a);
}

/** Tokens excluding one symbol (for the "to" picker). */
export function swapTokensExcept(symbol: string): SwapToken[] {
    return BASE_SWAP_TOKENS.filter((t) => t.symbol !== symbol);
}

/** Search by symbol or name — used when the list grows. */
export function searchSwapTokens(query: string, exceptSymbol?: string): SwapToken[] {
    const q = query.trim().toLowerCase();
    let list = exceptSymbol ? swapTokensExcept(exceptSymbol) : BASE_SWAP_TOKENS;
    if (!q) return list;
    list = list.filter((t) => t.symbol.toLowerCase().includes(q) || t.name.toLowerCase().includes(q));
    // Exact symbol hit first.
    return [...list].sort((a, b) => {
        const ax = a.symbol.toLowerCase() === q ? 0 : 1;
        const bx = b.symbol.toLowerCase() === q ? 0 : 1;
        return ax - bx;
    });
}
