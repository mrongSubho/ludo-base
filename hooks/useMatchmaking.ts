import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { getEdgeClient } from '@/lib/teamup/edge-server-singleton';

export type MatchmakingStatus = 'idle' | 'searching' | 'expanding' | 'timeout' | 'matched' | 'error';

interface UseMatchmakingProps {
    playerId: string;
    gameMode: string;
    matchType: string;
    wager: number;
    onMatchFound: (matchId: string, roomCode: string, isHost: boolean, validationToken?: string) => void;
}

export function useMatchmaking(props: UseMatchmakingProps) {
    const {
        playerId,
        gameMode,
        matchType,
        wager,
        onMatchFound
    } = props;

    // --- State ---
    const [status, setStatus] = useState<MatchmakingStatus>('idle');
    const [isConnectingToEdge, setIsConnectingToEdge] = useState(false);
    const [ticketId, setTicketId] = useState<string | null>(null);
    const [matchId, setMatchId] = useState<string | null>(null);
    const [roomCode, setRoomCode] = useState<string | null>(null);
    const [matchData, setMatchData] = useState<any | null>(null);
    const [nearbyPools, setNearbyPools] = useState<{wager: number, waiters: number}[]>([]);
    const [searchTime, setSearchTime] = useState(0);
    const [maxSearchTime, setMaxSearchTime] = useState(30);
    const [error, setError] = useState<string | null>(null);

    // --- Refs ---
    const ticketIdRef = useRef<string | null>(null);
    const searchStartTimeRef = useRef<number | null>(null);
    const maxSearchTimeRef = useRef(30);
    const lastSearchRef = useRef<string>('');
    const isStartingRef = useRef(false);
    const statusRef = useRef<MatchmakingStatus>(status);
    const onMatchFoundRef = useRef(onMatchFound);
    const pollingRef = useRef<NodeJS.Timeout | null>(null);
    const timerRef = useRef<NodeJS.Timeout | null>(null);

    // --- Memoized Clients ---
    const edgeClient = useMemo(() => getEdgeClient(), []);

    // --- Synchronization Effects ---
    useEffect(() => {
        statusRef.current = status;
        onMatchFoundRef.current = onMatchFound;
        ticketIdRef.current = ticketId;
        maxSearchTimeRef.current = maxSearchTime;
    }, [status, onMatchFound, ticketId, maxSearchTime]);

    // --- Stable Callbacks ---
    
    const fetchNearbyPools = useCallback(async () => {
        try {
            const { data, error } = await supabase
                .from('matchmaking_queue')
                .select('wager')
                .eq('status', 'searching')
                .eq('game_mode', gameMode)
                .eq('match_type', matchType)
                .neq('player_id', playerId.toLowerCase())
                .limit(50);

            if (error) throw error;
            
            const counts: Record<number, number> = {};
            data?.forEach(row => {
                const w = row.wager;
                if (w !== null && w !== undefined) {
                    counts[w] = (counts[w] || 0) + 1;
                }
            });

            const sortedPools = Object.entries(counts)
                .map(([wagerStr, count]) => ({
                    wager: parseInt(wagerStr),
                    waiters: count
                }))
                .filter(p => p.wager !== wager)
                .sort((a, b) => b.waiters - a.waiters)
                .slice(0, 3);

            setNearbyPools(sortedPools);
        } catch (err) {
            console.warn('⚠️ [Matchmaking] Failed to fetch nearby pools:', err);
        }
    }, [gameMode, matchType, playerId, wager]);

    const extendSearch = useCallback((seconds: number = 20) => {
        console.log(`📡 [Matchmaking] Extending search by ${seconds}s...`);
        setMaxSearchTime(prev => Math.max(prev, searchTime + seconds));
    }, [searchTime]);

    const cancelSearch = useCallback(async (allForPlayer: boolean = false, skipStateReset: boolean = false) => {
        const currentTicketId = ticketIdRef.current;
        if (!currentTicketId && !allForPlayer) {
            if (!skipStateReset) {
                console.log('📡 [Matchmaking] Resetting state to IDLE (No ticket and not allForPlayer)');
                setStatus('idle');
            }
            return;
        }

        console.log(`📡 [Matchmaking] cancelSearch called (allForPlayer: ${allForPlayer}, skipStateReset: ${skipStateReset})`);
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

        if (!skipStateReset) {
            console.log('📡 [Matchmaking] Full state reset to IDLE');
            setTicketId(null);
            setMatchId(null);
            setRoomCode(null);
            setStatus('idle');
            if (pollingRef.current) {
                console.log('📡 [Matchmaking] Clearing polling timer');
                clearInterval(pollingRef.current);
            }
            lastSearchRef.current = ''; 
        }
    }, [playerId]);

    const checkTicketStatus = useCallback(async (id: string) => {
        if (statusRef.current === 'matched') return;
        
        console.log(`📡 [Matchmaking] Checking status (ID: ${id})...`);
        try {
            // 1. Primary check by specific ticket ID
            const { data, error } = await supabase
                .from('matchmaking_queue')
                .select('status, match_id, room_code, validation_token')
                .eq('id', id)
                .maybeSingle();

            if (error) throw error;

            let typedData = data as any;

            // 2. Secondary fallback (Defensive): Check if ANY matched ticket exists for this player
            // This handles cases where ID might have changed or been mis-matched during a race
            if (!typedData || typedData.status !== 'matched') {
                const { data: fallbackData } = await supabase
                    .from('matchmaking_queue')
                    .select('status, match_id, room_code, validation_token')
                    .eq('player_id', playerId.toLowerCase())
                    .eq('game_mode', gameMode)
                    .eq('match_type', matchType)
                    .eq('status', 'matched')
                    .order('created_at', { ascending: false })
                    .limit(1)
                    .maybeSingle();
                
                if (fallbackData) {
                    console.log('📡 [Matchmaking] Secondary fallback found match!');
                    typedData = fallbackData;
                }
            }

            if (typedData?.status === 'matched' && typedData.match_id) {
                console.log(`✅ [Matchmaking] Match found! ID: ${typedData.match_id}`);
                if (pollingRef.current) clearInterval(pollingRef.current);
                
                setMatchId(typedData.match_id);
                setRoomCode(typedData.room_code || '');
                setStatus('matched');
                
                onMatchFoundRef.current(typedData.match_id, typedData.room_code || '', true, typedData.validation_token);
            }
        } catch (err) {
            console.error('❌ [Matchmaking] Status check failed:', err);
        }
    }, [playerId]);

    // --- Continuous 1s Timer Effect ---
    useEffect(() => {
        let interval: NodeJS.Timeout;
        
        if (status === 'searching' || status === 'expanding') {
            if (!searchStartTimeRef.current) {
                searchStartTimeRef.current = Date.now();
                console.log('📡 [Matchmaking] Timer Start:', searchStartTimeRef.current);
            }
            
            interval = setInterval(() => {
                const elapsed = Math.floor((Date.now() - (searchStartTimeRef.current || Date.now())) / 1000);
                setSearchTime(elapsed);
                
                // Triggers
                if (elapsed === 15) fetchNearbyPools();
                if (elapsed === 16) setStatus('expanding');
                
                if (elapsed >= maxSearchTimeRef.current) {
                    console.error('❌ [Matchmaking] Search timed out after', maxSearchTimeRef.current, 'seconds');
                    setError('Matchmaking timed out. Please try again.');
                    setStatus('timeout');
                }
            }, 1000);
        } else if (status === 'idle' || status === 'timeout' || status === 'error') {
            searchStartTimeRef.current = null;
            setSearchTime(0);
        }

        return () => {
            if (interval) clearInterval(interval);
        };
    }, [status, fetchNearbyPools]);

    // --- Search Triggers ---

    const startSearch = useCallback(async (wagerMin?: number, wagerMax?: number) => {
        if (isStartingRef.current) {
            console.log('📡 [Matchmaking] Search already starting, ignoring duplicate call.');
            return;
        }

        const normalizedPlayerId = playerId?.toLowerCase();
        if (!normalizedPlayerId) return;

        const criteria = `${normalizedPlayerId}-${gameMode}-${matchType}-${wager}-${wagerMin}-${wagerMax}`;
        // If we are already searching with the same criteria, don't reset the timer/state
        if (statusRef.current === 'searching' && lastSearchRef.current === criteria) {
            console.log('📡 [Matchmaking] Already searching with same criteria. Ignoring startSearch call.');
            return;
        }

        isStartingRef.current = true;
        console.log(`📡 [Matchmaking] Starting UNIFIED search for player: ${normalizedPlayerId}`);
        
        setIsConnectingToEdge(true);
        setMatchId(null);
        setRoomCode(null);
        setError(null);

        if (pollingRef.current) clearInterval(pollingRef.current);
        
        try {
            // Purge stale tickets (Supabase side) - BLOCKING to avoid race with join
            console.log('📡 [Matchmaking] Triggering blocking purge for player:', normalizedPlayerId);
            await cancelSearch(true, true);

            // Now officially in searching state
            setStatus('searching');
            lastSearchRef.current = criteria;

            // Attempt Edge Server
            if (edgeClient) {
                try {
                    console.log('📡 [Matchmaking] Attempting Edge Server connection...');
                    let connected = false;
                    const startTime = Date.now();
                    while (Date.now() - startTime < 5000) { 
                        try {
                            await edgeClient.connect();
                            connected = true;
                            break;
                        } catch (e) {
                            await new Promise(r => setTimeout(r, 1000));
                        }
                    }

                    if (connected) {
                        const targetWager = (wagerMin !== undefined && wagerMin === wagerMax) ? wagerMin : wager;
                        console.log('📡 [Matchmaking] Requesting match from Edge Server...');
                        const edgeMatch = await edgeClient.findMatch({
                            playerId: normalizedPlayerId,
                            mode: gameMode as any,
                            entryFee: targetWager,
                            minWager: wagerMin !== undefined ? wagerMin : targetWager,
                            maxWager: wagerMax !== undefined ? wagerMax : targetWager,
                            matchType: matchType as any,
                            gameMode: gameMode as any,
                            gameType: 'quick'
                        } as any);

                        if (edgeMatch && statusRef.current !== 'matched') {
                            console.log('✅ [Matchmaking] EDGE MATCH found!', edgeMatch.matchId);
                            if (pollingRef.current) clearInterval(pollingRef.current);

                            setStatus('matched');
                            setMatchId(edgeMatch.matchId);
                            setMatchData(edgeMatch);
                            setRoomCode(edgeMatch.matchId); 

                            const isIHost = edgeMatch.players[0].id.toLowerCase() === normalizedPlayerId;
                            setTimeout(() => {
                                onMatchFoundRef.current(edgeMatch.matchId, edgeMatch.matchId, isIHost, edgeMatch.validationToken);
                            }, 1000);
                            return; 
                        }
                    }
                } catch (edgeErr) {
                    console.warn('⚠️ [Matchmaking] Edge Server failed. Falling back to Supabase RPC.', edgeErr);
                } finally {
                    setIsConnectingToEdge(false);
                }
            }

            // Fallback: Supabase RPC
            console.log('📡 [Matchmaking] Falling back to Supabase RPC...');
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
            console.log('📡 [Matchmaking] Join response:', data);

            if (data.status === 'matched') {
                console.log('✅ [Matchmaking] DIRECT MATCH found via RPC.');
                if (pollingRef.current) clearInterval(pollingRef.current);
                
                setStatus('matched');
                setMatchId(data.match_id);
                setRoomCode(data.room_code || '');
                
                setTimeout(() => {
                    onMatchFoundRef.current(data.match_id, data.room_code || '', false, data.validation_token); 
                }, 1500);
            } else {
                console.log('📡 [Matchmaking] No direct match. Ticket created:', data.ticket_id);
                setTicketId(data.ticket_id);
                checkTicketStatus(data.ticket_id);
                
                if (pollingRef.current) clearInterval(pollingRef.current);
                pollingRef.current = setInterval(() => {
                    if (data.ticket_id) checkTicketStatus(data.ticket_id);
                }, 3000);
            }
        } catch (err) {
            console.error('❌ [Matchmaking] Ultimate error starting search:', err);
            setStatus('error');
        } finally {
            isStartingRef.current = false;
        }
    }, [playerId, gameMode, matchType, wager, cancelSearch, checkTicketStatus, fetchNearbyPools, edgeClient]);

    const startHybridSearch = useCallback(async (roomCode: string, slotsNeeded: number, lobbyMatchType: string, wagerMin?: number, wagerMax?: number) => {
        if (isStartingRef.current) {
            console.log('📡 [Matchmaking] Hybrid search already starting, ignoring duplicate call.');
            return;
        }

        const normalizedPlayerId = playerId.toLowerCase();
        const criteria = `hybrid-${roomCode}-${slotsNeeded}-${lobbyMatchType}-${wager}-${wagerMin}-${wagerMax}`;
        
        if (statusRef.current === 'searching' && lastSearchRef.current === criteria) {
            console.log('📡 [Matchmaking] Already in hybrid search with same criteria. Ignoring call.');
            return;
        }

        isStartingRef.current = true;
        console.log(`📡 [Matchmaking] Starting HYBRID search for room: ${roomCode}`);

        setStatus('searching');
        lastSearchRef.current = criteria;

        if (pollingRef.current) clearInterval(pollingRef.current);
        
        try {
            // Purge stale tickets (Supabase side) - BLOCKING to avoid race with join
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
                if (pollingRef.current) clearInterval(pollingRef.current);
                
                setStatus('matched');
                setMatchId(data.match_id);
                setRoomCode(data.room_code || '');

                setTimeout(() => {
                    onMatchFoundRef.current(data.match_id, data.room_code || '', false, data.validation_token);
                }, 800);
            } else {
                setTicketId(data.ticket_id);
                checkTicketStatus(data.ticket_id);
                
                if (pollingRef.current) clearInterval(pollingRef.current);
                pollingRef.current = setInterval(() => {
                    if (data.ticket_id) checkTicketStatus(data.ticket_id);
                }, 3000);
            }
        } catch (err) {
            console.error('❌ [Matchmaking] Hybrid search error:', err);
            setStatus('error');
        } finally {
            isStartingRef.current = false;
        }
    }, [playerId, gameMode, wager, cancelSearch, checkTicketStatus, fetchNearbyPools]);

    // --- Subscription Effects ---

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
                    if (statusRef.current === 'matched') return;

                    const { status: newStatus, match_id, room_code } = payload.new;
                    if (newStatus === 'matched') {
                        console.log(`✅ [Matchmaking] REALTIME MATCH! YOU ARE THE HOST. Match: ${match_id}`);
                        if (pollingRef.current) clearInterval(pollingRef.current);
                        
                        setMatchId(match_id);
                        setRoomCode(room_code || '');
                        setStatus('matched');
                        onMatchFoundRef.current(match_id, room_code || '', true, payload.new.validation_token);
                    }
                }
            )
            .subscribe();

        return () => {
            console.log('📡 [Matchmaking] Cleaning up Realtime subscription.');
            supabase.removeChannel(channel);
        };
    }, [ticketId, status]);

    // --- Tab Lifecycle ---

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
    }, [cancelSearch, status]);

    // --- Mounting Cleanup ---

    useEffect(() => {
        return () => {
            if (pollingRef.current) clearInterval(pollingRef.current);
            if (timerRef.current) clearInterval(timerRef.current);
            
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
        matchData,
        nearbyPools,
        error,
        isConnectingToEdge,
        startSearch,
        startHybridSearch,
        cancelSearch,
        extendSearch
    };
}
