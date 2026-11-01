/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { requireSession, requireAppSession, serviceDb } from '@/lib/serverAuth';
import type { ClanChatMessage } from '@/lib/clan/types';

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const clanId = searchParams.get('clanId');
        if (!clanId) return NextResponse.json({ error: 'clanId parameter required' }, { status: 400 });

        const authed = (await requireSession(request, 'app'))?.wallet ||
            searchParams.get('wallet') || null;

        if (!authed) {
            return NextResponse.json({ error: 'Unauthorized: valid app session required' }, { status: 401 });
        }

        const db = serviceDb();

        // Verify membership
        const { data: member } = await (db as any)
            .from('clan_members')
            .select('id')
            .eq('clan_id', clanId)
            .eq('wallet_address', authed.toLowerCase())
            .maybeSingle();

        if (!member) {
            return NextResponse.json({ error: 'Access restricted to clan members' }, { status: 403 });
        }

        const limit = Math.min(Number(searchParams.get('limit') || 50), 100);

        const { data: messages, error } = await (db as any)
            .from('clan_chat')
            .select('*')
            .eq('clan_id', clanId)
            .order('created_at', { ascending: false })
            .limit(limit);

        if (error) {
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        return NextResponse.json({ messages: (messages || []).reverse() as ClanChatMessage[] });
    } catch (err: any) {
        console.error('[clans:chat:GET]', err);
        return NextResponse.json({ error: err.message || 'Failed to load chat' }, { status: 500 });
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

        const { clanId, content } = body;
        if (!clanId || !content || typeof content !== 'string') {
            return NextResponse.json({ error: 'clanId and content string required' }, { status: 400 });
        }

        const text = content.trim();
        if (text.length === 0 || text.length > 280) {
            return NextResponse.json({ error: 'Message must be between 1 and 280 characters' }, { status: 400 });
        }

        const db = serviceDb();
        const wallet = authed.toLowerCase();

        // Verify membership
        const { data: member } = await (db as any)
            .from('clan_members')
            .select('role')
            .eq('clan_id', clanId)
            .eq('wallet_address', wallet)
            .maybeSingle();

        if (!member) {
            return NextResponse.json({ error: 'You must be a member of this clan to post messages' }, { status: 403 });
        }

        // Fetch display name from players table
        const { data: player } = await (db as any)
            .from('players')
            .select('username')
            .eq('wallet_address', wallet)
            .maybeSingle();

        const senderName = player?.username || `${wallet.slice(0, 6)}...${wallet.slice(-4)}`;

        const { data: inserted, error } = await (db as any)
            .from('clan_chat')
            .insert({
                clan_id: clanId,
                wallet_address: wallet,
                sender_name: senderName,
                content: text,
            })
            .select('*')
            .single();

        if (error) {
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        return NextResponse.json({ success: true, message: inserted });
    } catch (err: any) {
        console.error('[clans:chat:POST]', err);
        return NextResponse.json({ error: err.message || 'Failed to send message' }, { status: 500 });
    }
}
