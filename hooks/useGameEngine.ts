/* eslint-disable @typescript-eslint/no-unused-vars -- lint burn-down quarantine 2026-09-23 */
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useChainId } from 'wagmi';
import { usePlayerSigner } from '@/hooks/usePlayerSigner';
import confetti from 'canvas-confetti';
import { prefersReducedMotion } from '@/lib/motion';
import { useTeamUpContext } from '@/hooks/TeamUpContext';
import { PlayerColor, PowerType, BotDifficulty, GameState, GameIntent, SeatPresenceState } from '@/lib/types';
import { Point, PathCell, ColorCorner, assignCornersForShape, shufflePlayers } from '@/lib/boardLayout';
import { recordMatchResult } from '@/lib/matchRecorder';
import {
    INITIAL_GAME_STATE,
    getTeammateColor,
    getNextPlayer as getNextPlayerCore,
    rollPowerType
} from '@/lib/gameLogic';
import { 
    BOARD_FINISH_INDEX, 
    DEFAULT_TURN_TIMER_SECS, 
    POWER_TILES_COUNT 
} from '@/lib/constants';
import { activeColorsForTurns } from '@/lib/engine';
import { clearShieldsOnTurnChange, createInitialPositions } from '@/lib/engine/core';
import {
    createInitialAfkStatsMap,
    isSeatInTier1Afk,
    isSeatPermanentlyLocked,
    normalizeSeatAfkStats,
} from '@/lib/afkPolicy';
import { resetNetCounters } from '@/lib/netcode/counters';
import { shouldFlushServerState } from '@/lib/netcode/flushGate';
import { computeAuthority, resolveMatchAuthorityMode, type MatchAuthorityMode } from '@/lib/netcode/authorityGate';
import { hostActionForIntent } from '@/lib/hostIntent';

// Specialized Hooks
import { useGameActions } from './useGameActions';
import { useGameTimer } from './useGameTimer';
import { useAFKManager } from './useAFKManager';
import { useAIBrain } from './useAIBrain';

export interface Player {
    name: string;
    level: number;
    lxp?: number;
    rxp?: number;
    avatar: string;
    color: 'green' | 'red' | 'yellow' | 'blue';
    position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
    isAi?: boolean;
    walletAddress?: string;
    clanTag?: string;
    clan_tag?: string;
}

interface UseGameEngineProps {
    initialPlayers: Player[];
    playerCount: '1v1' | '4P' | '2v2';
    gameMode: 'classic' | 'power' | 'quick';
    isBotMatch: boolean;
    botDifficulty?: BotDifficulty;
    colorCorner: ColorCorner;
    pathCells: PathCell[];
    setBoardConfig: React.Dispatch<React.SetStateAction<{
        players: Player[];
        colorCorner: ColorCorner;
    }>>;
    wager?: number;
}

