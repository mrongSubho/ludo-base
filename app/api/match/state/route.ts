import { NextResponse } from 'next/server';
import { serviceDb, requireSession } from '@/lib/serverAuth';
import { sanitizeGameStateForWire } from '@/lib/wireSanitize';
import type { GameState } from '@/lib/types';

/**
 * GET /api/match/state?matchId=…
 * Public snapshot read for spectators and reconnecting players. match_states has no anon SELECT
 * policy (server-only under default-deny), and live match state is
 * spectator-visible by design — so it reads through the service role.
 * When authenticated with a match session, the player's own power hand is preserved while
 * opponent hands and hidden board power types are strictly redacted (PW-1).
 */
export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const matchId = searchParams.get('matchId');
        if (!matchId) return NextResponse.json({ error: 'matchId is required' }, { status: 400 });
        const { data, error } = await serviceDb()
            .from('match_states')
            .select('seq, state, color_corner, player_seats')
            .eq('match_id', matchId)
            .maybeSingle();
        if (error) throw error;
        if (!data) return NextResponse.json({ error: 'Match not found', code: 'MATCH_NOT_FOUND' }, { status: 404 });

        // PW-1: Resolve viewer session if provided to allow player to see their own hand,
        // while masking all other players' power types (and masking all for spectators).
        let viewerColor: string | undefined = undefined;
        try {
            const session = await requireSession(request, { scope: 'match', matchId });
            if (session?.wallet && data.player_seats) {
                const seats = data.player_seats as Record<string, { kind?: string; wallet?: string }>;
                const lowWallet = session.wallet.toLowerCase();
                for (const [seatColor, seat] of Object.entries(seats)) {
                    if (seat?.wallet && seat.wallet.toLowerCase() === lowWallet) {
                        viewerColor = seatColor;
                        break;
                    }
                }
            }
        } catch {
            // Unauthenticated spectator: viewerColor remains undefined, all hands masked
        }

        // ENG-07 & PW-1: power-tile types are authority-only; opponent hands are redacted.
        // `state` is jsonb in the schema; the wire sanitizer wants the GameState shape.
        return NextResponse.json({
            seq: data.seq,
            color_corner: data.color_corner,
            state: sanitizeGameStateForWire(data.state as unknown as GameState, viewerColor as any),
        });
    } catch (error) {
        return NextResponse.json({ error: (error as Error).message }, { status: 500 });
    }
}
