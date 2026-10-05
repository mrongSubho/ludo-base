import { useEffect } from 'react';
import { PlayerColor, GameState, GameStateSetter, GameActionType, GameActionPayload } from '@/lib/types';
import { Player } from './useGameEngine';
import { getLegalTokenIndices } from '@/lib/gameLogic';
import { ColorCorner } from '@/lib/boardLayout';
import type { MatchConnectionStatus } from '@/lib/matchProtocol';

interface UseAFKManagerProps {
    localGameState: GameState;
    setLocalGameState: GameStateSetter;
    initialPlayers: Player[];
    handleRoll: (value?: number) => Promise<void>;
    moveToken: (color: PlayerColor, tokenIndex: number, steps: number) => void;
    getNextPlayer: (current: PlayerColor) => PlayerColor;
    broadcastAction?: <T extends GameActionType>(type: T, payload?: GameActionPayload<T>, stateOverride?: GameState) => void;
    isHost?: boolean;
    colorCorner?: ColorCorner;
    matchConnectionStatus?: MatchConnectionStatus;
    /** Networked authority handles for AFK auto-play (host drives bot seats). */
    moveAuth?: {
        passTurn: (p: {
            matchId: string;
            rollId: string;
            expectedSeq: number;
            source?: 'player' | 'host-assist';
            reason?: string;
        }) => Promise<{ ok: boolean; seq?: number; state?: GameState; error?: string }>;
        getMatchState?: (matchId: string) => Promise<{ ok: boolean; seq?: number; state?: GameState; error?: string }>;
    };
    serverSeqRef?: React.MutableRefObject<number>;
    lastRollIdRef?: React.MutableRefObject<string | null>;
    applyServerState?: (state: GameState, seq: number) => void;
    isLobbyConnected?: boolean;
}