export function useGameEngine({
    initialPlayers,
    playerCount,
    gameMode,
    isBotMatch,
    botDifficulty = 'pro',
    colorCorner,
    pathCells,
    setBoardConfig,
    wager = 0,
}: UseGameEngineProps) {
    const [lxpGain, setLxpGain] = useState<number | null>(null);
    // Effective identity (wallet or guest id) — guests must resolve as the
    // human seat, never as bots.
    const { address, isGuest } = useCurrentUser();
    const player = usePlayerSigner();
    const signAccount = (player.address ?? address) as `0x${string}`;
    const { signMessageAsync, signTypedDataAsync } = player;
    const hasRecordedWin = useRef<boolean>(false);
    const preAuthMatchRef = useRef<string | null>(null);
    const autoMoveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    const activeColorsArr = useMemo(() => initialPlayers.map(p => p.color as PlayerColor), [initialPlayers]);

    const {
        gameState: networkGameState,
        isComputeHost,
        sendIntent,
        broadcastAction,
        roomId,
        isLobbyConnected,
        updateGameState,
        lastIntent,
        clearIntent,
        startBettingWindow,
        // NET-02: the TeamUpContext ref IS the seq of record. useGameEngine
        // used to hold a private `useRef(0)`, so the AFK manager and the
        // actions hook could write a seq the context never saw — and a
        // rejected action could look "current" after a resync.
        serverSeqRef,
        serverSeq,
        applyServerState,
        matchConnectionStatus,
        hasAuthoritativeSnapshot,
        classifyAndRecordAbandon,
        recordDisconnect,
        clearDisconnect,
        abandonGraceFor,
        roomAuthority,
        roomStatus,
        sendRoomIntent,
        getRoomServerNow,
    } = useTeamUpContext();

    const [localGameState, setLocalGameState] = useState<GameState>(() => {
        const now = Date.now();
        return {
            ...INITIAL_GAME_STATE,
            afkStats: createInitialAfkStatsMap(),
            positions: createInitialPositions(colorCorner, gameMode),
            gameMode,
            botDifficulty,
            currentPlayer: (initialPlayers[0]?.color as PlayerColor) || 'green',
            // ENG-11: mint the respawn seed once per match; it commits via the
            // seed digest and is the sole entropy for replacement-tile spawns.
            powerTileSeed: (Math.random() * 0x100000000) >>> 0,
            powerTiles: (gameMode === 'power' ? pathCells
                .filter(c => c.cls === 'board-cell')
                .sort(() => Math.random() - 0.5)
                .slice(0, POWER_TILES_COUNT)
                .map(c => ({ r: c.row, c: c.col, type: rollPowerType() })) : []),
            matchStartedAt: now,
            lastUpdate: now,
        };
    });

    // 3. Authority Logic & ADR-02 Strict Mode Partitioning ('room' | 'p2p' | 'offline')
    const effectiveMatchId = networkGameState?.matchId || localGameState.matchId || null;
    const isLocalMatchId = !effectiveMatchId || effectiveMatchId === 'local' || effectiveMatchId.startsWith('local-');
    const latchedAuthorityRef = useRef<{ matchId: string; mode: MatchAuthorityMode } | null>(null);
    const roomSignalId =
        !isBotMatch &&
        (roomAuthority || (roomStatus !== 'idle' && Boolean(effectiveMatchId || roomId || networkGameState?.isStarted)))
            ? (!isLocalMatchId && effectiveMatchId ? effectiveMatchId : '__room_pending__')
            : null;
    if (roomSignalId) {
        if (!latchedAuthorityRef.current || latchedAuthorityRef.current.matchId !== roomSignalId) {
            latchedAuthorityRef.current = { matchId: roomSignalId, mode: 'room' };
        }
    }
    const latchedMode: MatchAuthorityMode | null =
        latchedAuthorityRef.current &&
        !isBotMatch &&
        !isLocalMatchId &&
        (latchedAuthorityRef.current.matchId === effectiveMatchId || latchedAuthorityRef.current.matchId === '__room_pending__')
            ? latchedAuthorityRef.current.mode
            : null;

    const isNetworkedMatch = isLobbyConnected
        || isComputeHost
        || roomAuthority
        || latchedMode === 'room'
        || (!isBotMatch && roomStatus !== 'idle')
        || (!isBotMatch && !isLocalMatchId);

    const matchAuthorityMode = resolveMatchAuthorityMode({
        latchedMode,
        roomAuthority,
        hasRoomConnection: !isBotMatch && roomStatus !== 'idle',
        isNetworkedMatch,
        matchId: effectiveMatchId,
    });

    const isAuthority = computeAuthority({
        isNetworkedMatch,
        isHost: false,
        isComputeHost,
        connectionStatus: matchConnectionStatus,
        hasAuthoritativeSnapshot,
        roomVersion: matchAuthorityMode === 'room' ? 2 : 1,
    });

    const getNextPlayer = useCallback((current: PlayerColor): PlayerColor => {
        // ENG-04: the engine owns the active-colour rule. This was the fourth
        // copy of it; useGameActions had a third. All now call one function.
        const activeForTurns = activeColorsForTurns({
            ...localGameState,
            playerCount,
        } as Parameters<typeof activeColorsForTurns>[0]);

        return getNextPlayerCore(current, playerCount, activeForTurns, colorCorner);
    }, [activeColorsArr, playerCount, colorCorner, localGameState]);

    const recordWin = useCallback(async (winnerColor: Player['color']) => {
        const player = initialPlayers.find(p => p.color === winnerColor);
        if (!player) return;

        const myPlayer = initialPlayers.find(p => p.walletAddress?.toLowerCase() === address?.toLowerCase());
        const isMeKicked = myPlayer ? isSeatPermanentlyLocked(localGameState.afkStats?.[myPlayer.color]) : false;
        
        if (isMeKicked) return;

        const iAmWinner = !!address && !!player.walletAddress &&
            player.walletAddress.toLowerCase() === address.toLowerCase();
        const iPlayed = !!myPlayer && !myPlayer.isAi;

        // Truthful XP toast: win amount on win, loss amount when we participated but lost
        const winLxpGain = 150 + Math.floor(wager * 0.1);
        const lossLxpGain = 50 + Math.floor(wager * 0.05);
        setLxpGain(iAmWinner ? winLxpGain : (iPlayed ? lossLxpGain : winLxpGain));
        setTimeout(() => setLxpGain(null), 3000);

        const data = localStorage.getItem('ludo-leaderboard');
        const stats = data ? JSON.parse(data) : {};

        if (!stats[player.name]) {
            stats[player.name] = { name: player.name, color: player.color, wins: 0, lastWin: 0 };
        }

        stats[player.name].wins += 1;
        stats[player.name].lastWin = Date.now();
        stats[player.name].color = player.color;

        localStorage.setItem('ludo-leaderboard', JSON.stringify(stats));

        if (!hasRecordedWin.current && (iAmWinner || isBotMatch)) {
            hasRecordedWin.current = true;
            const humans = initialPlayers
                .map(p => p.walletAddress)
                .filter(Boolean) as string[];

            // Skip unattributable edge cases (no human involved) and guest
            // trials (guest ids have no onchain row — recording would junk
            // the match history).
            if (humans.length === 0 || isGuest || !address) return;

            // API requires a wallet signature from a listed participant.
            // When a bot won, the local human still signs as an attesting player.
            //
            // Per-player capture counts (host-authoritative `matchStats.kicks`,
            // mapped colour -> human wallet). They ride inside the signed payload
            // so the server can report daily_capture_2 / weekly_capture_10 from a
            // source the signature vouches for, instead of a client self-report.
            const captureCounts: Record<string, number> = {};
            for (const p of initialPlayers) {
                if (!p.walletAddress || p.isAi) continue;
                const kicks = localGameState.matchStats?.[p.color]?.kicks ?? 0;
                if (kicks > 0) captureCounts[p.walletAddress.toLowerCase()] = kicks;
            }

            try {
                await recordMatchResult(
                    player.walletAddress || null,
                    roomId || 'local',
                    gameMode,
                    humans,
                    localGameState.matchId,
                    (msg) => signMessageAsync({ account: signAccount, message: msg }),
                    captureCounts
                );
            } catch (err) {
                console.error('❌ [Engine] Match record signing failed', err);
            }
        }
    }, [initialPlayers, address, isGuest, roomId, gameMode, localGameState.afkStats, localGameState.matchStats, localGameState.matchId, wager, isBotMatch, signMessageAsync, signAccount]);

    const triggerWinConfetti = useCallback(() => {
        if (prefersReducedMotion()) return;
        const duration = 5 * 1000;
        const animationEnd = Date.now() + duration;
        const defaults = { startVelocity: 30, spread: 360, ticks: 60, zIndex: 0, colors: ['#A8E6CF', '#FFD3B6', '#D4F1F4', '#FFEFBA'] };

        const randomInRange = (min: number, max: number) => Math.random() * (max - min) + min;

        const interval = setInterval(function () {
            const timeLeft = animationEnd - Date.now();
            if (timeLeft <= 0 || prefersReducedMotion()) return clearInterval(interval);

            const particleCount = 50 * (timeLeft / duration);
            confetti({ ...defaults, particleCount, origin: { x: randomInRange(0.1, 0.3), y: Math.random() - 0.2 } });
            confetti({ ...defaults, particleCount, origin: { x: randomInRange(0.7, 0.9), y: Math.random() - 0.2 } });
        }, 250);
    }, []);

    const lastRollIdRef = useRef<string | null>(null);

    const {
        moveToken,
        handleRoll,
        handleUsePower,
        handleTokenClick
    } = useGameActions({
        localGameState,
        setLocalGameState,
        initialPlayers,
        address,
        isLobbyConnected,
        roomAuthority,
        matchAuthorityMode,
        sendRoomIntent,
        broadcastAction,
        sendIntent,
        playerCount,
        colorCorner,
        activeColorsArr,
        triggerWinConfetti,
        recordWin,
        autoMoveTimeoutRef,
        startBettingWindow,
        lastRollIdRef,
    });

    useGameTimer({
        localGameState,
        setLocalGameState,
        matchConnectionStatus,
        // Server-owned countdown + skew-adjusted clock across both Room DO and P2P modes.
        isNetworked: isLobbyConnected || roomAuthority || matchAuthorityMode !== 'offline',
        hasAuthoritativeSnapshot,
        getServerNow: getRoomServerNow,
        isOfflineSeatAi: Boolean(initialPlayers.find((p) => p.color === localGameState.currentPlayer)?.isAi),
    });

    useAFKManager({
        localGameState,
        setLocalGameState,
        initialPlayers,
        handleRoll,
        moveToken,
        handleUsePower,
        getNextPlayer,
        colorCorner,
        playerCount,
        matchConnectionStatus,
        matchAuthorityMode,
        // NET-07: permanent kick IS the abandon signal.
        onAbandon: ({ seat, matchEnded }) => {
            classifyAndRecordAbandon({
                accusedSeat: seat,
                hasEdgeSig: isLobbyConnected,
                hasHostSig: isAuthority,
                matchEnded,
            });
        }
    });

    useAIBrain({
        localGameState,
        setLocalGameState,
        initialPlayers,
        handleRoll,
        moveToken,
        handleUsePower,
        getNextPlayer,
        colorCorner,
        playerCount,
        isLobbyConnected: isLobbyConnected || roomAuthority || matchAuthorityMode === 'room',
        matchConnectionStatus
    });

    // 🔧 FIX 4: Safety net — if gamePhase is stuck at 'landing' for >3s, force transition.
    // This catches edge cases where moveToken's turn-switch setTimeout fails to fire.
    // Note: moveToken already wrote the authoritative post-move `currentPlayer` (preserving
    // `actingSeat` on bonus rolls / Boost Step 1, or advancing to `newState.currentPlayer`
    // otherwise), so we MUST NOT call `getNextPlayer` a second time here!
    //
    // NET-14: OFFLINE ONLY. On a networked match the landing phase is cleared by
    // the authority's response (move-auth advances `seq`), so flipping the turn
    // locally here desynced match_states from every client's board — the next
    // player's move was then refused with 403 'Not this color turn' and the
    // match wedged. Networked boards re-render from the snapshot instead.
    useEffect(() => {
        if (localGameState.gamePhase !== 'landing' || localGameState.winner) return;
        if (isNetworkedMatch) return;
        const safetyTimer = setTimeout(() => {
            setLocalGameState((prev) => {
                if (prev.gamePhase !== 'landing') return prev; // Already resolved
                console.warn('⚠️ [Engine] Landing safety net triggered! Recovering phase from landing.');
                if (prev.boostPendingDice != null) {
                    return {
                        ...prev,
                        gamePhase: 'moving',
                        diceValue: prev.boostPendingDice,
                        boostPendingDice: null,
                        powerSpentThisTurn: true,
                        timeLeft: 15,
                        lastUpdate: Date.now(),
                    };
                }
                return {
                    ...prev,
                    gamePhase: 'rolling',
                    diceValue: null,
                    boostPendingDice: null,
                    boostSubMoveBonus: false,
                    powerSpentThisTurn: false,
                    timeLeft: 15,
                    lastUpdate: Date.now()
                };
            });
        }, 3000);
        return () => clearTimeout(safetyTimer);
    }, [localGameState.gamePhase, localGameState.winner, setLocalGameState, isNetworkedMatch]);

    // Room-mode state synchronization: keep rendering latest server-authoritative snapshot.
    useEffect(() => {
        if ((!roomAuthority && matchAuthorityMode !== 'room') || !networkGameState) return;
        setLocalGameState(prev => ({
            ...prev,
            ...networkGameState,
            // ENG-11: the respawn seed is minted locally and never crosses the
            // wire — keep the local copy so replacement tiles stay stable.
            powerTileSeed: prev.powerTileSeed ?? networkGameState.powerTileSeed,
            lastUpdate: Date.now(),
        }));
    }, [roomAuthority, matchAuthorityMode, networkGameState]);

    const localStateRef = useRef<GameState>(localGameState);
    localStateRef.current = localGameState;

    const cancelAfk = useCallback((color: PlayerColor) => {
        const seatAfk = localStateRef.current.afkStats?.[color];
        if (isSeatPermanentlyLocked(seatAfk) || !isSeatInTier1Afk(seatAfk)) {
            return;
        }
        if (matchAuthorityMode === 'room') {
            if (roomAuthority) {
                void sendRoomIntent('CMD_REQUEST_TRUST', { trust: false, color });
            }
            return;
        }
        setLocalGameState((prev) => {
            const cur = normalizeSeatAfkStats(prev.afkStats?.[color]);
            if (isSeatPermanentlyLocked(cur) || !isSeatInTier1Afk(cur)) return prev;
            const now = Date.now();
            const isOwnActiveTurn = prev.currentPlayer === color;
            const nextTimeLeft = isOwnActiveTurn
                ? prev.gamePhase === 'moving'
                    ? 15
                    : 12
                : prev.timeLeft;
            const nextDurationMs = isOwnActiveTurn ? nextTimeLeft * 1000 : prev.turnDurationMs;
            const nextDeadlineAt = isOwnActiveTurn ? now + nextTimeLeft * 1000 : prev.deadlineAt;
            return {
                ...prev,
                timeLeft: nextTimeLeft,
                turnDurationMs: nextDurationMs,
                deadlineAt: nextDeadlineAt,
                idleWarning: null,
                afkStats: {
                    ...prev.afkStats,
                    [color]: {
                        ...cur,
                        mode: 'human',
                        isAutoPlaying: false,
                        consecutiveTurns: 0,
                        afkSinceAt: null,
                        afkDeadlineAt: null,
                        afkWindowMs: null,
                        presence: 'active',
                        presenceUpdatedAt: now,
                    },
                },
                lastUpdate: now,
            };
        });
    }, [matchAuthorityMode, roomAuthority, sendRoomIntent]);

    const updateLocalPresence = useCallback((color: PlayerColor, presence: SeatPresenceState) => {
        setLocalGameState((prev) => {
            const cur = normalizeSeatAfkStats(prev.afkStats?.[color]);
            if (cur.presence === presence) return prev;
            return {
                ...prev,
                afkStats: {
                    ...prev.afkStats,
                    [color]: {
                        ...cur,
                        presence,
                        presenceUpdatedAt: Date.now(),
                    },
                },
            };
        });
    }, []);

    // 📬 Listen for Guest Intents (Legacy P2P fallback Host only)
    useEffect(() => {
        if (isAuthority && lastIntent) {
            const action = hostActionForIntent(lastIntent, localGameState.diceValue);
            console.log('📬 [Host] Processing Intent:', lastIntent.type, action);

            if (action.kind === 'roll') {
                handleRoll();
            } else if (action.kind === 'move') {
                moveToken(action.color, action.tokenIndex, action.diceValue);
            } else if (action.kind === 'power') {
                void handleUsePower(action.color, action.power, action.tokenIndex);
            } else if (action.kind === 'trust') {
                if (!action.isKicked) {
                    cancelAfk(action.color);
                }
            } else if (action.kind === 'ignore') {
                return;
            }

            clearIntent();
        }
    }, [isAuthority, lastIntent, handleRoll, moveToken, handleUsePower, cancelAfk, clearIntent, localGameState.diceValue]);

    const resetGame = useCallback(() => {
        latchedAuthorityRef.current = null;
        // One seating rule for every shape, same as the room's self-seed — a
        // rematch must not seat differently from the match it replaces.
        const newCC = assignCornersForShape(playerCount);
        // Preserve seating mode: a single-human (offline/bot-seated) board stays bot-seeded;
        // real multiplayer boards keep template shuffling.
        const offlineSeeded = initialPlayers.filter(p => !p.isAi).length === 1;
        const newPlayers = shufflePlayers(playerCount, isBotMatch || offlineSeeded, newCC) as Player[];

        const prevHuman = initialPlayers.find(p => !p.isAi);
        const nextHuman = newPlayers.find(p => !p.isAi);
        if (prevHuman?.walletAddress && nextHuman) {
            nextHuman.walletAddress = prevHuman.walletAddress;
            nextHuman.name = prevHuman.name;
            nextHuman.avatar = prevHuman.avatar;
        }

        setBoardConfig({
            players: newPlayers,
            colorCorner: newCC
        });
        // NET-27: counters reset per match (rematch included).
        resetNetCounters();
        setLocalGameState({
            ...INITIAL_GAME_STATE,
            afkStats: createInitialAfkStatsMap(),
            positions: createInitialPositions(newCC, gameMode),
            gameMode,
            botDifficulty,
            currentPlayer: newPlayers[0].color,
            // ENG-11: fresh seed per match (see above).
            powerTileSeed: (Math.random() * 0x100000000) >>> 0,
            powerTiles: (gameMode === 'power' ? pathCells
                .filter(c => c.cls === 'board-cell')
                .sort(() => Math.random() - 0.5)
                .slice(0, POWER_TILES_COUNT)
                .map(c => ({ r: c.row, c: c.col, type: rollPowerType() })) : []) as { r: number, c: number, type: import('@/lib/types').PowerType }[],
            isStarted: true,
            matchStartedAt: Date.now(),
            lastUpdate: Date.now()
        });
    }, [playerCount, gameMode, pathCells, isBotMatch, botDifficulty, setBoardConfig, initialPlayers]);

    // Turn & networked-move audio cues are handled reactively by `useBoardAudio` + `TokenPiece`.

    // REA-11: the whole-state write-up used to fire on EVERY localGameState
    // change — including the ~1Hz timer ticks — pushing the entire board into
    // TeamUpContext once a second and re-rendering its whole subtree. It now
    // flushes once, on matchId arrival (the ref-stable transition that means
    // "this client joined a real match"), and never on timer churn. The
    // decision is `shouldFlushServerState` (lib/netcode/flushGate.ts) so the
    // hooks harness executes it instead of asserting on effect source.
    const flushedMatchIdRef = useRef<string | null | undefined>(null);
    useEffect(() => {
        const ctxMatchId = localGameState.matchId;
        const decision = shouldFlushServerState({
            flushedId: flushedMatchIdRef.current ?? null,
            matchId: ctxMatchId,
            isHost: false,
            isLobbyConnected,
        });
        if (decision === 'flush') {
            flushedMatchIdRef.current = ctxMatchId ?? null;
            updateGameState(localGameState);
        } else if (decision === 'reset') {
            flushedMatchIdRef.current = null;
        }
    }, [isLobbyConnected, localGameState.matchId, localGameState.isStarted, updateGameState]);

    // Networked clients copy only the server snapshot cached by TeamUpContext.
    useEffect(() => {
        if (isLobbyConnected && networkGameState && networkGameState.lastUpdate > localGameState.lastUpdate) {
            setLocalGameState(prev => {
                // PW-3: power inventory is per-seat private state. A shared broadcast
                // carries every colour with `type` stripped, so a blanket spread wiped
                // the guest's OWN hand as well — the guest then held nothing usable.
                // Take only this client's colour from the wire (delivered by the
                // targeted POWER_HAND message) and keep every other seat local.
                const myColor = initialPlayers.find(
                    p => p.walletAddress?.toLowerCase() === address?.toLowerCase(),
                )?.color;
                const myHand = myColor ? networkGameState.playerPowers?.[myColor] : undefined;
                return {
                    ...prev,
                    ...networkGameState,
                    playerPowers: myColor && myHand
                        ? { ...prev.playerPowers, [myColor]: myHand }
                        : prev.playerPowers,
                    isStarted: prev.isStarted || networkGameState.isStarted,
                    matchId: networkGameState.matchId || prev.matchId,
                    // Preserve local-only UI fields
                    powerTiles: networkGameState.powerTiles?.length
                        ? networkGameState.powerTiles
                        : prev.powerTiles,
                };
            });
            // Move hop & land audio is handled by TokenPiece + useBoardAudio.
        }
    }, [isLobbyConnected, networkGameState, localGameState.lastUpdate, initialPlayers, address]);

    // Host: pull matchId from TeamUpContext (seeded on START_GAME) so Edge
    // rolls/moves are not stuck on match_id='local'.
    useEffect(() => {
        const ctxMatchId = networkGameState?.matchId;
        if (ctxMatchId && localGameState.matchId !== ctxMatchId) {
            setLocalGameState(prev => ({ ...prev, matchId: ctxMatchId, lastUpdate: Date.now() }));
        }
    }, [networkGameState?.matchId, localGameState.matchId]);

    return {
        gameState: localGameState,
        lxpGain,
        handleRoll,
        handleTokenClick,
        handleUsePower,
        cancelAfk,
        updateLocalPresence,
        sendRoomIntent,
        roomAuthority,
        getRoomServerNow,
        resetGame,
        getNextPlayer,
        isAuthority,
        matchAuthorityMode,
    };
}
