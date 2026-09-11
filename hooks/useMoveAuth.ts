"use client";

import { useCallback, useRef } from 'react';
import {
    buildMoveMessage,
    buildPassMessage,
    buildPowerMessage,
    buildSeedMessage,
} from '@/lib/matchProof';
import {
    LUDO_SESSION_DOMAIN,
    LUDO_SESSION_TYPES,
    buildMatchSessionPayload,
    type MatchSessionTypedMessage,
} from '@/lib/sessionProof';
import { stripPowerTypesForWire } from '@/lib/engine';
import type { GameState, ColorCorner, PlayerColor, PowerType } from '@/lib/types';

type SignFn = (args: { account: `0x${string}`; message: string }) => Promise<string>;
type SignTypedFn = (args: {
    account: `0x${string}`;
    domain: typeof LUDO_SESSION_DOMAIN;
    types: typeof LUDO_SESSION_TYPES;
    primaryType: 'LudoMatchSession';
    message: MatchSessionTypedMessage;
}) => Promise<string>;

const fnUrl = () => `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/move-auth`;

async function callMoveAuth(action: string, body: Record<string, unknown>) {
    const res = await fetch(fnUrl(), {
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

export function useMoveAuth(opts: {
    myAddress: string | undefined;
    signMessageAsync: SignFn;
    signTypedDataAsync: SignTypedFn;
}) {
    const { myAddress, signMessageAsync, signTypedDataAsync } = opts;
    /** matchId → sessionId (one EIP-712 sign per match). */
    const sessionRef = useRef<Map<string, string>>(new Map());

    const getSessionId = useCallback((matchId: string) => sessionRef.current.get(matchId) || null, []);

    /**
     * One wallet sign per match (EIP-712). MetaMask and smart wallets both land here.
     * Returns sessionId for subsequent submit-move / power / pass without popups.
     */
    const createMatchSession = useCallback(async (params: {
        matchId: string;
        roomCode: string;
    }): Promise<{ ok: boolean; sessionId?: string; error?: string }> => {
        if (!myAddress) return { ok: false, error: 'no wallet' };
        const payload = buildMatchSessionPayload({
            wallet: myAddress,
            matchId: params.matchId,
            roomCode: params.roomCode,
        });
        let signature: string;
        try {
            signature = await signTypedDataAsync({
                account: myAddress as `0x${string}`,
                domain: LUDO_SESSION_DOMAIN,
                types: LUDO_SESSION_TYPES,
                primaryType: 'LudoMatchSession',
                message: {
                    wallet: payload.wallet as `0x${string}`,
                    matchId: payload.matchId,
                    roomCode: payload.roomCode,
                    expiresAt: BigInt(payload.expiresAt),
                    nonce: payload.nonce,
                },
            });
        } catch {
            return { ok: false, error: 'session sign rejected' };
        }
        const r = await callMoveAuth('session', {
            matchId: params.matchId,
            roomCode: params.roomCode,
            wallet: payload.wallet,
            expiresAt: payload.expiresAt,
            nonce: payload.nonce,
            signature,
        });
        if (r.ok && r.data?.sessionId) {
            sessionRef.current.set(params.matchId, r.data.sessionId);
            return { ok: true, sessionId: r.data.sessionId };
        }
        return { ok: false, error: r.data?.error || `HTTP ${r.status}` };
    }, [myAddress, signTypedDataAsync]);

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
        actorOverride?: string;
        roomCode?: string;
    }): Promise<MoveAuthResult> => {
        const source = params.source || 'player';
        const actor = (params.actorOverride || myAddress || '').toLowerCase();
        if (!actor) return { ok: false, error: 'no actor' };

        // Lazy session: first action may create the EIP-712 grant (guests).
        if (!sessionRef.current.has(params.matchId) && source === 'player' && myAddress) {
            try {
                await createMatchSession({ matchId: params.matchId, roomCode: params.roomCode || params.matchId });
            } catch { /* fall back to per-action sign */ }
        }

        const sessionId = sessionRef.current.get(params.matchId);
        const issuedAt = new Date().toISOString();
        let message: string | undefined;
        let signature: string | undefined;

        if (!sessionId) {
            message = buildMoveMessage({
                matchId: params.matchId,
                actor,
                color: params.color,
                tokenIndex: params.tokenIndex,
                rollId: params.rollId,
                expectedSeq: params.expectedSeq,
                issuedAt,
            });
            try {
                signature = await signMessageAsync({ account: actor as `0x${string}`, message });
            } catch {
                return { ok: false, error: 'sign rejected' };
            }
        }

        const r = await callMoveAuth('move', {
            matchId: params.matchId,
            actor,
            color: params.color,
            tokenIndex: params.tokenIndex,
            rollId: params.rollId,
            expectedSeq: params.expectedSeq,
            source,
            sessionId: sessionId || undefined,
            message,
            signature,
            issuedAt: sessionId ? undefined : issuedAt,
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
    }, [myAddress, signMessageAsync, createMatchSession]);

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
        const sessionId = sessionRef.current.get(params.matchId);
        const issuedAt = new Date().toISOString();
        let message: string | undefined;
        let signature: string | undefined;
        if (!sessionId) {
            message = buildPassMessage({
                matchId: params.matchId,
                actor,
                rollId: params.rollId,
                expectedSeq: params.expectedSeq,
                issuedAt,
            });
            try {
                signature = await signMessageAsync({ account: actor as `0x${string}`, message });
            } catch {
                return { ok: false, error: 'sign rejected' };
            }
        }
        const r = await callMoveAuth('pass', {
            matchId: params.matchId,
            actor,
            rollId: params.rollId,
            expectedSeq: params.expectedSeq,
            source,
            reason: params.reason,
            sessionId: sessionId || undefined,
            message,
            signature,
            issuedAt: sessionId ? undefined : issuedAt,
        });
        if (r.ok && r.data?.state) {
            return { ok: true, seq: r.data.seq, state: r.data.state as GameState };
        }
        return { ok: false, error: r.data?.error || `HTTP ${r.status}`, seq: r.data?.seq, state: r.data?.state };
    }, [myAddress, signMessageAsync]);

    const getMatchState = useCallback(async (matchId: string) => {
        return callMoveAuth('get', { matchId });
    }, []);

    const submitPower = useCallback(async (params: {
        matchId: string;
        color: PlayerColor;
        power: PowerType;
        tokenIndex?: number | null;
        expectedSeq: number;
        source?: 'player' | 'host-assist';
        actorOverride?: string;
    }): Promise<MoveAuthResult & { message?: string; armed?: string; kept?: boolean }> => {
        const source = params.source || 'player';
        const actor = (params.actorOverride || myAddress || '').toLowerCase();
        if (!actor) return { ok: false, error: 'no actor' };
        const tokenIndex = params.tokenIndex === undefined ? null : params.tokenIndex;
        const sessionId = sessionRef.current.get(params.matchId);
        const issuedAt = new Date().toISOString();
        let message: string | undefined;
        let signature: string | undefined;
        if (!sessionId) {
            message = buildPowerMessage({
                matchId: params.matchId,
                actor,
                color: params.color,
                power: params.power,
                tokenIndex,
                expectedSeq: params.expectedSeq,
                issuedAt,
            });
            try {
                signature = await signMessageAsync({ account: actor as `0x${string}`, message });
            } catch {
                return { ok: false, error: 'sign rejected' };
            }
        }
        const r = await callMoveAuth('power', {
            matchId: params.matchId,
            actor,
            color: params.color,
            power: params.power,
            tokenIndex,
            expectedSeq: params.expectedSeq,
            source,
            sessionId: sessionId || undefined,
            message,
            signature,
            issuedAt: sessionId ? undefined : issuedAt,
        });
        if (r.ok && r.data?.state) {
            return {
                ok: true,
                seq: r.data.seq,
                state: r.data.state as GameState,
                message: r.data.message,
            };
        }
        return {
            ok: false,
            error: r.data?.error || `HTTP ${r.status}`,
            seq: r.data?.seq,
            state: r.data?.state,
            armed: r.data?.armed,
            kept: r.data?.kept,
        };
    }, [myAddress, signMessageAsync]);

    return {
        seedMatch,
        createMatchSession,
        getSessionId,
        submitMove,
        passTurn,
        submitPower,
        getMatchState,
    };
}
