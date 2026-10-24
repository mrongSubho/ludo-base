/* eslint-disable @typescript-eslint/no-explicit-any -- legacy wire/UI types; typed burn-down tracked in docs/ops/DEPLOY_OPS.md */
import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { useAppSession } from './useAppSession';

export type MatchmakingStatus = 'idle' | 'searching' | 'expanding' | 'timeout' | 'matched' | 'error';

/**
 * MM-3: the wager presets, descending — mirrors `snapFee` in the panel.
 * Kept here because expansion is the queue's behaviour, not the panel's.
 */
const FEE_PRESETS = [1_000_000, 100_000, 10_000, 1_000, 0];

/**
 * MM-3: widen a search band by exactly one preset in each direction.
 *
 * `expanding` used to be a label with nothing behind it: the ticket kept the
 * wager window it joined with, so the pool never grew and the prompt lied. One
 * step per side is deliberate — dropping straight to "any wager" would pair a
 * 1M table with a free one, which is a worse outcome than waiting.
 *
 * Returns null when the band is already as wide as it can get (free play), so
 * the caller does not restart a search that cannot widen.
 */
export function widenWagerBand(wager: number): { min: number; max?: number } | null {
    const idx = FEE_PRESETS.indexOf(wager);
    if (idx < 0) return wager > 0 ? { min: 0 } : null;
    if (idx === FEE_PRESETS.length - 1) return null; // already free
    const min = FEE_PRESETS[Math.min(idx + 1, FEE_PRESETS.length - 1)];
    const max = idx === 0 ? undefined : FEE_PRESETS[idx - 1];
    return { min, max };
}

/**
 * Session-gated ticket poll shape (GET /api/matchmaking/status). The route
 *  returns `validation_token: string | null` — null for open rooms. */
interface TicketStatus {
    status: string;
    match_id?: string | null;
    room_code?: string | null;
    validation_token: string | null;
    players?: string[];
}

/**
 * P3: a session token is a bearer credential, so it travels in a header and
 * never in a URL. Query strings end up in access logs, proxy logs, browser
 * history and `Referer` headers — every one of which is a place a credential
 * should not be. `check:routes` enforces this with an absolute "no route reads
 * sessionId from the query string" assertion, which is why the query form had
 * to go even though the route still accepted it as a fallback.
 */
