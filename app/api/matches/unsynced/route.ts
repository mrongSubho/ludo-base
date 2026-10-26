import { NextResponse } from 'next/server';
import { requireSessionWallet, serviceDb } from '@/lib/serverAuth';
import { missionSystemAddress } from '@/lib/missionSystem';
import { parseChainId, type SupportedChainId } from '@/lib/chains';
import {
    signFreeMatchAttestation,
    type FreeMatchAttestation,
} from '@/lib/freeMatchAttestation';
import { backfillPlayerFreeMatches } from '@/lib/freeMatchSync';
import { keccak256, toBytes, type Address, type Hex } from 'viem';

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const expectedWallet = searchParams.get('walletAddress') || undefined;
        const chainIdRaw = searchParams.get('chainId');

        const wallet = await requireSessionWallet(request, { scope: 'app', expectedWallet });

        if (!wallet) return NextResponse.json({ error: 'Invalid session' }, { status: 401 });

        const chainId = (parseChainId(chainIdRaw) ?? 84532) as SupportedChainId;
        const missionSystem = missionSystemAddress();

        const db = serviceDb();

        // 1. Backfill any offline/casual free matches that are not yet queued in player_free_matches
        await backfillPlayerFreeMatches(db, wallet);

        const { data: unsynced, error } = await db
            .from('player_free_matches')
            .select('match_id, player_id, won, is_pvp, captures, played_at')
            .eq('player_id', wallet.toLowerCase())
            .eq('onchain_synced', false)
            .order('played_at', { ascending: false })
            .limit(50);

        if (error) {
            console.error('[matches/unsynced] query failed:', error);
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        const matches = unsynced ?? [];
        if (matches.length === 0 || !missionSystem) {
            return NextResponse.json({
                matches,
                attestations: [],
                signatures: [],
                configured: Boolean(missionSystem),
            });
        }

        const now = Math.floor(Date.now() / 1000);
        const deadline = now + 3600; // 1 hour validity

        const attestations: FreeMatchAttestation[] = [];
        const signatures: Hex[] = [];

        for (const m of matches) {
            const matchBytes32: Hex = keccak256(toBytes(m.match_id));
            const playedAtSec = Math.floor(new Date(m.played_at).getTime() / 1000);

            const att: FreeMatchAttestation = {
                matchId: matchBytes32,
                player: wallet.toLowerCase() as Address,
                won: m.won ? 1 : 0,
                isPvp: m.is_pvp ? 1 : 0,
                captures: Math.max(0, Number(m.captures || 0)),
                playedAt: playedAtSec,
                deadline,
            };

            const sig = await signFreeMatchAttestation(att, missionSystem, chainId);
            attestations.push(att);
            signatures.push(sig);
        }

        return NextResponse.json({
            matches,
            attestations,
            signatures,
            configured: true,
        });
    } catch (err: unknown) {
        console.error('[matches/unsynced] unexpected error:', err);
        return NextResponse.json(
            { error: err instanceof Error ? err.message : 'failed to fetch unsynced matches' },
            { status: 500 },
        );
    }
}
