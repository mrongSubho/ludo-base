/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { requireSession, requireAppSession } from '@/lib/serverAuth';
import { getWarFixtures, scheduleFixtureTime } from '@/lib/clan/clanWarService';
import { ClanServiceError } from '@/lib/clan/clanService';

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const warId = searchParams.get('warId');
        if (!warId) return NextResponse.json({ error: 'warId parameter required' }, { status: 400 });

        const fixtures = await getWarFixtures(warId);
        return NextResponse.json({ fixtures });
    } catch (err: any) {
        console.error('[clans:war:fixture:GET]', err);
        return NextResponse.json({ error: err.message || 'Failed to fetch war fixtures' }, { status: 500 });
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

        const { fixtureId, scheduledAt } = body;
        if (!fixtureId || !scheduledAt) {
            return NextResponse.json({ error: 'fixtureId and scheduledAt required' }, { status: 400 });
        }

        await scheduleFixtureTime({
            fixtureId,
            actorWallet: authed,
            scheduledAt,
        });

        return NextResponse.json({ success: true, message: 'Fixture time agreed' });
    } catch (err: any) {
        if (err instanceof ClanServiceError) {
            return NextResponse.json({ error: err.message, code: err.code }, { status: err.statusCode });
        }
        console.error('[clans:war:fixture:POST]', err);
        return NextResponse.json({ error: err.message || 'Fixture update failed' }, { status: 500 });
    }
}
