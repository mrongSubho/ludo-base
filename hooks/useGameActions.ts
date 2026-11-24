import { useCallback, useRef, useEffect } from 'react';
import { PlayerColor, PowerType, PowerItem, GameState, GameStateSetter, BetType, GameActionType, GameIntentType, GameIntentPayloads, GameActionPayload } from '@/lib/types';
import { processMove, getTeammateColor, handleThreeSixes, getNextPlayer as getNextPlayerCore, nearestStarAhead, getLegalTokenIndices } from '@/lib/gameLogic';
import { activeColorsForTurns } from '@/lib/engine';
import { applyPowerPickup, resolveControllableColor, sweepExpiredPowers } from '@/lib/engine/core';
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
import type { MatchActionErrorCode } from '@/lib/matchProtocol';

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
    audio: {
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
     * intents and renders the room's broadcast; when false the P2P host is the
     * authority (degraded mode) and guests ask it via `sendIntent`.
     */
    roomAuthority: boolean;
    /** Send an intent to the room. Rejects when no room socket is open. */
    sendRoomIntent: (kind: string, payload?: unknown) => Promise<{ ok: boolean; data?: unknown }>;
    /** @deprecated Edge move-auth path — only reachable when `roomAuthority` is false. */
    moveAuth?: {
        submitMove: (p: {
            matchId: string;
            color: PlayerColor;
            tokenIndex: number;
            rollId: string;
            expectedSeq: number;
            source?: 'player' | 'host-assist';
            actorOverride?: string;
        }) => Promise<{ ok: boolean; seq?: number; state?: GameState; captured?: boolean; bonusRoll?: boolean; error?: string; code?: MatchActionErrorCode }>;
        passTurn: (p: {
            matchId: string;
            rollId: string;
            expectedSeq: number;
            source?: 'player' | 'host-assist';
            /** Removed (SEC-18): the engine derives pass legality server-side. */
        }) => Promise<{ ok: boolean; seq?: number; state?: GameState; error?: string; code?: MatchActionErrorCode }>;
        submitPower: (p: {
            matchId: string;
            color: PlayerColor;
            power: PowerType;
            tokenIndex?: number | null;
            expectedSeq: number;
            source?: 'player' | 'host-assist';
        }) => Promise<{ ok: boolean; seq?: number; state?: GameState; error?: string; code?: MatchActionErrorCode; message?: string; armed?: string; kept?: boolean }>;
        /** Authoritative snapshot fetch — recovery path when a write is refused. */
        getMatchState?: (matchId: string) => Promise<{ ok: boolean; seq?: number; state?: GameState; error?: string }>;
        /**
         * SEC-01: mint a dice receipt through the match session. No face
         * parameter exists on purpose — the Edge function is the only source.
         */
        requestRoll?: (p: { matchId: string; seatColor: PlayerColor; roomCode?: string }) => Promise<{ ok: boolean; result?: number; rollId?: string | null; error?: string }>;
    };
    /** Latest server seq (match_states). */
    serverSeqRef: React.MutableRefObject<number>;
    /** Last Edge roll receipt id for the current turn. */
    lastRollIdRef: React.MutableRefObject<string | null>;
    /** P4: push Edge results into TeamUpContext match_states cache. */
    applyServerState?: (state: GameState, seq: number) => void;
}


