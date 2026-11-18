/* eslint-disable @typescript-eslint/no-explicit-any */
import { serviceDb } from '@/lib/serverAuth';
import {
    SPECTATOR_BET_MAX_CHIPS,
    SPECTATOR_BET_MIN_CHIPS,
    SPECTATOR_RAKE_BPS,
    calculatePariMutuelSettlement,
    isBetWindowOpen,
    resolveWinningBetValues,
} from '@/lib/spectatorBettingMath';

export * from '@/lib/spectatorBettingMath';

export class SpectatorBetError extends Error {
    constructor(
        message: string,
        public readonly statusCode: number = 409,
        public readonly code?: string,
    ) {
        super(message);
        this.name = 'SpectatorBetError';
    }
}

export const KNOWN_BET_ERROR_CODES = [
    'ESCROW_DISABLED',
    'BET_WINDOW_NOT_OPEN',
    'BET_WINDOW_CLOSED',
    'BET_TYPE_NOT_CURRENT',
    'SELF_BET_NOT_ALLOWED',
    'INSUFFICIENT_VAULT',
    'BET_OUT_OF_RANGE',
    'INVALID_BET_INPUT',
    'MATCH_NOT_FOUND',
] as const;

function isRpcMissingError(err: { code?: string; message?: string } | null | undefined): boolean {
    if (!err) return false;
    const msg = String(err.message || '').toLowerCase();
    return err.code === 'PGRST202' || msg.includes('could not find the function') || msg.includes('schema cache');
}

function mapBetRpcError(err: { message?: string }): SpectatorBetError {
    const msg = String(err.message || 'Bet rejected');
    const matchedCode = KNOWN_BET_ERROR_CODES.find((k) => msg.includes(k));
    if (matchedCode === 'INSUFFICIENT_VAULT') {
        return new SpectatorBetError('INSUFFICIENT_VAULT', 402, matchedCode);
    }
    if (matchedCode === 'MATCH_NOT_FOUND') {
        return new SpectatorBetError('MATCH_NOT_FOUND', 404, matchedCode);
    }
    if (matchedCode) {
        return new SpectatorBetError(matchedCode, 409, matchedCode);
    }
    return new SpectatorBetError('bet rejected', 409);
}

/**
 * Place a spectator bet funded from the player's Arena Match Vault (`arena_vault_accounts`).
 * Enforces window expiry, anti-self-bet, idempotency on (wallet, actionId), and atomic debit.
 */
export async function placeSpectatorBet(params: {
    wallet: string;
    matchId: string;
    betType: string;
    betValue: string;
    amount: number;
    actionId: string;
}): Promise<{ id: string; betId: string; balance: number; idempotent: boolean }> {
    const wallet = params.wallet.trim().toLowerCase();
    const matchId = String(params.matchId || '').trim();
    const betType = String(params.betType || '').trim().toLowerCase();
    const betValue = String(params.betValue || '').trim().toLowerCase().slice(0, 80);
    const amount = Math.floor(Number(params.amount));
    const actionId = String(params.actionId || '').trim();

    if (!wallet || !matchId || !betType || !betValue || !actionId) {
        throw new SpectatorBetError('INVALID_BET_INPUT', 400, 'INVALID_BET_INPUT');
    }
    if (!Number.isInteger(amount) || amount < SPECTATOR_BET_MIN_CHIPS || amount > SPECTATOR_BET_MAX_CHIPS) {
        throw new SpectatorBetError('BET_OUT_OF_RANGE', 400, 'BET_OUT_OF_RANGE');
    }

    const db = serviceDb() as any;

    const { data, error } = await db.rpc('arena_vault_place_spectator_bet', {
        p_player: wallet,
        p_match_id: matchId,
        p_bet_type: betType,
        p_bet_value: betValue,
        p_amount: String(amount),
        p_action_id: actionId,
    });

    if (!error) {
        return {
            id: String(data?.id ?? data?.betId ?? ''),
            betId: String(data?.betId ?? data?.id ?? ''),
            balance: Number(data?.balance ?? 0),
            idempotent: Boolean(data?.idempotent),
        };
    }

    if (!isRpcMissingError(error)) {
        const mapped = mapBetRpcError(error);
        if (!mapped.code) console.error('[spectatorBetting:placeSpectatorBet] rpc error:', error);
        throw mapped;
    }

    // Fallback when migration 202611190001 has not yet been applied to remote PostgREST.
    return placeSpectatorBetFallback(db, { wallet, matchId, betType, betValue, amount, actionId });
}

