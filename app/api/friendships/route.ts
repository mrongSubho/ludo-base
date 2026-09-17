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
            let query = db.from('friendships').delete();
            if (friendshipId) query = query.eq('id', friendshipId);
            else {
                const friend = String(target || '').toLowerCase();
                if (!/^0x[a-f0-9]{40}$/.test(friend)) return NextResponse.json({ error: 'Invalid target' }, { status: 400 });
                query = query.or(`and(user_address.eq.${wallet},friend_address.eq.${friend}),and(user_address.eq.${friend},friend_address.eq.${wallet})`);
            }
            const { error } = await query;
            if (error) return NextResponse.json({ error: error.message }, { status: 500 });
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
