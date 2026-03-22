import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';

export type MatchmakingStatus = 'idle' | 'searching' | 'expanding' | 'timeout' | 'matched' | 'error';

interface UseMatchmakingProps {
    playerId: string;
    gameMode: string;
    matchType: string;
    wager: number;
    onMatchFound: (matchId: string, roomCode: string, isHost: boolean) => void;
}

export function useMatchmaking({
    playerId,
    gameMode,
    matchType,
    wager,
    onMatchFound
}: {
    playerId: string;
    gameMode: string;
    matchType: string;
    wager: number;
    onMatchFound: (matchId: string, roomCode: string, isHost: boolean) => void;
}) {
    const [status, setStatus] = useState<MatchmakingStatus>('idle');
    const [ticketId, setTicketId] = useState<string | null>(null);
    const ticketIdRef = useRef<string | null>(null);
    const [matchId, setMatchId] = useState<string | null>(null);
    const [roomCode, setRoomCode] = useState<string | null>(null);
    const [searchTime, setSearchTime] = useState(0);
    const timerRef = useRef<NodeJS.Timeout | null>(null);
    const pollingRef = useRef<NodeJS.Timeout | null>(null);
    const statusRef = useRef<MatchmakingStatus>(status);
    const onMatchFoundRef = useRef(onMatchFound);

    // Keep refs synced
    useEffect(() => {
        statusRef.current = status;
        onMatchFoundRef.current = onMatchFound;
        ticketIdRef.current = ticketId;
    }, [status, onMatchFound, ticketId]);

    const cancelSearch = useCallback(async (allForPlayer: boolean = false, skipStateReset: boolean = false) => {
        const currentTicketId = ticketIdRef.current;
        if (!currentTicketId && !allForPlayer) {
            // Even if no ticket, we might still want to clear search session
            if (!skipStateReset) {
                setStatus('idle');
                setSearchTime(0);
                if (timerRef.current) clearInterval(timerRef.current);
            }
            return;
        }
 
        console.log(`📡 [Matchmaking] ${allForPlayer ? 'Purging player tickets' : 'Cancelling current ticket'}...`);
        try {
            await fetch('/api/matchmaking/cancel', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    ticketId: allForPlayer ? null : currentTicketId,
                    playerId: allForPlayer ? playerId.toLowerCase() : null
                })
            });
        } catch (err) {
            console.error('❌ [Matchmaking] Failed to cancel search:', err);
        }
 
        // Clean up
        if (!skipStateReset) {
            setTicketId(null);
            setMatchId(null);
            setRoomCode(null);
            setStatus('idle');
            setSearchTime(0);
            if (timerRef.current) clearInterval(timerRef.current);
            if (pollingRef.current) clearInterval(pollingRef.current);
            lastSearchRef.current = ''; // Clear so we can restart with same criteria
        }
    }, [playerId]);

    // --- Check Current Ticket Status (Fallback for missed Realtime) ---
    const checkTicketStatus = useCallback(async (id: string) => {
        if (statusRef.current === 'matched') return;
        
        console.log(`📡 [Matchmaking] Checking status for ticket: ${id}...`);
        try {
            const { data, error } = await supabase
                .from('matchmaking_queue')
                .select('status, match_id, room_code')
                .eq('id', id)
                .single();

            if (error) throw error;

            if (data?.status === 'matched' && data.match_id) {
                console.log(`✅ [Matchmaking] Polling found MATCH! Match: ${data.match_id}`);
                if (timerRef.current) clearInterval(timerRef.current);
                if (pollingRef.current) clearInterval(pollingRef.current);
                
                setMatchId(data.match_id);
                setRoomCode(data.room_code || '');
                setStatus('matched');
                
                // If we found it via poll, we are likely the Guest (or Host who missed update)
                // We'll follow the Guest path (slight delay) to be safe, or just join.
                // Actually, if match_id exists, we can join.
                onMatchFoundRef.current(data.match_id, data.room_code || '', false);
            }
        } catch (err) {
            console.error('❌ [Matchmaking] Status check failed:', err);
        }
    }, []);

    const lastSearchRef = useRef<string>('');
    const startSearch = useCallback(async (wagerMin?: number, wagerMax?: number) => {
        const normalizedPlayerId = playerId.toLowerCase();
        const criteria = `${normalizedPlayerId}-${gameMode}-${matchType}-${wager}-${wagerMin}-${wagerMax}`;
        
        console.log(`📡 [Matchmaking] Starting NEW search. Criteria: ${criteria}`);
        
        // 1. Instant UI Reset
        setStatus('searching');
        setSearchTime(0);
        lastSearchRef.current = criteria;
        
        // 2. Clear & Restart Timer immediately
        if (timerRef.current) clearInterval(timerRef.current);
        if (pollingRef.current) clearInterval(pollingRef.current);
        
        timerRef.current = setInterval(() => {
            setSearchTime(prev => {
                const newTime = prev + 1;
                if (newTime === 16) setStatus('expanding');
                if (newTime >= 30) {
                    setStatus('timeout');
                    if (timerRef.current) clearInterval(timerRef.current);
                    if (pollingRef.current) clearInterval(pollingRef.current);
                }
                return newTime;
            });
        }, 1000);

        // 3. Purge stale tickets
        try {
            await cancelSearch(true, true);
        } catch (e) {
            console.error('❌ [Matchmaking] Purge failed, but proceeding...', e);
        }

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
                console.log('✅ [Matchmaking] DIRECT MATCH found. YOU ARE THE GUEST.');
                if (timerRef.current) clearInterval(timerRef.current);
                if (pollingRef.current) clearInterval(pollingRef.current);
                
                setStatus('matched');
                setMatchId(data.match_id);
                setRoomCode(data.room_code || '');
                
                setTimeout(() => {
                    onMatchFoundRef.current(data.match_id, data.room_code || '', false); 
                }, 1500);
            } else {
                console.log('📡 [Matchmaking] No direct match. Ticket created:', data.ticket_id);
                setTicketId(data.ticket_id);
                
                // Immediately check status once in case match happened during join
                checkTicketStatus(data.ticket_id);
                
                // Start polling as a safety net
                pollingRef.current = setInterval(() => {
                    if (data.ticket_id) checkTicketStatus(data.ticket_id);
                }, 3000);
            }
        } catch (err) {
            console.error('❌ [Matchmaking] Error starting search:', err);
            setStatus('error');
            setSearchTime(0);
        }
    }, [playerId, gameMode, matchType, wager, cancelSearch, checkTicketStatus]);

    // --- Hybrid Search ---
    const startHybridSearch = useCallback(async (roomCode: string, slotsNeeded: number, lobbyMatchType: string, wagerMin?: number, wagerMax?: number) => {
        setStatus('searching');
        setSearchTime(0);

        if (timerRef.current) clearInterval(timerRef.current);
        if (pollingRef.current) clearInterval(pollingRef.current);
        
        timerRef.current = setInterval(() => {
            setSearchTime(prev => {
                const newTime = prev + 1;
                if (newTime === 16) setStatus('expanding');
                if (newTime >= 30) {
                    setStatus('timeout');
                    if (timerRef.current) clearInterval(timerRef.current);
                    if (pollingRef.current) clearInterval(pollingRef.current);
                }
                return newTime;
            });
        }, 1000);

        try {
            await cancelSearch(true, true);
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
                    roomCode,
                    slotsNeeded,
                    isHybrid: true
                })
            });
            const data = await response.json();

            if (data.status === 'matched') {
                console.log('✅ [Matchmaking] HYBRID MATCH found. YOU ARE THE GUEST.');
                if (timerRef.current) clearInterval(timerRef.current);
                if (pollingRef.current) clearInterval(pollingRef.current);
                
                setStatus('matched');
                setMatchId(data.match_id);
                setRoomCode(data.room_code || '');

                setTimeout(() => {
                    onMatchFoundRef.current(data.match_id, data.room_code || '', false);
                }, 800);
            } else {
                setTicketId(data.ticket_id);
                
                // Immediate check
                checkTicketStatus(data.ticket_id);
                
                // Polling
                pollingRef.current = setInterval(() => {
                    if (data.ticket_id) checkTicketStatus(data.ticket_id);
                }, 3000);
            }
        } catch (err) {
            console.error('❌ [Matchmaking] Hybrid search error:', err);
            setStatus('error');
        }
    }, [playerId, gameMode, wager, cancelSearch, checkTicketStatus]);

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
                    // CRITICAL: If we already matched via RPC (Guest), ignore this Realtime signal (Host-path)
                    // This prevents the Guest from also trying to 'hostGame' and causing PeerJS ID collisions.
                    if (statusRef.current === 'matched') {
                        console.log('📡 [Matchmaking] Ignoring redundant Realtime update (already matched via RPC)');
                        return;
                    }

                    const { status: newStatus, match_id, room_code } = payload.new;
                    if (newStatus === 'matched') {
                        console.log(`✅ [Matchmaking] REALTIME MATCH! YOU ARE THE HOST. Match: ${match_id}`);
                        if (timerRef.current) clearInterval(timerRef.current);
                        if (pollingRef.current) clearInterval(pollingRef.current);
                        
                        setMatchId(match_id);
                        setRoomCode(room_code || '');
                        setStatus('matched');
                        
                        // Waiters (Hosts) join immediately because they are the ones opening the room
                        onMatchFoundRef.current(match_id, room_code || '', true);
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

    // Independent unmount cleanup for timers and search
    useEffect(() => {
        return () => {
            if (timerRef.current) clearInterval(timerRef.current);
            if (pollingRef.current) clearInterval(pollingRef.current);
            
            // Auto-cancel if still searching on unmount
            if (statusRef.current !== 'matched' && (statusRef.current === 'searching' || statusRef.current === 'expanding')) {
                console.log('📡 [Matchmaking] Component unmounting. Cancelling search...');
                cancelSearch();
            }
        };
    }, [cancelSearch]);

    return {
        status,
        searchTime,
        ticketId,
        matchId,
        roomCode,
        startSearch,
        startHybridSearch,
        cancelSearch
    };
}

