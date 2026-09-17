import { NextResponse } from 'next/server';
import { requireAppSession, serviceDb } from '@/lib/serverAuth';

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const wallet = await requireAppSession(
            searchParams.get('walletAddress'),
            searchParams.get('sessionId'),
        );
        if (!wallet) return NextResponse.json({ error: 'Invalid session' }, { status: 401 });

        const db = serviceDb();
        const [conversations, messages] = await Promise.all([
            db.from('conversations')
                .select('id, user_a, user_b, last_message_at, last_message_content, unread_count_a, unread_count_b')
                .or(`user_a.eq.${wallet},user_b.eq.${wallet}`)
                .order('last_message_at', { ascending: false }),
            db.from('messages')
                .select('id, sender_id, receiver_id, content, is_read, created_at, deleted_by_sender, deleted_by_receiver')
                .or(`sender_id.eq.${wallet},receiver_id.eq.${wallet}`)
                .order('created_at', { ascending: false })
                .limit(30),
        ]);
        if (conversations.error) return NextResponse.json({ error: conversations.error.message }, { status: 500 });
        if (messages.error) return NextResponse.json({ error: messages.error.message }, { status: 500 });
        return NextResponse.json({ conversations: conversations.data || [], messages: messages.data || [] });
    } catch (error) {
        return NextResponse.json({ error: (error as Error).message }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const { walletAddress, sessionId, action, receiverId, content, messageId } = await request.json();
        const wallet = await requireAppSession(walletAddress, sessionId);
        if (!wallet) return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
        const db = serviceDb();
        if (action === 'send') {
            const receiver = String(receiverId || '').toLowerCase();
            if (!/^0x[a-f0-9]{40}$/.test(receiver) || !content || String(content).length > 10000)
                return NextResponse.json({ error: 'Invalid message' }, { status: 400 });
            const { data, error } = await db.from('messages').insert({
                sender_id: wallet, receiver_id: receiver, content: String(content),
            }).select().single();
            if (error) return NextResponse.json({ error: error.message }, { status: 500 });
            return NextResponse.json(data);
        }
        if (action === 'read') {
            const sender = String(receiverId || '').toLowerCase();
            if (!/^0x[a-f0-9]{40}$/.test(sender) || sender === wallet)
                return NextResponse.json({ error: 'Invalid conversation' }, { status: 400 });
            // The RPC also recomputes both sidebar counters, so this remains
            // one atomic server-side operation instead of two client writes.
            const { error } = await db.rpc('mark_conversation_read' as never, {
                me: wallet,
                friend: sender,
            } as never);
            if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        } else if (action === 'delete') {
            const { data: message } = await db.from('messages').select('sender_id, receiver_id')
                .eq('id', messageId).maybeSingle();
            if (!message || ![message.sender_id, message.receiver_id].map(String).map(v => v.toLowerCase()).includes(wallet))
                return NextResponse.json({ error: 'Message not found' }, { status: 404 });
            // Delete-for-me semantics (intentional): only the caller's side
            // flag is set — the counterpart still sees the message. The old
            // client set both flags, nuking the other side's copy.
            const field = String(message.sender_id).toLowerCase() === wallet ? 'deleted_by_sender' : 'deleted_by_receiver';
            const { error } = await db.from('messages').update({ [field]: true }).eq('id', messageId);
            if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        } else return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
        return NextResponse.json({ success: true });
    } catch (error) {
        return NextResponse.json({ error: (error as Error).message }, { status: 500 });
    }
}
