import { NextResponse } from 'next/server';
import { requireSessionWallet, serviceDb } from '@/lib/serverAuth';

export interface MatchParticipantProfile {
    wallet: string;
    username: string | null;
    avatarUrl: string | null;
    rankTier: string | null;
    isWinner: boolean;
    isMe: boolean;
}

export interface MatchHistoryRecord {
    matchId: string;
    roomCode: string | null;
    gameMode: string;
    matchShape: string;
    won: boolean;
    isPvp: boolean;
    captures: number;
    createdAt: string;
    finishedAt: string | null;
    durationSec: number | null;
    rxpDelta: number;
    lxpDelta: number;
    isPaidPool: boolean;
    poolEntryFee: number | null;
    poolPrizeFund: number | null;
    poolStatus: string | null;
    settleTx: string | null;
    onchainSynced: boolean;
    syncTxHash: string | null;
    spectatorCount: number;
    totalBetVolume: number;
    winnerAddress: string | null;
    participants: MatchParticipantProfile[];
}

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const expectedWallet = searchParams.get('wallet')?.toLowerCase() || undefined;

        if (!expectedWallet || !/^0x[a-f0-9]{40}$/.test(expectedWallet)) {
            return NextResponse.json({ error: 'Valid wallet address required' }, { status: 400 });
        }

        const wallet = await requireSessionWallet(request, {
            scope: 'app',
            expectedWallet,
        });

        if (!wallet) {
            return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
        }

        const me = wallet.toLowerCase();
        const db = serviceDb();

        // 1. Fetch matches & player_free_matches in parallel
        const [matchesRes, freeMatchesRes] = await Promise.all([
            db
                .from('matches')
                .select(
                    'id, created_at, finished_at, game_mode, match_shape, participants, winner_address, room_code, spectator_count, total_bet_volume, metadata'
                )
                .overlaps('participants', [me, wallet])
                .order('created_at', { ascending: false })
                .limit(50),
            db
                .from('player_free_matches')
                .select('match_id, player_id, won, is_pvp, captures, played_at, onchain_synced, sync_tx_hash')
                .eq('player_id', me)
                .order('played_at', { ascending: false })
                .limit(50),
        ]);

        if (matchesRes.error) {
            console.error('[matches/history] matches query failed:', matchesRes.error);
            return NextResponse.json({ error: matchesRes.error.message }, { status: 500 });
        }

        const rawMatches = matchesRes.data ?? [];
        const freeRows = freeMatchesRes.data ?? [];

        const freeByMatchId = new Map(freeRows.map((r) => [r.match_id, r]));
        const seenMatchIds = new Set<string>();

        // Collect all match IDs and participant wallets for batch enrichment
        const allMatchIds = new Set<string>();
        const allWallets = new Set<string>([me]);

        for (const m of rawMatches) {
            allMatchIds.add(m.id);
            for (const p of m.participants ?? []) {
                const lc = String(p).toLowerCase();
                if (/^0x[a-f0-9]{40}$/.test(lc)) allWallets.add(lc);
            }
            if (m.winner_address && /^0x[a-f0-9]{40}$/i.test(m.winner_address)) {
                allWallets.add(m.winner_address.toLowerCase());
            }
        }
        for (const f of freeRows) {
            allMatchIds.add(f.match_id);
        }

        // 2. Batch-fetch chips_pools & player profiles in parallel
        const matchIdList = [...allMatchIds];
        const walletList = [...allWallets];

        const [poolsRes, playersRes] = await Promise.all([
            matchIdList.length > 0
                ? db
                      .from('chips_pools')
                      .select('match_id, pool_id, entry_fee, prize_fund, status, settle_tx, settled_at')
                      .in('match_id', matchIdList)
                : Promise.resolve({ data: [], error: null }),
            walletList.length > 0
                ? db
                      .from('players')
                      .select('wallet_address, username, avatar_url, rank_tier')
                      .in('wallet_address', walletList)
                : Promise.resolve({ data: [], error: null }),
        ]);

        const poolByMatchId = new Map(
            (poolsRes.data ?? [])
                .filter((p) => Boolean(p.match_id))
                .map((p) => [String(p.match_id), p])
        );

        const profileByWallet = new Map(
            (playersRes.data ?? []).map((p) => [p.wallet_address.toLowerCase(), p])
        );

        const records: MatchHistoryRecord[] = [];

        // 3. Build unified records from `matches`
        for (const m of rawMatches) {
            seenMatchIds.add(m.id);
            const freeRow = freeByMatchId.get(m.id);
            const poolRow = poolByMatchId.get(m.id);

            const winnerLc = m.winner_address ? m.winner_address.toLowerCase() : null;
            const won = freeRow ? Boolean(freeRow.won) : winnerLc === me;
            const partWallets = Array.from(
                new Set((m.participants ?? []).map((p) => String(p).toLowerCase()))
            );
            if (!partWallets.includes(me)) partWallets.unshift(me);

            const isPvp = freeRow
                ? Boolean(freeRow.is_pvp)
                : partWallets.filter((a) => /^0x[a-f0-9]{40}$/.test(a)).length >= 2 &&
                  m.game_mode !== 'ai' &&
                  m.game_mode !== 'offline';

            // Extract captures from freeRow or metadata if present
            const metaObj =
                m.metadata && typeof m.metadata === 'object' && !Array.isArray(m.metadata)
                    ? (m.metadata as Record<string, unknown>)
                    : {};
            const metaCaptures =
                metaObj.captures && typeof metaObj.captures === 'object'
                    ? Number((metaObj.captures as Record<string, unknown>)[me] ?? 0)
                    : 0;
            const captures = freeRow ? Number(freeRow.captures || 0) : metaCaptures;

            const startMs = m.created_at ? new Date(m.created_at).getTime() : null;
            const endMs = m.finished_at ? new Date(m.finished_at).getTime() : null;
            const durationSec =
                startMs && endMs && endMs > startMs
                    ? Math.max(1, Math.round((endMs - startMs) / 1000))
                    : null;

            const isPaidPool = Boolean(poolRow && Number(poolRow.entry_fee || 0) > 0);
            const settleTx = poolRow?.settle_tx ?? null;
            const onchainSynced = isPaidPool
                ? Boolean(settleTx || poolRow?.status === 'Settled')
                : Boolean(freeRow?.onchain_synced);

            const shape =
                m.match_shape ||
                (partWallets.length === 2 ? '1v1' : partWallets.length >= 4 ? '4P' : '1v1');

            const participants: MatchParticipantProfile[] = partWallets.map((addr) => {
                const prof = profileByWallet.get(addr);
                return {
                    wallet: addr,
                    username: prof?.username ?? null,
                    avatarUrl: prof?.avatar_url ?? null,
                    rankTier: prof?.rank_tier ?? null,
                    isWinner: winnerLc !== null && addr === winnerLc,
                    isMe: addr === me,
                };
            });

            records.push({
                matchId: m.id,
                roomCode: m.room_code ?? null,
                gameMode: m.game_mode || 'classic',
                matchShape: shape,
                won,
                isPvp,
                captures,
                createdAt: m.finished_at || m.created_at,
                finishedAt: m.finished_at,
                durationSec,
                rxpDelta: won ? 30 : -15,
                lxpDelta: won ? 150 : 50,
                isPaidPool,
                poolEntryFee: poolRow?.entry_fee ?? null,
                poolPrizeFund: poolRow?.prize_fund ?? null,
                poolStatus: poolRow?.status ?? null,
                settleTx,
                onchainSynced,
                syncTxHash: freeRow?.sync_tx_hash ?? settleTx ?? null,
                spectatorCount: Number(m.spectator_count || 0),
                totalBetVolume: Number(m.total_bet_volume || 0),
                winnerAddress: m.winner_address,
                participants,
            });
        }

        // 4. Append any free matches that were recorded only in player_free_matches
        for (const f of freeRows) {
            if (seenMatchIds.has(f.match_id)) continue;
            const meProf = profileByWallet.get(me);
            records.push({
                matchId: f.match_id,
                roomCode: null,
                gameMode: f.is_pvp ? 'classic' : 'ai',
                matchShape: f.is_pvp ? '1v1' : 'SOLO',
                won: Boolean(f.won),
                isPvp: Boolean(f.is_pvp),
                captures: Number(f.captures || 0),
                createdAt: f.played_at,
                finishedAt: f.played_at,
                durationSec: null,
                rxpDelta: f.won ? 30 : -15,
                lxpDelta: f.won ? 150 : 50,
                isPaidPool: false,
                poolEntryFee: null,
                poolPrizeFund: null,
                poolStatus: null,
                settleTx: null,
                onchainSynced: Boolean(f.onchain_synced),
                syncTxHash: f.sync_tx_hash ?? null,
                spectatorCount: 0,
                totalBetVolume: 0,
                winnerAddress: f.won ? me : null,
                participants: [
                    {
                        wallet: me,
                        username: meProf?.username ?? null,
                        avatarUrl: meProf?.avatar_url ?? null,
                        rankTier: meProf?.rank_tier ?? null,
                        isWinner: Boolean(f.won),
                        isMe: true,
                    },
                ],
            });
        }

        // Sort chronologically newest first
        records.sort(
            (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );

        return NextResponse.json({ matches: records.slice(0, 50) });
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unexpected error';
        console.error('[matches/history] unexpected error:', err);
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
