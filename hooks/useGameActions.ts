import { useCallback, useRef, useEffect } from 'react';
import { PlayerColor, PowerType, PowerItem, GameState, GameStateSetter, BetType, GameActionType, GameIntentType, GameIntentPayloads, GameActionPayload } from '@/lib/types';
import { processMove, getTeammateColor, handleThreeSixes, getNextPlayer as getNextPlayerCore, nearestStarAhead, getLegalTokenIndices } from '@/lib/gameLogic';
import { activeColorsForTurns } from '@/lib/engine';
import { applyPowerPickup, sweepExpiredPowers } from '@/lib/engine/core';
import { countNukeVictims } from '@/lib/aiEngine';
import { Player } from './useGameEngine';
import { ColorCorner } from '@/lib/boardLayout';
import {
    BOARD_FINISH_INDEX,
    BASE_INDEX,
    DICE_MAX,
    DICE_ROLL_SIX,
    HOME_LANE_START_INDEX,
} from '@/lib/constants';
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
    const stateRef = useRef(localGameState);

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

        // Boosted move: +6 steps, consumed on use (host computes; guests
        // replay the broadcast steps without re-adding).
        const boosted = !isRemote && currentState.activeBoost === currentState.currentPlayer;
        const effSteps = boosted ? steps + DICE_MAX : steps;

        const { newState, captured } = processMove(
            currentState,
            color,
            tokenIndex,
            effSteps,
            playerCount,
            colorCorner,
            currentState.currentPlayer,
            activeColorsArr
        );

        let pTurnSwitchPending = false;
        let pNextPlayer: PlayerColor | null = null;
        const isBonusTurn = (steps === DICE_ROLL_SIX || captured || newState.winner);

        const finalState: GameState = {
            ...currentState,
            ...newState,
            // REA-10: the bonus-turn holder is written on the FRESH state, not
            // on the aliased `newState` returned by processMove (mutating the
            // engine's return value).
            currentPlayer: (isBonusTurn && !currentState.winner) ? color : newState.currentPlayer,
            diceValue: isBonusTurn ? null : newState.diceValue,
            captureMessage: captured ? `Captured! Bonus roll for ${color}!` : null,
            strikes: { ...currentState.strikes, [color]: 0 },
            consecutiveSixes: (newState.currentPlayer !== color) ? 0 : currentState.consecutiveSixes,
            gamePhase: 'landing' as const, // Buffer to prevent AI state stomping
            timeLeft: 15, // Reset timer during animation
            lastUpdate: Date.now()
        };

        // Boost consumed by this move — leave a motion trail on the mover.
        if (boosted) {
            finalState.activeBoost = null;
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
        // PW-4/PW-6: this used to be a third hand-written copy of the pickup rule,
        // including its own copy of the LCG reseed formula. It now delegates to the
        // engine's `applyPowerPickup`, which is the same function the room engine
        // runs — one implementation, one reseed, one set of golden tests.
        const landedPos = newState.positions[color][tokenIndex];
        {
            // The engine state type is structurally wider than `GameState` (it has an
            // index signature), so this is a pure type-boundary cast, not a conversion.
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
                    finalState.captureMessage = captured
                        ? `${finalState.captureMessage ?? ''} ${foundMsg}`.trim()
                        : foundMsg;
                    audio.playPickup();
                }
            }
        }

        // PW-5: the host is the authority, so it decides expiry — once, at the turn
        // boundary — instead of every client filtering by its own clock.
        finalState.playerPowers = sweepExpiredPowers(
            finalState as unknown as Parameters<typeof sweepExpiredPowers>[0],
        ).playerPowers as GameState['playerPowers'];

        if (!isRemote) {
            if (newState.currentPlayer !== currentState.currentPlayer || isBonusTurn) {
                pTurnSwitchPending = true;
                pNextPlayer = isBonusTurn ? color : newState.currentPlayer;
            }
        }

        setLocalGameState(finalState);

        // State travels via server room DO or local state.
        if (broadcastAction && isLobbyConnected && !isRemote) {
            broadcastAction('ENGINE_STATE', {}, finalState);
        }

        if (newState.positions[color][tokenIndex] !== currentState.positions[color][tokenIndex]) audio.playMove();
        if (captured) audio.playCapture();
        if (newState.winner && !currentState.winner) {
            audio.playWin();
            triggerWinConfetti();
            recordWin(color);
            // ENG-06: a 2v2 team win records BOTH teammates (see above).
            const mate = getTeammateColor(color, playerCount);
            if (playerCount === '2v2' && mate && newState.winner.startsWith('Team ')) {
                recordWin(mate);
            }
        }

        // 🚀 Executing side effects OUTSIDE the setLocalGameState!
        if (pTurnSwitchPending) {
            if (autoMoveTimeoutRef.current) clearTimeout(autoMoveTimeoutRef.current);
            autoMoveTimeoutRef.current = setTimeout(() => {
                // Release the roll guard — this path skips the normal-flow
                // reset, and a stuck guard deadlocks every future roll
                // (AFK auto-play then loops on strikes forever).
                rollingRef.current = false;
                setLocalGameState((latest) => {
                    const switchState: GameState = {
                        ...latest,
                        currentPlayer: pNextPlayer ?? latest.currentPlayer,
                        diceValue: null,
                        gamePhase: 'rolling', // Now it's officially the next turn
                        lastUpdate: Date.now(),
                        timeLeft: 15 // Reset for next turn
                    };
                    if (broadcastAction && isLobbyConnected) broadcastAction('ENGINE_STATE', {}, switchState);
                    return switchState;
                });
            }, 800);
        }
        return 'applied';
    }, [isLobbyConnected, sendIntent, broadcastAction, audio, playerCount, activeColorsArr, colorCorner, setLocalGameState, autoMoveTimeoutRef, triggerWinConfetti, recordWin, moveAuth, serverSeqRef, lastRollIdRef, address, initialPlayers, applyServerState]);

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

        const tumblePromise = new Promise(r => setTimeout(r, 1200));

        // 2. Generate and Set Result
        //
        // TU-4: the room mints the die (CSPRNG, in-process) and broadcasts the
        // resulting state. This client does not compute a face at all when the room
        // is the authority — it waits for the fan-out, which is what makes the roll
        // the same fact on every socket.
        if (roomAuthority) {
            await tumblePromise;
            await sendRoomIntent('REQUEST_ROLL', { seatColor: color });
            rollingRef.current = false;
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
        const rollReceiptId: string | null = null;

        // Wait for the tumble animation to finish
        await tumblePromise;

        setLocalGameState((prev) => ({
            ...prev,
            isRolling: false,
            diceValue: rollValue,
            lastUpdate: Date.now(),
            timeLeft: 15, // Reset timer during animation
            // A fresh roll opens a fresh power budget: one power per roll.
            powerSpentThisTurn: false
        }));
        
        // Brief pause for visual impact of the landing face
        await new Promise(r => setTimeout(r, 200));

        // Break the asynchronous updater cycle using stateRef
        const currentState = stateRef.current;
        if (currentState.gamePhase !== 'rolling' || currentState.winner) {
            rollingRef.current = false;
            return 'failed';
        }


        const teammate = (playerCount === '2v2') ? getTeammateColor(color, playerCount) : null;
        const isSelfFinished = currentState.positions[color].every((p: number) => p === BOARD_FINISH_INDEX);
        const targetColor = (playerCount === '2v2' && isSelfFinished && teammate) ? teammate : color;

        let pDelayedAction: 'turnSwitch' | 'autoMove' | null = null;
        let pNextPlayer: PlayerColor | null = null;
        const pTargetColor: PlayerColor = targetColor;
        let pLastValidTokenIndex = -1;
        let pFinalStateForBroadcast: GameState | null = null;

        const { isThreeSixes, nextSixes } = handleThreeSixes(currentState.consecutiveSixes, rollValue);

        if (isThreeSixes) {
            pNextPlayer = getNextPlayer(color, currentState.positions);
            pDelayedAction = 'turnSwitch';
            // 🔧 FIX 2: Use functional updater to avoid clobbering concurrent state
            setLocalGameState((prev) => {
                pFinalStateForBroadcast = { ...prev, isRolling: false, diceValue: rollValue, gamePhase: 'rolling', consecutiveSixes: 0 };
                return pFinalStateForBroadcast;
            });
        } else {
            // Engine-accurate legality (gate crossing, base exit, overshoot)
            const legalIdxs = getLegalTokenIndices(currentState.positions, targetColor, rollValue, colorCorner);
            const validMovesCount = legalIdxs.length;
            const lastValidTokenIndex = legalIdxs[legalIdxs.length - 1] ?? -1;

            if (validMovesCount === 0) {
                console.log(`🎲 [Engine] No valid moves for ${color}. Switching turn.`);
                pNextPlayer = getNextPlayer(color, currentState.positions);
                pDelayedAction = 'turnSwitch';
                // 🔧 FIX 2: Functional updater
                setLocalGameState((prev) => {
                    pFinalStateForBroadcast = { ...prev, isRolling: false, diceValue: rollValue, gamePhase: 'rolling', consecutiveSixes: nextSixes };
                    return pFinalStateForBroadcast;
                });
            } else {
                // --- Zero-Click Auto-Move Flow ---
                const allAtHome = currentState.positions[targetColor].every((p: number) => p === -1);
                const tokensOnBoard = currentState.positions[targetColor].filter((p: number) => p >= 0 && p < 57).length;
                const isForcedStart = allAtHome && rollValue === 6;
                const isSingleMove = validMovesCount === 1;
                const isEndGame = tokensOnBoard === 1 && validMovesCount === 1;

                if ((isSingleMove || isForcedStart || isEndGame) && !isRemote && !isCurrentlyBot) {
                    console.log(`🎲 [Engine] Auto-move triggered (forced=${isForcedStart}, single=${isSingleMove}, endGame=${isEndGame})`);
                    pLastValidTokenIndex = lastValidTokenIndex;
                    pDelayedAction = 'autoMove';
                    // 🔧 FIX 2: Functional updater
                    setLocalGameState((prev) => {
                        pFinalStateForBroadcast = { ...prev, isRolling: false, diceValue: rollValue, gamePhase: 'moving', consecutiveSixes: nextSixes };
                        return pFinalStateForBroadcast;
                    });
                } else {
                    // Normal Flow: Just change phase and wait for user/bot interaction
                    rollingRef.current = false;
                    // 🔧 FIX 2: Functional updater
                    setLocalGameState((prev) => {
                        pFinalStateForBroadcast = {
                            ...prev,
                            isRolling: false,
                            diceValue: rollValue,
                            gamePhase: 'moving' as const,
                            consecutiveSixes: nextSixes,
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
                moveToken(pTargetColor, pLastValidTokenIndex, rollValue);
                rollingRef.current = false;
                autoMoveTimeoutRef.current = null;
            }, 1500);
        }
        return 'applied';
    }, [isLobbyConnected, sendIntent, broadcastAction, setLocalGameState, initialPlayers, localGameState.winner, localGameState.isRolling, localGameState.diceValue, localGameState.currentPlayer, localGameState.afkStats, startBettingWindow, playerCount, getNextPlayer, moveToken, address, moveAuth, serverSeqRef, lastRollIdRef, applyServerState, resyncFromServer]);

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
            nextState.captureMessage = `BOOST! Next move +${DICE_MAX} steps.`;
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
    }, [playerCount, colorCorner, audio, setLocalGameState, isLobbyConnected, moveAuth, serverSeqRef, address, initialPlayers, applyServerState, lastRollIdRef, resyncFromServer, sendIntent]);

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
    }, [localGameState.gamePhase, localGameState.diceValue, localGameState.currentPlayer, localGameState.positions, playerCount, isLobbyConnected, sendIntent, moveToken, address, initialPlayers]);

    return {
        moveToken,
        handleRoll,
        handleUsePower,
        handleTokenClick
    };
}
