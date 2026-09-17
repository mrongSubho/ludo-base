import { NextResponse } from 'next/server';
import { requireAppSession, serviceDb } from '@/lib/serverAuth';

const walletPattern = /^0x[a-f0-9]{40}$/;

/**
 * GET /api/social/moderation?walletAddress=…&sessionId=…&target=0x…
 * Block-status check. user_blocks has no anon SELECT policy (leaking block
 * lists would expose the social graph), so reads go through here, session-
 * gated to the viewer: { blocked: boolean }.
 */
export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const wallet = await requireAppSession(
            searchParams.get('walletAddress'),
            searchParams.get('sessionId'),
        );
        if (!wallet) return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
        const target = String(searchParams.get('target') || '').toLowerCase();
        if (!walletPattern.test(target)) {
            return NextResponse.json({ error: 'Invalid target' }, { status: 400 });
        }
        const { data, error } = await serviceDb().from('user_blocks')
            .select('id')
            .eq('blocker_address', wallet)
            .eq('blocked_address', target)
            .limit(1);
        if (error) throw error;
        return NextResponse.json({ blocked: (data || []).length > 0 });
    } catch (error) {
        return NextResponse.json({ error: (error as Error).message }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const { walletAddress, sessionId, action, target, reason, requestId } = await request.json();
        const wallet = await requireAppSession(walletAddress, sessionId);
        if (!wallet) return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
        const targetWallet = String(target || '').toLowerCase();
        if (action !== 'activity' && (!walletPattern.test(targetWallet) || targetWallet === wallet)) {
            return NextResponse.json({ error: 'Invalid target' }, { status: 400 });
        }
        const db = serviceDb();

        if (action === 'block' || action === 'unblock') {
            if (action === 'block') {
                const { error } = await db.from('user_blocks').upsert(
                    { blocker_address: wallet, blocked_address: targetWallet },
                    { onConflict: 'blocker_address,blocked_address', ignoreDuplicates: true }
                );
                if (error) return NextResponse.json({ error: error.message }, { status: 500 });
            } else {
                const { error } = await db.from('user_blocks').delete()
                    .eq('blocker_address', wallet).eq('blocked_address', targetWallet);
                if (error) return NextResponse.json({ error: error.message }, { status: 500 });
            }
            return NextResponse.json({ success: true });
        }

        if (action === 'report') {
            const cleanReason = String(reason || '').trim().slice(0, 2000);
            if (!cleanReason) return NextResponse.json({ error: 'Reason is required' }, { status: 400 });
            const { error } = await db.from('user_reports').insert({
                reporter_address: wallet, reported_address: targetWallet, reason: cleanReason,
            });
            if (error) return NextResponse.json({ error: error.message }, { status: 500 });
            return NextResponse.json({ success: true });
        }

        if (action === 'congratulate') {
            const id = String(requestId || '').slice(0, 100);
            if (!id) return NextResponse.json({ error: 'Request id is required' }, { status: 400 });
            const { data: existing } = await db.from('activities').select('id')
                .eq('actor_id', wallet).eq('type', 'congratulate')
                .contains('metadata', { request_id: id }).limit(1);
            if (!existing?.length) {
                const { error } = await db.from('activities').insert({
                    actor_id: wallet, type: 'congratulate',
                    metadata: { target_id: targetWallet, request_id: id },
                });
                if (error) return NextResponse.json({ error: error.message }, { status: 500 });
            }
            return NextResponse.json({ success: true });
        }
        if (action === 'activity') {
            const id = String(requestId || '').slice(0, 100);
            if (!id) return NextResponse.json({ error: 'Request id is required' }, { status: 400 });
            const { data: existing } = await db.from('activities').select('id')
                .eq('actor_id', wallet).eq('type', 'join_tournament')
                .contains('metadata', { request_id: id }).limit(1);
            if (!existing?.length) {
                const { error } = await db.from('activities').insert({
                    actor_id: wallet, type: 'join_tournament',
                    metadata: { room_code: String(target || '').slice(0, 80), request_id: id },
                });
                if (error) return NextResponse.json({ error: error.message }, { status: 500 });
            }
            return NextResponse.json({ success: true });
        }
        return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    } catch (error) {
        return NextResponse.json({ error: (error as Error).message }, { status: 500 });
    }
}
