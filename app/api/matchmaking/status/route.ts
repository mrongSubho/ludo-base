import { NextResponse } from 'next/server';
import { requireAppSession, serviceDb } from '@/lib/serverAuth';

/**
 * GET /api/matchmaking/status?ticketId=…&walletAddress=…&sessionId=…
 * GET /api/matchmaking/status?matchId=…&walletAddress=…&sessionId=…
 * Session-gated ticket poll. Returns validation_token for the OWNER only —
 * the token is secret material (no anon column grant), so polling must go
 * through here, never direct from the browser. The matchId form returns the
 * matched roster for deterministic host resolution (caller must be a
 * participant).
 */
export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const ticketId = searchParams.get('ticketId');
        const matchId = searchParams.get('matchId');
        const wallet = await requireAppSession(
            searchParams.get('walletAddress'),
            searchParams.get('sessionId'),
        );
        if (!wallet) return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
        if ((!ticketId || ticketId === 'undefined') && !matchId) {
            return NextResponse.json({ error: 'Missing or invalid ticketId/matchId' }, { status: 400 });
        }

        const db = serviceDb();
        // Roster mode: matched player ids for deterministic host resolution.
        // Allowed only for participants of that match.
        if (matchId && (!ticketId || ticketId === 'undefined')) {
            const { data: roster, error: rosterError } = await db
                .from('matchmaking_queue')
                .select('player_id')
                .eq('match_id', matchId);
            if (rosterError) throw rosterError;
            const players = [...new Set((roster || []).map(r => String(r.player_id || '').toLowerCase()).filter(Boolean))];
            if (!players.includes(wallet)) {
                return NextResponse.json({ error: 'Not a participant' }, { status: 403 });
            }
            return NextResponse.json({ status: 'matched', match_id: matchId, players });
        }
        // 1. Primary check by specific ticket ID (must belong to the session wallet).
        const { data, error } = await db
            .from('matchmaking_queue')
            .select('status, match_id, room_code, validation_token, player_id, created_at')
            .eq('id', ticketId)
            .maybeSingle();
        if (error) throw error;

        let ticket = data && data.player_id?.toLowerCase() === wallet ? data : null;

        // A matched ticket older than 10 minutes is stale — never dispatch it.
        // Missing/unparseable timestamps fail closed (treated as stale).
        const isStaleMatch = (row: { created_at?: string | null }) => {
            const t = row?.created_at ? Date.parse(row.created_at) : NaN;
            return !Number.isFinite(t) || Date.now() - t > 10 * 60 * 1000;
        };

        // 2. Secondary fallback: recent matched tickets for this wallet,
        // preferring the polled ticket's lineage (same match_id) so a poll
        // can't pair with a stale match from an older search. Stale
        // candidates fall through to `searching` rather than dispatching.
        if (!ticket || ticket.status !== 'matched') {
            const { data: candidates, error: fbError } = await db
                .from('matchmaking_queue')
                .select('status, match_id, room_code, validation_token, player_id, created_at')
                .eq('player_id', wallet)
                .eq('status', 'matched')
                .order('created_at', { ascending: false })
                .limit(5);
            if (fbError) throw fbError;
            const fresh = (candidates || []).filter(c => !isStaleMatch(c));
            const lineageId = ticket?.match_id ?? null;
            const picked = (lineageId ? fresh.find(c => c.match_id === lineageId) : undefined) ?? fresh[0] ?? null;
            if (picked) ticket = picked;
        }

        if (!ticket) return NextResponse.json({ status: 'searching' });
        if (ticket.status === 'matched' && isStaleMatch(ticket)) {
            return NextResponse.json({ status: 'searching' });
        }
        // Matched player ids for deterministic host resolution (owner-checked
        // above; player_ids are roster membership, not secrets — the secret
        // stays in validation_token).
        let players: string[] = [];
        if (ticket.status === 'matched' && ticket.match_id) {
            const { data: roster } = await db
                .from('matchmaking_queue')
                .select('player_id')
                .eq('match_id', ticket.match_id);
            players = [...new Set((roster || []).map(r => String(r.player_id || '').toLowerCase()).filter(Boolean))];
        }
        return NextResponse.json({
            status: ticket.status,
            match_id: ticket.match_id,
            room_code: ticket.room_code,
            validation_token: ticket.validation_token ?? null,
            players,
        });
    } catch (err: any) {
        console.error('❌ [Matchmaking] Status Error:', err.message || err);
        return NextResponse.json({ error: err.message || 'Status check failed' }, { status: 500 });
    }
}