async function placeSpectatorBetFallback(
    db: any,
    params: {
        wallet: string;
        matchId: string;
        betType: string;
        betValue: string;
        amount: number;
        actionId: string;
    },
): Promise<{ id: string; betId: string; balance: number; idempotent: boolean }> {
    const { wallet, matchId, betType, betValue, amount, actionId } = params;

    const [{ data: lm }, { data: match }] = await Promise.all([
        db
            .from('live_matches')
            .select('match_id, bet_window_status, current_bet_type, window_closed_at')
            .eq('match_id', matchId)
            .maybeSingle(),
        db
            .from('matches')
            .select('id, finished_at, participants, total_bet_volume')
            .eq('id', matchId)
            .maybeSingle(),
    ]);

    if (!lm || !match) {
        throw new SpectatorBetError('MATCH_NOT_FOUND', 404, 'MATCH_NOT_FOUND');
    }
    if (match.finished_at) {
        throw new SpectatorBetError('BET_WINDOW_CLOSED', 409, 'BET_WINDOW_CLOSED');
    }
    if (!isBetWindowOpen({ status: lm.bet_window_status, windowClosedAt: lm.window_closed_at })) {
        if (lm.bet_window_status === 'open') {
            await db
                .from('live_matches')
                .update({ bet_window_status: 'closed', updated_at: new Date().toISOString() })
                .eq('match_id', matchId);
            throw new SpectatorBetError('BET_WINDOW_CLOSED', 409, 'BET_WINDOW_CLOSED');
        }
        throw new SpectatorBetError('BET_WINDOW_NOT_OPEN', 409, 'BET_WINDOW_NOT_OPEN');
    }
    if (lm.current_bet_type && String(lm.current_bet_type).toLowerCase() !== betType) {
        throw new SpectatorBetError('BET_TYPE_NOT_CURRENT', 409, 'BET_TYPE_NOT_CURRENT');
    }
    const parts = Array.isArray(match.participants)
        ? match.participants.map((p: string) => String(p).toLowerCase())
        : [];
    if (parts.includes(wallet)) {
        throw new SpectatorBetError('SELF_BET_NOT_ALLOWED', 409, 'SELF_BET_NOT_ALLOWED');
    }

    const { data: existingBet } = await db
        .from('spectator_bets')
        .select('id')
        .eq('player_id', wallet)
        .eq('action_id', actionId)
        .maybeSingle();
    if (existingBet?.id) {
        const { data: acc } = await db
            .from('arena_vault_accounts')
            .select('balance')
            .eq('wallet_address', wallet)
            .maybeSingle();
        return {
            id: String(existingBet.id),
            betId: String(existingBet.id),
            balance: Number(acc?.balance ?? 0),
            idempotent: true,
        };
    }

    await db.from('players').upsert({ wallet_address: wallet }, { onConflict: 'wallet_address', ignoreDuplicates: true });
    await db
        .from('arena_vault_accounts')
        .upsert({ wallet_address: wallet, balance: 0 }, { onConflict: 'wallet_address', ignoreDuplicates: true });

    const { data: accRow } = await db
        .from('arena_vault_accounts')
        .select('balance')
        .eq('wallet_address', wallet)
        .maybeSingle();
    const currentBal = Number(accRow?.balance ?? 0);
    if (currentBal < amount) {
        throw new SpectatorBetError('INSUFFICIENT_VAULT', 402, 'INSUFFICIENT_VAULT');
    }

    const newBal = currentBal - amount;
    const { data: debited } = await db
        .from('arena_vault_accounts')
        .update({ balance: newBal, updated_at: new Date().toISOString() })
        .eq('wallet_address', wallet)
        .gte('balance', amount)
        .select('balance')
        .maybeSingle();

    if (!debited) {
        throw new SpectatorBetError('INSUFFICIENT_VAULT', 402, 'INSUFFICIENT_VAULT');
    }

    const ref = `sbet:${matchId}:${actionId}`;
    await db
        .from('arena_vault_ledger')
        .upsert(
            { wallet_address: wallet, delta: -amount, reason: 'spectator_bet_stake', ref },
            { onConflict: 'wallet_address,reason,ref', ignoreDuplicates: true },
        );

    const { data: inserted, error: insErr } = await db
        .from('spectator_bets')
        .insert({
            player_id: wallet,
            match_id: matchId,
            bet_type: betType,
            bet_value: betValue,
            amount,
            odds: 1,
            potential_payout: amount,
            status: 'open',
            action_id: actionId,
            window_closed_at: lm.window_closed_at,
            stake_settled: true,
            escrow_ref: ref,
            bet_metadata: { source: 'arena_vault', model: 'parimutuel' },
        })
        .select('id')
        .single();

    if (insErr || !inserted) {
        // Best-effort refund on insert error
        await db
            .from('arena_vault_accounts')
            .update({ balance: currentBal, updated_at: new Date().toISOString() })
            .eq('wallet_address', wallet);
        throw new SpectatorBetError(insErr?.message || 'Failed to place bet', 500);
    }

    await db
        .from('matches')
        .update({ total_bet_volume: Number(match.total_bet_volume ?? 0) + amount })
        .eq('id', matchId);

    return {
        id: String(inserted.id),
        betId: String(inserted.id),
        balance: Number(debited.balance ?? newBal),
        idempotent: false,
    };
}

/**
 * Settle all open `'winner'` spectator bets for a completed match into `arena_vault_claims`.
 */
