import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';

export type MatchmakingStatus = 'idle' | 'searching' | 'expanding' | 'timeout' | 'matched' | 'error';

interface UseMatchmakingProps {
    playerId: string;
    gameMode: string;
    matchType: string;
    wager: number;
    onMatchFound: (matchId: string, isHost: boolean) => void;
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
    const statusRef = useRef<MatchmakingStatus>(status);
    const onMatchFoundRef = useRef(onMatchFound);

    // Keep refs synced
    useEffect(() => {
        statusRef.current = status;
        onMatchFoundRef.current = onMatchFound;
    }, [status, onMatchFound]);

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
        lastSearchRef.current = ''; // Clear so we can restart with same criteria
    }, [ticketId]);

    const lastSearchRef = useRef<string>('');

    const startSearch = useCallback(async (wagerMin?: number, wagerMax?: number) => {
        const normalizedPlayerId = playerId.toLowerCase();
        const criteria = `${normalizedPlayerId}-${gameMode}-${matchType}-${wager}-${wagerMin}-${wagerMax}`;
        const currentStatus = statusRef.current;
        
        if (currentStatus === 'searching' || currentStatus === 'expanding' || currentStatus === 'matched') {
            if (lastSearchRef.current === criteria) {
                console.log('📡 [Matchmaking] Already searching with same criteria, skipping...');
                return;
            }
            // If criteria changed, cancel old and continue
            await cancelSearch();
        }
        
        console.log(`📡 [Matchmaking] Starting NEW search. Criteria: ${criteria}`);
        lastSearchRef.current = criteria;
        setStatus('searching');
        setSearchTime(0);

        try {
            const response = await fetch('/api/matchmaking/join', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    playerId: normalizedPlayerId, 
                    gameMode, 
                    matchType, 
                    wager,
                    wagerMin,
                    wagerMax
                })
            });
            const data = await response.json();

            if (data.status === 'matched') {
                setStatus('matched');
                onMatchFoundRef.current(data.match_id, false);
            } else {
                setTicketId(data.ticket_id);

                // Start Timer (Phase 1/2) - No longer starts polling here
                if (timerRef.current) clearInterval(timerRef.current);
                timerRef.current = setInterval(() => {
                    setSearchTime(prev => {
                        const newTime = prev + 1;

                        // Phase 2: Expanding Search (16s - 29s)
                        if (newTime === 16) {
                            setStatus('expanding');
                        }

                        // Phase 3: Timeout (30s)
                        if (newTime >= 30) {
                            setStatus('timeout');
                            lastSearchRef.current = ''; 
                            if (timerRef.current) clearInterval(timerRef.current);
                        }

                        return newTime;
                    });
                }, 1000);
            }
        } catch (err) {
            console.error('❌ [Matchmaking] Error starting search:', err);
            setStatus('error');
        }
    }, [playerId, gameMode, matchType, wager, cancelSearch]);

    // --- Hybrid Search (from a private lobby) ---
    const startHybridSearch = useCallback(async (roomCode: string, slotsNeeded: number, lobbyMatchType: string, wagerMin?: number, wagerMax?: number) => {
        setStatus('searching');
        setSearchTime(0);

        try {
            const response = await fetch('/api/matchmaking/join', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    playerId,
                    gameMode,
                    matchType: lobbyMatchType,
                    wager,
                    wagerMin,
                    wagerMax,
                    roomCode,       // Include existing room for direct joins
                    slotsNeeded,    // How many slots to fill
                    isHybrid: true
                })
            });
            const data = await response.json();

            if (data.status === 'matched') {
                setStatus('matched');
                onMatchFoundRef.current(data.match_id, false);
            } else {
                setTicketId(data.ticket_id);

                // Timer (same as normal search)
                if (timerRef.current) clearInterval(timerRef.current);
                timerRef.current = setInterval(() => {
                    setSearchTime(prev => {
                        const newTime = prev + 1;
                        if (newTime === 16) setStatus('expanding');
                        if (newTime >= 30) {
                            setStatus('timeout');
                            if (timerRef.current) clearInterval(timerRef.current);
                        }
                        return newTime;
                    });
                }, 1000);
            }
        } catch (err) {
            console.error('❌ [Matchmaking] Hybrid search error:', err);
            setStatus('error');
        }
    }, [playerId, gameMode, wager]);

    // --- Supabase Realtime Subscription for Matchmaking Status ---
    useEffect(() => {
        if (!ticketId || (status !== 'searching' && status !== 'expanding')) return;

        console.log(`📡 [Matchmaking] Subscribing to Realtime updates for ticket: ${ticketId}`);
        
        const channel = supabase
            .channel(`matchm-status-${ticketId}`)
            .on(
                'postgres_changes',
                {
                    event: 'UPDATE',
                    schema: 'public',
                    table: 'matchmaking_queue',
                    filter: `id=eq.${ticketId}`
                },
                (payload: any) => {
                    const newData = payload.new;
                    console.log('📡 [Matchmaking] Realtime update received:', newData.status);
                    
                    if (newData.status === 'matched') {
                        setStatus('matched');
                        onMatchFoundRef.current(newData.match_id, true);
                        if (timerRef.current) clearInterval(timerRef.current);
                    }
                }
            )
            .subscribe((status: string) => {
                if (status === 'SUBSCRIBED') {
                    console.log('✅ [Matchmaking] Realtime subscription active.');
                }
            });

        return () => {
            console.log('📡 [Matchmaking] Cleaning up Realtime subscription.');
            supabase.removeChannel(channel);
        };
    }, [ticketId, status]);

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
        };
    }, [cancelSearch]);

    // Independent unmount cleanup for timers
    useEffect(() => {
        return () => {
            if (timerRef.current) clearInterval(timerRef.current);
            if (pollingRef.current) clearInterval(pollingRef.current);
        };
    }, []);

    return {
        status,
        searchTime,
        startSearch,
        startHybridSearch,
        cancelSearch
    };
}

