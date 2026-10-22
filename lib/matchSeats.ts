import { seatedColorsFor, type PlayerColor } from '@/lib/engine/core';
import { serviceDb } from '@/lib/serverAuth';

export interface MatchSeat {
    match_id: string;
    color: PlayerColor;
    wallet_address: string;
    seat_index: number;
    assigned_at: string;
}

/**
 * Deterministic seat assignment (§6.6):
 * 1. Reads participant wallets, normalises (toLowerCase()), sorts with explicit byte-order comparator.
 * 2. Indexes into seatedColorsFor(matchShape).
 * 3. Persists to match_seats.
 */
export async function assignAndPersistSeats(
    matchId: string,
    matchShape: string,
    participants: string[]
): Promise<MatchSeat[]> {
    const db = serviceDb();
    const colors = seatedColorsFor(matchShape);

    // Explicit ASCII byte-order comparator (matching Postgres COLLATE "C")
    const sortedWallets = [...new Set(participants.map(p => String(p || '').trim().toLowerCase()))]
        .filter(Boolean)
        .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

    const seatsToInsert: Array<{
        match_id: string;
        color: PlayerColor;
        wallet_address: string;
        seat_index: number;
    }> = [];

    for (let i = 0; i < sortedWallets.length && i < colors.length; i++) {
        seatsToInsert.push({
            match_id: matchId,
            color: colors[i],
            wallet_address: sortedWallets[i],
            seat_index: i,
        });
    }

    if (seatsToInsert.length > 0) {
        const { error } = await db
            .from('match_seats')
            .upsert(seatsToInsert, { onConflict: 'match_id,color' });
        if (error) throw error;
    }

    const { data: persisted, error: readError } = await db
        .from('match_seats')
        .select('*')
        .eq('match_id', matchId)
        .order('seat_index', { ascending: true });

    if (readError) throw readError;
    return (persisted || []) as MatchSeat[];
}

export async function getMatchSeats(matchId: string): Promise<MatchSeat[]> {
    const db = serviceDb();
    const { data, error } = await db
        .from('match_seats')
        .select('*')
        .eq('match_id', matchId)
        .order('seat_index', { ascending: true });
    if (error) throw error;
    return (data || []) as MatchSeat[];
}
