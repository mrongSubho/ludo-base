/* eslint-disable @typescript-eslint/no-explicit-any -- legacy wire/UI types; typed burn-down tracked in docs/ops/DEPLOY_OPS.md */
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { getEdgeClient } from '@/lib/teamup/edge-server-singleton';
import { useAppSession } from './useAppSession';

export type MatchmakingStatus = 'idle' | 'searching' | 'expanding' | 'timeout' | 'matched' | 'error';

/** Session-gated ticket poll shape (GET /api/matchmaking/status). The route
 *  returns `validation_token: string | null` — null for open rooms. */
interface TicketStatus {
    status: string;
    match_id?: string | null;
    room_code?: string | null;
    validation_token: string | null;
    players?: string[];
}

interface UseMatchmakingProps {
    playerId: string;
    gameMode: string;
    matchType: string;
    wager: number;
    onMatchFound: (matchId: string, roomCode: string, isHost: boolean, validationToken?: string) => void;
    /** Fired when host resolution degrades to the fallback (route failure). */
    onDegraded?: (matchId: string, cause: unknown) => void;
}

export function useMatchmaking(props: UseMatchmakingProps) {
    const {
        playerId,
        gameMode,
        matchType,
        wager,
        onMatchFound,
        onDegraded
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
    const { ensureAppSession } = useAppSession();

    // --- Refs ---
    const ticketIdRef = useRef<string | null>(null);
    const searchStartTimeRef = useRef<number | null>(null);
    const maxSearchTimeRef = useRef(30);
    const lastSearchRef = useRef<string>('');
    const isStartingRef = useRef(false);
    const statusRef = useRef<MatchmakingStatus>(status);
    const onMatchFoundRef = useRef(onMatchFound);
    const onDegradedRef = useRef(onDegraded);
    const pollingRef = useRef<NodeJS.Timeout | null>(null);
    const timerRef = useRef<NodeJS.Timeout | null>(null);
    const refreshingRef = useRef(false);
    const poolsFiredRef = useRef(false);
    const expandFiredRef = useRef(false);
    /** Fire onMatchFound once per match — ticket realtime + heartbeat used to race. */
    const matchDispatchedRef = useRef(false);

    /**
     * Quick Match has no "room creator" — everyone searches independently.
     * After pairing we still need ONE engine authority (P2P/Edge host role).
     * Pick it deterministically from match_id + wallet so neither side is
     * special for having queued first, and both clients agree without a race.
     */
    const resolveIsHost = useCallback(async (matchId: string, fallbackIsHost: boolean): Promise<boolean> => {
        const me = (playerId || '').toLowerCase();
        const markDegraded = (cause: unknown) => {
            // Split-brain guard: silently returning the fallback lets two peers
            // diverge with no surfaced error, so log loudly (matchId + cause)
            // and expose the degraded state to the caller. Dispatch semantics
            // are unchanged — the fallback is still returned.
            console.error(`❌ [Matchmaking] Host resolution degraded for match ${matchId}, using fallback=${fallbackIsHost}:`, cause);
            onDegradedRef.current?.(matchId, cause);
        };
        try {
            // Owner-checked roster via the status route: matchmaking_queue
            // player_ids are server-only under default-deny (anon reads go empty).
            const sessionId = await ensureAppSession().catch(() => null);
            const params = new URLSearchParams({ matchId });
            if (playerId) params.set('walletAddress', playerId);
            if (sessionId) params.set('sessionId', sessionId);
            const res = await fetch(`/api/matchmaking/status?${params.toString()}`);
            if (!res.ok) { markDegraded(`status route failed: ${res.status}`); return fallbackIsHost; }
            const data = await res.json();
            const players = ((data?.players || []) as string[]).map(p => String(p || '').toLowerCase()).filter(Boolean);
            if (players.length === 0) { markDegraded('empty roster'); return fallbackIsHost; }
            // Stable pick: sort wallets, index by hash(matchId)
            const sorted = [...new Set(players)].sort();
            let h = 0;
            for (let i = 0; i < matchId.length; i++) h = (h * 31 + matchId.charCodeAt(i)) >>> 0;
            const authority = sorted[h % sorted.length];
            return authority === me;
        } catch (err) {
            markDegraded(err);
            return fallbackIsHost;
        }
    }, [playerId]);

    const dispatchMatch = useCallback(async (
        matchId: string,
        roomCode: string,
        fallbackIsHost: boolean,
        validationToken?: string | null
    ) => {
        if (matchDispatchedRef.current) return;
        if (statusRef.current === 'matched' && matchDispatchedRef.current) return;
        matchDispatchedRef.current = true;
        const isHost = await resolveIsHost(matchId, fallbackIsHost);
        console.log(`🎯 [Matchmaking] Dispatch match ${matchId} room=${roomCode} isHost=${isHost}`);
        // Single null→undefined boundary: the status route types the token as
        // `string | null` (open rooms carry null); downstream only uses
        // truthiness guards, so null and undefined behave identically.
        onMatchFoundRef.current(matchId, roomCode, isHost, validationToken ?? undefined);
    }, [resolveIsHost]);

    // --- Memoized Clients ---
    const edgeClient = useMemo(() => getEdgeClient(), []);

    // --- Synchronization Effects ---
    useEffect(() => {
        statusRef.current = status;
        onMatchFoundRef.current = onMatchFound;
        onDegradedRef.current = onDegraded;
        ticketIdRef.current = ticketId;
        maxSearchTimeRef.current = maxSearchTime;
    }, [status, onMatchFound, onDegraded, ticketId, maxSearchTime]);

    // --- Stable Callbacks ---

    // Stable matched-check (avoids TS narrowing issues with statusRef across awaits)
    const isMatched = useCallback(() => statusRef.current === 'matched', []);

    const fetchNearbyPools = useCallback(async () => {
        try {
            // Public aggregate via service role: matchmaking_queue player_ids
            // are server-only under default-deny (anon reads go empty).
            const params = new URLSearchParams({ gameMode, matchType });
            if (playerId) params.set('walletAddress', playerId);
            const res = await fetch(`/api/matchmaking/pools?${params.toString()}`);
            if (!res.ok) throw new Error(`Pools route failed: ${res.status}`);
            const { pools } = await res.json();
            const counts: Record<number, number> = {};
            for (const [wager, count] of Object.entries((pools || {}) as Record<string, number>)) {
                const w = Number(wager);
                if (Number.isFinite(w) && count > 0) counts[w] = count;
            }

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
            const sessionId = await ensureAppSession();
            await fetch('/api/matchmaking/cancel', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    ticketId: allForPlayer ? null : currentTicketId,
                    playerId: playerId.toLowerCase(),
                    sessionId
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
            matchDispatchedRef.current = false;
            if (pollingRef.current) {
                console.log('📡 [Matchmaking] Clearing polling timer');
                clearInterval(pollingRef.current);
            }
            lastSearchRef.current = ''; 
        }
    }, [playerId, ensureAppSession]);

    const checkTicketStatus = useCallback(async (id: string) => {
        if (statusRef.current === 'matched') return;
        
        console.log(`📡 [Matchmaking] Checking status (ID: ${id})...`);
        try {
            // Session-gated status route: validation_token is secret material
            // (no anon column grant), so ticket polling must never read the
            // queue directly from the browser.
            const sessionId = await ensureAppSession();
            const params = new URLSearchParams({ ticketId: id });
            if (playerId) params.set('walletAddress', playerId);
            if (sessionId) params.set('sessionId', sessionId);
            const res = await fetch(`/api/matchmaking/status?${params.toString()}`);
            if (!res.ok) throw new Error(`Status route failed: ${res.status}`);
            const typedData = (await res.json()) as TicketStatus;

            if (typedData?.status === 'matched' && typedData.match_id) {
                console.log(`✅ [Matchmaking] Match found! ID: ${typedData.match_id}`);
                if (pollingRef.current) clearInterval(pollingRef.current);

                setMatchId(typedData.match_id);
                setRoomCode(typedData.room_code || '');
                setStatus('matched');

                // Our ticket landing "matched" does NOT mean we host — resolve from queue order.
                void dispatchMatch(typedData.match_id, typedData.room_code || '', false, typedData.validation_token);
            }
        } catch (err) {
            console.error('❌ [Matchmaking] Status check failed:', err);
        }
    }, [playerId, gameMode, matchType, dispatchMatch, ensureAppSession]);

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

                // Triggers (>= so throttled background tabs can't skip them)
                if (elapsed >= 15 && !poolsFiredRef.current) {
                    poolsFiredRef.current = true;
                    fetchNearbyPools();
                }
                if (elapsed >= 16 && !expandFiredRef.current) {
                    expandFiredRef.current = true;
                    setStatus('expanding');
                }

                if (elapsed >= maxSearchTimeRef.current) {
                    console.error('❌ [Matchmaking] Search timed out after', maxSearchTimeRef.current, 'seconds');
                    if (pollingRef.current) {
                        clearInterval(pollingRef.current);
                        pollingRef.current = null;
                    }
                    // Server-side cancel only — keep the timeout UI on screen
                    cancelSearch(false, true);
                    setError('Matchmaking timed out. Please try again.');
                    setStatus('timeout');
                }
            }, 1000);
        } else if (status === 'idle' || status === 'timeout' || status === 'error') {
            searchStartTimeRef.current = null;
            poolsFiredRef.current = false;
            expandFiredRef.current = false;
            setSearchTime(0);
        }

        return () => {
            if (interval) clearInterval(interval);
        };
    }, [status, fetchNearbyPools, cancelSearch]);

    // --- Supabase RPC join only: no purge, no Edge, no dedupe ---
    // Heartbeat-safe: re-running it re-uses our ticket (bumps expiry server-side),
    // retries opponent matching, and re-checks status. Returns true on direct match.
    const joinSupabase = useCallback(async (wagerMin?: number, wagerMax?: number) => {
        const normalizedPlayerId = playerId?.toLowerCase();
        if (!normalizedPlayerId) return false;
        const sessionId = await ensureAppSession();
        if (!sessionId) throw new Error('Wallet session required for matchmaking');

        console.log('📡 [Matchmaking] Joining via Supabase RPC...');
        const response = await fetch('/api/matchmaking/join', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                playerId: normalizedPlayerId,
                sessionId,
                gameMode,
                matchType,
                wager,
                wagerMin,
                wagerMax
            })
        });
        if (!response.ok) {
            const errText = await response.text().catch(() => '');
            throw new Error(`Join request failed (${response.status}): ${errText.slice(0, 120)}`);
        }
        const data = await response.json();
        console.log('📡 [Matchmaking] Join response:', data);

        if (data.status === 'matched') {
            console.log('✅ [Matchmaking] DIRECT MATCH found via RPC.');
            if (pollingRef.current) clearInterval(pollingRef.current);

            setStatus('matched');
            setMatchId(data.match_id);
            setRoomCode(data.room_code || '');

            // Direct RPC match: we joined someone already waiting → usually guest.
            void dispatchMatch(data.match_id, data.room_code || '', false, data.validation_token);
            return true;
        }
        if (!data.ticket_id) throw new Error('Join returned neither match nor ticket');
        console.log('📡 [Matchmaking] No direct match. Ticket:', data.ticket_id);
        setTicketId(data.ticket_id);
        checkTicketStatus(data.ticket_id);
        return false;
    }, [playerId, gameMode, matchType, wager, checkTicketStatus, dispatchMatch, ensureAppSession]);

    // 5s heartbeat: extend ticket + detect matches. Never purges, never touches Edge.
    const heartbeatTick = useCallback(async (wagerMin?: number, wagerMax?: number) => {
        if (statusRef.current !== 'searching' && statusRef.current !== 'expanding') return;
        if (refreshingRef.current) return;
        refreshingRef.current = true;
        try {
            const matched = await joinSupabase(wagerMin, wagerMax);
            if (!matched && ticketIdRef.current) await checkTicketStatus(ticketIdRef.current);
        } catch (err) {
            console.error('❌ [Matchmaking] Heartbeat failed:', err);
        } finally {
            refreshingRef.current = false;
        }
    }, [joinSupabase, checkTicketStatus]);

    // Background Edge attempt: runs AFTER (never before) the fast Supabase join,
    // fire-and-forget. A silent Edge server can delay but never wedge searching.
    // If Edge wins after Supabase already matched, it stands down and kills our orphan ticket.
    const attemptEdgeInBackground = useCallback(async (wagerMin?: number, wagerMax?: number) => {
        if (!edgeClient) return;
        const normalizedPlayerId = playerId?.toLowerCase();
        if (!normalizedPlayerId) return;
        try {
            setIsConnectingToEdge(true);
            let connected = false;
            const startTime = Date.now();
            while (Date.now() - startTime < 3000) {
                try {
                    await edgeClient.connect();
                    connected = true;
                    break;
                } catch (_e) {
                    await new Promise(r => setTimeout(r, 1000));
                }
            }
            if (!connected) return;

            const targetWager = (wagerMin !== undefined && wagerMin === wagerMax) ? wagerMin : wager;
            const edgeMatch = await Promise.race([
                edgeClient.findMatch({
                    playerId: normalizedPlayerId,
                    mode: gameMode as any,
                    entryFee: targetWager,
                    minWager: wagerMin !== undefined ? wagerMin : targetWager,
                    maxWager: wagerMax !== undefined ? wagerMax : targetWager,
                    matchType: matchType as any,
                    gameMode: gameMode as any,
                    gameType: 'quick'
                } as any),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Edge findMatch timed out after 8s')), 8000)),
            ]) as any;

            if (!edgeMatch || isMatched()) {
                // Lost the race to Supabase: kill our orphan ticket so it can't ghost-match later
                if (edgeMatch && ticketIdRef.current) {
                    fetch('/api/matchmaking/cancel', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ ticketId: ticketIdRef.current, playerId: null })
                    }).catch(() => {});
                }
                return;
            }
            console.log('✅ [Matchmaking] EDGE MATCH found (background)!', edgeMatch.matchId);
            if (pollingRef.current) clearInterval(pollingRef.current);

            setStatus('matched');
            setMatchId(edgeMatch.matchId);
            setMatchData(edgeMatch);
            setRoomCode(edgeMatch.matchId);

            const isIHost = edgeMatch.players[0].id.toLowerCase() === normalizedPlayerId;
            void dispatchMatch(edgeMatch.matchId, edgeMatch.matchId, isIHost, edgeMatch.validationToken);
        } catch (edgeErr) {
            console.warn('⚠️ [Matchmaking] Background Edge attempt failed quietly.', edgeErr);
        } finally {
            setIsConnectingToEdge(false);
        }
    }, [edgeClient, playerId, gameMode, matchType, wager, isMatched, dispatchMatch]);

    // --- Search Triggers ---

    const startSearch = useCallback(async (wagerMin?: number, wagerMax?: number) => {
        if (isStartingRef.current) {
            console.log('📡 [Matchmaking] Search already starting, ignoring duplicate call.');
            return;
        }

        const normalizedPlayerId = playerId?.toLowerCase();
        if (!normalizedPlayerId) return;

        // Never purge/restart once a match landed (kills the purge race)
        if (isMatched()) {
            console.log('📡 [Matchmaking] Already matched. Ignoring startSearch call.');
            return;
        }

        const criteria = `${normalizedPlayerId}-${gameMode}-${matchType}-${wager}-${wagerMin}-${wagerMax}`;
        // If we are already searching with the same criteria, don't reset the timer/state
        if (statusRef.current === 'searching' && lastSearchRef.current === criteria) {
            console.log('📡 [Matchmaking] Already searching with same criteria. Ignoring startSearch call.');
            return;
        }

        isStartingRef.current = true;
        console.log(`📡 [Matchmaking] Starting UNIFIED search for player: ${normalizedPlayerId}`);

        setMatchId(null);
        setRoomCode(null);
        setError(null);
        matchDispatchedRef.current = false;

        if (pollingRef.current) clearInterval(pollingRef.current);

        try {
            // Purge stale tickets (Supabase side) - BLOCKING to avoid race with join
            console.log('📡 [Matchmaking] Triggering blocking purge for player:', normalizedPlayerId);
            await cancelSearch(true, true);

            // Now officially in searching state
            setStatus('searching');
            lastSearchRef.current = criteria;

            // Fast path first: Supabase RPC join (hundreds of ms, never wedges).
            try {
                const matched = await joinSupabase(wagerMin, wagerMax);
                if (!matched) {
                    if (pollingRef.current) clearInterval(pollingRef.current);
                    pollingRef.current = setInterval(() => {
                        heartbeatTick(wagerMin, wagerMax);
                    }, 5000);
                    // Slow path in background: Edge hunts in parallel, stands down if RPC wins.
                    attemptEdgeInBackground(wagerMin, wagerMax);
                }
            } catch (err) {
                console.error('❌ [Matchmaking] Supabase join failed:', err);
                setError(err instanceof Error ? err.message : 'Matchmaking join failed.');
                setStatus('error');
            }
        } catch (err) {
            console.error('❌ [Matchmaking] Ultimate error starting search:', err);
            setError(err instanceof Error ? err.message : 'Matchmaking failed to start.');
            setStatus('error');
        } finally {
            isStartingRef.current = false;
        }
    }, [playerId, gameMode, matchType, wager, cancelSearch, joinSupabase, heartbeatTick, attemptEdgeInBackground, isMatched]);

    const startHybridSearch = useCallback(async (roomCode: string, slotsNeeded: number, lobbyMatchType: string, wagerMin?: number, wagerMax?: number) => {
        if (isStartingRef.current) {
            console.log('📡 [Matchmaking] Hybrid search already starting, ignoring duplicate call.');
            return;
        }

        const _normalizedPlayerId = playerId.toLowerCase();
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
            const sessionId = await ensureAppSession();
            if (!sessionId) throw new Error('Wallet session required for matchmaking');
            const response = await fetch('/api/matchmaking/join', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    playerId,
                    sessionId,
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

                void dispatchMatch(data.match_id, data.room_code || '', false, data.validation_token);
            } else {
                setTicketId(data.ticket_id);
                checkTicketStatus(data.ticket_id);
                
                if (pollingRef.current) clearInterval(pollingRef.current);
                pollingRef.current = setInterval(() => {
                    startHybridSearch(roomCode, slotsNeeded, lobbyMatchType, wagerMin, wagerMax);
                }, 5000);
            }
        } catch (err) {
            console.error('❌ [Matchmaking] Hybrid search error:', err);
            setStatus('error');
        } finally {
            isStartingRef.current = false;
        }
    }, [playerId, gameMode, wager, cancelSearch, checkTicketStatus, fetchNearbyPools, dispatchMatch]);

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

                    const { status: newStatus, match_id } = payload.new;
                    if (newStatus === 'matched') {
                        console.log(`✅ [Matchmaking] REALTIME MATCH! Match: ${match_id}`);
                        // Never trust payload columns (ungranted under default-deny,
                        // and validation_token must come owner-checked): re-verify
                        // through the session-gated status route, which dispatches.
                        void checkTicketStatus(ticketId);
                    }
                }
            )
            .subscribe();

        return () => {
            console.log('📡 [Matchmaking] Cleaning up Realtime subscription.');
            supabase.removeChannel(channel);
        };
    }, [ticketId, status, checkTicketStatus]);

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
