import { useEffect } from 'react';
import { PlayerColor } from '@/lib/types';

interface UseGameTimerProps {
    localGameState: any;
    setLocalGameState: React.Dispatch<React.SetStateAction<any>>;
}

export function useGameTimer({
    localGameState,
    setLocalGameState
}: UseGameTimerProps) {
    useEffect(() => {
        if (localGameState.winner) return;

        const interval = setInterval(() => {
            setLocalGameState((prev: any) => {
                // If the Idle Warning prompt is active, tick its countdown instead
                if (prev.idleWarning) {
                    if (prev.idleWarning.timeLeft <= 0) {
                        // 10s ultimatum expired -> Kick the player
                        const kickedPlayer = prev.idleWarning.player;
                        return {
                            ...prev,
                            idleWarning: null,
                            afkStats: {
                                ...prev.afkStats,
                                [kickedPlayer]: { ...prev.afkStats[kickedPlayer], isKicked: true, isAutoPlaying: false }
                            },
                        };
                    }
                    return {
                        ...prev,
                        idleWarning: { ...prev.idleWarning, timeLeft: prev.idleWarning.timeLeft - 1 }
                    };
                }

                // Normal Turn Timer
                // Tick the timer as long as we aren't actively rolling the dice and the game isn't finished.
                const isInteractive = prev.gamePhase !== 'finished' && !prev.isRolling && !prev.winner;
                
                if (!isInteractive || prev.timeLeft <= 0) return prev;
                return { ...prev, timeLeft: prev.timeLeft - 1 };
            });
        }, 1000);

        return () => clearInterval(interval);
    }, [localGameState.winner, localGameState.currentPlayer, localGameState.gamePhase, setLocalGameState]);
}
