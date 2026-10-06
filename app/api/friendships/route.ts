import { NextResponse } from 'next/server';
import { requireAppSession, serviceDb, ensurePlayerRow } from '@/lib/serverAuth';

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const wallet = await requireAppSession(
            searchParams.get('walletAddress'),
            searchParams.get('sessionId'),
        );
        if (!wallet) return NextResponse.json({ error: 'Invalid session' }, { status: 401 });

        const db = serviceDb();
        const { data: rows, error } = await db.from('friendships')
            .select('id, status, user_address, friend_address, created_at')
            .or(`user_address.eq.${wallet},friend_address.eq.${wallet}`)
            .in('status', ['accepted', 'pending'])
            .order('created_at', { ascending: false });
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });

        const addresses = [...new Set((rows || []).flatMap((row) => [row.user_address, row.friend_address]))];
        const { data: players, error: playersError } = addresses.length
            ? await db.from('players')
                .select('wallet_address, username, avatar_url, total_wins, status, last_played_at, current_room_code')
                .in('wallet_address', addresses)
            : { data: [], error: null };
        if (playersError) return NextResponse.json({ error: playersError.message }, { status: 500 });
        const profiles = new Map((players || []).map((player) => [String(player.wallet_address).toLowerCase(), player]));
        const result = (rows || []).map((row) => ({
            ...row,
            requester: profiles.get(String(row.user_address).toLowerCase()) || null,
            receiver: profiles.get(String(row.friend_address).toLowerCase()) || null,
        }));
        return NextResponse.json({
            accepted: result.filter((row) => row.status === 'accepted'),
            incoming: result.filter((row) => row.status === 'pending' && String(row.friend_address).toLowerCase() === wallet),
            outgoing: result.filter((row) => row.status === 'pending' && String(row.user_address).toLowerCase() === wallet),
        });
    } catch (error) {
        return NextResponse.json({ error: (error as Error).message }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const { walletAddress, sessionId, action, friendshipId, target } = await request.json();
        const wallet = await requireAppSession(walletAddress, sessionId);
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
            if (!/^0x[a-f0-9]{40}$/.test(friend) || friend === wallet) return NextResponse.json({ error: 'Invalid target' }, { status: 400 });
            // Fresh wallets have no players row yet — provision before the
            // FK-checked upsert so friending new users doesn't 500.
            const provErr = await ensurePlayerRow(friend);
            if (provErr) return NextResponse.json({ error: provErr }, { status: 400 });
            const { error } = await db.from('friendships').upsert({
                user_address: wallet, friend_address: friend, status: 'pending',
            }, { onConflict: 'user_address,friend_address' });
            if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        } else return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
        return NextResponse.json({ success: true });
    } catch (error) {
        return NextResponse.json({ error: (error as Error).message }, { status: 500 });
    }
}
