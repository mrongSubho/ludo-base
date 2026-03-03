import { useState, useEffect, useCallback, useRef } from 'react';

export type MatchmakingStatus = 'idle' | 'searching' | 'expanding' | 'timeout' | 'matched' | 'error';

interface UseMatchmakingProps {
    playerId: string;
    gameMode: string;
    matchType: string;
    wager: number;
    onMatchFound: (matchId: string) => void;
}

export function useMatchmaking({
    playerId,
    gameMode,
    matchType,
    wager,
    onMatchFound
}: UseMatchmakingProps) {
    const [status, setStatus] = useState<MatchmakingStatus>('idle');
    const [ticketId, setTicketId] = useState<string | null>(null);
    const [searchTime, setSearchTime] = useState(0);
    const timerRef = useRef<NodeJS.Timeout | null>(null);
    const pollingRef = useRef<NodeJS.Timeout | null>(null);

    const cancelSearch = useCallback(async () => {
        if (!ticketId) return;

        console.log('📡 [Matchmaking] Auto-cancelling search...');
        try {
            await fetch('/api/matchmaking/cancel', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ticketId })
            });
        } catch (err) {
            console.error('❌ [Matchmaking] Failed to cancel search:', err);
        }

        // Clean up
        setTicketId(null);
        setStatus('idle');
        setSearchTime(0);
        if (timerRef.current) clearInterval(timerRef.current);
        if (pollingRef.current) clearInterval(pollingRef.current);
    }, [ticketId]);

    const startSearch = useCallback(async () => {
        setStatus('searching');
        setSearchTime(0);

        try {
            const response = await fetch('/api/matchmaking/join', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ playerId, gameMode, matchType, wager })
            });
            const data = await response.json();

            if (data.status === 'matched') {
                setStatus('matched');
                onMatchFound(data.match_id);
            } else {
                setTicketId(data.ticket_id);

                // Start Timer (Phase 1/2)
                timerRef.current = setInterval(() => {
                    setSearchTime(prev => {
                        const newTime = prev + 1;
                        if (newTime === 26) setStatus('expanding');
                        if (newTime >= 40) {
                            setStatus('timeout');
                            if (timerRef.current) clearInterval(timerRef.current);
                        }
                        return newTime;
                    });
                }, 1000);

                // Start Polling (Phase 4)
                pollingRef.current = setInterval(async () => {
                    try {
                        const statusRes = await fetch(`/api/matchmaking/status?ticketId=${data.ticket_id}`);
                        const statusData = await statusRes.json();

                        if (statusData.status === 'matched') {
                            setStatus('matched');
                            onMatchFound(statusData.match_id);
                            if (timerRef.current) clearInterval(timerRef.current);
                            if (pollingRef.current) clearInterval(pollingRef.current);
                        }
                    } catch (err) {
                        console.error('❌ [Matchmaking] Polling error:', err);
                    }
                }, 3000);
            }
        } catch (err) {
            console.error('❌ [Matchmaking] Error starting search:', err);
            setStatus('error');
        }
    }, [playerId, gameMode, matchType, wager, onMatchFound]);

    // Visibility Change Handling (Heartbeat & Cancellation)
    useEffect(() => {
        const handleVisibilityChange = () => {
            if (document.hidden && (status === 'searching' || status === 'expanding')) {
                cancelSearch();
            }
        };

        const handleBeforeUnload = () => {
            if (status === 'searching' || status === 'expanding') {
                cancelSearch();
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);
        window.addEventListener('beforeunload', handleBeforeUnload);

        return () => {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            window.removeEventListener('beforeunload', handleBeforeUnload);
            if (timerRef.current) clearInterval(timerRef.current);
            if (pollingRef.current) clearInterval(pollingRef.current);
        };
    }, [status, cancelSearch]);

    return {
        status,
        searchTime,
        startSearch,
        cancelSearch
    };
}
