/* eslint-disable @typescript-eslint/no-unused-vars -- lint burn-down quarantine 2026-09-23 */
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useChainId } from 'wagmi';
import { usePlayerSigner } from '@/hooks/usePlayerSigner';
import confetti from 'canvas-confetti';
import { useTeamUpContext } from '@/hooks/TeamUpContext';
import { PlayerColor, PowerType, BotDifficulty, GameState, GameIntent } from '@/lib/types';
import { Point, PathCell, ColorCorner, assignCornersFFA, assignCorners2v2, buildPlayerPaths, shufflePlayers } from '@/lib/boardLayout';
import { recordMatchResult } from '@/lib/matchRecorder';
import { useAudio } from '../app/hooks/useAudio';
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
import { resetNetCounters } from '@/lib/netcode/counters';
import { shouldFlushServerState } from '@/lib/netcode/flushGate';
import { computeAuthority } from '@/lib/netcode/authorityGate';
import { hostActionForIntent } from '@/lib/hostIntent';

// Specialized Hooks
import { useGameActions } from './useGameActions';
import { useGameTimer } from './useGameTimer';
import { useAFKManager } from './useAFKManager';
import { useAIBrain } from './useAIBrain';
import { useMoveAuth } from './useMoveAuth';

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
}

interface UseGameEngineProps {
    initialPlayers: Player[];
    playerCount: '1v1' | '4P' | '2v2';
    gameMode: 'classic' | 'power' | 'snakes';
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
    const { playMove, playCapture, playWin, playTurn, playNuke, playShield, playBoost, playTeleport, playPickup } = useAudio();
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
        isHost,
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
        abandonGraceFor
    } = useTeamUpContext();
    
    // 3. Authority Logic (Determines who orchestrates AI and AFK turns)
    // In multiplayer, authority rests with the P2P Host (or Compute Host if P2P Host leaves).
    // In offline matches, the local player always has authority.
    const isNetworkedMatch = isLobbyConnected
        || isHost
        || isComputeHost
        || Boolean(networkGameState?.matchId && networkGameState.matchId !== 'local');
    // NET-07: a compute host orchestrates only when it can PROVE it knows the
    // current board. A snapshot-less election would otherwise let a client
    // that merely joined the presence channel drive AI/AFK turns from an empty
    // state — which is how a match gets wedged rather than saved. Executed by
    // `test:netcode` through `computeAuthority`, not re-derived here.
    const isAuthority = computeAuthority({
        isNetworkedMatch,
        isHost,
        isComputeHost,
        connectionStatus: matchConnectionStatus,
        hasAuthoritativeSnapshot,
    });

    const [localGameState, setLocalGameState] = useState<GameState>({
        ...INITIAL_GAME_STATE,
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
        lastUpdate: Date.now()
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
        const isMeKicked = myPlayer ? localGameState.afkStats[myPlayer.color].isKicked : false;
        
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
        const duration = 5 * 1000;
        const animationEnd = Date.now() + duration;
        const defaults = { startVelocity: 30, spread: 360, ticks: 60, zIndex: 0, colors: ['#A8E6CF', '#FFD3B6', '#D4F1F4', '#FFEFBA'] };

        const randomInRange = (min: number, max: number) => Math.random() * (max - min) + min;

        const interval = setInterval(function () {
            const timeLeft = animationEnd - Date.now();
            if (timeLeft <= 0) return clearInterval(interval);

            const particleCount = 50 * (timeLeft / duration);
            confetti({ ...defaults, particleCount, origin: { x: randomInRange(0.1, 0.3), y: Math.random() - 0.2 } });
            confetti({ ...defaults, particleCount, origin: { x: randomInRange(0.7, 0.9), y: Math.random() - 0.2 } });
        }, 250);
    }, []);

    const lastRollIdRef = useRef<string | null>(null);
    const chainId = useChainId();
    const moveAuth = useMoveAuth({ myAddress: player.address ?? address, signMessageAsync, signTypedDataAsync, chainId });

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
        isHost: isAuthority,
        isLobbyConnected,
        broadcastAction,
        sendIntent,
        playerCount,
        colorCorner,
        activeColorsArr,
        audio: useMemo(() => ({ playMove, playCapture, playWin, playNuke, playShield, playBoost, playTeleport, playPickup }), [playMove, playCapture, playWin, playNuke, playShield, playBoost, playTeleport, playPickup]),
        triggerWinConfetti,
        recordWin,
        autoMoveTimeoutRef,
        startBettingWindow,
        moveAuth,
        serverSeqRef,
        lastRollIdRef,
        applyServerState,
    });

    useGameTimer({
        localGameState,
        setLocalGameState,
        matchConnectionStatus,
        isNetworked: isLobbyConnected,
        hasAuthoritativeSnapshot,
    });

    useAFKManager({
        localGameState,
        setLocalGameState,
        initialPlayers,
        handleRoll,
        moveToken,
        getNextPlayer,
        broadcastAction,
        isHost: isAuthority,
        colorCorner,
        matchConnectionStatus,
        moveAuth,
        serverSeqRef,
        lastRollIdRef,
        applyServerState,
        isLobbyConnected,
        // NET-07: the kick IS the abandon signal — classify and record it from
        // the context's single classifier (grace clock + dual-sign policy).
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
        initialPlayers,
        isHost: isAuthority,
        handleRoll,
        moveToken,
        handleUsePower,
        colorCorner,
        playerCount,
        isLobbyConnected,
        matchConnectionStatus
    });

    // 🔧 FIX 4: Safety net — if gamePhase is stuck at 'landing' for >3s, force transition.
    // This catches edge cases where moveToken's turn-switch setTimeout fails to fire.
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
                console.warn('⚠️ [Engine] Landing safety net triggered! Forcing phase to rolling.');
                const nextPlayer = getNextPlayer(prev.currentPlayer);
                return {
                    ...prev,
                    gamePhase: 'rolling',
                    currentPlayer: nextPlayer,
                    diceValue: null,
                    timeLeft: 15,
                    lastUpdate: Date.now()
                };
            });
        }, 3000);
        return () => clearTimeout(safetyTimer);
    }, [localGameState.gamePhase, localGameState.winner, getNextPlayer, setLocalGameState, isNetworkedMatch]);

    // NET-12: the blanket guest sync above (setLocalGameState(networkGameState)
    // with no seq/timestamp guard) was deleted. It fired on the same commit as
    // the seq-advance effect below, so this one ran first and made that one
    // unreachable — while also clobbering the host-only local fields the
    // careful merge below preserves (powerTiles types, matchId, UI state).

    // Authorize the player's whole match as soon as the host publishes the
    // authoritative match id. This keeps the wallet prompt in the pre-match
    // transition instead of surprising the player on their first action.
    useEffect(() => {
        const matchId = networkGameState?.matchId;
        if (!isLobbyConnected || isHost || !networkGameState?.isStarted || !matchId || matchId === 'local') return;
        if (preAuthMatchRef.current === matchId) return;
        preAuthMatchRef.current = matchId;
        const provisionalKeys = [
            `room:${roomId}`,
            `search:${address?.toLowerCase()}:${gameMode}:${playerCount}`,
        ];
        const provisionalId = provisionalKeys
            .map(key => sessionStorage.getItem(`ludo-provisional:${key}`))
            .find(Boolean);
        if (provisionalId) {
            void moveAuth.bindProvisionalSession({ provisionalId, matchId, roomCode: roomId }).then(result => {
                if (!result.ok) console.warn('🔑 [MoveAuth] provisional binding failed:', result.error);
            });
            return;
        }
        void moveAuth.createMatchSession({
            matchId,
            roomCode: roomId || matchId,
        }).then(result => {
            if (!result.ok) {
                console.warn('🔑 [MoveAuth] pre-match session was not created:', result.error);
                preAuthMatchRef.current = null;
            }
        });
    }, [isLobbyConnected, isHost, networkGameState?.isStarted, networkGameState?.matchId, roomId, moveAuth]);

    const cancelAfk = useCallback((color: PlayerColor) => {
        setLocalGameState((prev) => ({
            ...prev,
            afkStats: {
                ...prev.afkStats,
                [color]: {
                    ...prev.afkStats[color],
                    isAutoPlaying: false,
                    consecutiveTurns: 0
                }
            },
            idleWarning: prev.idleWarning?.player === color ? null : prev.idleWarning
        }));
    }, []);

    const toggleAutoPlay = useCallback((color: PlayerColor, forceTrust: boolean = false) => {
        setLocalGameState((prev) => {
            const nextState = {
                ...prev,
                afkStats: {
                    ...prev.afkStats,
                    [color]: {
                        ...prev.afkStats[color],
                        isAutoPlaying: forceTrust || !prev.afkStats[color].isAutoPlaying,
                        isKicked: forceTrust ? true : prev.afkStats[color].isKicked // Manual rage quit -> bot converts permanently
                    }
                }
            };
            if (isHost && isLobbyConnected) {
                broadcastAction('CMD_REQUEST_TRUST', { color, isBotTrusted: nextState.afkStats[color].isAutoPlaying, isKicked: nextState.afkStats[color].isKicked }, nextState);
            } else if (!isHost && isLobbyConnected) {
                sendIntent('CMD_REQUEST_TRUST', { color, isBotTrusted: nextState.afkStats[color].isAutoPlaying, isKicked: nextState.afkStats[color].isKicked });
            }
            return nextState;
        });
    }, [isHost, isLobbyConnected, broadcastAction, sendIntent]);

    // 📬 Listen for Guest Intents (Host only)
    useEffect(() => {
        // NET-07: `isAuthority`, not raw `isHost` — a compute host that is
        // serving as the authority during a host outage must consume intents,
        // or guests' actions are silently dropped for the whole outage.
        if (isAuthority && lastIntent) {
            // The roll/move decision is hostActionForIntent (lib/hostIntent.ts),
            // executed under scripts/host-intent.test.ts. No face is ever read
            // from the payload here — see that module for the invariant.
            const action = hostActionForIntent(lastIntent, localGameState.diceValue);
            console.log('📬 [Host] Processing Intent:', lastIntent.type, action);

            if (action.kind === 'roll') {
                handleRoll();
            } else if (action.kind === 'move') {
                moveToken(action.color, action.tokenIndex, action.diceValue);
            } else if (action.kind === 'trust') {
                toggleAutoPlay(action.color, action.isKicked);
            } else if (action.kind === 'ignore') {
                // NET-04: declined (bad payload / no committed face). Do NOT
                // dequeue — dropping it silently lost the guest's intent with
                // no ACK and no retry. The guest's ACK watch resends it, or a
                // later state change (a committed face) lets the same intent
                // apply on the next effect run.
                return;
            }

            clearIntent();
        }
    }, [isAuthority, lastIntent, handleRoll, moveToken, toggleAutoPlay, clearIntent, localGameState.diceValue]);

    const resetGame = useCallback(() => {
        const newCC = playerCount === '2v2' ? assignCorners2v2() : assignCornersFFA(playerCount as '1v1' | '4P');
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
            lastUpdate: Date.now()
        });
    }, [playerCount, gameMode, pathCells, isBotMatch, botDifficulty, setBoardConfig, initialPlayers]);

    useEffect(() => {
        if (localGameState.winner) return;
        const currentPlayerInfo = initialPlayers.find(p => p.color === localGameState.currentPlayer);
        const isCurrentlyBot = currentPlayerInfo?.isAi || localGameState.afkStats[localGameState.currentPlayer].isKicked;
        if (!isCurrentlyBot && localGameState.gamePhase === 'rolling' && !localGameState.afkStats[localGameState.currentPlayer].isAutoPlaying) {
            playTurn();
        }
    }, [localGameState.currentPlayer, localGameState.winner, localGameState.afkStats, playTurn, localGameState.gamePhase, initialPlayers]);

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
            isHost,
            isLobbyConnected,
        });
        if (decision === 'flush') {
            flushedMatchIdRef.current = ctxMatchId ?? null;
            updateGameState(localGameState);
        } else if (decision === 'reset') {
            flushedMatchIdRef.current = null;
        }
    }, [isHost, isLobbyConnected, localGameState.matchId, localGameState.isStarted, updateGameState]);

    // Networked guests copy only the server snapshot cached by TeamUpContext.
    useEffect(() => {
        if (!isHost && isLobbyConnected && networkGameState && networkGameState.lastUpdate > localGameState.lastUpdate) {
            setLocalGameState(prev => ({
                ...prev,
                ...networkGameState,
                isStarted: prev.isStarted || networkGameState.isStarted,
                matchId: networkGameState.matchId || prev.matchId,
                // Preserve local-only UI fields
                powerTiles: networkGameState.powerTiles?.length
                    ? networkGameState.powerTiles
                    : prev.powerTiles,
            }));
            if (networkGameState.lastAction?.type === 'MOVE_TOKEN') playMove();
        }
    }, [isHost, isLobbyConnected, networkGameState, localGameState.lastUpdate, playMove]);

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
        toggleAutoPlay,
        resetGame,
        getNextPlayer,
        isAuthority
    };
}