export function useAFKManager({
    localGameState,
    setLocalGameState,
    initialPlayers,
    handleRoll,
    moveToken,
    getNextPlayer,
    broadcastAction,
    isHost,
    colorCorner,
    matchConnectionStatus = 'offline',
    moveAuth,
    serverSeqRef,
    lastRollIdRef,
    applyServerState,
    isLobbyConnected
}: UseAFKManagerProps) {
    useEffect(() => {
        if (localGameState.winner || localGameState.idleWarning ||
            matchConnectionStatus === 'ended' || matchConnectionStatus === 'reconnecting' ||
            matchConnectionStatus === 'syncing') return;

        const color = localGameState.currentPlayer;
        const currentPlayerInfo = initialPlayers.find(p => p.color === color);
        const isOriginalBot = currentPlayerInfo?.isAi;
        const isKicked = localGameState.afkStats[color].isKicked;
        const isCurrentlyBot = isOriginalBot || isKicked;

        // Striking logic only applies to active humans when timeLeft hits 0
        if (!isCurrentlyBot && localGameState.timeLeft <= 0) {
            setLocalGameState((prev) => {
                const stats = prev.afkStats[color];
                const nextStats = { ...stats };
                let nextWarning = null;

                if (!stats.isAutoPlaying) {
                    nextStats.isAutoPlaying = true;
                    nextStats.consecutiveTurns = 1;
                    nextStats.totalTriggers += 1;
                } else {
                    nextStats.consecutiveTurns += 1;
                }

                if (nextStats.totalTriggers >= 3) {
                    nextStats.isKicked = true;
                    nextStats.isAutoPlaying = false;
                } else if (nextStats.consecutiveTurns >= 4) {
                    nextWarning = { player: color as PlayerColor, timeLeft: 10 };
                }

                return {
                    ...prev,
                    afkStats: { ...prev.afkStats, [color]: nextStats },
                    idleWarning: nextWarning || prev.idleWarning
                };
            });
        }
    }, [localGameState.timeLeft, localGameState.currentPlayer, localGameState.winner, localGameState.idleWarning, initialPlayers, setLocalGameState, matchConnectionStatus]);

    // Handle the Side-Effects of AFK Timeouts
    useEffect(() => {
        if (localGameState.winner || localGameState.idleWarning ||
            matchConnectionStatus === 'ended' || matchConnectionStatus === 'reconnecting' ||
            matchConnectionStatus === 'syncing') return;

        const color = localGameState.currentPlayer;
        const currentPlayerInfo = initialPlayers.find(p => p.color === color);
        const isOriginalBot = currentPlayerInfo?.isAi;
        const isKicked = localGameState.afkStats[color].isKicked;
        const isCurrentlyBot = isOriginalBot || isKicked;

        // ONLY the Host (or Computer Host) triggers forced AFK actions for ANY player.
        // This prevents Guests from spamming intents while 'timeLeft' is 0.
        if (isHost && !isCurrentlyBot && localGameState.afkStats[color].isAutoPlaying && localGameState.timeLeft <= 0) {
            if (localGameState.gamePhase === 'rolling') {
                // No pre-rolled face: handleRoll uses Edge RNG in networked
                // matches and local RNG only offline (see useGameActions).
                setLocalGameState((s) => ({ ...s, timeLeft: 15 }));
                handleRoll();
            } else if (localGameState.gamePhase === 'moving' && localGameState.diceValue !== null) {
                const diceValue = localGameState.diceValue;
                // Engine-accurate legality only — never naive pos+roll
                if (!colorCorner) {
                    console.warn('[AFK] colorCorner missing — skipping forced move');
                    return;
                }
                const options = getLegalTokenIndices(localGameState.positions, color, diceValue, colorCorner);

                if (options.length === 0) {
                    // Server-authoritative matches must advance match_states,
                    // otherwise the next player's move is refused 403 and the
                    // match stalls for everyone.
                    const matchId = localGameState.matchId;
                    const rollId = lastRollIdRef?.current;
                    if (isLobbyConnected && moveAuth?.passTurn && matchId && matchId !== 'local' && rollId && serverSeqRef) {
                        void moveAuth.passTurn({
                            matchId,
                            rollId,
                            expectedSeq: serverSeqRef.current,
                            source: 'host-assist',
                        }).then(async (pass) => {
                            if (pass.ok && pass.state) {
                                serverSeqRef.current = pass.seq ?? serverSeqRef.current;
                                if (lastRollIdRef) lastRollIdRef.current = null;
                                applyServerState?.(pass.state, pass.seq ?? serverSeqRef.current);
                                setLocalGameState(s => ({ ...s, ...pass.state!, diceValue: null, gamePhase: 'rolling', timeLeft: 15, lastUpdate: Date.now() }));
                                if (broadcastAction) broadcastAction('ENGINE_STATE', {}, pass.state);
                                return;
                            }
                            const snap = await moveAuth.getMatchState?.(matchId);
                            if (snap?.ok && snap.state) {
                                serverSeqRef.current = snap.seq ?? serverSeqRef.current;
                                if (lastRollIdRef) lastRollIdRef.current = null;
                                applyServerState?.(snap.state, snap.seq ?? serverSeqRef.current);
                                setLocalGameState(s => ({ ...s, ...snap.state!, isRolling: false, timeLeft: 15, lastUpdate: Date.now() }));
                            }
                        }).catch(err => console.warn('[AFK] networked pass failed', err));
                        return;
                    }
                    setLocalGameState((s) => {
                        const nextPlayer = getNextPlayer(s.currentPlayer);
                        const switchState: GameState = {
                            ...s,
                            gamePhase: 'rolling',
                            currentPlayer: nextPlayer,
                            diceValue: null,
                            timeLeft: 15,
                            lastUpdate: Date.now()
                        };
                        if (isHost && broadcastAction) {
                            broadcastAction('TURN_SWITCH', { nextPlayer }, switchState);
                        }
                        return switchState;
                    });
                } else {
                    const randomIdx = options[Math.floor(Math.random() * options.length)];
                    // Reset timeLeft immediately to prevent loop
                    setLocalGameState((s) => ({ ...s, timeLeft: 15 }));
                    moveToken(color, randomIdx, diceValue);
                }
            }
        }
    }, [localGameState.timeLeft, localGameState.currentPlayer, localGameState.gamePhase, localGameState.winner, localGameState.diceValue, localGameState.afkStats, localGameState.idleWarning, handleRoll, moveToken, initialPlayers, getNextPlayer, setLocalGameState, isHost, broadcastAction, colorCorner, matchConnectionStatus]);
}
