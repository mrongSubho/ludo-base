import { NextResponse } from 'next/server';
import { requireAppSession, serviceDb } from '@/lib/serverAuth';

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const wallet = await requireAppSession(searchParams.get('walletAddress'), searchParams.get('sessionId'));
        if (!wallet) return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
        const matchId = searchParams.get('matchId');
        if (!matchId || matchId.length > 200) return NextResponse.json({ error: 'Invalid match' }, { status: 400 });
        let query = serviceDb().from('spectator_bets')
            .select('id, player_id, bet_type, bet_value, amount, status, created_at')
            .eq('match_id', matchId).order('created_at', { ascending: false }).limit(50);
        if (searchParams.get('mine') === '1') query = query.eq('player_id', wallet);
        else query = query.eq('status', 'open');
        const { data, error } = await query;
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json(data || []);
    } catch (error) {
        return NextResponse.json({ error: (error as Error).message }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const { walletAddress, sessionId, action, betId, matchId, betType, betValue, amount, actionId: actionId0 } = await request.json();
        const wallet = await requireAppSession(walletAddress, sessionId);
        if (!wallet) return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
        const db = serviceDb();

        if (action === 'cash_out') {
            // Withdraw settled winnings out of escrow toward the chain.
            // `cash_out_bet` credited `players.coins` for bets that were never
            // paid for (SYSTEM_REVIEW.md SEC-05) and is now frozen.
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
            const payout = Number(bet.payout_amount ?? 0);
            if (bet.status === 'cashed_out') {
                return NextResponse.json({ withdrawn: payout, idempotent: true });
            }
            if (payout <= 0) {
                return NextResponse.json({ error: 'Nothing to withdraw' }, { status: 400 });
            }

            const ref = `bet:${betId}`;
            const { data: out, error: wdErr } = await db.rpc('chips_escrow_withdraw' as never, {
                p_wallet: wallet,
                p_amount: String(payout),
                p_ref: ref,
            } as never);
            if (wdErr) return NextResponse.json({ error: wdErr.message }, { status: 409 });

            const { error: flagErr } = await db
                .from('spectator_bets')
                .update({ status: 'cashed_out' })
                .eq('id', betId)
                .eq('status', 'won');
            if (flagErr) return NextResponse.json({ error: flagErr.message }, { status: 500 });

            return NextResponse.json({ withdrawn: payout, balance: (out as { balance?: number } | null)?.balance });
        }

        const numericAmount = Number(amount);
        if (!matchId || !['dice_roll', 'winner'].includes(String(betType)) ||
            !Number.isInteger(numericAmount) || numericAmount <= 0 || numericAmount > 1000000)
            return NextResponse.json({ error: 'Invalid bet' }, { status: 400 });

        // Placement goes through the escrow RPC: it owns the betting-window gate,
        // the market (current_bet_type), the self-bet check, the atomic stake
        // debit, and idempotency on action_id. The client cannot supply
        // window_closedAt or influence any of it (SYSTEM_REVIEW.md SEC-05).
        const actionId = String(actionId0 ?? crypto.randomUUID());
        const { data, error } = await db.rpc('chips_escrow_place_bet' as never, {
            p_player: wallet,
            p_match_id: String(matchId),
            p_bet_type: String(betType),
            p_bet_value: String(betValue ?? ''),
            p_amount: String(numericAmount),
            p_action_id: actionId,
        } as never);
        if (error) {
            const msg = error.message || 'bet rejected';
            const known = [
                'ESCROW_DISABLED', 'BET_WINDOW_NOT_OPEN', 'BET_WINDOW_CLOSED',
                'BET_TYPE_NOT_CURRENT', 'SELF_BET_NOT_ALLOWED', 'INSUFFICIENT_ESCROW',
                'BET_OUT_OF_RANGE',
            ].some((k) => msg.includes(k));
            if (!known) console.error('spectator bet rpc error', error);
            return NextResponse.json({ error: known ? msg : 'bet rejected' }, { status: 409 });
        }
        return NextResponse.json(data);
    } catch (error) {
        return NextResponse.json({ error: (error as Error).message }, { status: 500 });
    }
}
