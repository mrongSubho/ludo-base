/**
 * Single signer seam for identity-bearing proofs (parent / smart account).
 * External = wagmi; In-game = CDP (usePlayerSigner picks one).
 * Never a sub-account or owner EOA as `wallet_address`.
 */

export type SignMessageArgs = {
    account: `0x${string}`;
    message: string;
};

export type SignTypedDataArgs = {
    account: `0x${string}`;
    domain: { name: string; version: string; chainId: number };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    types: any;
    primaryType: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    message: any;
};

export type WalletSigner = {
    /** Player id (parent / smart), or undefined when disconnected. */
    address: string | undefined;
    signMessageAsync: (args: SignMessageArgs) => Promise<`0x${string}`>;
    signTypedDataAsync: (args: SignTypedDataArgs) => Promise<`0x${string}`>;
};
