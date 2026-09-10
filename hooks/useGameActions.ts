import { useCallback, useRef, useEffect } from 'react';
import { PlayerColor, PowerType, PowerItem } from '@/lib/types';
import { processMove, getTeammateColor, handleThreeSixes, getNextPlayer as getNextPlayerCore, nearestStarAhead, rollPowerType, getLegalTokenIndices } from '@/lib/gameLogic';
import { countNukeVictims } from '@/lib/aiEngine';
import { Player } from './useGameEngine';
import { Point, ColorCorner, SAFE_POSITIONS as GLOBAL_SAFE_POINTS, getBoardCoordinate } from '@/lib/boardLayout';
import {
    BOARD_FINISH_INDEX,
    BASE_INDEX,
    DICE_MAX,
    DICE_ROLL_SIX,
    HOME_LANE_START_INDEX,
    POWER_EXPIRY_MS,
    POWER_TILES_COUNT
} from '@/lib/constants';

interface UseGameActionsProps {
    localGameState: any;
    setLocalGameState: React.Dispatch<React.SetStateAction<any>>;
    initialPlayers: Player[];
    address: string | undefined;
    isHost: boolean;
    isLobbyConnected: boolean;
    broadcastAction: (type: string, payload?: any, fullState?: any) => void;
    sendIntent: (type: string, payload?: any) => void;
    startBettingWindow: (betType: any) => Promise<string>;
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
}


