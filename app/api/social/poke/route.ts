import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

/**
 * POKE SYSTEM LOGIC
 * A pokes B -> (sent)
 * B pokes A -> (poked_back) -> Both get 100 coins
 */

export async function POST(request: Request) {
    try {
        const { sender, receiver } = await request.json();

        if (!sender || !receiver) {
            return NextResponse.json({ error: 'Missing addresses' }, { status: 400 });
        }

        const s = sender.toLowerCase();
        const r = receiver.toLowerCase();

        // 0. Enforce Limits (UTC 00:00:00 boundary)
        const now = new Date();
        const startOfToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0)).toISOString();

        // Count UNIQUE friends interacted with today
        // We check pokes where I am sender OR I am receiver (and poked back)
        const { data: sentToday } = await supabase
            .from('pokes')
            .select('receiver_id')
            .eq('sender_id', s)
            .gte('created_at', startOfToday);
            
        const { data: returnedToday } = await supabase
            .from('pokes')
            .select('sender_id')
            .eq('receiver_id', s)
            .gte('poked_back_at', startOfToday);

        const friendsInteracted = new Set([
            ...(sentToday?.map(p => p.receiver_id) || []),
            ...(returnedToday?.map(p => p.sender_id) || [])
        ]);

        if (friendsInteracted.has(r)) {
            return NextResponse.json({ error: 'Already interacted with this friend today' }, { status: 400 });
        }

        if (friendsInteracted.size >= 20) {
            return NextResponse.json({ error: 'Daily limit reached (20 friends/day)' }, { status: 400 });
        }


        // 1. Check if receiver already poked sender (Waiting for a Poke Back)
        const { data: incoming, error: inError } = await supabase
            .from('pokes')
            .select('*')
            .eq('sender_id', r)
            .eq('receiver_id', s)
            .eq('status', 'sent')
            .single();

        if (!inError && incoming) {
            // MATCH! This is a Poke Back.
            await supabase
                .from('pokes')
                .update({ 
                    status: 'poked_back', 
                    poked_back_at: new Date().toISOString() 
                })
                .eq('id', incoming.id);

            // Reward both
            const { data: players } = await supabase
                .from('players')
                .select('wallet_address, coins')
                .in('wallet_address', [s, r]);

            if (players) {
                for (const p of players) {
                    await supabase
                        .from('players')
                        .update({ coins: (p.coins || 0) + 100 })
                        .ilike('wallet_address', p.wallet_address);
                }
            }

            // Increment "Poke Back" mission for the sender (current caller)
            const { data: mission } = await supabase
                .from('player_missions')
                .select('id, progress')
                .eq('player_id', s)
                .eq('mission_id', 'daily_poke_back')
                .single();

            if (mission) {
                await supabase
                    .from('player_missions')
                    .update({ 
                        progress: (mission.progress || 0) + 1,
                        last_updated: new Date().toISOString()
                    })
                    .eq('id', mission.id);
            }

            return NextResponse.json({ success: true, type: 'poke_back', reward: 100 });
        }

        // 2. Check if sender already poked receiver
        const { data: existing } = await supabase
            .from('pokes')
            .select('*')
            .eq('sender_id', s)
            .eq('receiver_id', r)
            .eq('status', 'sent')
            .single();

        if (existing) {
            return NextResponse.json({ error: 'Already poked this friend' }, { status: 400 });
        }

        // 3. Create new Poke
        await supabase
            .from('pokes')
            .insert({
                sender_id: s,
                receiver_id: r,
                status: 'sent'
            });

        return NextResponse.json({ success: true, type: 'poke_sent' });

    } catch (err: any) {
        console.error('Poke Error:', err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const wallet = searchParams.get('wallet')?.toLowerCase();

    if (!wallet) return NextResponse.json([], { status: 400 });

    // Get pokes sent to me that I haven't poked back yet
    const { data, error } = await supabase
        .from('pokes')
        .select(`
            id,
            sender_id,
            status,
            created_at,
            players!pokes_sender_id_fkey (
                username,
                avatar_url
            )
        `)
        .eq('receiver_id', wallet)
        .eq('status', 'sent');

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json(data);
}
