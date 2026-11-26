import { useEffect } from 'react';
import { PlayerColor, GameState, GameStateSetter, GameActionType, GameActionPayload } from '@/lib/types';
import { Player } from './useGameEngine';
import { getLegalTokenIndices } from '@/lib/gameLogic';
import { clearShieldsOnTurnChange } from '@/lib/engine/core';
import { ColorCorner } from '@/lib/boardLayout';
import type { MatchConnectionStatus } from '@/lib/matchProtocol';
import type { MatchAuthorityMode } from '@/lib/netcode/authorityGate';
import type { RollOutcome, MoveTokenOutcome } from './useGameActions';

interface UseAFKManagerProps {
    localGameState: GameState;
    setLocalGameState: GameStateSetter;
    initialPlayers: Player[];
    handleRoll: (isRemote?: boolean) => Promise<RollOutcome>;
    moveToken: (color: PlayerColor, tokenIndex: number, steps: number) => Promise<MoveTokenOutcome>;
    getNextPlayer: (current: PlayerColor) => PlayerColor;
    broadcastAction?: <T extends GameActionType>(type: T, payload?: GameActionPayload<T>, stateOverride?: GameState) => void;
    colorCorner?: ColorCorner;
    matchConnectionStatus?: MatchConnectionStatus;
    matchAuthorityMode?: MatchAuthorityMode;
    /** NET-07: called with the kicked seat so the abandon is classified. */
    onAbandon?: (args: { seat: string; matchEnded: boolean }) => void;
}

export function useAFKManager({
    localGameState,
    setLocalGameState,
    initialPlayers,
    handleRoll,
    moveToken,
    getNextPlayer,
    broadcastAction,
    colorCorner,
    matchConnectionStatus = 'offline',
    matchAuthorityMode = 'offline',
    /** NET-07: records the abandon evidence when a seat is kicked. */
    onAbandon,
}: UseAFKManagerProps) {
    useEffect(() => {
        if (matchAuthorityMode === 'room' ||
            localGameState.winner || localGameState.idleWarning ||
            matchConnectionStatus === 'ended' || matchConnectionStatus === 'reconnecting' ||
            matchConnectionStatus === 'syncing' || matchConnectionStatus === 'connected') return;

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
                    // NET-07: the kick IS the abandon signal. Classify and
                    // record it here — the classifier had no caller, so the
                    // grace window and dual-sign policy were unobservable.
                    onAbandon?.({ seat: color, matchEnded: prev.winner !== null || prev.status === 'finished' });
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
    }, [localGameState.timeLeft, localGameState.currentPlayer, localGameState.winner, localGameState.idleWarning, initialPlayers, setLocalGameState, matchConnectionStatus, matchAuthorityMode, onAbandon]);

    // Handle the Side-Effects of AFK Timeouts
    useEffect(() => {
        if (matchAuthorityMode === 'room' ||
            localGameState.winner || localGameState.idleWarning ||
            matchConnectionStatus === 'ended' || matchConnectionStatus === 'reconnecting' ||
            matchConnectionStatus === 'syncing' || matchConnectionStatus === 'connected') return;

        const color = localGameState.currentPlayer;
        const currentPlayerInfo = initialPlayers.find(p => p.color === color);
        const isOriginalBot = currentPlayerInfo?.isAi;
        const isKicked = localGameState.afkStats[color].isKicked;
        const isCurrentlyBot = isOriginalBot || isKicked;

        // Striking & auto-play actions in offline/P2P matches when 'timeLeft' is 0.
        if (!isCurrentlyBot && localGameState.afkStats[color].isAutoPlaying && localGameState.timeLeft <= 0) {
            if (localGameState.gamePhase === 'rolling') {
                void Promise.resolve(handleRoll()).then((applied) => {
                    if (applied !== 'applied') return; // refused/deferred — let timeLeft run out again
                    setLocalGameState((s) => ({ ...s, timeLeft: 15 }));
                });
            } else if (localGameState.gamePhase === 'moving' && localGameState.diceValue !== null) {
                const diceValue = localGameState.diceValue;
                // Engine-accurate legality only — never naive pos+roll
                if (!colorCorner) {
                    console.warn('[AFK] colorCorner missing — skipping forced move');
                    return;
                }
                const options = getLegalTokenIndices(localGameState.positions, color, diceValue, colorCorner);

                if (options.length === 0) {
                    setLocalGameState((s) => {
                        const nextPlayer = getNextPlayer(s.currentPlayer);
                        const switchState: GameState = {
                            ...s,
                            gamePhase: 'rolling',
                            currentPlayer: nextPlayer,
                            activeShields: clearShieldsOnTurnChange(s.activeShields, s.currentPlayer, nextPlayer),
                            diceValue: null,
                            timeLeft: 15,
                            lastUpdate: Date.now()
                        };
                        if (broadcastAction) {
                            broadcastAction('TURN_SWITCH', { nextPlayer }, switchState);
                        }
                        return switchState;
                    });
                } else {
                    const randomIdx = options[Math.floor(Math.random() * options.length)];
                    void Promise.resolve(moveToken(color, randomIdx, diceValue)).then((status) => {
                        if (status === 'failed') return;
                        setLocalGameState((s) => ({ ...s, timeLeft: 15 }));
                    });
                }
            }
        }
    }, [localGameState.timeLeft, localGameState.currentPlayer, localGameState.gamePhase, localGameState.winner, localGameState.diceValue, localGameState.afkStats, localGameState.idleWarning, handleRoll, moveToken, initialPlayers, getNextPlayer, setLocalGameState, broadcastAction, colorCorner, matchConnectionStatus, matchAuthorityMode]);
}
