import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

const LIMIT = 20;
const SLOW_MODE_S = 10;
const PRUNE_KEEP = 300;

// Service role for room upserts (anon holds no UPDATE policy by design).
// Falls back to anon when unconfigured — upserts then degrade to inserts.
const serviceClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// GET /api/live-chat?country=US&limit=20 — newest-first, returned oldest-first.
export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const country = (searchParams.get('country') || '').toUpperCase().slice(0, 2);
    const limit = Math.min(parseInt(searchParams.get('limit') || String(LIMIT), 10) || LIMIT, 50);

    try {
        let query = supabase
            .from('live_chat')
            .select('id, sender_id, username, avatar_url, content, country, created_at, room_code, room_open')
            .order('created_at', { ascending: false })
            .limit(limit);
        if (country) query = query.eq('country', country);
        let { data, error } = await query;
        if (error && (error.code === '42703' || String(error.message || '').includes('room_code'))) {
            // Pre-migration DB: legacy columns only.
            let legacy = supabase
                .from('live_chat')
                .select('id, sender_id, username, avatar_url, content, country, created_at')
                .order('created_at', { ascending: false })
                .limit(limit);
            if (country) legacy = legacy.eq('country', country);
            const retry = await legacy;
            data = retry.data as typeof data;
            error = retry.error;
        }
        if (error) throw error;
        return NextResponse.json([...(data || [])].reverse());
    } catch (err) {
        console.error('[live-chat] GET failed:', err);
        return NextResponse.json({ error: 'Failed to load chat' }, { status: 500 });
    }
}

// POST /api/live-chat { wallet, content, roomCode?, roomOpen? }
// Fresh shouts: 10s slow-mode. Room announces (roomCode present): upserted
// into ONE row per room (seat fills rewrite it, start/close flips room_open
// instead of deleting) and bypass slow-mode — the client throttles to 10s.
// Guests (guest_ ids) may announce; identity falls back to Guest XXXX.
export async function POST(request: Request) {
    try {
        const body = await request.json();
        const wallet = (body.wallet || '').toLowerCase();
        const content = (body.content || '').slice(0, 140).trim();
        const roomCode = typeof body.roomCode === 'string' && /^[A-Z0-9]{6}$/i.test(body.roomCode.trim())
            ? body.roomCode.trim().toUpperCase()
            : null;
        const roomOpen = body.roomOpen !== false;

        const isWallet = wallet.startsWith('0x');
        const isGuestId = wallet.startsWith('guest_');
        if ((!isWallet && !isGuestId) || !content) {
            return NextResponse.json({ error: !content ? 'Empty message' : 'Wallet required' }, { status: !content ? 400 : 401 });
        }

        // Slow-mode applies to fresh shouts only — room state syncs bypass it.
        if (!roomCode) {
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
        }

        // Identity snapshot (trust the DB, not the client).
        const { data: profile } = await supabase
            .from('players')
            .select('username, avatar_url')
            .ilike('wallet_address', wallet)
            .single();
        const username = (profile?.username && !profile.username.startsWith('0x'))
            ? profile.username
            : isGuestId
                ? `Guest ${wallet.slice(-4).toUpperCase()}`
                : `User ${wallet.slice(0, 6).toUpperCase()}`;

        // Country from the edge (Vercel). 'XX' = unknown (local dev included).
        const country = (request.headers.get('x-vercel-ip-country') || 'XX').toUpperCase().slice(0, 2);

        const FULL_COLS = 'id, sender_id, username, avatar_url, content, country, created_at, room_code, room_open';

        // Room announce: refresh the sender's row for this room (or plant it).
        // Service role: anon clients hold no UPDATE policy by design.
        if (roomCode) {
            const roomRow = { sender_id: wallet, username, avatar_url: profile?.avatar_url || null, content, country, room_code: roomCode, room_open: roomOpen };
            const missingCols = (e: any) => e?.code === '42703' || String(e?.message || '').includes('room_code');
            try {
                const { data: existing } = await serviceClient
                    .from('live_chat')
                    .select('id')
                    .eq('sender_id', wallet)
                    .eq('room_code', roomCode)
                    .order('created_at', { ascending: false })
                    .limit(1)
                    .maybeSingle();
                if (existing?.id) {
                    const { data: updated, error: updErr } = await serviceClient
                        .from('live_chat')
                        .update({ content, room_open: roomOpen, created_at: new Date().toISOString() })
                        .eq('id', existing.id)
                        .select(FULL_COLS)
                        .single();
                    if (updErr) throw updErr;
                    return NextResponse.json(updated);
                }
                const { data: planted, error: plantErr } = await serviceClient
                    .from('live_chat')
                    .insert(roomRow)
                    .select(FULL_COLS)
                    .single();
                if (plantErr) throw plantErr;
                return NextResponse.json(planted);
            } catch (e: any) {
                // Pre-migration table: degraded static card (one per announce).
                if (missingCols(e)) {
                    try {
                        const { data: legacy, error: legErr } = await supabase
                            .from('live_chat')
                            .insert({ sender_id: wallet, username, avatar_url: profile?.avatar_url || null, content, country })
                            .select('id, sender_id, username, avatar_url, content, country, created_at')
                            .single();
                        if (legErr) throw legErr;
                        return NextResponse.json(legacy);
                    } catch {
                        throw e;
                    }
                }
                // Update denied (no service key) or any other failure: return
                // the live row untouched. NEVER insert a duplicate — one bad
                // announce must not flood the feed with stale clones.
                try {
                    const { data: current } = await supabase
                        .from('live_chat')
                        .select('id, sender_id, username, avatar_url, content, country, created_at')
                        .eq('sender_id', wallet)
                        .order('created_at', { ascending: false })
                        .limit(1)
                        .maybeSingle();
                    if (current) return NextResponse.json(current);
                } catch {
                    /* fall through to 500 */
                }
                throw e;
            }
        }

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
