"use client";

import { useCallback } from 'react';
import {
    buildMoveMessage,
    buildPassMessage,
    buildSeedMessage,
} from '@/lib/matchProof';
import { stripPowerTypesForWire } from '@/lib/engine';
import type { GameState, ColorCorner, PlayerColor } from '@/lib/types';

type SignFn = (args: { account: `0x${string}`; message: string }) => Promise<string>;

const fnUrl = (action: string) =>
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/move-auth`;

async function callMoveAuth(action: string, body: Record<string, unknown>) {
    const res = await fetch(fnUrl(action), {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({ action, ...body }),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
}

export type MoveAuthResult =
    | { ok: true; seq: number; state: GameState; captured?: boolean; bonusRoll?: boolean }
    | { ok: false; error: string; seq?: number; state?: GameState; legal?: number[] };

/**
 * v2 server-authoritative moves: Edge validates + persists match_states.
 * Host uses source='host-assist' for bot/AFK seats only.
 */
export function useMoveAuth(opts: {
    myAddress: string | undefined;
    signMessageAsync: SignFn;
}) {
    const { myAddress, signMessageAsync } = opts;

    const seedMatch = useCallback(async (params: {
        matchId: string;
        roomCode: string;
        colorCorner: ColorCorner;
        playerSeats: Record<string, { kind: 'human' | 'bot' | 'afk'; wallet?: string }>;
        initialState: GameState;
    }) => {
        if (!myAddress) return { ok: false as const, error: 'no wallet' };
        const issuedAt = new Date().toISOString();
        const expectedSeq = 0;
        const message = buildSeedMessage({
            matchId: params.matchId,
            hostAddress: myAddress,
            roomCode: params.roomCode,
            expectedSeq,
            issuedAt,
        });
        const signature = await signMessageAsync({ account: myAddress as `0x${string}`, message });
        const r = await callMoveAuth('seed', {
            matchId: params.matchId,
            hostAddress: myAddress,
            roomCode: params.roomCode,
            colorCorner: params.colorCorner,
            playerSeats: params.playerSeats,
            initialState: stripPowerTypesForWire(params.initialState),
            expectedSeq,
            message,
            signature,
            issuedAt,
        });
        return r;
    }, [myAddress, signMessageAsync]);

    const submitMove = useCallback(async (params: {
        matchId: string;
        color: PlayerColor;
        tokenIndex: number;
        rollId: string;
        expectedSeq: number;
        source?: 'player' | 'host-assist';
        /** For host-assist, sign as host; for player, sign as seat wallet. */
        actorOverride?: string;
    }): Promise<MoveAuthResult> => {
        const source = params.source || 'player';
        const actor = (params.actorOverride || myAddress || '').toLowerCase();
        if (!actor) return { ok: false, error: 'no actor' };

        const issuedAt = new Date().toISOString();
        const message = buildMoveMessage({
            matchId: params.matchId,
            actor,
            color: params.color,
            tokenIndex: params.tokenIndex,
            rollId: params.rollId,
            expectedSeq: params.expectedSeq,
            issuedAt,
        });
        let signature: string;
        try {
            signature = await signMessageAsync({ account: actor as `0x${string}`, message });
        } catch {
            return { ok: false, error: 'sign rejected' };
        }

        const r = await callMoveAuth('move', {
            matchId: params.matchId,
            actor,
            color: params.color,
            tokenIndex: params.tokenIndex,
            rollId: params.rollId,
            expectedSeq: params.expectedSeq,
            source,
            message,
            signature,
            issuedAt,
        });
        if (r.ok && r.data?.state) {
            return {
                ok: true,
                seq: r.data.seq,
                state: r.data.state as GameState,
                captured: r.data.captured,
                bonusRoll: r.data.bonusRoll,
            };
        }
        return {
            ok: false,
            error: r.data?.error || `HTTP ${r.status}`,
            seq: r.data?.seq,
            state: r.data?.state,
            legal: r.data?.legal,
        };
    }, [myAddress, signMessageAsync]);

    const passTurn = useCallback(async (params: {
        matchId: string;
        rollId: string;
        expectedSeq: number;
        source?: 'player' | 'host-assist';
        reason?: string;
        actorOverride?: string;
    }): Promise<MoveAuthResult> => {
        const source = params.source || 'player';
        const actor = (params.actorOverride || myAddress || '').toLowerCase();
        if (!actor) return { ok: false, error: 'no actor' };
        const issuedAt = new Date().toISOString();
        const message = buildPassMessage({
            matchId: params.matchId,
            actor,
            rollId: params.rollId,
            expectedSeq: params.expectedSeq,
            issuedAt,
        });
        let signature: string;
        try {
            signature = await signMessageAsync({ account: actor as `0x${string}`, message });
        } catch {
            return { ok: false, error: 'sign rejected' };
        }
        const r = await callMoveAuth('pass', {
            matchId: params.matchId,
            actor,
            rollId: params.rollId,
            expectedSeq: params.expectedSeq,
            source,
            reason: params.reason,
            message,
            signature,
            issuedAt,
        });
        if (r.ok && r.data?.state) {
            return { ok: true, seq: r.data.seq, state: r.data.state as GameState };
        }
        return { ok: false, error: r.data?.error || `HTTP ${r.status}`, seq: r.data?.seq, state: r.data?.state };
    }, [myAddress, signMessageAsync]);

    const getMatchState = useCallback(async (matchId: string) => {
        return callMoveAuth('get', { matchId });
    }, []);

    return { seedMatch, submitMove, passTurn, getMatchState };
}
