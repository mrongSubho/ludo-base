/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { requireSession, requireAppSession } from '@/lib/serverAuth';
import { getActiveWarCall, postWarNotice, cancelWarNotice } from '@/lib/clan/clanWarService';
import { ClanServiceError } from '@/lib/clan/clanService';

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const clanId = searchParams.get('clanId');
        if (!clanId) return NextResponse.json({ error: 'clanId parameter required' }, { status: 400 });

        const data = await getActiveWarCall(clanId);
        return NextResponse.json(data);
    } catch (err: any) {
        console.error('[clans:war:notice:GET]', err);
        return NextResponse.json({ error: err.message || 'Failed to fetch war notice' }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const body = await request.json().catch(() => ({}));
        const authed =
            (await requireSession(request, 'app'))?.wallet ||
            (body.walletAddress && body.sessionId ? await requireAppSession(body.walletAddress, body.sessionId) : null);

        if (!authed) {
            return NextResponse.json({ error: 'Unauthorized: valid app session required' }, { status: 401 });
        }

        const { clanId, action } = body;
        if (!clanId) return NextResponse.json({ error: 'clanId required' }, { status: 400 });

        if (action === 'cancel') {
            await cancelWarNotice(clanId, authed);
            return NextResponse.json({ success: true, message: 'War notice cancelled, refunds available' });
        }

        const {
            bracket,
            memberFee,
            stakersPct,
            treasuryPct,
            leaderPct,
            officersPct,
            treasurySubsidy,
        } = body;

        if (!bracket || !memberFee) {
            return NextResponse.json({ error: 'bracket and memberFee required' }, { status: 400 });
        }

        const warCall = await postWarNotice({
            clanId,
            actorWallet: authed,
            bracket: Number(bracket) as 5 | 10 | 15 | 20,
            memberFee: Number(memberFee),
            stakersPct: Number(stakersPct ?? 50),
            treasuryPct: Number(treasuryPct ?? 25),
            leaderPct: Number(leaderPct ?? 15),
            officersPct: Number(officersPct ?? 10),
            treasurySubsidy: treasurySubsidy ? Number(treasurySubsidy) : 0,
        });

        return NextResponse.json({ success: true, warCall });
    } catch (err: any) {
        if (err instanceof ClanServiceError) {
            return NextResponse.json({ error: err.message, code: err.code }, { status: err.statusCode });
        }
        console.error('[clans:war:notice:POST]', err);
        return NextResponse.json({ error: err.message || 'Failed to post war notice' }, { status: 500 });
    }
}
