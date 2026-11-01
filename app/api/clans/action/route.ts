/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { requireSession, requireAppSession } from '@/lib/serverAuth';
import {
    requestJoinClan,
    cancelJoinRequest,
    reviewJoinRequest,
    leaveClan,
    kickMember,
    updateMemberRole,
    updateClanSettings,
    ClanServiceError,
} from '@/lib/clan/clanService';

export async function POST(request: Request) {
    try {
        const body = await request.json().catch(() => ({}));
        const authed =
            (await requireSession(request, 'app'))?.wallet ||
            (body.walletAddress && body.sessionId ? await requireAppSession(body.walletAddress, body.sessionId) : null);

        if (!authed) {
            return NextResponse.json({ error: 'Unauthorized: valid app session required' }, { status: 401 });
        }

        const { action, clanId } = body;
        if (!action || !clanId) {
            return NextResponse.json({ error: 'Action and clanId are required' }, { status: 400 });
        }

        switch (action) {
            case 'request_join': {
                const res = await requestJoinClan(clanId, authed);
                return NextResponse.json(res);
            }

            case 'cancel_request': {
                await cancelJoinRequest(clanId, authed);
                return NextResponse.json({ success: true });
            }

            case 'review_request': {
                const { targetWallet, decision } = body;
                if (!targetWallet || !['accept', 'reject'].includes(decision)) {
                    return NextResponse.json({ error: 'targetWallet and decision (accept/reject) required' }, { status: 400 });
                }
                await reviewJoinRequest(clanId, authed, targetWallet, decision);
                return NextResponse.json({ success: true });
            }

            case 'leave': {
                await leaveClan(clanId, authed);
                return NextResponse.json({ success: true });
            }

            case 'kick': {
                const { targetWallet } = body;
                if (!targetWallet) return NextResponse.json({ error: 'targetWallet required' }, { status: 400 });
                await kickMember(clanId, authed, targetWallet);
                return NextResponse.json({ success: true });
            }

            case 'update_role': {
                const { targetWallet, newRole } = body;
                if (!targetWallet || !['commander', 'officer', 'elite', 'member'].includes(newRole)) {
                    return NextResponse.json({ error: 'targetWallet and valid newRole required' }, { status: 400 });
                }
                await updateMemberRole(clanId, authed, targetWallet, newRole);
                return NextResponse.json({ success: true });
            }

            case 'update_settings': {
                const { updates } = body;
                if (!updates) return NextResponse.json({ error: 'updates object required' }, { status: 400 });
                await updateClanSettings(clanId, authed, updates);
                return NextResponse.json({ success: true });
            }

            default:
                return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
        }
    } catch (err: any) {
        if (err instanceof ClanServiceError) {
            return NextResponse.json({ error: err.message, code: err.code }, { status: err.statusCode });
        }
        console.error('[clans:action]', err);
        return NextResponse.json({ error: err.message || 'Action failed' }, { status: 500 });
    }
}