function sessionAuthHeaders(sessionId: string | null): Record<string, string> {
    if (!sessionId) return {};
    return {
        'x-session-id': sessionId,
        'Authorization': `Bearer ${sessionId}`,
    };
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
    const [ticketId, setTicketId] = useState<string | null>(null);
    const [matchId, setMatchId] = useState<string | null>(null);
    const [roomCode, setRoomCode] = useState<string | null>(null);
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
    const resolveIsHost = useCallback(async (
        matchId: string,
        fallbackIsHost: boolean,
        knownPlayers?: string[]
    ): Promise<boolean> => {
        const me = (playerId || '').toLowerCase();

        // 1. If roster is already provided by match RPC or ticket status response, compute directly!
        const filteredKnown = ((knownPlayers || []) as string[])
            .map(p => String(p || '').toLowerCase())
            .filter(Boolean);

        if (filteredKnown.length > 0) {
            const sorted = [...new Set(filteredKnown)].sort();
            let h = 0;
            for (let i = 0; i < matchId.length; i++) h = (h * 31 + matchId.charCodeAt(i)) >>> 0;
            const authority = sorted[h % sorted.length];
            return authority === me;
        }

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
            const headers = sessionAuthHeaders(sessionId);
            const res = await fetch(`/api/matchmaking/status?${params.toString()}`, { headers });
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
    }, [playerId, ensureAppSession]);

    const dispatchMatch = useCallback(async (
        matchId: string,
        roomCode: string,
        fallbackIsHost: boolean,
        validationToken?: string | null,
        knownPlayers?: string[]
    ) => {
        if (matchDispatchedRef.current) return;
        if (statusRef.current === 'matched' && matchDispatchedRef.current) return;
        matchDispatchedRef.current = true;

        // MM-12: the `match-found` broadcast that announces a pairing is a PUBLIC
        // topic (`matchm-player-<wallet>` is guessable), so it deliberately does
        // not carry the `validation_token`. Dispatching straight from it left the
        // guest holding no token, and the host's matchmaking door rejects a
        // token-less join attempt — so the guest could never be seated and both
        // devices sat on the Match! panel forever.
        //
        // The token is secret material, so it is resolved here from the
        // session-gated status route rather than being broadcast. This also
        // backfills the roster, which the broadcast omits too.
        let token = validationToken ?? null;
        let players = knownPlayers;
        if (!token || !players || players.length === 0) {
            try {
                const sessionId = await ensureAppSession().catch(() => null);
                const params = new URLSearchParams({ matchId });
                if (playerId) params.set('walletAddress', playerId);
                const res = await fetch(`/api/matchmaking/status?${params.toString()}`, {
                    headers: sessionAuthHeaders(sessionId),
                });
                if (res.ok) {
                    const d = await res.json();
                    if (!token && d?.validation_token) token = d.validation_token;
                    if ((!players || players.length === 0) && Array.isArray(d?.players)) {
                        players = d.players.map((p: unknown) => String(p || '').toLowerCase()).filter(Boolean);
                    }
                }
            } catch {
                // Degrade to the fallback below rather than dispatching blind.
            }
        }

        const isHost = await resolveIsHost(matchId, fallbackIsHost, players);
        console.log(`🎯 [Matchmaking] Dispatch match ${matchId} room=${roomCode} isHost=${isHost} token=${token ? 'yes' : 'MISSING'}`);
        if (!token) {
            // A matchmaking room cannot be entered without its credential. Say so
            // loudly instead of letting the host silently reject the join.
            console.error('❌ [Matchmaking] No validation_token resolved — the host will refuse this join');
        }
        // Single null→undefined boundary: the status route types the token as
        // `string | null` (open rooms carry null); downstream only uses
        // truthiness guards, so null and undefined behave identically.
        onMatchFoundRef.current(matchId, roomCode, isHost, token ?? undefined);
    }, [resolveIsHost, playerId, ensureAppSession]);

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

    /** MM-3: set after `startSearch` exists (the timer effect runs before it). */
    const expandRef = useRef<null | (() => void)>(null);
    const rejoinRef = useRef<null | (() => void)>(null);
    const extendSearch = useCallback((seconds: number = 20) => {
        console.log(`📡 [Matchmaking] Extending search by ${seconds}s...`);
        setMaxSearchTime(prev => Math.max(prev, searchTime + seconds));
        if (statusRef.current === 'timeout') {
            rejoinRef.current?.();
        }
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
            const headers = sessionAuthHeaders(sessionId);
            const res = await fetch(`/api/matchmaking/status?${params.toString()}`, { headers });
            if (!res.ok) throw new Error(`Status route failed: ${res.status}`);
            const typedData = (await res.json()) as TicketStatus;

            if (typedData?.status === 'matched' && typedData.match_id) {
                console.log(`✅ [Matchmaking] Match found! ID: ${typedData.match_id}`);
                if (pollingRef.current) clearInterval(pollingRef.current);

                setMatchId(typedData.match_id);
                setRoomCode(typedData.room_code || '');
                setStatus('matched');

                // Our ticket landing "matched" does NOT mean we host — resolve from queue order.
                void dispatchMatch(typedData.match_id, typedData.room_code || '', false, typedData.validation_token, typedData.players);
            }
        } catch (err) {
            console.error('❌ [Matchmaking] Status check failed:', err);
        }
    }, [playerId, dispatchMatch, ensureAppSession]);

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
                    // MM-3: actually widen. The ticket is re-issued with a band one
                    // preset wider on each side; `startSearch` purges the old ticket
                    // first, so the wider window replaces it rather than queueing twice.
                    expandRef.current?.();
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
            const errJson = await response.json().catch(() => null);
            if (errJson?.error) {
                throw new Error(errJson.error);
            }
            if (response.status === 503 || response.status === 502 || response.status === 504) {
                throw new Error('Matchmaking service is temporarily unreachable. Please retry in a moment.');
            }
            if (response.status === 429) {
                throw new Error('Too many matchmaking requests. Please wait a moment before trying again.');
            }
            if (response.status === 401) {
                throw new Error('Session inactive for matchmaking. Please activate session and try again.');
            }
            const errText = await response.text().catch(() => '');
            const sanitized = errText.replace(/<[^>]*>?/gm, '').trim();
            const message = sanitized && !sanitized.toLowerCase().includes('doctype')
                ? sanitized.slice(0, 100)
                : 'Service temporarily unavailable.';
            throw new Error(`Matchmaking failed (${response.status}): ${message}`);
        }
        const data = await response.json();
        console.log('📡 [Matchmaking] Join response:', data);

        if (data.status === 'matched') {
            console.log('✅ [Matchmaking] DIRECT MATCH found via RPC.');
            if (pollingRef.current) clearInterval(pollingRef.current);

            // Signal matched peer(s) over Realtime broadcast immediately
            for (const p of data.participants || []) {
                const addr = String(p || '').toLowerCase();
                if (addr && addr !== normalizedPlayerId) {
                    void supabase.channel(`matchm-player-${addr}`).send({
                        type: 'broadcast',
                        event: 'match-found',
                        payload: { matchId: data.match_id, roomCode: data.room_code }
                    }).catch(() => {});
                }
            }

            setStatus('matched');
            setMatchId(data.match_id);
            setRoomCode(data.room_code || '');

            // Direct RPC match: resolve host deterministically using participants roster.
            void dispatchMatch(data.match_id, data.room_code || '', false, data.validation_token, data.participants);
            return true;
        }
        if (!data.ticket_id) throw new Error('Join returned neither match nor ticket');
        console.log('📡 [Matchmaking] No direct match. Ticket:', data.ticket_id);
        ticketIdRef.current = data.ticket_id;
        setTicketId(data.ticket_id);
        checkTicketStatus(data.ticket_id);
        return false;
    }, [playerId, gameMode, matchType, wager, checkTicketStatus, dispatchMatch, ensureAppSession]);

    // Poll heartbeat: check ticket status to detect matches.
    // Does NOT call joinSupabase (which would crash on unique constraint and miss status).
    const heartbeatTick = useCallback(async () => {
        if (statusRef.current !== 'searching' && statusRef.current !== 'expanding') return;
        if (refreshingRef.current) return;
        refreshingRef.current = true;
        try {
            const currentId = ticketIdRef.current;
            if (currentId) {
                await checkTicketStatus(currentId);
            }
        } catch (err) {
            console.error('❌ [Matchmaking] Heartbeat ticket check failed:', err);
        } finally {
            refreshingRef.current = false;
        }
    }, [checkTicketStatus]);

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

            // Fast path only: the Supabase RPC is the single queue.
            // MM-5: the parallel "Edge" hunt against NEXT_PUBLIC_EDGE_SERVER_URL was
            // removed. It was a second, unrelated matchmaker with its own host
            // resolution rule (roster[0] rather than the hash), it could hand back a
            // roomCode that no other subsystem knows about, and its orphan-ticket
            // cleanup was the only thing keeping it from ghost-matching. One queue,
            // one host rule.
            try {
                const matched = await joinSupabase(wagerMin, wagerMax);
                if (!matched) {
                    if (pollingRef.current) clearInterval(pollingRef.current);
                    pollingRef.current = setInterval(() => {
                        void heartbeatTick();
                    }, 1500);
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
    }, [playerId, gameMode, matchType, wager, cancelSearch, joinSupabase, heartbeatTick, isMatched]);

    // MM-3: the timer effect fires before `startSearch` is in scope, so it calls
    // through this ref. Re-issuing with a wider band is the whole point of the
    // `expanding` status — previously the label changed and the ticket did not.
    useEffect(() => {
        expandRef.current = () => {
            const band = widenWagerBand(wager);
            if (!band) return;
            console.log('📡 [Matchmaking] Expanding wager band to', band);
            void startSearch(band.min, band.max);
        };
        rejoinRef.current = () => {
            lastSearchRef.current = '';
            void startSearch();
        };
        return () => {
            expandRef.current = null;
            rejoinRef.current = null;
        };
    }, [wager, startSearch]);

    const startHybridSearch = useCallback(async (roomCode: string, slotsNeeded: number, lobbyMatchType: string, wagerMin?: number, wagerMax?: number, skipPurge: boolean = false) => {
        if (isStartingRef.current) {
            console.log('📡 [Matchmaking] Hybrid search already starting, ignoring duplicate call.');
            return;
        }

        const _normalizedPlayerId = playerId.toLowerCase();
        const criteria = `hybrid-${roomCode}-${slotsNeeded}-${lobbyMatchType}-${wager}-${wagerMin}-${wagerMax}`;
        
        if (!skipPurge && statusRef.current === 'searching' && lastSearchRef.current === criteria) {
            console.log('📡 [Matchmaking] Already in hybrid search with same criteria. Ignoring call.');
            return;
        }

        isStartingRef.current = true;
        console.log(`📡 [Matchmaking] Starting HYBRID search for room: ${roomCode}`);

        setStatus('searching');
        lastSearchRef.current = criteria;

        if (!skipPurge && pollingRef.current) clearInterval(pollingRef.current);
        
        try {
            if (!skipPurge) {
                // Purge stale tickets on initial start only — never on 5s heartbeat ticks
                await cancelSearch(true, true);
            }
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
                console.log('✅ [Matchmaking] HYBRID MATCH found.');
                if (pollingRef.current) clearInterval(pollingRef.current);

                setStatus('matched');
                setMatchId(data.match_id);
                setRoomCode(data.room_code || '');

                void dispatchMatch(data.match_id, data.room_code || '', false, data.validation_token, data.participants);
            } else {
                ticketIdRef.current = data.ticket_id;
                setTicketId(data.ticket_id);
                checkTicketStatus(data.ticket_id);
                
                if (!skipPurge) {
                    if (pollingRef.current) clearInterval(pollingRef.current);
                    pollingRef.current = setInterval(() => {
                        void startHybridSearch(roomCode, slotsNeeded, lobbyMatchType, wagerMin, wagerMax, true);
                    }, 5000);
                }
            }
        } catch (err) {
            console.error('❌ [Matchmaking] Hybrid search error:', err);
            setStatus('error');
        } finally {
            isStartingRef.current = false;
        }
    }, [playerId, gameMode, wager, cancelSearch, checkTicketStatus, fetchNearbyPools, dispatchMatch, ensureAppSession]);

    // --- Subscription Effects ---

    useEffect(() => {
        if (!ticketId || (status !== 'searching' && status !== 'expanding')) return;

        const normalized = (playerId || '').toLowerCase();
        const ticketTopic = `matchm-status-${ticketId}`;
        const playerTopic = `matchm-player-${normalized}`;

        console.log(`📡 [Matchmaking] Subscribing to Realtime (ticket: ${ticketId}, player: ${normalized})`);

        const ticketChannel = supabase
            .channel(ticketTopic)
            .on('broadcast', { event: 'match-found' }, () => {
                if (statusRef.current === 'matched') return;
                console.log(`⚡ [Matchmaking] Instant Broadcast match for ticket: ${ticketId}`);
                void checkTicketStatus(ticketId);
            })
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

        const playerChannel = normalized
            ? supabase
                .channel(playerTopic)
                .on('broadcast', { event: 'match-found' }, () => {
                    if (statusRef.current === 'matched') return;
                    console.log(`⚡ [Matchmaking] Instant Broadcast match for player: ${normalized}`);
                    void checkTicketStatus(ticketId);
                })
                .subscribe()
            : null;

        return () => {
            console.log('📡 [Matchmaking] Cleaning up Realtime subscriptions.');
            supabase.removeChannel(ticketChannel);
            if (playerChannel) supabase.removeChannel(playerChannel);
        };
    }, [ticketId, status, playerId, checkTicketStatus]);

    // --- Tab Lifecycle ---

    useEffect(() => {
        const handleVisibilityChange = () => {
            if (!document.hidden && (status === 'searching' || status === 'expanding') && ticketIdRef.current) {
                void checkTicketStatus(ticketIdRef.current);
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
    }, [cancelSearch, checkTicketStatus, status]);

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
        nearbyPools,
        error,
        startSearch,
        startHybridSearch,
        cancelSearch,
        extendSearch
    };
}
