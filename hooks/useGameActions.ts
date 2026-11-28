import { useCallback, useRef, useEffect } from 'react';
import { PlayerColor, PowerType, PowerItem, GameState, GameStateSetter, BetType, GameActionType, GameIntentType, GameIntentPayloads, GameActionPayload } from '@/lib/types';
import { processMove, getTeammateColor, handleThreeSixes, getNextPlayer as getNextPlayerCore, getLegalTokenIndices, getIntermediatePathCoords } from '@/lib/gameLogic';
import { activeColorsForTurns } from '@/lib/engine';
import { applyPower, applyPowerPickup, clearShieldsOnTurnChange, CORNER_SLOTS, liveInventory, resolveControllableColor, sweepExpiredPowers, type EngineGameState } from '@/lib/engine/core';
import { countNukeVictims } from '@/lib/aiEngine';
import { Player } from './useGameEngine';
import { ColorCorner } from '@/lib/boardLayout';
import {
    BOARD_FINISH_INDEX,
    BASE_INDEX,
    DICE_ROLL_SIX,
    HOME_LANE_START_INDEX,
} from '@/lib/constants';
import { computeMoveSettleBufferMs } from '@/lib/tokenMovement';
import { prefersReducedMotion } from '@/lib/motion';
import type { RoomIntentResult } from '@/lib/roomCodes';
import type { MatchAuthorityMode } from '@/lib/netcode/authorityGate';
import { isSeatInTier1Afk, isSeatPermanentlyLocked } from '@/lib/afkPolicy';
import { friendlyError } from '@/lib/errorCopy';

/**
 * NET-19: outcome of a token move, for callers that act on confirmation.
 * `applied` = the move landed locally or was accepted by the authority;
 * `failed` = refused (pending guard, no rollId, server rejection, illegal);
 * `deferred` = handed to the host as an intent (a guest's own broadcast).
 */
export type MoveTokenOutcome = 'applied' | 'failed' | 'deferred';

/** NET-19: `deferred` = handed to the host as a REQUEST_ROLL intent. */
export type RollOutcome = 'applied' | 'failed' | 'deferred';

interface UseGameActionsProps {
    localGameState: GameState;
    setLocalGameState: GameStateSetter;
    initialPlayers: Player[];
    address: string | undefined;
    isLobbyConnected: boolean;
    broadcastAction: <T extends GameActionType>(type: T, payload?: GameActionPayload<T>, fullState?: GameState) => void;
    sendIntent: <T extends GameIntentType>(type: T, payload: GameIntentPayloads[T]) => void;
    startBettingWindow: (betType: BetType) => Promise<string>;
    playerCount: '1v1' | '4P' | '2v2';
    colorCorner: ColorCorner;
    activeColorsArr: PlayerColor[];
    audio?: {
        playMove: () => void;
        playCapture: () => void;
        playWin: () => void;
        playNuke: () => void;
        playShield: () => void;
        playBoost: () => void;
        playTeleport: () => void;
        playPickup: () => void;
    };
    triggerWinConfetti: () => void;
    recordWin: (color: PlayerColor) => Promise<void>;
    autoMoveTimeoutRef: React.MutableRefObject<NodeJS.Timeout | null>;
    /**
     * TU-4: is the MatchRoom Durable Object the authority for this match?
     *
     * Supplied by `TeamUpContext` from the room socket state — true only while
     * `/api/room/:matchId/ws` is open and connected. When true this hook sends
     * intents and renders the room's broadcast; when false and in `'p2p'` mode,
     * the P2P host is the authority and guests ask it via `sendIntent`.
     */
    roomAuthority: boolean;
    /** ADR-02 strict mode partition: 'room' | 'p2p' | 'offline'. */
    matchAuthorityMode?: MatchAuthorityMode;
    /** Send an intent to the room. Rejects when no room socket is open. */
    sendRoomIntent: (kind: string, payload?: unknown) => Promise<RoomIntentResult>;
    /** Last roll receipt id for the current turn. */
    lastRollIdRef: React.MutableRefObject<string | null>;
}


const NOOP_GAME_AUDIO = {
    playMove: () => {},
    playCapture: () => {},
    playWin: () => {},
    playNuke: () => {},
    playShield: () => {},
    playBoost: () => {},
    playTeleport: () => {},
    playPickup: () => {},
};

