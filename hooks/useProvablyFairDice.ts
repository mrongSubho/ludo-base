import { useState, useCallback } from 'react';
import { PlayerColor, GameState } from '@/lib/types';
import { handleThreeSixes, getNextPlayer, getTeammateColor } from '@/lib/gameLogic';
import { generateRandomNonce, sha256 } from '@/lib/encryption';

interface UseProvablyFairDiceProps {
    gameState: GameState;
    setGameState: React.Dispatch<React.SetStateAction<GameState>>;
    isHost: boolean;
    myAddress: string | undefined;
    connection: any; // Peer data connection
    broadcastAction: (type: any, payload?: any) => void;
    broadcastToAll: (data: any) => void;
    resolveBet?: (matchId: string, result: string, betType: string) => void;
}

export function useProvablyFairDice({
    gameState,
    setGameState,
    isHost,
    myAddress,
    connection,
    broadcastAction,
    broadcastToAll,
    resolveBet
}: UseProvablyFairDiceProps) {
    const [commitments, setCommitments] = useState<Record<string, string>>({});
    const [reveals, setReveals] = useState<Record<string, string>>({});
    const [myPendingNonce, setMyPendingNonce] = useState<string | null>(null);

    const initiateDiceRoll = useCallback(async () => {
        if (gameState.gamePhase !== 'rolling') return;
        
        const nonce = generateRandomNonce();
        const hash = await sha256(nonce);
        setMyPendingNonce(nonce);
        
        setCommitments({});
        setReveals({});

        if (isHost) {
            setCommitments(prev => ({ ...prev, [myAddress || 'host']: hash }));
            broadcastAction('DICE_COMMIT', { hash, sender: myAddress || 'host' });
        } else if (connection?.open) {
            connection.send({ type: 'DICE_COMMIT', payload: { hash, sender: myAddress } });
        }
    }, [gameState.gamePhase, isHost, myAddress, connection, broadcastAction]);

    const finalizeDiceRoll = useCallback(async (allReveals: Record<string, string>) => {
        if (!isHost) return;

        const entries = Object.entries(allReveals);
        for (const [addr, nonce] of entries) {
            const expectedHash = commitments[addr];
            const actualHash = await sha256(nonce);
            if (actualHash !== expectedHash) {
                console.error(`🚨 CHEAT DETECTED! Player ${addr} sent mismatching nonce.`);
                return;
            }
        }

        const combined = entries.map(([_, n]) => n).sort().join(':');
        const rollHash = await sha256(combined);
        const roll = (parseInt(rollHash.substring(0, 8), 16) % 6) + 1;

        setGameState(prev => {
            const { isThreeSixes, nextSixes } = handleThreeSixes(prev.consecutiveSixes, roll);
            const allColors = prev.initialBoardConfig?.players.map((p: any) => p.color as PlayerColor) || [];
            const activeColors = allColors.filter((color: PlayerColor) => {
                const hasTokens = prev.positions[color].some(p => p !== 57);
                if (prev.playerCount === '2v2') {
                    const teammate = getTeammateColor(color, prev.playerCount);
                    const teammateHasTokens = teammate ? prev.positions[teammate].some(p => p !== 57) : false;
                    return hasTokens || teammateHasTokens;
                }
                return hasTokens;
            });

            if (isThreeSixes) {
                const nextPlayer = getNextPlayer(prev.currentPlayer, prev.playerCount, activeColors, prev.initialBoardConfig?.colorCorner);
                const updated: GameState = {
                    ...prev,
                    diceValue: roll,
                    consecutiveSixes: 0,
                    gamePhase: 'rolling',
                    currentPlayer: nextPlayer,
                    captureMessage: 'Three 6s! Turn passed.'
                };
                setTimeout(() => {
                    broadcastToAll({ type: 'ROLL_DICE', value: roll, gameState: { ...updated, lastAction: { type: 'ROLL_DICE', payload: { value: roll } } } });
                    broadcastToAll({ type: 'TURN_SWITCH', nextPlayer, gameState: updated });
                }, 0);
                return updated;
            } else {
                const updated = { ...prev, diceValue: roll, consecutiveSixes: nextSixes, gamePhase: 'moving' as const };
                setTimeout(() => {
                    broadcastToAll({ type: 'ROLL_DICE', value: roll, gameState: { ...updated, lastAction: { type: 'ROLL_DICE', payload: { value: roll } } } });
                }, 0);
                return updated;
            }
        });

        // 🎰 Trigger Bet Resolution (Dice Roll)
        if (gameState.matchId && resolveBet) {
            resolveBet(gameState.matchId, String(roll), 'dice_roll');
        }
    }, [isHost, commitments, broadcastToAll, setGameState, gameState.matchId, resolveBet]);

    const handleCommitReceived = useCallback(async (sender: string, hash: string, lobbyStateRef: React.MutableRefObject<any>) => {
        setCommitments(prev => {
            const next = { ...prev, [sender.toLowerCase()]: hash };
            
            if (isHost && lobbyStateRef.current) {
                const joinedParticipants = lobbyStateRef.current.slots
                    .filter((s: any) => s.status === 'joined')
                    .map((s: any) => s.playerId?.toLowerCase())
                    .filter(Boolean) as string[];

                const allCommitted = joinedParticipants.every(p => next[p]);
                if (allCommitted) {
                    broadcastAction('DICE_REVEAL_SIGNAL');
                    if (myPendingNonce) {
                        setReveals(r => ({ ...r, [myAddress?.toLowerCase() || 'host']: myPendingNonce }));
                        broadcastAction('DICE_REVEAL', { nonce: myPendingNonce, sender: myAddress || 'host' });
                    }
                }
            }
            return next;
        });
    }, [isHost, myPendingNonce, myAddress, broadcastAction]);

    const handleRevealReceived = useCallback(async (sender: string, nonce: string, lobbyStateRef: React.MutableRefObject<any>) => {
        setReveals(prev => {
            const next = { ...prev, [sender.toLowerCase()]: nonce };
            
            if (isHost && lobbyStateRef.current) {
                const joinedParticipants = lobbyStateRef.current.slots
                    .filter((s: any) => s.status === 'joined')
                    .map((s: any) => s.playerId?.toLowerCase())
                    .filter(Boolean) as string[];

                const allRevealed = joinedParticipants.every(p => next[p]);
                if (allRevealed) {
                    finalizeDiceRoll(next);
                }
            }
            return next;
        });
    }, [isHost, finalizeDiceRoll]);

    return {
        commitments,
        reveals,
        myPendingNonce,
        setCommitments,
        setReveals,
        setMyPendingNonce,
        initiateDiceRoll,
        finalizeDiceRoll,
        handleCommitReceived,
        handleRevealReceived
    };
}
