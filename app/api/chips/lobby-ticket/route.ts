import { NextResponse } from "next/server";
import type { Address } from "viem";
import {
    edgeSign,
    lobbyTicketDigest,
    parseRequestedChainId,
    seatsHash,
    toHex32,
} from "@/lib/chipsSettle";
import { matchPoolAddress } from "@/lib/chips";
import { requireAppSession, serviceDb } from "@/lib/serverAuth";

const ADDRESS_RE = /^0x[a-f0-9]{40}$/;

/**
 * POST /api/chips/lobby-ticket
 * Edge-signed lobby ticket for MatchPool.createPool.
 *
 * Body: { walletAddress, sessionId, chainId, roomCode, seatColors?, issuedAt? }
 *
 * SEC-11. This used to accept `host`, `seatWallets`, `gameMode` and `maxSeats`
 * from the request body and only checked `wallet === host` — both sides being
 * body fields. Any free SIWE session could therefore obtain an Edge-signed
 * ticket for any matchId/roomCode with a self-chosen roster, i.e. mint an
 * official-looking pool.
 *
 * Everything that identifies the pool is now read from the canonical `matches`
 * row:
 *   - the caller must be `participants[0]` of that row
 *   - the row must have `host_proven = true`, which /api/match/start only sets
 *     when the creator held a session for participants[0] (SEC-06)
 *   - seats are the stored roster, so a caller cannot nominate anyone
 *   - gameMode comes from the stored `game_mode`
 *   - maxSeats is the stored roster length
 *
 * Seat colours are still caller-supplied because the canonical corner mapping
 * lives in `match_states.color_corner`, which is only written once the match is
 * seeded — after a ticket would be needed. The colours are bound by `seatsHash`
 * into the signed digest, so they cannot be swapped after issuance.
 *
 * NOTE: no client calls this route yet; the paid-pool creation flow is not
 * implemented in the UI (PaidPoolJoinButton / SettlePoolButton are stubs with
 * no fetch). It is kept, and kept safe, for whoever builds it.
 */
export async function POST(request: Request) {
    try {
        const body = await request.json();
        const {
            walletAddress,
            sessionId,
            chainId: chainRaw,
            roomCode,
            seatColors,
            issuedAt,
        } = body ?? {};

        if (!walletAddress || !roomCode) {
            return NextResponse.json({ error: "Missing lobby ticket fields" }, { status: 400 });
        }

        const wallet = await requireAppSession(walletAddress, sessionId);
        if (!wallet) {
            return NextResponse.json({ error: "Invalid session" }, { status: 401 });
        }

        const chainId = parseRequestedChainId(chainRaw ?? 84532);
        const pool = matchPoolAddress();
        if (!pool) {
            return NextResponse.json({ error: "MatchPool not configured" }, { status: 503 });
        }

        // ── Canonical match ───────────────────────────────────────────────
        const db = serviceDb();
        const { data: match, error } = await db
            .from("matches")
            .select("id, room_code, game_mode, participants, host_proven")
            .eq("room_code", String(roomCode))
            .maybeSingle();
        if (error) {
            return NextResponse.json({ error: error.message }, { status: 500 });
        }
        if (!match) {
            return NextResponse.json({ error: "Unknown room" }, { status: 404 });
        }

        const row = match as unknown as {
            id: string;
            room_code: string;
            game_mode: string;
            participants: string[];
            host_proven?: boolean;
        };

        // A match whose host was never proven cannot authorise a wagered pool.
        if (!row.host_proven) {
            return NextResponse.json(
                { error: "Match host was never proven; cannot issue a lobby ticket", code: "HOST_UNPROVEN" },
                { status: 403 },
            );
        }

        const stored = (row.participants ?? []).map((p) => String(p).toLowerCase());
        const seats = stored.filter((p) => ADDRESS_RE.test(p)) as Address[];
        if (seats.length === 0) {
            return NextResponse.json(
                { error: "Match has no wallet-addressed seats" },
                { status: 409 },
            );
        }

        const canonicalHost = stored[0];
        if (!canonicalHost || canonicalHost !== wallet.toLowerCase()) {
            return NextResponse.json(
                { error: "Only the canonical match host may request a lobby ticket" },
                { status: 403 },
            );
        }

        const colors = (seatColors as number[] | undefined) ?? seats.map((_, i) => (i % 4) + 1);
        if (colors.length !== seats.length || colors.some((c) => !Number.isInteger(c) || c < 1 || c > 4)) {
            return NextResponse.json(
                { error: "seatColors must be 1..4 and match the seat count" },
                { status: 400 },
            );
        }

        const ticket = {
            roomCode: toHex32(String(row.room_code ?? roomCode)),
            matchId: toHex32(String(row.id)),
            host: wallet.toLowerCase() as Address,
            seatsHash: seatsHash(seats, colors as number[]),
            gameMode: 0,
            maxSeats: seats.length,
            issuedAt: BigInt(issuedAt ?? Math.floor(Date.now() / 1000)),
        };

        const digest = lobbyTicketDigest(ticket, pool, chainId);
        const edgeTicketSig = await edgeSign(digest);

        return NextResponse.json({
            ticket: {
                roomCode: ticket.roomCode,
                matchId: ticket.matchId,
                host: ticket.host,
                seatsHash: ticket.seatsHash,
                gameMode: ticket.gameMode,
                maxSeats: ticket.maxSeats,
                issuedAt: ticket.issuedAt.toString(),
            },
            seatWallets: seats,
            seatColors: colors,
            edgeTicketSig,
            chainId,
            matchPool: pool,
            digest,
        });
    } catch (err) {
        console.error("lobby-ticket error", err);
        return NextResponse.json(
            { error: err instanceof Error ? err.message : "lobby ticket failed" },
            { status: 500 },
        );
    }
}
