import { NextResponse } from 'next/server';
import { requireSessionWallet, requireAppSession, serviceDb, ensurePlayerRow } from '@/lib/serverAuth';

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const expectedWallet = searchParams.get('walletAddress') || undefined;
        const wallet = await requireSessionWallet(request, { scope: 'app', expectedWallet });
        if (!wallet) return NextResponse.json({ error: 'Invalid session' }, { status: 401 });

        const db = serviceDb();
        const walletLower = wallet.toLowerCase();
        const [asUser, asFriend] = await Promise.all([
            db.from('friendships')
                .select('id, status, user_address, friend_address, created_at')
                .eq('user_address', walletLower)
                .in('status', ['accepted', 'pending']),
            db.from('friendships')
                .select('id, status, user_address, friend_address, created_at')
                .eq('friend_address', walletLower)
                .in('status', ['accepted', 'pending']),
        ]);
        const error = asUser.error || asFriend.error;
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        const rows = [...(asUser.data || []), ...(asFriend.data || [])];
        rows.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

        const addresses = [...new Set(rows.flatMap((row) => [row.user_address, row.friend_address]).map((a) => String(a).toLowerCase()))];
        const { data: players, error: playersError } = addresses.length
            ? await db.from('players')
                .select('wallet_address, username, avatar_url, total_wins, status, last_played_at, current_room_code')
                .in('wallet_address', addresses)
            : { data: [], error: null };
        if (playersError) return NextResponse.json({ error: playersError.message }, { status: 500 });
        const profiles = new Map((players || []).map((player) => [String(player.wallet_address).toLowerCase(), player]));

        const fallbackProfile = (addr: string) => ({
            wallet_address: addr,
            username: null,
            avatar_url: null,
            total_wins: 0,
            status: 'Offline',
            last_played_at: null,
            current_room_code: null,
        });

        const result = rows.map((row) => ({
            ...row,
            requester: profiles.get(String(row.user_address).toLowerCase()) || fallbackProfile(row.user_address),
            receiver: profiles.get(String(row.friend_address).toLowerCase()) || fallbackProfile(row.friend_address),
        }));
        return NextResponse.json({
            accepted: result.filter((row) => row.status === 'accepted'),
            incoming: result.filter((row) => row.status === 'pending' && String(row.friend_address).toLowerCase() === walletLower),
            outgoing: result.filter((row) => row.status === 'pending' && String(row.user_address).toLowerCase() === walletLower),
        });
    } catch (error) {
        return NextResponse.json({ error: (error as Error).message }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const { walletAddress, sessionId, action, friendshipId, target } = await request.json();
        const wallet =
            (await requireSessionWallet(request, { scope: 'app', expectedWallet: walletAddress })) ||
            (await requireAppSession(walletAddress, sessionId));
        if (!wallet) return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
        const db = serviceDb();
        if (action === 'accept') {
            const { error } = await db.from('friendships').update({ status: 'accepted' })
                .eq('id', friendshipId).eq('friend_address', wallet).eq('status', 'pending');
            if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        } else if (action === 'remove') {
            // SEC-13: scope the delete to a row the caller is actually part of.
            // `.eq('id', friendshipId)` alone let any session-holder delete ANY
            // friendship in the table by guessing an id — including between two
            // other people. Both directions are checked explicitly rather than
            // with an interpolated `.or()` (SEC-08).
            if (friendshipId) {
                const { data: row } = await db
                    .from('friendships')
                    .select('id, user_address, friend_address')
                    .eq('id', friendshipId)
                    .maybeSingle();
                const mine = row && (
                    String(row.user_address).toLowerCase() === wallet
                    || String(row.friend_address).toLowerCase() === wallet
                );
                if (!mine) {
                    return NextResponse.json({ error: 'Not your friendship' }, { status: 403 });
                }
            } else {
                const friend = String(target || '').toLowerCase();
                if (!/^0x[a-f0-9]{40}$/.test(friend)) return NextResponse.json({ error: 'Invalid target' }, { status: 400 });
                const [asUser, asFriend] = await Promise.all([
                    db.from('friendships').delete()
                        .eq('user_address', wallet).eq('friend_address', friend),
                    db.from('friendships').delete()
                        .eq('user_address', friend).eq('friend_address', wallet),
                ]);
                const err = asUser.error || asFriend.error;
                if (err) {
                    console.error('[friendships] remove failed', JSON.stringify({ code: err.code, message: err.message, hint: err.hint }));
                    return NextResponse.json({ error: 'Could not remove friendship' }, { status: 500 });
                }
                return NextResponse.json({ success: true });
            }
            const { error } = await db.from('friendships').delete().eq('id', friendshipId);
            if (error) {
                console.error('[friendships] remove failed', JSON.stringify({ code: error.code, message: error.message, hint: error.hint }));
                return NextResponse.json({ error: 'Could not remove friendship' }, { status: 500 });
            }
        } else if (action === 'request') {
            const friend = String(target || '').toLowerCase();
            const senderWallet = wallet.toLowerCase();
            if (!/^0x[a-f0-9]{40}$/.test(friend) || friend === senderWallet) return NextResponse.json({ error: 'Invalid target' }, { status: 400 });
            // Fresh wallets have no players row yet — provision both sender & target before the
            // FK-checked upsert so friending new users doesn't 500.
            const provSenderErr = await ensurePlayerRow(senderWallet);
            if (provSenderErr) return NextResponse.json({ error: provSenderErr }, { status: 400 });
            const provErr = await ensurePlayerRow(friend);
            if (provErr) return NextResponse.json({ error: provErr }, { status: 400 });
            const { error } = await db.from('friendships').upsert({
                user_address: senderWallet, friend_address: friend, status: 'pending',
            }, { onConflict: 'user_address,friend_address' });
            if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        } else return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
        return NextResponse.json({ success: true });
    } catch (error) {
        return NextResponse.json({ error: (error as Error).message }, { status: 500 });
    }
}
