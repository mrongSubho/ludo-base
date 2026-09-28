/**
 * R4 — Base-only swap token list (CDP / Coinbase swap engine).
 * CHIPS is not a swap asset until a real market exists (H2).
 */

export type SwapToken = {
    symbol: string;
    address: `0x${string}`;
    decimals: number;
};

/** WETH on Base used as native-ETH stand-in in Coinbase swap quotes. */
export const WETH_BASE = "0x4200000000000000000000000000000000000006" as const;

export const BASE_SWAP_TOKENS: SwapToken[] = [
    { symbol: "ETH", address: WETH_BASE, decimals: 18 },
    { symbol: "USDC", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6 },
    { symbol: "USDT", address: "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2", decimals: 6 },
    { symbol: "DAI", address: "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb", decimals: 18 },
    {
        symbol: "cbBTC",
        address: "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf",
        decimals: 8,
    },
];

export function findSwapToken(symbol: string): SwapToken | undefined {
    return BASE_SWAP_TOKENS.find((t) => t.symbol.toLowerCase() === symbol.toLowerCase());
}
