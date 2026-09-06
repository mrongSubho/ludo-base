import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

const LIMIT = 20;
const SLOW_MODE_S = 10;
const PRUNE_KEEP = 300;

// GET /api/live-chat?country=US&limit=20 — newest-first, returned oldest-first.
export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const country = (searchParams.get('country') || '').toUpperCase().slice(0, 2);
    const limit = Math.min(parseInt(searchParams.get('limit') || String(LIMIT), 10) || LIMIT, 50);

    try {
        let query = supabase
            .from('live_chat')
            .select('id, sender_id, username, avatar_url, content, country, created_at')
            .order('created_at', { ascending: false })
            .limit(limit);
        if (country) query = query.eq('country', country);

        const { data, error } = await query;
        if (error) throw error;
        return NextResponse.json([...(data || [])].reverse());
    } catch (err) {
        console.error('[live-chat] GET failed:', err);
        return NextResponse.json({ error: 'Failed to load chat' }, { status: 500 });
    }
}

// POST /api/live-chat { wallet, content } — 10s slow-mode, server-stamped country.
export async function POST(request: Request) {
    try {
        const body = await request.json();
        const wallet = (body.wallet || '').toLowerCase();
        const content = (body.content || '').slice(0, 140).trim();

        if (!wallet || !wallet.startsWith('0x')) {
            return NextResponse.json({ error: 'Wallet required' }, { status: 401 });
        }
        if (!content) {
            return NextResponse.json({ error: 'Empty message' }, { status: 400 });
        }

        // Slow-mode: one message per wallet per 10s.
        const { data: last } = await supabase
            .from('live_chat')
            .select('created_at')
            .eq('sender_id', wallet)
            .order('created_at', { ascending: false })
            .limit(1);
        const lastAt = last?.[0]?.created_at ? new Date(last[0].created_at).getTime() : 0;
        const waitLeft = Math.ceil((SLOW_MODE_S * 1000 - (Date.now() - lastAt)) / 1000);
        if (waitLeft > 0) {
            return NextResponse.json({ error: `Slow mode — wait ${waitLeft}s`, waitLeft }, { status: 429 });
        }

        // Identity snapshot (trust the DB, not the client).
        const { data: profile } = await supabase
            .from('players')
            .select('username, avatar_url')
            .ilike('wallet_address', wallet)
            .single();
        const username = (profile?.username && !profile.username.startsWith('0x'))
            ? profile.username
            : `User ${wallet.slice(0, 6).toUpperCase()}`;

        // Country from the edge (Vercel). 'XX' = unknown (local dev included).
        const country = (request.headers.get('x-vercel-ip-country') || 'XX').toUpperCase().slice(0, 2);

        const { data: inserted, error } = await supabase
            .from('live_chat')
            .insert({
                sender_id: wallet,
                username,
                avatar_url: profile?.avatar_url || null,
                content,
                country,
            })
            .select('id, sender_id, username, avatar_url, content, country, created_at')
            .single();
        if (error) throw error;

        // Opportunistic prune: keep only the newest rows so the table
        // self-cleans without a cron job.
        try {
            const { data: keep } = await supabase
                .from('live_chat')
                .select('created_at')
                .order('created_at', { ascending: false })
                .limit(1)
                .range(PRUNE_KEEP - 1, PRUNE_KEEP - 1);
            const cutoff = keep?.[0]?.created_at;
            if (cutoff) {
                await supabase.from('live_chat').delete().lt('created_at', cutoff);
            }
        } catch {
            /* prune is best-effort */
        }

        return NextResponse.json(inserted);
    } catch (err) {
        console.error('[live-chat] POST failed:', err);
        return NextResponse.json({ error: 'Failed to send' }, { status: 500 });
    }
}
