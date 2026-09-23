/* eslint-disable @typescript-eslint/no-unused-vars -- lint burn-down quarantine 2026-09-23 */
import { NextResponse } from "next/server";
import type { Address, Hex } from "viem";
import {
    edgeSign,
    lobbyTicketDigest,
    parseRequestedChainId,
    seatsHash,
    toHex32,
} from "@/lib/chipsSettle";
import { matchPoolAddress } from "@/lib/chips";
import { requireAppSession } from "@/lib/serverAuth";

/**
 * POST /api/chips/lobby-ticket
 * Edge-signed lobby ticket for MatchPool.createPool (HIGH-5).
 *
 * Body:
 * {
 *   walletAddress, sessionId,
 *   chainId, matchId, roomCode,
 *   host, seatWallets[], seatColors[],
 *   gameMode, maxSeats, issuedAt?
 * }
 *
 * Auth: SIWE app session of the host wallet. Guest / unsigned rejected.
 * Requires: MATCH_POOL deployed + EDGE_SETTLE_PRIVATE_KEY + NEXT_PUBLIC_MATCH_POOL_ADDRESS.
 */
export async function POST(request: Request) {
    try {
        const body = await request.json();
        const {
            walletAddress,
            sessionId,
            chainId: chainRaw,
            matchId,
            roomCode,
            host,
            seatWallets,
            seatColors,
            gameMode,
            maxSeats,
            issuedAt,
        } = body ?? {};

        if (!walletAddress || !matchId || !roomCode || !host || !Array.isArray(seatWallets)) {
            return NextResponse.json({ error: "Missing lobby ticket fields" }, { status: 400 });
        }

        const wallet = await requireAppSession(walletAddress, sessionId);
        if (!wallet) {
            return NextResponse.json({ error: "Invalid session" }, { status: 401 });
        }
        if (wallet.toLowerCase() !== String(host).toLowerCase()) {
            return NextResponse.json({ error: "Only the host may request a lobby ticket" }, { status: 403 });
        }

        const chainId = parseRequestedChainId(chainRaw ?? 84532);
        const pool = matchPoolAddress();
        if (!pool) {
            return NextResponse.json({ error: "MatchPool not configured" }, { status: 503 });
        }

        const seats = seatWallets.map((a: string) => String(a).toLowerCase() as Address);
        const colors = (seatColors as number[] | undefined) ?? seats.map((_, i) => (i % 4) + 1);
        if (seats.length !== Number(maxSeats) || colors.length !== Number(maxSeats)) {
            return NextResponse.json({ error: "seatWallets/seatColors length must equal maxSeats" }, { status: 400 });
        }

        const ticket = {
            roomCode: toHex32(String(roomCode)),
            matchId: toHex32(String(matchId)),
            host: String(host).toLowerCase() as Address,
            seatsHash: seatsHash(seats, colors as number[]),
            gameMode: Number(gameMode) || 0,
            maxSeats: Number(maxSeats),
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