export async function settleSpectatorMatchBets(params: {
    matchId: string;
    matchShape?: string | null;
    winnerRaw?: string | null;
    playerSeats?: Record<string, { wallet?: string }> | null;
    winnerWallets?: string[];
    rakeBps?: number;
}): Promise<{ settled: boolean; mode?: string; totalPot?: number; rake?: number; reason?: string }> {
    const winningValues = resolveWinningBetValues({
        winnerRaw: params.winnerRaw,
        matchShape: params.matchShape,
        playerSeats: params.playerSeats,
        winnerWallets: params.winnerWallets,
    });

    if (winningValues.length === 0) {
        return { settled: false, reason: 'no_winners' };
    }

    const rakeBps = params.rakeBps ?? SPECTATOR_RAKE_BPS;
    const db = serviceDb() as any;

    const { data, error } = await db.rpc('arena_vault_settle_spectator_bets', {
        p_match_id: params.matchId,
        p_winning_values: winningValues,
        p_rake_bps: rakeBps,
    });

    if (!error) {
        return {
            settled: Boolean(data?.settled),
            mode: data?.mode ? String(data.mode) : undefined,
            totalPot: data?.totalPot !== undefined ? Number(data.totalPot) : undefined,
            rake: data?.rake !== undefined ? Number(data.rake) : undefined,
            reason: data?.reason ? String(data.reason) : undefined,
        };
    }

    if (!isRpcMissingError(error)) {
        console.warn('[spectatorBetting:settleSpectatorMatchBets] rpc warning:', error.message);
        return { settled: false, reason: error.message };
    }

    return settleSpectatorMatchBetsFallback(db, params.matchId, winningValues, rakeBps);
}

async function settleSpectatorMatchBetsFallback(
    db: any,
    matchId: string,
    winningValues: string[],
    rakeBps: number,
): Promise<{ settled: boolean; mode?: string; totalPot?: number; rake?: number; reason?: string }> {
    const nowIso = new Date().toISOString();

    await db
        .from('live_matches')
        .update({ bet_window_status: 'settled', updated_at: nowIso })
        .eq('match_id', matchId);

    const { data: openBets, error: fetchErr } = await db
        .from('spectator_bets')
        .select('id, player_id, bet_value, amount, bet_metadata')
        .eq('match_id', matchId)
        .eq('status', 'open')
        .eq('bet_type', 'winner')
        .order('created_at', { ascending: true });

    if (fetchErr || !Array.isArray(openBets) || openBets.length === 0) {
        return { settled: false, reason: 'no_open_bets', totalPot: 0 };
    }

    const plan = calculatePariMutuelSettlement(
        openBets.map((b: any) => ({
            id: String(b.id),
            playerId: String(b.player_id).toLowerCase(),
            betValue: String(b.bet_value),
            amount: Number(b.amount),
        })),
        winningValues,
        rakeBps,
    );

    if (plan.mode === 'empty') {
        return { settled: false, reason: 'no_open_bets', totalPot: 0 };
    }

    const metaById = new Map<string, Record<string, unknown>>();
    for (const b of openBets) {
        metaById.set(String(b.id), (b.bet_metadata as Record<string, unknown>) || {});
    }

    for (const item of plan.payouts) {
        const baseMeta = metaById.get(item.id) || {};
        if (item.status === 'won' && item.claimType && item.payout > 0) {
            const { data: claimRow } = await db
                .from('arena_vault_claims')
                .insert({
                    wallet_address: item.playerId,
                    claim_type: item.claimType,
                    amount: item.payout,
                    match_id: matchId,
                    status: 'claimable',
                })
                .select('id')
                .single();

            const claimId = claimRow?.id ? String(claimRow.id) : item.id;
            const reason = item.claimType === 'match_refund' ? 'spectator_bet_refund' : 'spectator_bet_payout';
            await db
                .from('arena_vault_ledger')
                .upsert(
                    { wallet_address: item.playerId, delta: item.payout, reason, ref: `sbet_claim:${claimId}` },
                    { onConflict: 'wallet_address,reason,ref', ignoreDuplicates: true },
                );

            await db
                .from('spectator_bets')
                .update({
                    status: 'won',
                    payout_amount: item.payout,
                    odds: Math.round((item.payout / Math.max(1, item.amount)) * 10_000) / 10_000,
                    resolved_at: nowIso,
                    bet_metadata: {
                        ...baseMeta,
                        outcome: item.outcome,
                        claim_id: claimId,
                        rake: plan.rake,
                    },
                })
                .eq('id', item.id)
                .eq('status', 'open');
        } else {
            await db
                .from('spectator_bets')
                .update({
                    status: 'lost',
                    payout_amount: 0,
                    resolved_at: nowIso,
                    bet_metadata: {
                        ...baseMeta,
                        outcome: item.outcome,
                    },
                })
                .eq('id', item.id)
                .eq('status', 'open');
        }
    }

    return {
        settled: true,
        mode: plan.mode,
        totalPot: plan.totalPot,
        rake: plan.rake,
    };
}
