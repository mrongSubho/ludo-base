import {
    createPublicClient,
    http,
    parseEventLogs,
    type Address,
    type Hex,
    type Log,
    type TransactionReceipt,
} from 'viem';
import { baseSepolia } from 'viem/chains';
import { CHIPS_ERC20_ABI } from '@/lib/chips';

const TX_HASH_RE = /^0x[0-9a-fA-F]{64}$/;

export function getBaseSepoliaRpcUrl(): string {
    return (
        process.env.SEPOLIA_RPC ||
        process.env.BASE_SEPOLIA_RPC_URL ||
        'https://sepolia.base.org'
    );
}

export function getBaseSepoliaPublicClient() {
    return createPublicClient({
        chain: baseSepolia,
        transport: http(getBaseSepoliaRpcUrl()),
    });
}

/**
 * Wait for a confirmed, successful Base Sepolia transaction receipt.
 * Always fails closed if the hash is malformed, unmined within timeout,
 * reverted, or if the RPC cannot confirm the receipt.
 */
export async function waitForConfirmedReceipt(
    txHash: string,
    makeError: (message: string, statusCode?: number) => Error,
    timeoutMs = 20_000,
): Promise<TransactionReceipt> {
    const cleanHash = txHash.trim();
    if (!TX_HASH_RE.test(cleanHash)) {
        throw makeError('Invalid transaction hash format', 400);
    }

    const client = getBaseSepoliaPublicClient();
    let receipt: TransactionReceipt;
    try {
        receipt = await client.waitForTransactionReceipt({
            hash: cleanHash as Hex,
            confirmations: 1,
            timeout: timeoutMs,
            pollingInterval: 1_500,
        });
    } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        throw makeError(
            `Unable to confirm on-chain transaction receipt (${reason}). Please retry once confirmed.`,
            400,
        );
    }

    if (receipt.status !== 'success') {
        throw makeError('On-chain transaction reverted or did not succeed', 400);
    }

    return receipt;
}

/**
 * Verify that `logs` contain an ERC-20 `Transfer` event on `tokenContract`
 * transferring at least `minAmountWei` from `expectedFrom` to `expectedTo`.
 * Returns the matched transfer value in wei, or throws via `makeError`.
 */
export function verifyErc20TransferLog(params: {
    logs: Log[];
    tokenContract: Address;
    expectedFrom: string;
    expectedTo: string;
    minAmountWei: bigint;
    makeError: (message: string, statusCode?: number) => Error;
}): bigint {
    const decoded = parseEventLogs({
        abi: CHIPS_ERC20_ABI,
        logs: params.logs,
        eventName: 'Transfer',
    });

    const targetToken = params.tokenContract.toLowerCase();
    const targetFrom = params.expectedFrom.toLowerCase();
    const targetTo = params.expectedTo.toLowerCase();

    let totalMatched = BigInt(0);
    for (const log of decoded) {
        if (log.address.toLowerCase() !== targetToken) continue;
        const args = log.args as { from?: string; to?: string; value?: bigint };
        if (
            args.from?.toLowerCase() === targetFrom &&
            args.to?.toLowerCase() === targetTo
        ) {
            totalMatched += args.value ?? BigInt(0);
        }
    }

    if (totalMatched < params.minAmountWei) {
        throw params.makeError(
            'Transaction logs do not show the required CHIPS transfer to the protocol treasury',
            400,
        );
    }

    return totalMatched;
}