export function useGameActions({
    localGameState,
    setLocalGameState,
    initialPlayers,
    address,
    isLobbyConnected,
    roomAuthority,
    matchAuthorityMode = 'offline',
    sendRoomIntent,
    broadcastAction,
    sendIntent,
    playerCount,
    colorCorner,
    activeColorsArr,
    audio = NOOP_GAME_AUDIO,
    triggerWinConfetti,
    recordWin,
    autoMoveTimeoutRef,
    startBettingWindow,
    lastRollIdRef,
}: UseGameActionsProps) {


    const _bettingWindowIdRef = useRef<string | null>(null);
    const rollingRef = useRef<boolean>(false);
    const serverActionPendingRef = useRef(false);
    const roomAutoMoveKeyRef = useRef<string>('');
    const prevRoomPositionsRef = useRef<GameState['positions'] | null>(null);
    const prevRoomDiceRef = useRef<number | null>(localGameState.diceValue ?? null);
    const stateRef = useRef(localGameState);
    const moveTokenRef = useRef<(color: PlayerColor, tokenIndex: number, steps: number, isRemote?: boolean) => Promise<MoveTokenOutcome>>(async () => 'failed');

    useEffect(() => {
        stateRef.current = localGameState;
    }, [localGameState]);

    const getNextPlayer = useCallback((current: PlayerColor, currentPositions: GameState['positions']): PlayerColor => {
        // ENG-04: this was a third local copy of the rule. The engine owns it
        // now; useGameEngine had a fourth. Drift between copies is how a finished
        // colour stayed in (or left) the turn cycle inconsistently.
        const activeForTurns = activeColorsForTurns({
            ...localGameState,
            positions: currentPositions,
            playerCount,
        } as Parameters<typeof activeColorsForTurns>[0]);

        return getNextPlayerCore(
            current,
            playerCount,
            activeForTurns,
            colorCorner
        );
    }, [activeColorsArr, playerCount, colorCorner]);

    /**
     * NET-19: callers get a status so a caller that owns a deadline (AFK
     * escalation) can tell an applied move from a refused one. Returning
     * `Promise<void>` forced every caller to assume success and re-arm its
     * clock, which made the 3rd strike unreachable.
     */
    const moveToken = useCallback(async (color: PlayerColor, tokenIndex: number, steps: number, isRemote = false): Promise<MoveTokenOutcome> => {
        const currentState0 = stateRef.current;
        if (currentState0.status === 'finished' || currentState0.winner) return 'failed';
        const _matchId = currentState0.matchId;
        // ── Room authority (TU-4 / ADR-02) ───────────────────────────────
        // The MatchRoom resolves the move, commits it atomically and fans the new
        // state out to every socket. This client sends an intent and renders the
        // broadcast — and when in room mode it must NEVER fall through to local
        // processMove if the socket is momentarily disconnected.
        if (matchAuthorityMode === 'room' && !roomAuthority && !isRemote) {
            return 'failed';
        }
        if (roomAuthority && !isRemote) {
            if (serverActionPendingRef.current) return 'failed';
            if (autoMoveTimeoutRef.current) {
                clearTimeout(autoMoveTimeoutRef.current);
                autoMoveTimeoutRef.current = null;
            }
            serverActionPendingRef.current = true;
            try {
                const res = await sendRoomIntent('REQUEST_MOVE', {
                    color,
                    tokenIndex,
                    steps,
                });
                if (!res.ok) {
                    const info = friendlyError(res.code);
                    console.warn('🏟️ [Room] move rejected:', res.code, info.copy);
                    return 'failed';
                }
                lastRollIdRef.current = null;
                return 'applied';
            } finally {
                serverActionPendingRef.current = false;
            }
        }

        if (autoMoveTimeoutRef.current) {
            clearTimeout(autoMoveTimeoutRef.current);
            autoMoveTimeoutRef.current = null;
        }

        const currentState = stateRef.current;
        if (currentState.gamePhase !== 'moving' && !isRemote) return 'failed';

        const pendingBoostDice = !isRemote ? (currentState.boostPendingDice ?? null) : null;
        const isStep2 = !isRemote && pendingBoostDice === null && Boolean(currentState.boostSubMoveBonus);

        const { newState, captured, finishedToken } = processMove(
            currentState,
            color,
            tokenIndex,
            steps,
            playerCount,
            colorCorner,
            currentState.currentPlayer,
            activeColorsArr
        );

        const actingSeat = currentState.currentPlayer;
        const stepStreakBreak = captured || finishedToken;
        const streakBreaker = stepStreakBreak || isStep2;
        const isBonusTurn = pendingBoostDice === null
            ? (streakBreaker || steps === DICE_ROLL_SIX || Boolean(newState.winner))
            : Boolean(newState.winner);

        let pTurnSwitchPending = false;
        let pNextPlayer: PlayerColor | null = null;
        const actingPlayerInfo = initialPlayers.find((p) => p.color === actingSeat);
        const isActingBot = Boolean(actingPlayerInfo?.isAi || isSeatPermanentlyLocked(currentState.afkStats?.[actingSeat]));

        const captureNotice = captured
            ? `Captured! Bonus roll for ${actingSeat}!`
            : finishedToken && !newState.winner
              ? `Token home! Bonus roll for ${actingSeat}!`
              : null;

        const finalState: GameState = {
            ...currentState,
            ...newState,
            // Preserve the current mover during Boost Step 1 -> Step 2, or grant bonus roll when earned.
            currentPlayer:
                pendingBoostDice !== null || (isBonusTurn && !newState.winner)
                    ? actingSeat
                    : newState.currentPlayer,
            diceValue: isBonusTurn ? null : newState.diceValue,
            captureMessage: captureNotice,
            strikes: { ...currentState.strikes, [actingSeat]: 0 },
            consecutiveSixes:
                pendingBoostDice !== null
                    ? (stepStreakBreak ? 0 : currentState.consecutiveSixes)
                    : (streakBreaker ? 0 : (isBonusTurn && !newState.winner ? currentState.consecutiveSixes : 0)),
            activeBoost: null,
            boostPendingDice: pendingBoostDice !== null && !newState.winner ? pendingBoostDice : null,
            boostSubMoveBonus: pendingBoostDice !== null ? stepStreakBreak : false,
            powerSpentThisTurn: pendingBoostDice !== null && !newState.winner,
            gamePhase: 'landing' as const, // Buffer to prevent AI state stomping
            timeLeft: 15, // Reset timer during animation
            lastUpdate: Date.now()
        };

        // Boost visual trail during split Boost steps
        if (pendingBoostDice !== null || currentState.boostTrail === color) {
            finalState.boostTrail = color;
            setTimeout(() => {
                setLocalGameState((latest) => latest.boostTrail === color ? { ...latest, boostTrail: null, lastUpdate: Date.now() } : latest);
            }, 1600);
        }

        // ── Power pickup: landing exactly on a hidden tile reveals + grants.
        const landedPos = newState.positions[color][tokenIndex];
        {
            const beforeTiles = finalState.powerTiles;
            const picked = applyPowerPickup(
                finalState as unknown as Parameters<typeof applyPowerPickup>[0],
                color,
                landedPos,
                colorCorner,
            ) as unknown as GameState;
            if ((picked.powerTiles as unknown) !== (beforeTiles as unknown)) {
                const hadBefore = (finalState.playerPowers?.[color] || []).length;
                finalState.playerPowers = picked.playerPowers ?? finalState.playerPowers;
                finalState.powerTiles = picked.powerTiles ?? finalState.powerTiles;
                if ((picked.playerPowers?.[color] || []).length > hadBefore) {
                    const foundMsg = picked.captureMessage ?? 'POWER discovered!';
                    finalState.captureMessage = captureNotice
                        ? `${captureNotice} ${foundMsg}`.trim()
                        : foundMsg;
                }
            }
        }

        // PW-5: the host is the authority, so it decides expiry — once, at the turn boundary.
        finalState.playerPowers = sweepExpiredPowers(
            finalState as unknown as Parameters<typeof sweepExpiredPowers>[0],
        ).playerPowers as GameState['playerPowers'];

        if (!isRemote && !newState.winner) {
            if (pendingBoostDice !== null || newState.currentPlayer !== currentState.currentPlayer || isBonusTurn) {
                pTurnSwitchPending = true;
                pNextPlayer = pendingBoostDice !== null || isBonusTurn ? actingSeat : newState.currentPlayer;
            }
        }

        setLocalGameState(finalState);

        if (broadcastAction && isLobbyConnected && !isRemote) {
            broadcastAction('ENGINE_STATE', {}, finalState);
        }

        if (newState.winner && !currentState.winner) {
            triggerWinConfetti();
            recordWin(color);
            const mate = getTeammateColor(color, playerCount);
            if (playerCount === '2v2' && mate && newState.winner.startsWith('Team ')) {
                recordWin(mate);
            }
        }

        // 🚀 Executing side effects OUTSIDE the setLocalGameState!
        if (pTurnSwitchPending) {
            if (autoMoveTimeoutRef.current) clearTimeout(autoMoveTimeoutRef.current);
            const movedDelta = Math.abs(
                Number(newState.positions[color][tokenIndex]) - Number(currentState.positions[color][tokenIndex]),
            );
            const isYardDeploy = Number(currentState.positions[color][tokenIndex]) === BASE_INDEX;
            const settleSteps = isYardDeploy
                ? 1
                : movedDelta > 0 && movedDelta <= 6
                  ? movedDelta
                  : steps;
            const settleBufferMs = computeMoveSettleBufferMs(
                settleSteps,
                pendingBoostDice !== null,
                '3077',
                isYardDeploy,
            );
            autoMoveTimeoutRef.current = setTimeout(() => {
                rollingRef.current = false;
                if (pendingBoostDice !== null) {
                    const latestSnap = stateRef.current;
                    const step2Target = resolveControllableColor(latestSnap.positions, actingSeat, playerCount);
                    const step2Legal = getLegalTokenIndices(latestSnap.positions, step2Target, pendingBoostDice, colorCorner);
                    if (step2Legal.length > 0) {
                        setLocalGameState((latest) => {
                            const nextStepState: GameState = {
                                ...latest,
                                currentPlayer: actingSeat,
                                diceValue: pendingBoostDice,
                                boostPendingDice: null,
                                boostSubMoveBonus: stepStreakBreak,
                                powerSpentThisTurn: true,
                                gamePhase: 'moving',
                                lastUpdate: Date.now(),
                                timeLeft: 15,
                            };
                            if (broadcastAction && isLobbyConnected) broadcastAction('ENGINE_STATE', {}, nextStepState);
                            return nextStepState;
                        });
                        const allStep2InBase = step2Legal.every((idx) => latestSnap.positions[step2Target][idx] === BASE_INDEX);
                        if (!isActingBot && (step2Legal.length === 1 || (pendingBoostDice === DICE_ROLL_SIX && allStep2InBase))) {
                            if (autoMoveTimeoutRef.current) clearTimeout(autoMoveTimeoutRef.current);
                            autoMoveTimeoutRef.current = setTimeout(() => {
                                autoMoveTimeoutRef.current = null;
                                void moveTokenRef.current(step2Target, step2Legal[0], pendingBoostDice);
                            }, 180);
                        }
                        return;
                    }
                    // Step 2 has no legal moves on post-Step-1 board: grant bonus roll on capture/finish, else pass turn.
                    const step2NextPlayer = stepStreakBreak ? actingSeat : getNextPlayer(actingSeat, latestSnap.positions);
                    setLocalGameState((latest) => {
                        const passOrBonusState: GameState = {
                            ...latest,
                            currentPlayer: step2NextPlayer,
                            activeShields: clearShieldsOnTurnChange(latest.activeShields, actingSeat, step2NextPlayer),
                            diceValue: null,
                            boostPendingDice: null,
                            boostSubMoveBonus: false,
                            consecutiveSixes: 0,
                            powerSpentThisTurn: false,
                            gamePhase: 'rolling',
                            lastUpdate: Date.now(),
                            timeLeft: 15,
                        };
                        if (broadcastAction && isLobbyConnected) broadcastAction('ENGINE_STATE', {}, passOrBonusState);
                        return passOrBonusState;
                    });
                    return;
                }

                setLocalGameState((latest) => {
                    const switchState: GameState = {
                        ...latest,
                        currentPlayer: pNextPlayer ?? latest.currentPlayer,
                        diceValue: null,
                        boostPendingDice: null,
                        boostSubMoveBonus: false,
                        powerSpentThisTurn: false,
                        gamePhase: 'rolling', // Now it's officially the next turn
                        lastUpdate: Date.now(),
                        timeLeft: 15 // Reset for next turn
                    };
                    if (broadcastAction && isLobbyConnected) broadcastAction('ENGINE_STATE', {}, switchState);
                    return switchState;
                });
            }, settleBufferMs);
        }
        return 'applied';
    }, [isLobbyConnected, roomAuthority, sendRoomIntent, sendIntent, broadcastAction, audio, playerCount, activeColorsArr, colorCorner, setLocalGameState, autoMoveTimeoutRef, triggerWinConfetti, recordWin, lastRollIdRef, address, initialPlayers, getNextPlayer, matchAuthorityMode]);

    moveTokenRef.current = moveToken;

    // No `value` parameter, by design. A roll face is never an input to this
    // function: it comes from the MatchRoom DO for a networked seat, or local
    // RNG for an offline one. Previously callers could pass a face and it was
    // used verbatim, which let a seated guest choose their own dice.
    //
    // NET-19: resolves to a RollOutcome so a caller that owns a deadline (AFK
    // escalation) distinguishes "face committed" from "refused". `Promise<void>`
    // forced every caller to assume success and re-arm its clock, which is why
    // the 3rd-strike kick was unreachable.
    const handleRoll = useCallback(async (isRemote = false): Promise<RollOutcome> => {
        // 🔧 FIX 3: Read from stateRef instead of stale closure for guard check
        const guardState = stateRef.current;
        if (guardState.status === 'finished' || guardState.winner) return 'failed';
        if (rollingRef.current || guardState.isRolling || guardState.gamePhase !== 'rolling') return 'failed';
        
        rollingRef.current = true;

        const matchId = stateRef.current.matchId;
        void matchId;
        const color = localGameState.currentPlayer;
        const currentPlayerInfo = initialPlayers.find(p => p.color === color);
        const isCurrentlyBot =
            Boolean(currentPlayerInfo?.isAi) ||
            isSeatPermanentlyLocked(localGameState.afkStats?.[color]) ||
            isSeatInTier1Afk(localGameState.afkStats?.[color]);
        
        // In a networked match, bots and autopiloting seats are rolled by the server room DO.
        if (!isRemote && (isLobbyConnected || matchAuthorityMode === 'room') && isCurrentlyBot) {
            rollingRef.current = false;
            return 'failed';
        }

        // Strict ADR-02 partition: room-mode matches must never downgrade to P2P or local dice on transient drops.
        if (matchAuthorityMode === 'room' && !roomAuthority) {
            rollingRef.current = false;
            return 'failed';
        }

        // Degraded fallback intent only in pure P2P mode when server room DO is not used.
        if (matchAuthorityMode === 'p2p' && isLobbyConnected && !roomAuthority && !isRemote) {
            sendIntent('REQUEST_ROLL', {});
            rollingRef.current = false;
            return 'failed';
        }

        setLocalGameState((prev) => ({ ...prev, isRolling: true, diceValue: null, timeLeft: 15 }));

        // Match LudoDice's ~440ms high-speed 3-axis breakout tumble so there is zero dead pause.
        const ROLL_TUMBLE_MS = 440;
        const tumblePromise = new Promise(r => setTimeout(r, ROLL_TUMBLE_MS));

        // 2. Generate and Set Result
        //
        // TU-4: the room mints the die (CSPRNG, in-process) and broadcasts the
        // resulting state. This client does not compute a face at all when the room
        // is the authority — it waits for the fan-out, which is what makes the roll
        // the same fact on every socket.
        if (roomAuthority) {
            await new Promise(r => setTimeout(r, 320));
            const res = await sendRoomIntent('REQUEST_ROLL', { seatColor: color });
            rollingRef.current = false;
            if (!res.ok) {
                const showMsg = res.code === 'RATE_LIMITED' || res.code === 'SESSION_EXPIRED';
                setLocalGameState((prev) => ({
                    ...prev,
                    isRolling: false,
                    diceValue: null,
                    ...(showMsg ? { captureMessage: friendlyError(res.code).copy } : {}),
                }));
                return 'failed';
            }
            return 'deferred';
        }

        // SEC-02: a networked seat never rolls locally. Without the room there is no
        // authority to mint the face, and a client-chosen `Math.random()` is exactly
        // what this invariant forbids — so the roll aborts rather than falling
        // through. Degraded play surfaces the gap instead of inventing a face.
        if (isLobbyConnected) {
            await tumblePromise;
            setLocalGameState((prev) => ({ ...prev, isRolling: false, diceValue: null }));
            rollingRef.current = false;
            console.error('❌ [Engine] networked roll with no server authority — aborting (no client fallback)');
            return 'failed';
        }
        if (matchAuthorityMode !== 'offline') {
            await tumblePromise;
            setLocalGameState((prev) => ({ ...prev, isRolling: false, diceValue: null }));
            rollingRef.current = false;
            return 'failed';
        }

        // Offline only: no other seat is watching, so the local die is honest.
        const rollValue = Math.floor(Math.random() * 6) + 1;

        // Wait for the tumble animation to finish
        await tumblePromise;

        const preLandState = stateRef.current;
        if (preLandState.gamePhase !== 'rolling' || preLandState.winner) {
            rollingRef.current = false;
            return 'failed';
        }

        const teammate = (playerCount === '2v2') ? getTeammateColor(color, playerCount) : null;
        const isSelfFinished = preLandState.positions[color].every((p: number) => p === BOARD_FINISH_INDEX);
        const targetColor = (playerCount === '2v2' && isSelfFinished && teammate) ? teammate : color;
        const { isThreeSixes, nextSixes } = handleThreeSixes(preLandState.consecutiveSixes, rollValue);
        const boosted = !isThreeSixes && (preLandState.activeBoost === color || preLandState.activeBoost === targetColor);
        const legalForSix = boosted ? getLegalTokenIndices(preLandState.positions, targetColor, DICE_ROLL_SIX, colorCorner) : [];
        const boostSplitActive = boosted && legalForSix.length > 0;
        const activeDice = boostSplitActive ? DICE_ROLL_SIX : rollValue;
        const pendingDiceForBoost = boostSplitActive ? rollValue : null;

        setLocalGameState((prev) => ({
            ...prev,
            isRolling: false,
            diceValue: isThreeSixes ? rollValue : activeDice,
            boostPendingDice: pendingDiceForBoost,
            activeBoost: boostSplitActive ? null : prev.activeBoost,
            boostTrail: null,
            lastUpdate: Date.now(),
            timeLeft: 15, // Reset timer during animation
        }));
        
        // Brief pause for visual impact of the landing face
        await new Promise(r => setTimeout(r, 140));

        // Break the asynchronous updater cycle using stateRef
        const currentState = stateRef.current;
        if (currentState.gamePhase !== 'rolling' || currentState.winner) {
            rollingRef.current = false;
            return 'failed';
        }

        let pDelayedAction: 'turnSwitch' | 'autoMove' | null = null;
        let pNextPlayer: PlayerColor | null = null;
        const pTargetColor: PlayerColor = targetColor;
        let pLastValidTokenIndex = -1;
        const pActiveStepValue = activeDice;
        let pFinalStateForBroadcast: GameState | null = null;

        if (isThreeSixes) {
            pNextPlayer = getNextPlayer(color, currentState.positions);
            pDelayedAction = 'turnSwitch';
            // 🔧 FIX 2: Use functional updater to avoid clobbering concurrent state
            setLocalGameState((prev) => {
                pFinalStateForBroadcast = {
                    ...prev,
                    isRolling: false,
                    diceValue: rollValue,
                    gamePhase: 'rolling',
                    consecutiveSixes: 0,
                    activeBoost: null,
                    boostPendingDice: null,
                    boostSubMoveBonus: false,
                    powerSpentThisTurn: false,
                    captureMessage: 'Three 6s! Turn forfeited.',
                };
                return pFinalStateForBroadcast;
            });
        } else {
            // Engine-accurate legality (gate crossing, base exit, overshoot)
            const legalIdxs = boostSplitActive
                ? legalForSix
                : getLegalTokenIndices(currentState.positions, targetColor, activeDice, colorCorner);
            const validMovesCount = legalIdxs.length;
            const lastValidTokenIndex = legalIdxs[legalIdxs.length - 1] ?? -1;

            if (validMovesCount === 0) {
                console.log(`🎲 [Engine] No valid moves for ${color}. Switching turn.`);
                pNextPlayer = getNextPlayer(color, currentState.positions);
                pDelayedAction = 'turnSwitch';
                setLocalGameState((prev) => {
                    pFinalStateForBroadcast = {
                        ...prev,
                        isRolling: false,
                        diceValue: activeDice,
                        gamePhase: 'rolling',
                        consecutiveSixes: 0,
                        activeBoost: null,
                        boostPendingDice: null,
                        boostSubMoveBonus: false,
                        powerSpentThisTurn: false,
                    };
                    return pFinalStateForBroadcast;
                });
            } else {
                // Immediate auto-move whenever only 1 legal move exists (or all eligible tokens sit in Yard on a 6).
                const allLegalInBase =
                    activeDice === DICE_ROLL_SIX &&
                    legalIdxs.every((idx) => currentState.positions[targetColor][idx] === BASE_INDEX);
                const isSingleMove = validMovesCount === 1;

                if ((isSingleMove || allLegalInBase) && !isRemote && !isCurrentlyBot) {
                    pLastValidTokenIndex = legalIdxs[0] ?? lastValidTokenIndex;
                    pDelayedAction = 'autoMove';
                    setLocalGameState((prev) => {
                        pFinalStateForBroadcast = {
                            ...prev,
                            isRolling: false,
                            diceValue: activeDice,
                            gamePhase: 'moving',
                            consecutiveSixes: nextSixes,
                            activeBoost: null,
                            boostPendingDice: pendingDiceForBoost,
                            boostSubMoveBonus: false,
                        };
                        return pFinalStateForBroadcast;
                    });
                } else {
                    rollingRef.current = false;
                    setLocalGameState((prev) => {
                        pFinalStateForBroadcast = {
                            ...prev,
                            isRolling: false,
                            diceValue: activeDice,
                            gamePhase: 'moving' as const,
                            consecutiveSixes: nextSixes,
                            activeBoost: null,
                            boostPendingDice: pendingDiceForBoost,
                            boostSubMoveBonus: false,
                            lastUpdate: Date.now(),
                            timeLeft: 15
                        };
                        return pFinalStateForBroadcast;
                    });
                }
            }
        }

        // 🚀 Executing side effects OUTSIDE the setLocalGameState!
        if (broadcastAction && isLobbyConnected && !isRemote && pFinalStateForBroadcast) {
            broadcastAction('ENGINE_STATE', {}, pFinalStateForBroadcast);
        }

        if (pDelayedAction === 'turnSwitch') {
            // Instant pass in local/offline mode (Room DO resolves passes authoritatively on roll).
            setLocalGameState((latest) => {
                const targetNext = pNextPlayer ?? latest.currentPlayer;
                const switchState: GameState = {
                    ...latest,
                    currentPlayer: targetNext,
                    activeShields: clearShieldsOnTurnChange(latest.activeShields, color, targetNext),
                    diceValue: null,
                    gamePhase: 'rolling',
                    consecutiveSixes: 0,
                    activeBoost: null,
                    boostPendingDice: null,
                    boostSubMoveBonus: false,
                    powerSpentThisTurn: false,
                    timeLeft: 15,
                    lastUpdate: Date.now()
                };
                console.log(`🎲 [Engine] Auto-switching to ${pNextPlayer}`);
                // NET-03: full state instead of a TURN_SWITCH hint.
                if (broadcastAction && isLobbyConnected) broadcastAction('ENGINE_STATE', {}, switchState);
                rollingRef.current = false;
                return switchState;
            });
        } else if (pDelayedAction === 'autoMove') {
            if (autoMoveTimeoutRef.current) clearTimeout(autoMoveTimeoutRef.current);
            autoMoveTimeoutRef.current = setTimeout(() => {
                moveToken(pTargetColor, pLastValidTokenIndex, pActiveStepValue);
                rollingRef.current = false;
                autoMoveTimeoutRef.current = null;
            }, 160);
        }
        return 'applied';
    }, [isLobbyConnected, roomAuthority, sendRoomIntent, sendIntent, broadcastAction, setLocalGameState, initialPlayers, localGameState.winner, localGameState.isRolling, localGameState.diceValue, localGameState.currentPlayer, localGameState.afkStats, startBettingWindow, playerCount, getNextPlayer, moveToken, address, matchAuthorityMode]);

    const handleUsePower = useCallback(async (color: PlayerColor, type?: PowerType, tokenIdx?: number) => {
        const prev = stateRef.current;
        if (prev.status === 'finished' || prev.winner) return;
        if (!prev || prev.currentPlayer !== color || prev.gamePhase !== 'rolling') return;
        if (prev.powerSpentThisTurn) return;

        // Strict ADR-02 partition: room-mode powers must never execute locally while disconnected.
        if (matchAuthorityMode === 'room' && !roomAuthority) return;

        // ── Room authority (PW-3) ────────────────────────────────────────
        // The room owns the inventory, so it decides whether this seat holds the
        // power, whether the turn budget is spent, and what the effect is. The
        // client only names the power and (for nuke/teleport) a target token.
        if (roomAuthority) {
            if (serverActionPendingRef.current) return;
            if (!type && tokenIdx === undefined) {
                setLocalGameState(s => ({
                    ...s,
                    captureMessage: 'Choose a power to use.',
                }));
                return;
            }
            serverActionPendingRef.current = true;
            try {
                const res = await sendRoomIntent('REQUEST_POWER', {
                    color,
                    power: type,
                    tokenIndex: tokenIdx,
                });
                if (!res.ok) {
                    if (res.code === 'POWER_ARMED') {
                        setLocalGameState(s => ({
                            ...s,
                            captureMessage: type === 'nuke'
                                ? 'Nuke armed — tap one of your tokens to target.'
                                : 'Teleport armed — tap one of your tokens.',
                        }));
                    } else {
                        const info = friendlyError(res.code);
                        console.warn('🏟️ [Room] power rejected:', res.code, info.copy);
                        if (res.code === 'RATE_LIMITED' || res.code === 'SESSION_EXPIRED' || res.code === 'POWER_REFUSED') {
                            setLocalGameState(s => ({
                                ...s,
                                captureMessage: info.copy,
                            }));
                        }
                    }
                }
            } finally {
                serverActionPendingRef.current = false;
            }
            return;
        }

        // ── Offline / legacy local path ──────────────────────────────────
        const now = Date.now();
        const myColor = color as PlayerColor;
        const liveInv: PowerItem[] = liveInventory(prev as unknown as EngineGameState, myColor, now);
        const pick: PowerType | undefined = type ?? (['nuke', 'shield', 'boost', 'teleport'] as PowerType[]).find(t => liveInv.some(p => p.type === t));
        if (!pick || !liveInv.some(p => p.type === pick)) return;

        let idx = tokenIdx;
        if (idx === undefined && pick === 'nuke') {
            // Auto-pick densest cluster (AI path).
            let best = -1;
            let bestCount = 0;
            prev.positions[myColor].forEach((myPos: number, i: number) => {
                if (myPos < 0 || myPos >= HOME_LANE_START_INDEX) return;
                const { victims } = countNukeVictims(prev, myColor, i, colorCorner, playerCount);
                if (victims.length > bestCount) {
                    bestCount = victims.length;
                    best = i;
                }
            });
            if (best >= 0) idx = best;
        } else if (idx === undefined && pick === 'teleport') {
            // Foremost on-board token by travel distance.
            const startIdx = CORNER_SLOTS[colorCorner[myColor]].startIdx;
            let bestDist = -1;
            prev.positions[myColor].forEach((p: number, i: number) => {
                if (p < 0 || p >= BOARD_FINISH_INDEX) return;
                const dist = p >= HOME_LANE_START_INDEX ? p : (p - startIdx + 52) % 52;
                if (dist > bestDist) {
                    bestDist = dist;
                    idx = i;
                }
            });
        }

        const res = applyPower(
            prev as unknown as EngineGameState,
            myColor,
            pick,
            idx,
            colorCorner,
            playerCount,
            now,
        );

        if (!res.ok) {
            setLocalGameState((latest) => ({
                ...latest,
                captureMessage: res.error,
                lastUpdate: Date.now(),
            }));
            return;
        }

        const nextState: GameState = {
            ...(res.state as unknown as GameState),
            captureMessage: res.message,
            lastUpdate: Date.now(),
        };
        setLocalGameState(nextState);

        // Clear the blast flash after the drama lands.
        if (res.nukeFlash && res.nukeFlash.length > 0) {
            setTimeout(() => {
                setLocalGameState((latest) => ({ ...latest, nukeFlash: [], lastUpdate: Date.now() }));
            }, 1400);
        }
    }, [playerCount, colorCorner, audio, setLocalGameState, isLobbyConnected, roomAuthority, sendRoomIntent, matchAuthorityMode]);

    const handleTokenClick = useCallback((color: PlayerColor, tokenIndex: number) => {
        if (localGameState.gamePhase !== 'moving' || localGameState.diceValue === null) return;

        const actingPlayerColor = localGameState.currentPlayer;
        const myPlayer =
            initialPlayers.find(p => address && p.walletAddress?.toLowerCase() === address.toLowerCase()) ||
            initialPlayers.find(p => !p.isAi);
        const myColor = myPlayer?.color;
        const isMyTurn = actingPlayerColor === myColor;
        const afkStat = localGameState.afkStats?.[actingPlayerColor];
        const isCurrentlyBot =
            Boolean(initialPlayers.find(p => p.color === actingPlayerColor)?.isAi) ||
            isSeatInTier1Afk(afkStat) ||
            isSeatPermanentlyLocked(afkStat);

        const teammateColor = getTeammateColor(myColor as PlayerColor, playerCount);
        const allMyTokensFinished = myColor ? localGameState.positions[myColor].every((pos: number) => pos === BOARD_FINISH_INDEX) : false;
        const isTeammateAssist = playerCount === '2v2' && color === teammateColor && allMyTokensFinished && isMyTurn;

        if (!isMyTurn) return;
        if (isCurrentlyBot) return;
        if (color !== myColor && !isTeammateAssist) return;

        if (matchAuthorityMode === 'room') {
            if (!roomAuthority) return;
            moveToken(color, tokenIndex, localGameState.diceValue);
            return;
        }

        if (matchAuthorityMode === 'p2p' && isLobbyConnected && !roomAuthority) {
            sendIntent('REQUEST_MOVE', { color, tokenIndex });
            return;
        }

        moveToken(color, tokenIndex, localGameState.diceValue);
    }, [localGameState.gamePhase, localGameState.diceValue, localGameState.currentPlayer, localGameState.positions, localGameState.afkStats, playerCount, isLobbyConnected, roomAuthority, sendIntent, moveToken, address, initialPlayers, matchAuthorityMode]);

    // Immediate auto-move for room-authoritative seats when only 1 legal move exists
    // (covering normal rolls as well as Boost Step 1 and Step 2), deferred until
    // visual dice landing or Boost Step 1 hop settles so tokens never snap mid-hop.
    useEffect(() => {
        const prevPos = prevRoomPositionsRef.current;
        const prevDice = prevRoomDiceRef.current;
        prevRoomPositionsRef.current = localGameState.positions;
        prevRoomDiceRef.current = localGameState.diceValue ?? null;

        if (!roomAuthority) {
            roomAutoMoveKeyRef.current = '';
            return;
        }
        if (
            localGameState.status === 'finished' ||
            localGameState.winner ||
            localGameState.isRolling ||
            localGameState.gamePhase !== 'moving' ||
            localGameState.diceValue === null
        ) {
            roomAutoMoveKeyRef.current = '';
            return;
        }

        const actingColor = localGameState.currentPlayer;
        const myPlayer =
            initialPlayers.find((p) => address && p.walletAddress?.toLowerCase() === address.toLowerCase()) ||
            initialPlayers.find((p) => !p.isAi);
        const myColor = myPlayer?.color;
        if (!myColor || actingColor !== myColor) return;
        const isBot =
            Boolean(initialPlayers.find((p) => p.color === actingColor)?.isAi) ||
            isSeatPermanentlyLocked(localGameState.afkStats?.[actingColor]) ||
            isSeatInTier1Afk(localGameState.afkStats?.[actingColor]);
        if (isBot) return;

        const targetColor = resolveControllableColor(localGameState.positions, myColor, playerCount);
        const diceVal = localGameState.diceValue;
        const legal = getLegalTokenIndices(localGameState.positions, targetColor, diceVal, colorCorner);
        if (legal.length === 0) return;

        const allInBaseOnSix =
            diceVal === DICE_ROLL_SIX &&
            legal.every((idx) => localGameState.positions[targetColor][idx] === BASE_INDEX);
        if (legal.length !== 1 && !allInBaseOnSix) return;

        const key = `${actingColor}|${diceVal}|${localGameState.boostPendingDice ?? ''}|${(localGameState.positions[targetColor] || []).join(',')}`;
        if (roomAutoMoveKeyRef.current === key) return;
        roomAutoMoveKeyRef.current = key;

        let delayMs = 180;
        if (!prefersReducedMotion()) {
            let movedSteps = 0;
            let isDeployTransition = false;
            if (prevPos) {
                for (const c of ['green', 'red', 'yellow', 'blue'] as PlayerColor[]) {
                    const pArr = prevPos[c] || [];
                    const nArr = localGameState.positions[c] || [];
                    for (let i = 0; i < Math.min(pArr.length, nArr.length); i++) {
                        const oldP = Number(pArr[i]);
                        const newP = Number(nArr[i]);
                        if (oldP === newP) continue;
                        if (oldP === BASE_INDEX && newP >= 0) {
                            isDeployTransition = true;
                            movedSteps = Math.max(movedSteps, 1);
                        } else if (oldP >= 0 && newP >= 0 && newP <= BOARD_FINISH_INDEX) {
                            const hops = getIntermediatePathCoords(oldP, newP, c, colorCorner).length;
                            movedSteps = Math.max(movedSteps, hops || 1);
                        }
                    }
                }
            }
            if (isDeployTransition || movedSteps > 0) {
                delayMs = computeMoveSettleBufferMs(
                    Math.max(1, movedSteps),
                    true,
                    '3077',
                    isDeployTransition && movedSteps <= 1,
                );
            } else if (prevDice == null && diceVal != null) {
                delayMs = 360;
            }
        }

        let fired = false;
        const timer = setTimeout(() => {
            fired = true;
            void moveTokenRef.current(targetColor, legal[0], diceVal);
        }, delayMs);
        return () => {
            clearTimeout(timer);
            if (!fired && roomAutoMoveKeyRef.current === key) {
                roomAutoMoveKeyRef.current = '';
            }
        };
    }, [
        roomAuthority,
        localGameState.status,
        localGameState.winner,
        localGameState.isRolling,
        localGameState.gamePhase,
        localGameState.diceValue,
        localGameState.boostPendingDice,
        localGameState.currentPlayer,
        localGameState.positions,
        localGameState.afkStats,
        initialPlayers,
        address,
        playerCount,
        colorCorner,
    ]);

    return {
        moveToken,
        handleRoll,
        handleUsePower,
        handleTokenClick
    };
}