export function useGameActions({
    localGameState,
    setLocalGameState,
    initialPlayers,
    address,
    isHost,
    isLobbyConnected,
    broadcastAction,
    sendIntent,
    playerCount,
    colorCorner,
    activeColorsArr,
    audio,
    triggerWinConfetti,
    recordWin,
    autoMoveTimeoutRef,
    startBettingWindow
}: UseGameActionsProps) {


    const bettingWindowIdRef = useRef<string | null>(null);
    const rollingRef = useRef<boolean>(false);
    const stateRef = useRef(localGameState);

    useEffect(() => {
        stateRef.current = localGameState;
    }, [localGameState]);

    const getNextPlayer = useCallback((current: PlayerColor, currentPositions: any): PlayerColor => {
        const activeForTurns = activeColorsArr.filter(color => {
            const hasTokens = currentPositions[color].some((p: number) => p !== BOARD_FINISH_INDEX);
            if (playerCount === '2v2') {
                const teammate = getTeammateColor(color, playerCount);
                const teammateHasTokens = teammate ? currentPositions[teammate].some((p: number) => p !== BOARD_FINISH_INDEX) : false;
                return hasTokens || teammateHasTokens;
            }
            return hasTokens;
        });

        return getNextPlayerCore(
            current,
            playerCount,
            activeForTurns,
            colorCorner
        );
    }, [activeColorsArr, playerCount, colorCorner]);

    const moveToken = useCallback((color: PlayerColor, tokenIndex: number, steps: number, isRemote = false) => {
        if (isLobbyConnected && !isHost && !isRemote) {
            console.log('🏃 [Guest] Sending REQUEST_MOVE intent');
            sendIntent('REQUEST_MOVE', { color, tokenIndex, diceValue: steps });
            return;
        }

        if (autoMoveTimeoutRef.current) {
            clearTimeout(autoMoveTimeoutRef.current);
            autoMoveTimeoutRef.current = null;
        }

        const currentState = stateRef.current;
        if (currentState.gamePhase !== 'moving' && !isRemote) return;

        // Boosted move: +6 steps, consumed on use (host computes; guests
        // replay the broadcast steps without re-adding).
        const boosted = !isRemote && (currentState as any).activeBoost === currentState.currentPlayer;
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
        
        if (isBonusTurn && !currentState.winner) {
            newState.currentPlayer = color;
        }

        const finalState = {
            ...currentState,
            ...newState,
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
            (finalState as any).activeBoost = null;
            (finalState as any).boostTrail = color;
            setTimeout(() => {
                setLocalGameState((latest: any) => latest.boostTrail === color ? { ...latest, boostTrail: null, lastUpdate: Date.now() } : latest);
            }, 1600);
        }
        // Shields last until the owner's next move completes.
        (finalState as any).activeShields = (currentState.activeShields || []).filter(
            (s: any) => s.color !== currentState.currentPlayer
        );

        // ── Power pickup: landing exactly on a hidden tile reveals + grants.
        // Same-type clocks refresh; a replacement tile spawns elsewhere.
        const landedPos = newState.positions[color][tokenIndex];
        if (typeof landedPos === 'number' && landedPos >= 0 && landedPos < HOME_LANE_START_INDEX) {
            const landPt = getBoardCoordinate(landedPos, color, colorCorner);
            if (landPt) {
                const tileIdx = (currentState.powerTiles || []).findIndex((t: any) => t.r === landPt.r && t.c === landPt.c);
                if (tileIdx >= 0) {
                    const tile = currentState.powerTiles[tileIdx];
                    const now = Date.now();
                    const liveInv: PowerItem[] = ((currentState.playerPowers || {})[color] || []).filter((p: PowerItem) => p.expiresAt > now);
                    const full = POWER_EXPIRY_MS[tile.type as keyof typeof POWER_EXPIRY_MS] ?? POWER_EXPIRY_MS.boost;
                    const granted: PowerItem[] = liveInv.map(p => p.type === tile.type ? { ...p, expiresAt: now + full } : p);
                    granted.push({ type: tile.type, expiresAt: now + full });
                    (finalState as any).playerPowers = { ...(currentState.playerPowers || {}), [color]: granted };
                    // Respawn to keep the board seeded.
                    const taken = new Set((currentState.powerTiles || []).map((t: any) => `${t.r},${t.c}`));
                    taken.delete(`${tile.r},${tile.c}`);
                    const palette: PlayerColor[] = ['green', 'red', 'blue', 'yellow'];
                    let spawnedKey: string | null = null;
                    for (let tries = 0; tries < 24 && !spawnedKey; tries++) {
                        const rc = palette[Math.floor(Math.random() * palette.length)];
                        const rp = Math.floor(Math.random() * 52);
                        const pt = getBoardCoordinate(rp, rc, colorCorner);
                        if (pt && !taken.has(`${pt.r},${pt.c}`)) {
                            spawnedKey = `${pt.r},${pt.c}`;
                        }
                    }
                    const remaining = (currentState.powerTiles || []).filter((_: any, i: number) => i !== tileIdx);
                    if (spawnedKey) {
                        const [sr, sc] = spawnedKey.split(',').map(Number);
                        remaining.push({ r: sr, c: sc, type: rollPowerType() });
                    }
                    (finalState as any).powerTiles = remaining;
                    const foundMsg = `${tile.type.toUpperCase()} discovered!`;
                    (finalState as any).captureMessage = captured ? `${(finalState as any).captureMessage} ${foundMsg}` : foundMsg;
                    audio.playPickup();
                }
            }
        }

        if (isHost && !isRemote) {
            if (newState.currentPlayer !== currentState.currentPlayer || isBonusTurn) {
                pTurnSwitchPending = true;
                pNextPlayer = isBonusTurn ? color : newState.currentPlayer;
            }
        }

        setLocalGameState(finalState);

        if (isHost && isLobbyConnected && !isRemote) {
            // We broadcast LIVE state immediately to show the target position
            broadcastAction('MOVE_TOKEN', {
                payload: { color, tokenIndex, steps: effSteps, targetPosition: newState.positions[color][tokenIndex] }
            }, finalState);
        }

        if (newState.positions[color][tokenIndex] !== currentState.positions[color][tokenIndex]) audio.playMove();
        if (captured) audio.playCapture();
        if (newState.winner && !currentState.winner) {
            audio.playWin();
            triggerWinConfetti();
            recordWin(color);
        }

        // 🚀 Executing side effects OUTSIDE the setLocalGameState!
        if (pTurnSwitchPending) {
            if (autoMoveTimeoutRef.current) clearTimeout(autoMoveTimeoutRef.current);
            autoMoveTimeoutRef.current = setTimeout(() => {
                // Release the roll guard — this path skips the normal-flow
                // reset, and a stuck guard deadlocks every future roll
                // (AFK auto-play then loops on strikes forever).
                rollingRef.current = false;
                setLocalGameState((latest: any) => {
                    const switchState = { 
                        ...latest, 
                        currentPlayer: pNextPlayer, 
                        diceValue: null, 
                        gamePhase: 'rolling', // Now it's officially the next turn
                        lastUpdate: Date.now(),
                        timeLeft: 15 // Reset for next turn
                    };
                    if (isLobbyConnected) broadcastAction('TURN_SWITCH', { nextPlayer: pNextPlayer }, switchState);
                    return switchState;
                });
            }, 800) as any;
        }
    }, [isHost, isLobbyConnected, sendIntent, broadcastAction, audio, playerCount, activeColorsArr, colorCorner, setLocalGameState, autoMoveTimeoutRef, triggerWinConfetti, recordWin]);

    const handleRoll = useCallback(async (value?: number, isRemote = false) => {
        // 🔧 FIX 3: Read from stateRef instead of stale closure for guard check
        const guardState = stateRef.current;
        if (rollingRef.current || guardState.isRolling || guardState.gamePhase !== 'rolling') return;
        
        rollingRef.current = true;

        const color = localGameState.currentPlayer;
        const currentPlayerInfo = initialPlayers.find(p => p.color === color);
        const isCurrentlyBot = currentPlayerInfo?.isAi || localGameState.afkStats?.[color]?.isKicked;
        
        // 🚨 CRITICAL FIX: Bots are host-only in lobby, but in local match, we are the host.
        if (!isRemote && (isLobbyConnected && !isHost) && isCurrentlyBot) {
            rollingRef.current = false;
            return;
        }

        // 🎲 Guest: Send intent to Host
        if (isLobbyConnected && !isHost && !isRemote) {
            console.log('🎲 [Guest] Sending REQUEST_ROLL intent');
            sendIntent('REQUEST_ROLL', { value });
            rollingRef.current = false;
            return;
        }

        // 🎰 Host: Open betting window (Only for human players)
        if (isHost && isLobbyConnected && !isRemote && !isCurrentlyBot) {
            await startBettingWindow('dice_roll');
        }

        // 1. Start Tumble Phase
        if (isHost && isLobbyConnected && !isRemote) {
            broadcastAction('ROLL_DICE', { isRolling: true, diceValue: null });
        }
        setLocalGameState((prev: any) => ({ ...prev, isRolling: true, diceValue: null, timeLeft: 15 }));
        
        let rollValue: number = value || 0;
        const tumblePromise = new Promise(r => setTimeout(r, 1200));

        // 2. Generate and Set Result
        // Networked human rolls: Edge RNG only — never silently fall back to
        // client Math.random (a hostile host could force any face that way).
        // Offline/bot/AFK may use local CSPRNG-equivalent.
        if (!value) {
            const networkedHuman = isLobbyConnected && !isCurrentlyBot && !!address;
            if (networkedHuman) {
                try {
                    const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/roll-dice`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}`
                        },
                        body: JSON.stringify({ matchId: localGameState.matchId || 'local', walletAddress: address, actionId: Date.now() })
                    });

                    if (!response.ok) throw new Error('Edge RNG failed');
                    const data = await response.json();
                    const parsed = Number(data?.result);
                    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 6) {
                        throw new Error('Edge RNG returned invalid face');
                    }
                    rollValue = parsed;
                } catch (err) {
                    console.error('❌ [Engine] Edge RNG failed — aborting networked roll (no client fallback)', err);
                    await tumblePromise;
                    setLocalGameState((prev: any) => ({ ...prev, isRolling: false, diceValue: null }));
                    rollingRef.current = false;
                    return;
                }
            } else {
                // Bots / AFK Auto-Play / offline human
                rollValue = Math.floor(Math.random() * 6) + 1;
            }
        }

        // Wait for the tumble animation to finish
        await tumblePromise;

        
        // 🚨 Broadcast result to Guests
        if (isHost && isLobbyConnected && !isRemote) {
            broadcastAction('ROLL_DICE', { isRolling: false, diceValue: rollValue });
        }

        setLocalGameState((prev: any) => ({
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
            return;
        }


        const teammate = (playerCount === '2v2') ? getTeammateColor(color, playerCount) : null;
        const isSelfFinished = currentState.positions[color].every((p: number) => p === BOARD_FINISH_INDEX);
        const targetColor = (playerCount === '2v2' && isSelfFinished && teammate) ? teammate : color;

        let pDelayedAction: 'turnSwitch' | 'autoMove' | null = null;
        let pNextPlayer: PlayerColor | null = null;
        let pTargetColor: PlayerColor = targetColor;
        let pLastValidTokenIndex = -1;
        let pFinalStateForBroadcast: any = null;

        const { isThreeSixes, nextSixes } = handleThreeSixes(currentState.consecutiveSixes, rollValue);

        if (isThreeSixes) {
            pNextPlayer = getNextPlayer(color, currentState.positions);
            pDelayedAction = 'turnSwitch';
            // 🔧 FIX 2: Use functional updater to avoid clobbering concurrent state
            setLocalGameState((prev: any) => {
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
                setLocalGameState((prev: any) => {
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
                    setLocalGameState((prev: any) => {
                        pFinalStateForBroadcast = { ...prev, isRolling: false, diceValue: rollValue, gamePhase: 'moving', consecutiveSixes: nextSixes };
                        return pFinalStateForBroadcast;
                    });
                } else {
                    // Normal Flow: Just change phase and wait for user/bot interaction
                    rollingRef.current = false;
                    // 🔧 FIX 2: Functional updater
                    setLocalGameState((prev: any) => {
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
        if (isHost && isLobbyConnected && !isRemote && pFinalStateForBroadcast) {
            broadcastAction('ENGINE_STATE', {}, pFinalStateForBroadcast);
        }

        if (pDelayedAction === 'turnSwitch') {
            // Instant pass: no dead time when nobody can move
            setLocalGameState((latest: any) => {
                const switchState = { 
                    ...latest, 
                    currentPlayer: pNextPlayer, 
                    diceValue: null, 
                    gamePhase: 'rolling', 
                    consecutiveSixes: 0,
                    timeLeft: 15,
                    lastUpdate: Date.now()
                };
                console.log(`🎲 [Engine] Auto-switching to ${pNextPlayer}`);
                if (isHost && isLobbyConnected) broadcastAction('TURN_SWITCH', { nextPlayer: pNextPlayer }, switchState);
                rollingRef.current = false;
                return switchState;
            });
        } else if (pDelayedAction === 'autoMove') {
            if (autoMoveTimeoutRef.current) clearTimeout(autoMoveTimeoutRef.current);
            autoMoveTimeoutRef.current = setTimeout(() => {
                moveToken(pTargetColor, pLastValidTokenIndex, rollValue);
                rollingRef.current = false;
                autoMoveTimeoutRef.current = null;
            }, 1500) as any;
        }

    }, [isHost, isLobbyConnected, sendIntent, broadcastAction, setLocalGameState, initialPlayers, localGameState.winner, localGameState.isRolling, localGameState.diceValue, localGameState.currentPlayer, localGameState.afkStats, startBettingWindow, playerCount, getNextPlayer, moveToken, address]);

    const handleUsePower = useCallback((color: PlayerColor, type?: PowerType, tokenIdx?: number) => {
        const prev: any = stateRef.current;
        if (!prev || prev.currentPlayer !== color || prev.gamePhase !== 'rolling') return;
        if (prev.powerSpentThisTurn) return;
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
        let nextState = { ...prev };
        let sound: 'nuke' | 'shield' | 'boost' | 'teleport' | null = null;
        let flash: { r: number, c: number }[] | null = null;

        if (pick === 'shield') {
            const tokensOnBoard = prev.positions[myColor]
                .map((pos: number, idx: number) => (pos >= 0 && pos < HOME_LANE_START_INDEX) ? idx : -1)
                .filter((idx: number) => idx !== -1);

            const newShields = [...prev.activeShields];
            tokensOnBoard.forEach((idx: number) => {
                if (!newShields.some((s: any) => s.color === myColor && s.tokenIdx === idx)) {
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
            victims.forEach(v => {
                newPositions[v.color] = [...newPositions[v.color]];
                newPositions[v.color][v.idx] = BASE_INDEX;
            });
            nextState.positions = newPositions;
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
                setLocalGameState((latest: any) => ({ ...latest, nukeFlash: [], lastUpdate: Date.now() }));
            }, 1400);
        }
    }, [playerCount, colorCorner, audio, setLocalGameState]);

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

        if (!isHost && isLobbyConnected) {
            sendIntent('REQUEST_MOVE', { color, tokenIndex, diceValue: localGameState.diceValue });
            return;
        }

        moveToken(color, tokenIndex, localGameState.diceValue);
    }, [localGameState.gamePhase, localGameState.diceValue, localGameState.currentPlayer, localGameState.positions, playerCount, isHost, isLobbyConnected, sendIntent, moveToken, address, initialPlayers]);

    return {
        moveToken,
        handleRoll,
        handleUsePower,
        handleTokenClick
    };
}
