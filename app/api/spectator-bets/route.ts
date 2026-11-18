/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { requireSessionWallet, requireAppSession, serviceDb } from '@/lib/serverAuth';
import { reportProgress } from '@/lib/missionOracle';
import {
    SPECTATOR_BET_MAX_CHIPS,
    SPECTATOR_BET_MIN_CHIPS,
    SpectatorBetError,
    computeSpectatorPoolSummary,
    placeSpectatorBet,
} from '@/lib/spectatorBetting';

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const expectedWallet = searchParams.get('walletAddress') || undefined;
        const wallet = await requireSessionWallet(request, { scope: 'app', expectedWallet });
        if (!wallet) return NextResponse.json({ error: 'Invalid session' }, { status: 401 });

        const matchId = searchParams.get('matchId');
        if (!matchId || matchId.length > 200) {
            return NextResponse.json({ error: 'Invalid match' }, { status: 400 });
        }

        const db = serviceDb() as any;
        const wantsSummary = searchParams.get('summary') === '1';

        if (!wantsSummary) {
            let query = db
                .from('spectator_bets')
                .select('id, player_id, bet_type, bet_value, amount, odds, potential_payout, payout_amount, status, bet_metadata, created_at, resolved_at')
                .eq('match_id', matchId)
                .order('created_at', { ascending: false })
                .limit(50);

            if (searchParams.get('mine') === '1') query = query.eq('player_id', wallet);
            else query = query.eq('status', 'open');

            const { data, error } = await query;
            if (error) return NextResponse.json({ error: error.message }, { status: 500 });
            return NextResponse.json(data || []);
        }

        const [lmRes, matchRes, betsRes] = await Promise.all([
            db
                .from('live_matches')
                .select('bet_window_status, current_bet_type, window_opened_at, window_closed_at')
                .eq('match_id', matchId)
                .maybeSingle(),
            db
                .from('matches')
                .select('match_shape, metadata, finished_at')
                .eq('id', matchId)
                .maybeSingle(),
            db
                .from('spectator_bets')
                .select('id, player_id, bet_type, bet_value, amount, odds, potential_payout, payout_amount, status, bet_metadata, created_at, resolved_at')
                .eq('match_id', matchId)
                .order('created_at', { ascending: false })
                .limit(200),
        ]);

        if (betsRes.error) {
            return NextResponse.json({ error: betsRes.error.message }, { status: 500 });
        }

        const lm = lmRes.data;
        const matchRow = matchRes.data;
        const nowMs = Date.now();
        let effectiveStatus: string = lm?.bet_window_status || 'closed';

        if (effectiveStatus === 'open' && lm?.window_closed_at && nowMs >= Date.parse(lm.window_closed_at)) {
            effectiveStatus = 'closed';
            await db
                .from('live_matches')
                .update({ bet_window_status: 'closed', updated_at: new Date(nowMs).toISOString() })
                .eq('match_id', matchId)
                .eq('bet_window_status', 'open');
        }
        if (matchRow?.finished_at && effectiveStatus === 'open') {
            effectiveStatus = 'closed';
        }

        const allRows = (betsRes.data || []) as Array<Record<string, any>>;
        const meta = (matchRow?.metadata || {}) as Record<string, any>;
        const matchShape = String(matchRow?.match_shape || meta.matchType || meta.match_type || '4P');
        const poolSummary = computeSpectatorPoolSummary(allRows, matchShape);
        const myBets = allRows.filter((r) => String(r.player_id || '').toLowerCase() === wallet);

        const wonRows = myBets.filter((r) => r.status === 'won');
        if (wonRows.length > 0) {
            void reportProgress(wallet, 'daily_predict_1', 1);
        }

        return NextResponse.json({
            bets: allRows.filter((r) => r.status === 'open').slice(0, 50),
            myBets,
            poolSummary,
            window: {
                status: effectiveStatus,
                betType: lm?.current_bet_type ?? 'winner',
                openedAt: lm?.window_opened_at ?? null,
                closedAt: lm?.window_closed_at ?? null,
                serverNow: new Date(nowMs).toISOString(),
            },
        });
    } catch (error) {
        return NextResponse.json({ error: (error as Error).message }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const {
            walletAddress,
            sessionId,
            action,
            betId,
            matchId,
            betType,
            betValue,
            amount,
            actionId: actionId0,
        } = body ?? {};

        const wallet =
            (await requireSessionWallet(request, { scope: 'app', expectedWallet: walletAddress })) ||
            (await requireAppSession(walletAddress, sessionId));
        if (!wallet) return NextResponse.json({ error: 'Invalid session' }, { status: 401 });

        const db = serviceDb() as any;

        if (action === 'cash_out') {
            if (!betId) return NextResponse.json({ error: 'Missing betId' }, { status: 400 });

            const { data: bet, error: lookupError } = await db
                .from('spectator_bets')
                .select('id, player_id, status, payout_amount')
                .eq('id', betId)
                .maybeSingle();

            if (lookupError) return NextResponse.json({ error: lookupError.message }, { status: 500 });
            if (!bet || String(bet.player_id).toLowerCase() !== wallet) {
                return NextResponse.json({ error: 'Bet not found' }, { status: 404 });
            }
            if (bet.status === 'cashed_out' || bet.status === 'won') {
                return NextResponse.json({ withdrawn: Number(bet.payout_amount ?? 0), idempotent: true });
            }
            return NextResponse.json(
                { error: 'Early cash-out is disabled for pari-mutuel pools; winnings settle to Claim Hub on match end.' },
                { status: 409 },
            );
        }

        const numericAmount = Number(amount);
        const normalizedType = String(betType || 'winner').trim().toLowerCase();
        const normalizedValue = String(betValue ?? '').trim().toLowerCase();

        if (
            !matchId ||
            !['winner', 'dice_roll'].includes(normalizedType) ||
            !normalizedValue ||
            !Number.isInteger(numericAmount) ||
            numericAmount < SPECTATOR_BET_MIN_CHIPS ||
            numericAmount > SPECTATOR_BET_MAX_CHIPS
        ) {
            return NextResponse.json({ error: 'Invalid bet' }, { status: 400 });
        }

        const actionId = String(actionId0 ?? crypto.randomUUID());
        const placed = await placeSpectatorBet({
            wallet,
            matchId: String(matchId),
            betType: normalizedType,
            betValue: normalizedValue,
            amount: numericAmount,
            actionId,
        });

        // On-chain mirror: placing a bet engages with a live match (spectate).
        void reportProgress(wallet, 'weekly_spectate_5', 1);

        return NextResponse.json(placed);
    } catch (error) {
        if (error instanceof SpectatorBetError) {
            return NextResponse.json(
                { error: error.message, code: error.code },
                { status: error.statusCode },
            );
        }
        return NextResponse.json({ error: (error as Error).message }, { status: 500 });
    }
}
