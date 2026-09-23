"use client";

import { useCallback, useRef } from 'react';
import {
    buildMoveMessage,
    buildPassMessage,
    buildPowerMessage,
    buildSeedMessage,
} from '@/lib/matchProof';
import {
    buildSessionDomain,
    LUDO_SESSION_TYPES,
    buildMatchSessionPayload,
    type MatchSessionTypedMessage,
} from '@/lib/sessionProof';
import { parseChainId, DEFAULT_CHAIN_ID } from '@/lib/chains';
import { stripPowerTypesForWire } from '@/lib/engine';
import type { GameState, ColorCorner, PlayerColor, PowerType } from '@/lib/types';
import type { MatchActionError, MatchActionErrorCode, MatchActionSuccess } from '@/lib/matchProtocol';
import type { MatchStateSnapshot } from '@/lib/matchProtocol';

type SignFn = (args: { account: `0x${string}`; message: string }) => Promise<string>;
type SignTypedFn = (args: {
    account: `0x${string}`;
    /** Widened from `typeof LUDO_SESSION_DOMAIN` for dual-chain (84532/8453) grants. */
    domain: { name: string; version: string; chainId: number };
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
    | ({ ok: true } & MatchActionSuccess)
    | ({ ok: false } & MatchActionError);

/** Module-shared session maps: useMoveAuth is instantiated twice
 * (TeamUpContext creates the match session at start; useGameEngine consumes
 * it per action). Per-instance maps meant the consumer never saw the
 * producer's session → a wallet popup on EVERY move. Keyed by matchId;
 * a wrong-wallet entry fails closed server-side and renews via 401. */
const sharedMoveSessions = new Map<string, string>();
/** Prevent concurrent first actions from opening one wallet prompt each. */
const sharedMovePending = new Map<string, Promise<{ ok: boolean; sessionId?: string; error?: string }>>();

export function useMoveAuth(opts: {
    myAddress: string | undefined;
    signMessageAsync: SignFn;
    signTypedDataAsync: SignTypedFn;
    /**
     * Active wallet chain for EIP-712 match-session grants. Validated
     * against the 84532/8453 allowlist; unsupported values fall back to the
     * mainnet default (server enforces the allowlist either way).
     */
    chainId?: number;
}) {
    const { myAddress, signMessageAsync, signTypedDataAsync } = opts;
    // Dual-chain gate: the EIP-712 domain chain must match what Edge verifies.
    const signingChainId = parseChainId(opts.chainId) ?? DEFAULT_CHAIN_ID;
    const sessionDomain = buildSessionDomain(signingChainId);
    /* session maps are module-shared (see top of file). */
    const getSessionId = useCallback((matchId: string) => sharedMoveSessions.get(matchId) || null, []);
    const clearSession = useCallback((matchId: string) => {
        sharedMoveSessions.delete(matchId);
    }, []);

    const createProvisionalSession = useCallback(async (params: {
        authorizationKey: string;
        roomCode?: string;
    }): Promise<{ ok: boolean; provisionalId?: string; error?: string }> => {
        if (!myAddress) return { ok: false, error: 'no wallet' };
        const payload = buildMatchSessionPayload({
            wallet: myAddress,
            matchId: params.authorizationKey,
            roomCode: params.roomCode || '',
        });
        let signature: string;
        try {
            signature = await signTypedDataAsync({
                account: myAddress as `0x${string}`,
                domain: sessionDomain,
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
        const r = await callMoveAuth('provisional-session', {
            authorizationKey: params.authorizationKey,
            roomCode: params.roomCode || '',
            wallet: payload.wallet,
            expiresAt: payload.expiresAt,
            nonce: payload.nonce,
            chainId: signingChainId,
            signature,
        });
        if (r.ok && r.data?.provisionalId) {
            sessionStorage.setItem(`ludo-provisional:${params.authorizationKey}`, r.data.provisionalId);
            return { ok: true, provisionalId: r.data.provisionalId };
        }
        return { ok: false, error: r.data?.error || `HTTP ${r.status}` };
    }, [myAddress, signTypedDataAsync]);

    const bindProvisionalSession = useCallback(async (params: {
        provisionalId: string;
        matchId: string;
        roomCode?: string;
    }) => {
        const r = await callMoveAuth('bind-provisional-session', params);
        if (r.ok && r.data?.sessionId) {
            sharedMoveSessions.set(params.matchId, r.data.sessionId);
            return { ok: true, sessionId: r.data.sessionId };
        }
        return { ok: false, error: r.data?.error || `HTTP ${r.status}` };
    }, []);

    /**
     * One wallet sign per match (EIP-712). MetaMask and smart wallets both land here.
     * Returns sessionId for subsequent submit-move / power / pass without popups.
     */
    const createMatchSession = useCallback(async (params: {
        matchId: string;
        roomCode: string;
    }): Promise<{ ok: boolean; sessionId?: string; error?: string }> => {
        if (!myAddress) return { ok: false, error: 'no wallet' };
        const existing = sharedMoveSessions.get(params.matchId);
        if (existing) return { ok: true, sessionId: existing };
        const pending = sharedMovePending.get(params.matchId);
        if (pending) return pending;

        const request = (async () => {
            const payload = buildMatchSessionPayload({
                wallet: myAddress,
                matchId: params.matchId,
                roomCode: params.roomCode,
            });
            let signature: string;
            try {
                signature = await signTypedDataAsync({
                    account: myAddress as `0x${string}`,
                    domain: sessionDomain,
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
                chainId: signingChainId,
                signature,
            });
            if (r.ok && r.data?.sessionId) {
                sharedMoveSessions.set(params.matchId, r.data.sessionId);
                return { ok: true, sessionId: r.data.sessionId };
            }
            return { ok: false, error: r.data?.error || `HTTP ${r.status}` };
        })();
        sharedMovePending.set(params.matchId, request);
        try {
            return await request;
        } finally {
            sharedMovePending.delete(params.matchId);
        }
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
        if (!sharedMoveSessions.has(params.matchId) && source === 'player' && myAddress) {
            try {
                await createMatchSession({ matchId: params.matchId, roomCode: params.roomCode || params.matchId });
            } catch { /* fall back to per-action sign */ }
        }

        const sessionId = sharedMoveSessions.get(params.matchId);
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

        let r = await callMoveAuth('move', {
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
        if (!r.ok && r.status === 401 && sessionId && source === 'player' && myAddress) {
            clearSession(params.matchId);
            const renewed = await createMatchSession({ matchId: params.matchId, roomCode: params.roomCode || params.matchId });
            if (renewed.ok) {
                r = await callMoveAuth('move', {
                    matchId: params.matchId, actor, color: params.color, tokenIndex: params.tokenIndex,
                    rollId: params.rollId, expectedSeq: params.expectedSeq, source,
                    sessionId: renewed.sessionId,
                });
            }
        }
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
            code: (r.data?.code || (r.status === 401 ? 'SESSION_EXPIRED' : r.status === 409 ? 'STALE_SEQ' : 'ILLEGAL_ACTION')) as MatchActionErrorCode,
            seq: r.data?.seq,
            state: r.data?.state,
            legal: r.data?.legal,
        };
    }, [myAddress, signMessageAsync, createMatchSession, clearSession]);

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
        if (!sharedMoveSessions.has(params.matchId) && source === 'player' && myAddress) {
            await createMatchSession({ matchId: params.matchId, roomCode: params.matchId });
        }
        let sessionId = sharedMoveSessions.get(params.matchId);
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
        let r = await callMoveAuth('pass', {
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
        if (!r.ok && r.status === 401 && sessionId && source === 'player' && myAddress) {
            clearSession(params.matchId);
            const renewed = await createMatchSession({ matchId: params.matchId, roomCode: params.matchId });
            if (renewed.ok) {
                sessionId = renewed.sessionId;
                r = await callMoveAuth('pass', {
                    matchId: params.matchId, actor, rollId: params.rollId,
                    expectedSeq: params.expectedSeq, source, reason: params.reason,
                    sessionId,
                });
            }
        }
        if (r.ok && r.data?.state) {
            return { ok: true, seq: r.data.seq, state: r.data.state as GameState };
        }
        return {
            ok: false,
            error: r.data?.error || `HTTP ${r.status}`,
            code: (r.data?.code || (r.status === 409 ? 'STALE_SEQ' : 'ILLEGAL_ACTION')) as MatchActionErrorCode,
            seq: r.data?.seq,
            state: r.data?.state,
        };
    }, [myAddress, signMessageAsync, createMatchSession, clearSession]);

    const getMatchState = useCallback(async (matchId: string) => {
        // N0 — player resume uses session-proofed `resync` when a match session
        // exists; spectators / cold start fall back to the public snapshot `get`.
        const sessionId = sharedMoveSessions.get(matchId);
        const actor = (myAddress || '').toLowerCase();
        const useProof = Boolean(sessionId && actor);
        const r = await callMoveAuth(useProof ? 'resync' : 'get', useProof
            ? { matchId, sessionId, actor, sinceSeq: undefined }
            : { matchId });
        if (r.status === 401 && useProof) {
            // Session expired mid-match — clear and retry public get so the UI
            // still renders (moves will re-prompt via createMatchSession).
            sharedMoveSessions.delete(matchId);
            const retry = await callMoveAuth('get', { matchId });
            if (retry.ok && retry.data?.state && Number.isFinite(Number(retry.data.seq))) {
                return {
                    ok: true as const,
                    seq: Number(retry.data.seq),
                    state: retry.data.state as GameState,
                };
            }
        }
        if (r.ok && r.data?.state && Number.isFinite(Number(r.data.seq))) {
            return {
                ok: true as const,
                seq: Number(r.data.seq),
                state: r.data.state as GameState,
            } satisfies MatchStateSnapshot & { ok: true };
        }
        return {
            ok: false as const,
            error: r.data?.error || `HTTP ${r.status}`,
            code: (r.data?.code || (r.status === 404 ? 'MATCH_NOT_FOUND' : r.status === 401 ? 'SESSION_EXPIRED' : 'ILLEGAL_ACTION')) as MatchActionErrorCode,
        };
    }, [myAddress]);

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
        if (!sharedMoveSessions.has(params.matchId) && source === 'player' && myAddress) {
            await createMatchSession({ matchId: params.matchId, roomCode: params.matchId });
        }
        const tokenIndex = params.tokenIndex === undefined ? null : params.tokenIndex;
        let sessionId = sharedMoveSessions.get(params.matchId);
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
        let r = await callMoveAuth('power', {
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
        if (!r.ok && r.status === 401 && sessionId && source === 'player' && myAddress) {
            clearSession(params.matchId);
            const renewed = await createMatchSession({ matchId: params.matchId, roomCode: params.matchId });
            if (renewed.ok) {
                sessionId = renewed.sessionId;
                r = await callMoveAuth('power', {
                    matchId: params.matchId, actor, color: params.color, power: params.power,
                    tokenIndex, expectedSeq: params.expectedSeq, source, sessionId,
                });
            }
        }
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
            code: (r.data?.code || (r.status === 401 ? 'SESSION_EXPIRED' : r.status === 409 ? 'STALE_SEQ' : 'ILLEGAL_ACTION')) as MatchActionErrorCode,
            seq: r.data?.seq,
            state: r.data?.state,
            armed: r.data?.armed,
            kept: r.data?.kept,
        };
    }, [myAddress, signMessageAsync, createMatchSession, clearSession]);

    return {
        seedMatch,
        createProvisionalSession,
        bindProvisionalSession,
        createMatchSession,
        getSessionId,
        clearSession,
        submitMove,
        passTurn,
        submitPower,
        getMatchState,
        refreshMatchState: getMatchState,
    };
}
