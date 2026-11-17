/* eslint-disable @typescript-eslint/no-explicit-any */
import {
    createPublicClient,
    formatUnits,
    http,
    parseEventLogs,
    type Hex,
} from 'viem';
import { baseSepolia } from 'viem/chains';
import { serviceDb } from '@/lib/serverAuth';
import { ARENA_VAULT_ABI, arenaVaultAddress } from '@/lib/chips';
import { issueVaultVoucher, type IssuedVaultVoucher } from '@/lib/arenaVaultVoucher';

export interface ArenaVaultClaimItem {
    id: string;
    wallet_address: string;
    claim_type: 'match_prize' | 'vault_withdraw' | 'match_refund';
    amount: number;
    match_id: string | null;
    status: 'claimable' | 'rolled' | 'claimed';
    tx_hash: string | null;
    created_at: string;
}

export interface ArenaVaultSummary {
    availableChips: number;
    reservedChips: number;
    claims: ArenaVaultClaimItem[];
    totalClaimableChips: number;
    prizeTotalChips: number;
}

export class ArenaVaultError extends Error {
    constructor(
        message: string,
        public readonly statusCode: number = 400,
        public readonly code?: string,
    ) {
        super(message);
        this.name = 'ArenaVaultError';
    }
}

export async function getVaultSummary(walletAddress: string): Promise<ArenaVaultSummary> {
    const db = serviceDb() as any;
    const wallet = walletAddress.toLowerCase();

    const [{ data: acc }, { data: stakes }, { data: claims }] = await Promise.all([
        db.from('arena_vault_accounts').select('balance').eq('wallet_address', wallet).maybeSingle(),
        db
            .from('arena_match_stakes')
            .select('amount, status')
            .eq('wallet_address', wallet)
            .in('status', ['reserved', 'committed']),
        db
            .from('arena_vault_claims')
            .select('*')
            .eq('wallet_address', wallet)
            .eq('status', 'claimable')
            .order('created_at', { ascending: false }),
    ]);

    const availableChips = Number(acc?.balance ?? 0);
    const reservedChips = (stakes || []).reduce((sum: number, s: any) => sum + Number(s.amount || 0), 0);
    const claimRows = (claims || []).map((c: any) => ({
        ...c,
        amount: Number(c.amount),
    })) as ArenaVaultClaimItem[];
    const totalClaimableChips = claimRows.reduce((sum, c) => sum + c.amount, 0);
    const prizeTotalChips = claimRows
        .filter((c) => c.claim_type === 'match_prize' || c.claim_type === 'match_refund')
        .reduce((sum, c) => sum + c.amount, 0);

    return {
        availableChips,
        reservedChips,
        claims: claimRows,
        totalClaimableChips,
        prizeTotalChips,
    };
}

export async function creditVaultDeposit(params: {
    walletAddress: string;
    txHash: string;
    expectedAmountChips?: number;
}): Promise<{ balance: number; creditedChips: number; idempotent: boolean }> {
    const db = serviceDb() as any;
    const wallet = params.walletAddress.toLowerCase();
    const txHash = params.txHash.trim();

    if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
        throw new ArenaVaultError('Invalid transaction hash format', 400);
    }

    const vaultAddr = arenaVaultAddress();
    let creditedChips = Number(params.expectedAmountChips ?? 0);

    try {
        const rpc = process.env.SEPOLIA_RPC || process.env.BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org';
        const client = createPublicClient({ chain: baseSepolia, transport: http(rpc) });
        const receipt = await client.getTransactionReceipt({ hash: txHash as Hex });

        if (receipt.status !== 'success') {
            throw new ArenaVaultError('On-chain vault deposit transaction failed', 400);
        }

        const decoded = parseEventLogs({
            abi: ARENA_VAULT_ABI,
            logs: receipt.logs,
            eventName: 'VaultDeposited',
        });

        if (decoded.length > 0) {
            const matchLog = decoded.find((l) => {
                const sameContract = !vaultAddr || l.address.toLowerCase() === vaultAddr.toLowerCase();
                const args = l.args as { player?: string; amount?: bigint };
                return sameContract && args.player?.toLowerCase() === wallet;
            });

            if (!matchLog) {
                throw new ArenaVaultError('Deposit log does not match connected wallet or ArenaVault contract', 400);
            }
            const amountWei = (matchLog.args as { amount?: bigint }).amount ?? BigInt(0);
            creditedChips = Math.floor(Number(formatUnits(amountWei, 18)));
        }
    } catch (err: any) {
        if (err instanceof ArenaVaultError) throw err;
        console.warn('[arenaVaultService] Receipt check warning (UserOp/RPC lag):', err?.message);
    }

    if (!Number.isFinite(creditedChips) || creditedChips <= 0) {
        throw new ArenaVaultError('Deposit amount must be positive', 400);
    }

    const { data, error } = await db.rpc('arena_vault_credit_deposit', {
        p_wallet: wallet,
        p_amount: creditedChips,
        p_tx_hash: txHash,
    });

    if (error) {
        throw new ArenaVaultError(error.message || 'Failed to credit vault deposit', 500);
    }

    return {
        balance: Number(data?.balance ?? 0),
        creditedChips,
        idempotent: Boolean(data?.idempotent),
    };
}

