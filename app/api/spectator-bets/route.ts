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
        const { walletAddress, sessionId, action, betId, matchId, betType, betValue, amount, windowClosedAt } = await request.json();
        const wallet = await requireAppSession(walletAddress, sessionId);
        if (!wallet) return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
        const db = serviceDb();

        if (action === 'cash_out') {
            if (!betId) return NextResponse.json({ error: 'Missing betId' }, { status: 400 });

            // Read ownership before invoking the privileged RPC. This prevents a
            // caller from learning or changing another player's bet.
            const { data: bet, error: lookupError } = await db.from('spectator_bets')
                .select('id, player_id, status, payout_amount')
                .eq('id', betId)
                .maybeSingle();
            if (lookupError) return NextResponse.json({ error: lookupError.message }, { status: 500 });
            if (!bet || String(bet.player_id).toLowerCase() !== wallet)
                return NextResponse.json({ error: 'Bet not found' }, { status: 404 });

            // cash_out_bet atomically requires an open/pending bet. A retry after
            // the first successful request must never credit the wallet twice.
            if (bet.status === 'cashed_out') {
                return NextResponse.json({ credited: Number(bet.payout_amount || 0), idempotent: true });
            }

            const { data, error } = await db.rpc('cash_out_bet' as never, {
                p_bet_id: betId,
                p_player_id: wallet,
            } as never);
            if (error) return NextResponse.json({ error: error.message }, { status: 409 });
            const credited = Array.isArray(data)
                ? Number((data[0] as { credited?: number } | undefined)?.credited ?? 0)
                : Number((data as { credited?: number } | null)?.credited ?? 0);
            return NextResponse.json({ credited });
        }

        const numericAmount = Number(amount);
        if (!matchId || !['dice_roll', 'winner'].includes(String(betType)) ||
            !Number.isInteger(numericAmount) || numericAmount <= 0 || numericAmount > 1000000)
            return NextResponse.json({ error: 'Invalid bet' }, { status: 400 });
        const odds = betType === 'dice_roll' ? 5 : 2;
        const { data, error } = await db.from('spectator_bets').insert({
            match_id: String(matchId), player_id: wallet, bet_type: betType,
            bet_value: String(betValue || '').slice(0, 80), amount: numericAmount, odds,
            potential_payout: Math.floor(numericAmount * odds), window_closed_at: windowClosedAt,
        }).select('id').single();
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json(data);
    } catch (error) {
        return NextResponse.json({ error: (error as Error).message }, { status: 500 });
    }
}
