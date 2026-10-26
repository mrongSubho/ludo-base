/**
 * Formats and sanitizes raw Web3/EVM errors into human-friendly, concise notifications.
 * Eliminates internal JSON-RPC envelopes, stack traces, docs URLs, and raw ABI hex dumps.
 */
export function formatWeb3Error(err: unknown): string {
    if (!err) return 'Transaction failed. Please try again.';

    const raw = err instanceof Error ? err.message : String(err);
    const lower = raw.toLowerCase();

    // 1. User rejection / cancellation in wallet
    if (
        lower.includes('user rejected') ||
        lower.includes('user denied') ||
        lower.includes('rejected the request') ||
        lower.includes('action rejected') ||
        lower.includes('declined')
    ) {
        return 'Transaction cancelled in wallet.';
    }

    // 2. Insufficient balance for transaction fee
    if (
        lower.includes('insufficient funds') ||
        lower.includes('exceeds balance') ||
        lower.includes('not enough funds') ||
        lower.includes('gas * price + value')
    ) {
        return 'Insufficient ETH balance on Base for gas fee.';
    }

    // 3. Contract-level revert reasons (MissionSystem.sol & Ludo contracts)
    if (lower.includes('onlyoracle')) {
        return 'Attestation signature expired or unauthorized. Please refresh queue.';
    }
    if (lower.includes('alreadycompleted') || lower.includes('matchsynced')) {
        return 'These matches have already been settled on-chain.';
    }
    if (lower.includes('badparam')) {
        return 'Invalid sync parameters or attestation deadline expired.';
    }
    if (lower.includes('paused')) {
        return 'Mission system contract is temporarily paused for maintenance.';
    }
    if (lower.includes('insufficientreserves')) {
        return 'Mission reward pool balance is low. Please try again shortly.';
    }
    if (lower.includes('notfound')) {
        return 'Mission reward not found or already settled.';
    }
    if (lower.includes('alreadyclaimed')) {
        return 'Reward for this period has already been claimed.';
    }

    // 4. Gas limit / batch size issues
    if (
        lower.includes('exceeds max transaction gas limit') ||
        lower.includes('gas limit') ||
        lower.includes('out of gas') ||
        lower.includes('gas required exceeds') ||
        lower.includes('intrinsic gas too low')
    ) {
        return 'Batch exceeds network gas limit. Please sync in smaller batches of 10.';
    }

    // 5. Pending / nonce collisions
    if (
        lower.includes('nonce too low') ||
        lower.includes('replacement transaction underpriced') ||
        lower.includes('already known')
    ) {
        return 'Previous transaction still pending in wallet. Please wait a moment.';
    }

    // 6. Network connectivity
    if (
        lower.includes('network error') ||
        lower.includes('failed to fetch') ||
        lower.includes('timeout') ||
        lower.includes('connection refused')
    ) {
        return 'Network connection issue. Please check your connection and retry.';
    }

    // 7. Check for viem's shortMessage property if present
    if (typeof err === 'object' && err !== null && 'shortMessage' in err) {
        const short = String((err as { shortMessage?: unknown }).shortMessage || '').trim();
        if (
            short &&
            !short.includes('Contract Call:') &&
            !short.includes('args:') &&
            short.length <= 140
        ) {
            return short;
        }
    }

    // 8. Extract clean revert reason regex match
    const revertMatch = raw.match(/reverted with the following reason:\s*([^\n\r]+)/i);
    if (revertMatch && revertMatch[1]) {
        const clean = revertMatch[1].trim().split('Contract Call:')[0].trim();
        if (clean.length > 0 && clean.length <= 120 && !clean.includes('0x')) {
            return clean;
        }
    }

    // Safe general fallback
    return 'Transaction failed on Base. Please try again.';
}
