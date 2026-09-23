/**
 * Single signer seam for identity-bearing proofs (parent Base Account only).
 * wagmi is the default impl today; CDP `useSignEvmMessage` / `useSignEvmTypedData`
 * will implement the same interface in Phase 1 — do not rewrite call sites.
 *
 * Identity rule (SMART_WALLET_PLAN §1.1): `account` is always the parent
 * smart-account address used as `wallet_address`. Never a sub-account.
 */

export type SignMessageArgs = {
    account: `0x${string}`;
    message: string;
};

export type SignTypedDataArgs = {
    account: `0x${string}`;
    /** Widened for dual-chain (84532/8453) grants — matches useMoveAuth. */
    domain: { name: string; version: string; chainId: number };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    types: Record<string, Array<{ name: string; type: string }>>;
    primaryType: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    message: Record<string, any>;
};

export type WalletSigner = {
    /** Parent address used as player id, or undefined when disconnected. */
    address: string | undefined;
    signMessageAsync: (args: SignMessageArgs) => Promise<string>;
    signTypedDataAsync: (args: SignTypedDataArgs) => Promise<string>;
};