export function useGameActions({
    localGameState,
    setLocalGameState,
    initialPlayers,
    address,
    isLobbyConnected,
    roomAuthority,
    sendRoomIntent,
    broadcastAction,
    sendIntent,
    playerCount,
    colorCorner,
    activeColorsArr,
    audio,
    triggerWinConfetti,
    recordWin,
    autoMoveTimeoutRef,
    startBettingWindow,
    moveAuth,
    serverSeqRef,
    lastRollIdRef,
    applyServerState,
}: UseGameActionsProps) {


    const _bettingWindowIdRef = useRef<string | null>(null);
    const rollingRef = useRef<boolean>(false);
    const serverActionPendingRef = useRef(false);
    const roomAutoMoveKeyRef = useRef<string>('');
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
        // ── Room authority (TU-4) ────────────────────────────────────────
        // The MatchRoom resolves the move, commits it atomically and fans the new
        // state out to every socket. This client sends an intent and renders the
        // broadcast — it does not merge a response into its own board, so there is
        // no second copy of the rules to drift from the authority.
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
                const code = (res.data as { code?: string } | undefined)?.code;
                if (!res.ok && code !== 'POWER_ARMED') {
                    console.warn('🏟️ [Room] move rejected:', code);
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
        const isActingBot = Boolean(actingPlayerInfo?.isAi || currentState.afkStats?.[actingSeat]?.isKicked);

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
        // Shields last until the owner's next move completes.
        finalState.activeShields = (currentState.activeShields || []).filter(
            (s) => s.color !== currentState.currentPlayer
        );

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
                    audio.playPickup();
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

        if (newState.positions[color][tokenIndex] !== currentState.positions[color][tokenIndex]) audio.playMove();
        if (captured) audio.playCapture();
        if (newState.winner && !currentState.winner) {
            audio.playWin();
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
                ? DICE_ROLL_SIX
                : movedDelta > 0 && movedDelta <= 6
                  ? movedDelta
                  : steps;
            const settleBufferMs = computeMoveSettleBufferMs(settleSteps, pendingBoostDice !== null);
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
    }, [isLobbyConnected, roomAuthority, sendRoomIntent, sendIntent, broadcastAction, audio, playerCount, activeColorsArr, colorCorner, setLocalGameState, autoMoveTimeoutRef, triggerWinConfetti, recordWin, moveAuth, serverSeqRef, lastRollIdRef, address, initialPlayers, applyServerState, getNextPlayer]);

    moveTokenRef.current = moveToken;

    /**
     * Pull the authoritative snapshot after a refused write (403 wrong turn,
     * 409 seq race, transport failure) so a single divergence cannot leave the
     * board showing a turn the server has already moved past.
     */
    const resyncFromServer = useCallback(async (matchId: string) => {
        if (!moveAuth?.getMatchState) return;
        try {
            const snap = await moveAuth.getMatchState(matchId);
            if (!snap.ok || !snap.state) return;
            serverSeqRef.current = snap.seq ?? serverSeqRef.current;
            lastRollIdRef.current = null;
            rollingRef.current = false;
            applyServerState?.(snap.state, snap.seq ?? serverSeqRef.current);
            setLocalGameState(prev => ({
                ...prev,
                ...snap.state!,
                isRolling: false,
                timeLeft: 15,
                lastUpdate: Date.now(),
            }));
        } catch (err) {
            console.warn('🔄 [Engine] resync failed', err);
        }
    }, [moveAuth, serverSeqRef, lastRollIdRef, applyServerState, setLocalGameState]);

    // No `value` parameter, by design. A roll face is never an input to this
    // function: it comes from Edge `roll-dice` for a networked seat, or local
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
        const color = localGameState.currentPlayer;
        const currentPlayerInfo = initialPlayers.find(p => p.color === color);
        const isCurrentlyBot = currentPlayerInfo?.isAi || localGameState.afkStats?.[color]?.isKicked;
        
        // In a networked match, bots are rolled by the server room DO.
        if (!isRemote && isLobbyConnected && isCurrentlyBot) {
            rollingRef.current = false;
            return 'failed';
        }

        // Degraded fallback intent when server room DO is not yet open
        if (isLobbyConnected && !roomAuthority && !isRemote) {
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
                setLocalGameState((prev) => ({ ...prev, isRolling: false, diceValue: null }));
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
            // Networked matches are server-authoritative: the turn must also
            // advance in match_states, or every later move is rejected with
            // 403 'Not this color turn' and the match wedges permanently.
            const passRollId = lastRollIdRef.current;
            const networkedPass = isLobbyConnected && !!moveAuth && !!matchId && matchId !== 'local' && !!passRollId;
            if (networkedPass) {
                // Bot/AFK seats are advanced by the host; humans pass for themselves.
                const passSeat = initialPlayers.find(p => p.color === pTargetColor);
                const passIsBot = passSeat?.isAi || !!stateRef.current.afkStats?.[pTargetColor]?.isKicked;
                const passSource: 'player' | 'host-assist' =
                    passIsBot ? 'host-assist' : 'player';
                serverActionPendingRef.current = true;
                try {
                    const pass = await moveAuth!.passTurn({
                        matchId: matchId!,
                        rollId: passRollId!,
                        expectedSeq: serverSeqRef.current,
                        source: passSource,
                    });
                    if (pass.ok && pass.state) {
                        // NET-02: applyServerState owns the ref; no local write.
                        lastRollIdRef.current = null;
                        rollingRef.current = false;
                        applyServerState?.(pass.state, pass.seq ?? serverSeqRef.current);
                        setLocalGameState((latest) => ({
                            ...latest,
                            ...pass.state!,
                            diceValue: null,
                            gamePhase: 'rolling',
                            timeLeft: 15,
                            lastUpdate: Date.now(),
                        }));
                        if (broadcastAction) broadcastAction('ENGINE_STATE', {}, pass.state!);
                    } else {
                        // Server refused the pass (usually a seq race). Recover
                        // from the authoritative snapshot instead of wedging.
                        await resyncFromServer(matchId!);
                    }
                } catch (err) {
                    console.warn('🎲 [Engine] networked pass failed, resyncing', err);
                    await resyncFromServer(matchId!);
                } finally {
                    serverActionPendingRef.current = false;
                }
                return 'failed';
            }
            // Instant pass: no dead time when nobody can move
            setLocalGameState((latest) => {
                const switchState: GameState = {
                    ...latest,
                    currentPlayer: pNextPlayer ?? latest.currentPlayer,
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
    }, [isLobbyConnected, roomAuthority, sendRoomIntent, sendIntent, broadcastAction, setLocalGameState, initialPlayers, localGameState.winner, localGameState.isRolling, localGameState.diceValue, localGameState.currentPlayer, localGameState.afkStats, startBettingWindow, playerCount, getNextPlayer, moveToken, address, moveAuth, serverSeqRef, lastRollIdRef, applyServerState, resyncFromServer]);

    const handleUsePower = useCallback(async (color: PlayerColor, type?: PowerType, tokenIdx?: number) => {
        const prev = stateRef.current;
        if (prev.status === 'finished' || prev.winner) return;
        if (!prev || prev.currentPlayer !== color || prev.gamePhase !== 'rolling') return;
        if (prev.powerSpentThisTurn) return;
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
                const code = (res.data as { code?: string } | undefined)?.code;
                if (!res.ok) {
                    if (code === 'POWER_ARMED') {
                        setLocalGameState(s => ({
                            ...s,
                            captureMessage: type === 'nuke'
                                ? 'Nuke armed — tap one of your tokens to target.'
                                : 'Teleport armed — tap one of your tokens.',
                        }));
                    } else {
                        console.warn('🏟️ [Room] power rejected:', code);
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
        // Sweep expired + read live inventory.
        const liveInv: PowerItem[] = (prev.playerPowers[myColor] || []).filter((p: PowerItem) => p.expiresAt > now);
        const pick: PowerType | undefined = type ?? (['nuke', 'shield', 'boost', 'teleport'] as PowerType[]).find(t => liveInv.some(p => p.type === t));
        if (!pick || !liveInv.some(p => p.type === pick)) return;

        const consume = (inv: PowerItem[], t: PowerType) => {
            const i = inv.findIndex(p => p.type === t);
            if (i >= 0) inv.splice(i, 1);
            return inv;
        };
        const nextState = { ...prev };
        let sound: 'nuke' | 'shield' | 'boost' | 'teleport' | null = null;
        let flash: { r: number, c: number }[] | null = null;

        if (pick === 'shield') {
            const tokensOnBoard = prev.positions[myColor]
                .map((pos: number, idx: number) => (pos >= 0 && pos < HOME_LANE_START_INDEX) ? idx : -1)
                .filter((idx: number) => idx !== -1);

            const newShields = [...prev.activeShields];
            tokensOnBoard.forEach((idx: number) => {
                if (!newShields.some((s) => s.color === myColor && s.tokenIdx === idx)) {
                    newShields.push({ color: myColor, tokenIdx: idx });
                }
            });
            nextState.activeShields = newShields;
            nextState.captureMessage = `Shield up! Safe until your next move.`;
            sound = 'shield';
        }
        else if (pick === 'nuke') {
            let idx = tokenIdx;
            if (idx === undefined) {
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
            }
            if (idx === undefined) {
                nextState.captureMessage = `Nuke armed — tap one of your tokens to target.`;
                setLocalGameState({ ...nextState, lastUpdate: Date.now() });
                return;
            }
            const { victims, cells } = countNukeVictims(prev, myColor, idx, colorCorner, playerCount);
            if (victims.length === 0) {
                nextState.captureMessage = `No targets in blast range — nuke kept.`;
                setLocalGameState({ ...nextState, lastUpdate: Date.now() });
                return;
            }
            const newPositions = { ...prev.positions };
            const prevStats = prev.matchStats ?? {
                green: { kicks: 0, gotKicked: 0 },
                red: { kicks: 0, gotKicked: 0 },
                yellow: { kicks: 0, gotKicked: 0 },
                blue: { kicks: 0, gotKicked: 0 },
            };
            const nextStats = {
                green: { ...prevStats.green },
                red: { ...prevStats.red },
                yellow: { ...prevStats.yellow },
                blue: { ...prevStats.blue },
            };
            victims.forEach(v => {
                newPositions[v.color] = [...newPositions[v.color]];
                newPositions[v.color][v.idx] = BASE_INDEX;
                nextStats[myColor].kicks += 1;
                nextStats[v.color].gotKicked += 1;
            });
            nextState.positions = newPositions;
            nextState.matchStats = nextStats;
            nextState.nukeFlash = cells;
            nextState.captureMessage = `NUKE! ${victims.length} token${victims.length === 1 ? '' : 's'} vaporized!`;
            sound = 'nuke';
            flash = cells;
        }
        else if (pick === 'boost') {
            nextState.activeBoost = myColor;
            nextState.captureMessage = 'BOOST! Next roll grants an extra 6 first, then your roll.';
            sound = 'boost';
        }
        else if (pick === 'teleport') {
            let idx = tokenIdx;
            if (idx === undefined) {
                // Foremost on-board token.
                let bestPos = -1;
                prev.positions[myColor].forEach((p: number, i: number) => {
                    if (p >= 0 && p < BOARD_FINISH_INDEX && p > bestPos) {
                        bestPos = p;
                        idx = i;
                    }
                });
            }
            if (idx === undefined) {
                nextState.captureMessage = `Teleport armed — tap one of your tokens.`;
                setLocalGameState({ ...nextState, lastUpdate: Date.now() });
                return;
            }
            const from = prev.positions[myColor][idx];
            let dest = -1;
            if (from >= 49 && from <= 56) {
                dest = BOARD_FINISH_INDEX;
            } else if (from >= 0 && from < HOME_LANE_START_INDEX) {
                dest = nearestStarAhead(from, myColor, colorCorner);
            }
            if (dest < 0) {
                nextState.captureMessage = `Nowhere to blink — teleport kept.`;
                setLocalGameState({ ...nextState, lastUpdate: Date.now() });
                return;
            }
            const newPos = { ...prev.positions };
            newPos[myColor] = [...newPos[myColor]];
            newPos[myColor][idx] = dest;
            nextState.positions = newPos;
            nextState.captureMessage = dest === BOARD_FINISH_INDEX ? `TELEPORT! Straight home!` : `TELEPORT! Blinked to safety.`;
            sound = 'teleport';
        }

        // Spend: consume one item, lock the turn's power budget.
        nextState.playerPowers = {
            ...prev.playerPowers,
            [myColor]: consume([...liveInv], pick)
        };
        nextState.powerSpentThisTurn = true;
        nextState.lastUpdate = Date.now();
        setLocalGameState(nextState);

        if (sound === 'nuke') audio.playNuke();
        else if (sound === 'shield') audio.playShield();
        else if (sound === 'boost') audio.playBoost();
        else if (sound === 'teleport') audio.playTeleport();

        // Clear the blast flash after the drama lands.
        if (flash) {
            setTimeout(() => {
                setLocalGameState((latest) => ({ ...latest, nukeFlash: [], lastUpdate: Date.now() }));
            }, 1400);
        }
    }, [playerCount, colorCorner, audio, setLocalGameState, isLobbyConnected, roomAuthority, sendRoomIntent, moveAuth, serverSeqRef, address, initialPlayers, applyServerState, lastRollIdRef, resyncFromServer, sendIntent]);

    const handleTokenClick = useCallback((color: PlayerColor, tokenIndex: number) => {
        if (localGameState.gamePhase !== 'moving' || localGameState.diceValue === null) return;

        const actingPlayerColor = localGameState.currentPlayer;
        const myPlayer =
            initialPlayers.find(p => address && p.walletAddress?.toLowerCase() === address.toLowerCase()) ||
            initialPlayers.find(p => !p.isAi);
        const myColor = myPlayer?.color;
        const isMyTurn = actingPlayerColor === myColor;
        const isCurrentlyBot = initialPlayers.find(p => p.color === actingPlayerColor)?.isAi;

        const teammateColor = getTeammateColor(myColor as PlayerColor, playerCount);
        const allMyTokensFinished = myColor ? localGameState.positions[myColor].every((pos: number) => pos === BOARD_FINISH_INDEX) : false;
        const isTeammateAssist = playerCount === '2v2' && color === teammateColor && allMyTokensFinished && isMyTurn;

        if (!isMyTurn) return;
        if (isCurrentlyBot) return;
        if (color !== myColor && !isTeammateAssist) return;

        if (isLobbyConnected && !roomAuthority) {
            sendIntent('REQUEST_MOVE', { color, tokenIndex });
            return;
        }

        moveToken(color, tokenIndex, localGameState.diceValue);
    }, [localGameState.gamePhase, localGameState.diceValue, localGameState.currentPlayer, localGameState.positions, playerCount, isLobbyConnected, roomAuthority, sendIntent, moveToken, address, initialPlayers]);

    // Immediate auto-move for room-authoritative seats when only 1 legal move exists
    // (covering normal rolls as well as Boost Step 1 and Step 2).
    useEffect(() => {
        if (!roomAuthority) return;
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
        const isBot = initialPlayers.find((p) => p.color === actingColor)?.isAi || localGameState.afkStats?.[actingColor]?.isKicked;
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

        const timer = setTimeout(() => {
            void moveTokenRef.current(targetColor, legal[0], diceVal);
        }, 180);
        return () => clearTimeout(timer);
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
