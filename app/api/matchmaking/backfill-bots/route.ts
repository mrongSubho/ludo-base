import { NextResponse } from 'next/server';
import { requireAppSession, requireSessionWallet, serviceDb } from '@/lib/serverAuth';
import { checkRateLimitShared } from '@/lib/rateLimitShared';
import { rateKey, rateLimitHeaders } from '@/lib/rateLimit';
import { GAME_MODE_CODE } from '@/lib/constants';
import { seatedColorsFor } from '@/lib/engine/core';
import type { BotDifficulty } from '@/lib/types';

const ALLOWED_MODES = new Set(['classic', 'power', 'quick']);
const ALLOWED_TYPES = new Set(['1v1', '2v2', '4P']);
const ALLOWED_DIFFICULTIES = new Set<BotDifficulty>(['rookie', 'pro', 'master']);

export async function POST(request: Request) {
    try {
        const body = (await request.json().catch(() => ({}))) as {
            playerId?: string;
            sessionId?: string;
            gameMode?: string;
            matchType?: string;
            wager?: number;
            ranked?: boolean;
            clanWar?: boolean;
            roomCode?: string;
            partyWallets?: string[];
            botDifficulty?: BotDifficulty;
        };

        const rawPlayerId = typeof body.playerId === 'string' ? body.playerId.trim().toLowerCase() : undefined;
        const sessionWallet = await requireSessionWallet(request, {
            scope: 'app',
            ...(rawPlayerId ? { expectedWallet: rawPlayerId } : {}),
        });
        const fallbackWallet =
            !sessionWallet && rawPlayerId && body.sessionId
                ? await requireAppSession(rawPlayerId, body.sessionId)
                : null;
        const wallet = (sessionWallet || fallbackWallet || '').toLowerCase();

        if (!wallet) {
            return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
        }

        const rate = await checkRateLimitShared(rateKey('mm:backfill', wallet), 10, 60_000);
        if (!rate.ok) {
            return NextResponse.json(
                { error: 'Too many bot backfill requests', retryAfter: rate.retryAfterSec },
                { status: 429, headers: rateLimitHeaders(rate) },
            );
        }

        const wager = Number(body.wager ?? 0);
        if (!Number.isFinite(wager) || wager > 0 || body.ranked === true || body.clanWar === true) {
            return NextResponse.json(
                {
                    error: 'Server bot backfill is only allowed on free unranked tables (wager must be 0).',
                    code: 'BOT_BACKFILL_FREE_ONLY',
                },
                { status: 403 },
            );
        }

        const gameMode = body.gameMode === 'power' || body.gameMode === 'quick' ? body.gameMode : body.gameMode || 'classic';
        const matchType = (body.matchType || '1v1') as '1v1' | '2v2' | '4P';
        const botDifficulty: BotDifficulty =
            body.botDifficulty && ALLOWED_DIFFICULTIES.has(body.botDifficulty) ? body.botDifficulty : 'pro';

        if (!ALLOWED_MODES.has(gameMode) || !ALLOWED_TYPES.has(matchType)) {
            return NextResponse.json({ error: 'Invalid gameMode or matchType' }, { status: 400 });
        }

        const seatColors = seatedColorsFor(matchType);
        const totalSeats = seatColors.length;

        const extraParty = Array.isArray(body.partyWallets)
            ? body.partyWallets
                  .map((w) => String(w || '').trim().toLowerCase())
                  .filter((w) => /^0x[0-9a-f]{40}$/.test(w) && w !== wallet)
            : [];
        const humanWallets = Array.from(new Set([wallet, ...extraParty])).slice(0, Math.max(1, totalSeats - 1));

        // Hard guard against active Match Vault stakes for any participant or room key
        const db = serviceDb();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- arena_match_stakes status query
        const adminDb = db as any;
        const matchKeys = [
            ...humanWallets.map((w) => `qm:${w}`),
            ...(body.roomCode ? [`room:${String(body.roomCode).trim()}`] : []),
        ];

        const [{ data: walletStakes }, { data: keyStakes }] = await Promise.all([
            adminDb
                .from('arena_match_stakes')
                .select('id')
                .in('wallet_address', humanWallets)
                .in('status', ['reserved', 'committed'])
                .limit(1),
            matchKeys.length > 0
                ? adminDb
                      .from('arena_match_stakes')
                      .select('id')
                      .in('match_key', matchKeys)
                      .in('status', ['reserved', 'committed'])
                      .limit(1)
                : Promise.resolve({ data: [] }),
        ]);

        if ((walletStakes && walletStakes.length > 0) || (keyStakes && keyStakes.length > 0)) {
            return NextResponse.json(
                {
                    error: 'Cannot launch server bot backfill while an active Match Vault stake is reserved or committed.',
                    code: 'BOT_BACKFILL_FREE_ONLY',
                },
                { status: 403 },
            );
        }

        const botCount = Math.max(1, totalSeats - humanWallets.length);
        const botIds = Array.from({ length: botCount }, (_, idx) => `bot:${idx + 1}`);
        const participants = [...humanWallets, ...botIds];
        const roomCode = `AI-${crypto.randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase()}`;
        const gameModeCode = GAME_MODE_CODE[gameMode as keyof typeof GAME_MODE_CODE] ?? 0;

        const { data: createdMatch, error: matchErr } = await db
            .from('matches')
            .insert({
                room_code: roomCode,
                game_mode: gameMode,
                game_mode_code: gameModeCode,
                match_shape: matchType,
                participants,
                host_proven: false,
                room_owner: wallet,
                metadata: {
                    botBackfill: true,
                    unranked: true,
                    botDifficulty,
                },
            })
            .select('id, room_code')
            .single();

        if (matchErr || !createdMatch) {
            return NextResponse.json({ error: matchErr?.message || 'Failed to create match row' }, { status: 500 });
        }

        const seats = participants.map((participantId, idx) => ({
            match_id: createdMatch.id,
            color: seatColors[idx],
            wallet_address: participantId,
            seat_index: idx,
            seat_kind: idx < humanWallets.length ? 'human' : 'bot',
        }));

        const { error: seatsErr } = await db.from('match_seats').insert(seats);
        if (seatsErr) {
            return NextResponse.json({ error: seatsErr.message }, { status: 500 });
        }

        // Cancel caller's active searching matchmaking tickets cleanly
        await db
            .from('matchmaking_queue')
            .update({ status: 'cancelled' })
            .eq('player_id', wallet)
            .eq('status', 'searching');

        return NextResponse.json({
            status: 'matched',
            matchId: createdMatch.id,
            roomCode: createdMatch.room_code || roomCode,
            gameMode,
            matchType,
            seats: seats.map((s) => ({
                color: s.color,
                walletAddress: s.wallet_address,
                seatIndex: s.seat_index,
                seatKind: s.seat_kind,
            })),
            botCount,
            unranked: true,
        });
    } catch (err: unknown) {
        return NextResponse.json({ error: (err as Error).message || 'Unexpected error' }, { status: 500 });
    }
}