export async function reserveMatchStake(params: {
    walletAddress: string;
    matchKey: string;
    amountChips: number;
}): Promise<{ balance: number; reserved: number }> {
    const db = serviceDb() as any;
    const wallet = params.walletAddress.toLowerCase();

    if (!params.matchKey || params.amountChips <= 0) {
        throw new ArenaVaultError('matchKey and positive amountChips required', 400);
    }

    const { data, error } = await db.rpc('arena_vault_reserve', {
        p_wallet: wallet,
        p_match_key: params.matchKey,
        p_amount: params.amountChips,
    });

    if (error) {
        const msg = String(error.message || '');
        if (msg.includes('INSUFFICIENT_VAULT')) {
            throw new ArenaVaultError('Insufficient Match Vault balance', 402, 'INSUFFICIENT_VAULT');
        }
        if (msg.includes('MATCH_ALREADY_COMMITTED')) {
            throw new ArenaVaultError('Match stake is already locked in progress', 409, 'MATCH_ALREADY_COMMITTED');
        }
        throw new ArenaVaultError(msg, 500);
    }

    return {
        balance: Number(data?.balance ?? 0),
        reserved: Number(data?.reserved ?? params.amountChips),
    };
}

export async function releaseMatchStake(params: {
    walletAddress: string;
    matchKey: string;
}): Promise<{ balance: number; released: number }> {
    const db = serviceDb() as any;
    const { data, error } = await db.rpc('arena_vault_release', {
        p_wallet: params.walletAddress.toLowerCase(),
        p_match_key: params.matchKey,
    });
    if (error) {
        throw new ArenaVaultError(error.message || 'Failed to release stake', 500);
    }
    return {
        balance: Number(data?.balance ?? 0),
        released: Number(data?.released ?? 0),
    };
}

export async function commitMatchStakes(params: {
    matchKeys: string[];
    matchId: string;
}): Promise<{ committed: number }> {
    if (!params.matchKeys.length || !params.matchId) return { committed: 0 };
    const db = serviceDb() as any;
    const { data, error } = await db.rpc('arena_vault_commit_match', {
        p_match_keys: params.matchKeys,
        p_match_id: params.matchId,
    });
    if (error) {
        console.warn('[arenaVaultService:commitMatchStakes]', error.message);
        return { committed: 0 };
    }
    return { committed: Number(data?.committed ?? 0) };
}

export async function requestVaultWithdrawal(params: {
    walletAddress: string;
    amountChips: number;
    chainId?: number;
}): Promise<{ balance: number; issuedVoucher: IssuedVaultVoucher }> {
    const db = serviceDb() as any;
    const wallet = params.walletAddress.toLowerCase();

    if (!Number.isFinite(params.amountChips) || params.amountChips <= 0) {
        throw new ArenaVaultError('Withdrawal amount must be positive', 400);
    }

    const { data, error } = await db.rpc('arena_vault_request_withdraw', {
        p_wallet: wallet,
        p_amount: Math.floor(params.amountChips),
    });

    if (error) {
        const msg = String(error.message || '');
        if (msg.includes('INSUFFICIENT_VAULT')) {
            throw new ArenaVaultError('Insufficient available Match Vault balance to withdraw', 400, 'INSUFFICIENT_VAULT');
        }
        throw new ArenaVaultError(msg, 500);
    }

    const issuedVoucher = await issueVaultVoucher({
        claimId: data.claimId,
        walletAddress: wallet,
        chainId: params.chainId,
    });

    return {
        balance: Number(data?.balance ?? 0),
        issuedVoucher,
    };
}

export async function rollPrizeToVault(params: {
    walletAddress: string;
    claimId: string;
}): Promise<{ balance: number; rolledAmount: number }> {
    const db = serviceDb() as any;
    const { data, error } = await db.rpc('arena_vault_roll_prize', {
        p_wallet: params.walletAddress.toLowerCase(),
        p_claim_id: params.claimId,
    });
    if (error) {
        throw new ArenaVaultError(error.message || 'Failed to roll prize to vault', 400);
    }
    return {
        balance: Number(data?.balance ?? 0),
        rolledAmount: Number(data?.rolledAmount ?? 0),
    };
}

export async function markVaultClaimsExecuted(params: {
    walletAddress: string;
    claimIds: string[];
    txHash: string;
}): Promise<void> {
    const db = serviceDb() as any;
    const wallet = params.walletAddress.toLowerCase();
    if (!params.claimIds.length) return;

    await db
        .from('arena_vault_claims')
        .update({
            status: 'claimed',
            tx_hash: params.txHash,
            claimed_at: new Date().toISOString(),
        })
        .in('id', params.claimIds)
        .eq('wallet_address', wallet)
        .eq('status', 'claimable');
}

export async function settleArenaMatchPayouts(params: {
    matchId: string;
    matchShape?: string | null;
    winnerWallets: string[];
}): Promise<{ settled: boolean }> {
    const db = serviceDb() as any;
    const winners = params.winnerWallets.map((w) => w.toLowerCase()).filter((w) => /^0x[0-9a-f]{40}$/.test(w));
    if (!winners.length) return { settled: false };

    let sharesBps: number[];
    if (winners.length === 1) {
        sharesBps = [10000];
    } else if (winners.length === 2) {
        sharesBps = params.matchShape === '4P' ? [7500, 2500] : [5000, 5000];
    } else {
        const even = Math.floor(10000 / winners.length);
        sharesBps = winners.map((_, idx) =>
            idx === winners.length - 1 ? 10000 - even * (winners.length - 1) : even,
        );
    }

    const { data, error } = await db.rpc('arena_vault_settle_match', {
        p_match_id: params.matchId,
        p_winners: winners,
        p_shares_bps: sharesBps,
        p_rake_bps: 500,
    });

    if (error) {
        console.warn('[arenaVaultService:settleArenaMatchPayouts]', error.message);
        return { settled: false };
    }
    return { settled: Boolean(data?.settled) };
}
