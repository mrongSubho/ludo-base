import { NextResponse } from 'next/server';
import { requireSessionWallet, requireAppSession, serviceDb, ensurePlayerRow } from '@/lib/serverAuth';
import { isSealedBox } from '@/lib/encryption';
import { MAX_DM_CONTENT_LEN } from '@/lib/constants';
import { sendError, classifyWriteError, SEND_ERROR_STATUS } from '@/lib/sendErrors';

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const expectedWallet = searchParams.get('walletAddress') || undefined;
        const wallet = await requireSessionWallet(request, { scope: 'app', expectedWallet });
        if (!wallet) return NextResponse.json(sendError('auth', 'invalid or missing app session'), { status: 401 });

        const db = serviceDb();
        const [conversations, messages, asUserFriends, asFriendFriends] = await Promise.all([
            db.from('conversations')
                .select('id, user_a, user_b, last_message_at, last_message_content, unread_count_a, unread_count_b')
                .or(`user_a.eq.${wallet},user_b.eq.${wallet}`)
                .order('last_message_at', { ascending: false }),
            db.from('messages')
                .select('id, sender_id, receiver_id, content, is_read, created_at, deleted_by_sender, deleted_by_receiver')
                .or(`sender_id.eq.${wallet},receiver_id.eq.${wallet}`)
                .order('created_at', { ascending: false })
                .limit(30),
            db.from('friendships')
                .select('friend_address')
                .eq('user_address', wallet)
                .eq('status', 'accepted'),
            db.from('friendships')
                .select('user_address')
                .eq('friend_address', wallet)
                .eq('status', 'accepted'),
        ]);
        if (conversations.error) return NextResponse.json(sendError('db_read', conversations.error.message), { status: 500 });
        if (messages.error) return NextResponse.json(sendError('db_read', messages.error.message), { status: 500 });

        const acceptedFriendsSet = new Set([
            ...(asUserFriends.data || []).map((r) => String(r.friend_address).toLowerCase()),
            ...(asFriendFriends.data || []).map((r) => String(r.user_address).toLowerCase()),
        ]);

        const filteredConvos = (conversations.data || []).filter((c) => {
            const isA = String(c.user_a).toLowerCase() === wallet;
            const peer = isA ? String(c.user_b).toLowerCase() : String(c.user_a).toLowerCase();
            return acceptedFriendsSet.has(peer);
        });

        const filteredMessages = (messages.data || []).filter((m) => {
            const isSender = String(m.sender_id).toLowerCase() === wallet;
            const peer = isSender ? String(m.receiver_id).toLowerCase() : String(m.sender_id).toLowerCase();
            return acceptedFriendsSet.has(peer);
        });

        return NextResponse.json({ conversations: filteredConvos, messages: filteredMessages });
    } catch (error) {
        const { code, detail } = classifyWriteError(error);
        console.error('[messages] unhandled:', detail);
        return NextResponse.json(sendError(code, detail), { status: SEND_ERROR_STATUS[code] || 500 });
    }
}

function safeParseJson(value: string): unknown {
    try {
        return JSON.parse(value);
    } catch {
        return null;
    }
}

export async function POST(request: Request) {
    try {
        const { walletAddress, sessionId, action, receiverId, content, messageId } = await request.json();
        const wallet =
            (await requireSessionWallet(request, { scope: 'app', expectedWallet: walletAddress })) ||
            (await requireAppSession(walletAddress, sessionId));
        if (!wallet) return NextResponse.json(sendError('auth', 'invalid or missing app session'), { status: 401 });
        const db = serviceDb();
        if (action === 'send') {
            const receiver = String(receiverId || '').toLowerCase();
            // CRY-03: a DM must be a sealed box. Without this the route stored
            // whatever string it was handed, so a client that failed to encrypt —
            // or chose not to — wrote plaintext into `messages.content`, where it
            // sits in a table other code reads. The check is structural, not a
            // length or shape heuristic: it must parse as a sealed box.
            if (typeof content !== 'string' || !isSealedBox(safeParseJson(content))) {
                return NextResponse.json(
                    { error: 'Message must be a sealed ECDH box, not plaintext' },
                    { status: 400 },
                );
            }
            // DB-15: the route cap is the shared constant, equal to the
            // `messages.content` DB CHECK — one constant, not two numbers.
            if (!/^0x[a-f0-9]{40}$/.test(receiver) || !content || String(content).length > MAX_DM_CONTENT_LEN)
                return NextResponse.json({ error: 'Invalid message' }, { status: 400 });
            // Direct messages are strictly friend-gated
            const [asUserRel, asFriendRel] = await Promise.all([
                db.from('friendships').select('id').eq('status', 'accepted').eq('user_address', wallet).eq('friend_address', receiver).maybeSingle(),
                db.from('friendships').select('id').eq('status', 'accepted').eq('user_address', receiver).eq('friend_address', wallet).maybeSingle(),
            ]);
            if (!asUserRel.data && !asFriendRel.data) {
                return NextResponse.json(
                    sendError('friend_gated', 'Direct messages are friend-gated. Add friend first.'),
                    { status: 403 }
                );
            }

            // messages.sender_id / receiver_id reference players(wallet_address).
            // A fresh social-login smart account has no players row, so the insert
            // fails with a foreign-key violation — which is what took DMs down.
            // Provision both sides first (idempotent), per ensurePlayerRow's contract.
            for (const party of [wallet, receiver]) {
                const provisionErr = await ensurePlayerRow(party);
                if (provisionErr) {
                    console.error('[messages] could not provision party:', party, provisionErr);
                    return NextResponse.json(sendError('db_write', provisionErr), { status: 500 });
                }
            }
            const { data, error } = await db.from('messages').insert({
                sender_id: wallet, receiver_id: receiver, content: String(content),
            }).select().single();
            if (error) {
                const { code, detail } = classifyWriteError(error);
                console.error('[messages] DM insert failed:', detail);
                return NextResponse.json(sendError(code, detail), { status: SEND_ERROR_STATUS[code] || 500 });
            }
            try {
                const { recordSocialOnboarding } = await import('@/lib/onboardingProgressWriter');
                await recordSocialOnboarding(db, wallet, 'friend_dm', 1);
                await recordSocialOnboarding(db, receiver, 'friend_dm', 1);
            } catch (onbErr) {
                console.error('[onboarding] friend_dm writer failed:', onbErr);
            }
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
            if (error) return NextResponse.json(sendError('db_write', error.message), { status: 500 });
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
            if (error) return NextResponse.json(sendError('db_write', error.message), { status: 500 });
        } else return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
        return NextResponse.json({ success: true });
    } catch (error) {
        const { code, detail } = classifyWriteError(error);
        console.error('[messages] unhandled:', detail);
        return NextResponse.json(sendError(code, detail), { status: SEND_ERROR_STATUS[code] || 500 });
    }
}
