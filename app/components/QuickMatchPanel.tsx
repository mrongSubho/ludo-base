"use client";

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useMatchmaking } from '@/hooks/useMatchmaking';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useTeamUpContext } from '@/hooks/TeamUpContext';
import { TeamUpWrapper } from './TeamUp/TeamUpWrapper';
import { supabase } from '@/lib/supabase';
import { getProgression } from '@/lib/progression';
import { GamePanelShell } from './GamePanelShell';
import { Button } from './Button';
import { Chip } from './Chip';
import { ThinkingOrb } from './ThinkingOrb';
import { useArenaVault } from '@/hooks/useArenaVault';
import { useToast } from './Toast';
import { HudCornerTicks } from './HudPrimitives';
import { ChipsHexIcon, PilotAvatarFallbackIcon, QuickDeployIcon, SimBotIcon } from './icons';
import { ENTRY_FEE_TIERS } from '@/lib/entryFeeDial';

const PRO_TIPS = [
    "Safe zones protect you from capture!",
    "Capture opponents to get a bonus roll!",
    "Win to climb the global leaderboard!",
    "Use power-ups strategically to gain an edge.",
    "Rolling a 6 gives you an extra turn!",
    "Block your opponents to slow them down.",
];

/** Matchmaking snaps to the same fee ladders as the lobby. */
const FEE_PRESETS = ENTRY_FEE_TIERS;

function snapFee(n: number): number {
    return FEE_PRESETS.reduce((best, p) => (Math.abs(p - n) < Math.abs(best - n) ? p : best), FEE_PRESETS[0]);
}

function feeLabel(n: number): string {
    if (n === 0) return 'Free';
    if (n >= 1_000_000) {
        const m = n / 1_000_000;
        return Number.isInteger(m) ? `${m}M` : `${m.toFixed(1)}M`;
    }
    if (n >= 1_000) return `${n / 1_000}k`;
    return String(n);
}

function adjacentPresets(n: number): { lower?: number; higher?: number } {
    const i = FEE_PRESETS.indexOf(snapFee(n) as typeof FEE_PRESETS[number]);
    return {
        lower: i > 0 ? FEE_PRESETS[i - 1] : undefined,
        higher: i < FEE_PRESETS.length - 1 ? FEE_PRESETS[i + 1] : undefined,
    };
}

const QuickTile = () => (
    <div className="hud-chamfer-sm w-6 h-6 rounded-lg bg-accent-soft border border-accent/35 flex items-center justify-center">
        <QuickDeployIcon className="w-3.5 h-3.5 text-accent" />
    </div>
);

interface QuickMatchPanelProps {
    gameMode: 'classic' | 'power';
    matchType: '1v1' | '2v2' | '4P';
    wager: number;
    onStartGame: (isBotMatch?: boolean) => void;
    onCancel: () => void;
    isHybrid?: boolean;
    roomCode?: string;
    slotsNeeded?: number;
}

export const QuickMatchPanel = ({
    gameMode,
    matchType,
    wager,
    onStartGame,
    onCancel,
    isHybrid = false,
    roomCode,
    slotsNeeded = 1,
}: QuickMatchPanelProps) => {
    const { address, profile, displayName: finalName } = useCurrentUser();
    const normalizedAddress = address?.toLowerCase() || '';
    const vault = useArenaVault();
    const toast = useToast();

    const {
        status,
        searchTime,
        ticketId,
        matchId: hookMatchId,
        roomCode: hookRoomCode,
        nearbyPools,
        error: matchError,
        startSearch,
        startHybridSearch,
        cancelSearch,
        extendSearch,
    } = useMatchmaking({
        playerId: normalizedAddress,
        gameMode,
        matchType,
        wager: snapFee(wager),
        onMatchFound: (matchId: string, foundRoomCode: string) => {
            console.log(`🎲 [Matchmaking] Match Found! MatchId: ${matchId}, Room: ${foundRoomCode}`);
            connectRoom(matchId);
        },
    });

    const {
        leaveGame,
        connectRoom,
        isLobbyConnected,
        isHost: p2pHost,
        roomStatus,
        roomError,
        gameState,
        createProvisionalSession,
    } = useTeamUpContext();
    const [tipIndex, setTipIndex] = useState(0);
    const [_hasExpanded, setHasExpanded] = useState(false);
    const [showExpansionOptions, setShowExpansionOptions] = useState(false);
    /** Fee the ticket is actually searching on (snapped; changes on expand). */
    const [activeWager, setActiveWager] = useState(() => snapFee(wager));
    const activeWagerRef = useRef(activeWager);
    useEffect(() => { activeWagerRef.current = activeWager; }, [activeWager]);
    const [wagerRange, setWagerRange] = useState<{ min: number; max?: number } | null>(null);
    const [opponentProfile, setOpponentProfile] = useState<{
        username: string;
        avatar_url: string | null;
        lxp: number;
        rxp: number;
        total_wins: number;
        total_games: number;
    } | null>(null);
    const [isLoadingRival, setIsLoadingRival] = useState(false);
    const [_expectedOpponent, setExpectedOpponent] = useState<string | null>(null);

    const [isStalled, setIsStalled] = useState(false);
    const preAuthStartedRef = useRef(false);

    // Auto-reveal expand overlay at 15s; vanish at 28s if ignored.
    useEffect(() => {
        if (status === 'searching' || status === 'expanding') {
            if (searchTime === 15) {
                setShowExpansionOptions(true);
            }
            if (searchTime === 28) {
                setShowExpansionOptions(false);
            }
        }

        // Stall detection: matched but the board never opened
        if (status === 'matched' && !gameState?.isStarted) {
            const stallTimer = setTimeout(() => setIsStalled(true), 4000);
            return () => clearTimeout(stallTimer);
        }
        setIsStalled(false);
    }, [searchTime, status, gameState?.isStarted]);

    // Tip rotation
    useEffect(() => {
        const interval = setInterval(() => {
            setTipIndex((prev) => (prev + 1) % PRO_TIPS.length);
        }, 5000);
        return () => clearInterval(interval);
    }, []);

    // ─── Phase S4: Server-owned match start transition ───
    useEffect(() => {
        if (status === 'matched' && gameState?.isStarted) {
            console.log('🏁 [QuickMatch] Server room state received. Synchronizing UI to board...');
            onStartGame(false);
        }
    }, [status, gameState?.isStarted, onStartGame]);

    const activeRoomCode = hookRoomCode || roomCode;

    // Fetch Opponent Profile / Reveal from the canonical match row
    useEffect(() => {
        if (status === 'matched') {
            const fetchOpponentData = async () => {
                const roomToSearch = activeRoomCode || hookRoomCode || roomCode;
                if (!roomToSearch) return;

                setIsLoadingRival(true);
                try {
                    const { data: match, error: mErr } = await supabase
                        .from('matches')
                        .select('participants')
                        .eq('room_code', roomToSearch)
                        .maybeSingle();

                    if (mErr || !match || !match.participants) throw new Error('Match record not found');

                    const opponentAddress = match.participants.find((p: string) => p.toLowerCase() !== normalizedAddress);
                    if (opponentAddress) {
                        setExpectedOpponent(opponentAddress.toLowerCase());
                        const { data: player } = await supabase
                            .from('players')
                            .select('username, avatar_url, lxp, rxp, total_wins, total_games')
                            .eq('wallet_address', opponentAddress.toLowerCase())
                            .maybeSingle();

                        if (player) {
                            setOpponentProfile({
                                username: player.username || 'Rival',
                                avatar_url: player.avatar_url,
                                lxp: player.lxp || 0,
                                rxp: player.rxp || 0,
                                total_wins: player.total_wins || 0,
                                total_games: player.total_games || 0,
                            });
                        } else if (opponentAddress) {
                            setOpponentProfile({
                                username: 'User ' + opponentAddress.slice(-4).toUpperCase(),
                                avatar_url: null,
                                lxp: 0,
                                rxp: 1500,
                                total_wins: 0,
                                total_games: 0,
                            });
                        }
                    }
                } catch (err) {
                    console.error('❌ [QuickMatch] Error fetching rival data:', err);
                } finally {
                    setIsLoadingRival(false);
                }
            };
            void fetchOpponentData();
        } else {
            setOpponentProfile(null);
        }
    }, [status, activeRoomCode, normalizedAddress, hookRoomCode, roomCode]);

    const releaseVaultIfSearching = useCallback(() => {
        if (normalizedAddress && activeWager > 0 && status !== 'matched') {
            void vault.releaseMatchStake(`qm:${normalizedAddress}`).then((released) => {
                if (released > 0) {
                    toast(
                        `${released.toLocaleString()} CHIPS kept in Match Vault for your next match (0 gas).`,
                        'info',
                    );
                }
            });
        }
    }, [normalizedAddress, activeWager, status, vault, toast]);

    const handleBackToLobby = useCallback(() => {
        releaseVaultIfSearching();
        cancelSearch();
        onCancel();
    }, [releaseVaultIfSearching, cancelSearch, onCancel]);

    useEffect(() => {
        if (!normalizedAddress) return;

        let cancelled = false;
        void (async () => {
            console.log('🏁 [QuickMatch] Triggering search initialization...');
            if (!isHybrid && !preAuthStartedRef.current) {
                preAuthStartedRef.current = true;
                const key = `search:${normalizedAddress}:${gameMode}:${matchType}`;
                const result = await createProvisionalSession(key, undefined, { context: 'quick-match' });
                if (!result.ok) {
                    preAuthStartedRef.current = false;
                    console.warn('🔑 [QuickMatch] pre-match authorization failed:', result.error);
                    handleBackToLobby();
                    return;
                }
            }
            if (cancelled) return;
            if (isHybrid && roomCode) {
                startHybridSearch(roomCode, slotsNeeded, matchType);
            } else {
                startSearch(wagerRange?.min, wagerRange?.max);
            }
        })();
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [normalizedAddress, isHybrid, roomCode, slotsNeeded, matchType, gameMode, createProvisionalSession, startSearch, startHybridSearch]);

    const handleForceBotMatch = () => {
        releaseVaultIfSearching();
        leaveGame();
        cancelSearch();
        onStartGame(true);
    };

    const handleCancelAndClose = () => {
        if (status === 'matched' && activeWager > 0 && !isStalled) {
            return;
        }
        releaseVaultIfSearching();
        cancelSearch();
        onCancel();
    };

    const handleExpandWager = (param: number | 'any') => {
        setHasExpanded(true);
        setShowExpansionOptions(false);
        extendSearch(20);

        if (param === 'any') {
            setWagerRange({ min: 0, max: undefined });
            console.log('[Matchmaking] Expanding search: any fee');
            startSearch(0, undefined);
            return;
        }

        const fee = snapFee(param);
        const runExpand = async () => {
            if (normalizedAddress) {
                if (fee === 0) {
                    const rel = await vault.releaseMatchStake(`qm:${normalizedAddress}`);
                    if (rel > 0) toast(`${rel.toLocaleString()} CHIPS returned to your Match Vault (0 gas).`, 'info');
                } else {
                    await vault.ensureVaultAndReserve({
                        matchKey: `qm:${normalizedAddress}`,
                        entryFeeChips: fee,
                    });
                }
            }
            setActiveWager(fee);
            setWagerRange({ min: fee, max: fee });
            console.log(`[Matchmaking] Expanding search to preset ${fee}`);
            startSearch(fee, fee);
        };
        void runExpand().catch((err: unknown) => {
            const msg = err instanceof Error ? err.message : undefined;
            toast(msg || 'Could not adjust Match Vault fee.', 'error');
        });
    };

    const handleStayHere = () => {
        setShowExpansionOptions(false);
        extendSearch(20);
    };

    const snappedPools = (() => {
        const seen = new Set<number>([activeWager]);
        const out: { fee: number; waiters: number }[] = [];
        for (const pool of nearbyPools || []) {
            const fee = snapFee(pool.wager);
            if (seen.has(fee)) continue;
            seen.add(fee);
            out.push({ fee, waiters: pool.waiters });
        }
        return out;
    })();
    const { lower: lowerFee, higher: higherFee } = adjacentPresets(activeWager);

    const handleRetry = () => {
        setHasExpanded(false);
        setWagerRange(null);
        const fee = activeWager;
        startSearch(fee, fee);
    };

    const isSearching = status === 'searching' || status === 'expanding';

    return (
        <GamePanelShell
            scopeClass="ludo-quick-scope"
            kicker="// RANKED QUEUE"
            title={(
                <span className="inline-flex items-center gap-2">
                    <QuickTile />
                    <span>Quick Match</span>
                </span>
            )}
            subtitle={(
                <span className="inline-flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-accent uppercase">{gameMode}</span>
                    <span className="w-1 h-1 rounded-full bg-line-strong" />
                    <span className="font-bold text-ink-muted uppercase">{matchType}</span>
                    <span className="w-1 h-1 rounded-full bg-line-strong" />
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-warn/15 border border-warn/35 text-warn font-extrabold font-mono tabular-nums">
                        <ChipsHexIcon className="w-3 h-3 text-warn" active />
                        <span>
                            {wagerRange?.max === undefined && wagerRange?.min === 0
                                ? 'Any'
                                : activeWager.toLocaleString()}
                        </span>
                    </span>
                </span>
            )}
            onClose={handleCancelAndClose}
            hideOrbs
        >
            <div className="relative flex-1 min-h-0 flex flex-col overflow-hidden">
                {/* Diagnostic Bar strip */}
                <div className="px-5 py-2 border-b border-line-soft bg-surface-recessed/60 flex items-center gap-1.5 flex-wrap shrink-0 relative z-10">
                    <span className={`diag-chip ${status === 'matched' ? 'diag-status-ok' : 'diag-status-info'}`}>
                        QUEUE | {status}
                    </span>
                    <span className="diag-chip">
                        ID: {normalizedAddress.slice(-4)}
                    </span>
                    {ticketId && (
                        <span className="diag-chip">
                            Network ID {ticketId.slice(0, 8).toUpperCase()}
                        </span>
                    )}
                    {isSearching && <div className="rail-sweep-3077 hidden ml-auto" aria-hidden />}
                </div>

                {/* Dynamic Matchmaking Content */}
                <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar flex flex-col items-center justify-center relative px-5">
                    {/* Tip Section */}
                    <div className="w-full pt-2 pb-1 shrink-0">
                        <div key={tipIndex} className="flex flex-col items-center gap-1">
                            <span className="text-ludo-xs uppercase font-extrabold tracking-[0.3em] text-accent">Pro Tip</span>
                            <p className="text-xs font-medium text-ink-muted text-center max-w-[280px] leading-relaxed">
                                {PRO_TIPS[tipIndex]}
                            </p>
                        </div>
                    </div>

                    <TeamUpWrapper mode="quick" entryFee={wager}>
                        <div className="flex flex-col items-center justify-center w-full h-full min-h-[280px] relative">
                            {status !== 'matched' && (
                                <div className="relative w-64 h-64 md:w-72 md:h-72 flex items-center justify-center">
                                    {/* Subtle Outer Glow */}
                                    <div className="absolute inset-[-15%] bg-accent/5 blur-[60px] rounded-full pointer-events-none" />

                                    {/* Multiple Concentric Rings */}
                                    {[1, 2, 3].map((ring) => (
                                        <motion.div
                                            key={`ring-${ring}`}
                                            animate={{ rotate: ring % 2 === 0 ? 360 : -360 }}
                                            transition={{ duration: 15 + (ring * 5), repeat: Infinity, ease: "linear" }}
                                            className={`absolute border rounded-full ${ring % 2 === 0 ? 'border-dashed' : 'border-dotted'}`}
                                            style={{
                                                inset: ring * 24,
                                                borderColor: `rgba(var(--accent-rgb, 0, 229, 255), ${0.14 + (ring * 0.06)})`,
                                            }}
                                        />
                                    ))}

                                    {/* Orbiting Signal Nodes */}
                                    {[0, 120, 240].map((angle, i) => (
                                        <motion.div
                                            key={`node-${i}`}
                                            animate={{ rotate: 360 }}
                                            transition={{ duration: 10 + i * 2, repeat: Infinity, ease: "linear" }}
                                            className="absolute inset-0 flex items-start justify-center"
                                            style={{ transform: `rotate(${angle}deg)` }}
                                        >
                                            <div className="w-1.5 h-1.5 rounded-full bg-accent shadow-[0_0_8px_color-mix(in_srgb,var(--accent)_80%,transparent)] mt-[-0.75px]" />
                                        </motion.div>
                                    ))}

                                    {/* Scanner Sweep */}
                                    <motion.div
                                        animate={{ rotate: 360 }}
                                        transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
                                        className="absolute inset-0 rounded-full pointer-events-none"
                                        style={{
                                            background: 'conic-gradient(from 0deg, transparent 60%, rgba(var(--accent-rgb, 0, 229, 255), 0.16) 100%)',
                                        }}
                                    />

                                    {/* Central Data Core */}
                                    <div className="relative z-10 w-28 h-28 md:w-32 md:h-32 bg-surface-panel rounded-full border border-line-strong flex flex-col items-center justify-center backdrop-blur-2xl shadow-xl overflow-hidden">
                                        <div className="absolute inset-0 bg-gradient-to-tr from-accent/15 via-transparent to-accent/10 opacity-60 pointer-events-none" />

                                        {/* Scanning Y-Sweep (compositor transform) */}
                                        <motion.div
                                            initial={{ y: -56 }}
                                            animate={{ y: 72 }}
                                            transition={{ duration: 2.5, repeat: Infinity, ease: "linear" }}
                                            className="absolute left-0 right-0 top-0 h-[2px] bg-accent/50 z-20 shadow-[0_0_12px_color-mix(in_srgb,var(--accent)_55%,transparent)]"
                                        />

                                        <div className="relative z-30 flex flex-col items-center">
                                            {status === 'error' ? (
                                                <>
                                                    <span className="text-ludo-xs font-extrabold text-negative uppercase tracking-widest leading-none mb-1">
                                                        FAULT
                                                    </span>
                                                    <span className="text-ludo-xs font-bold text-negative opacity-70 uppercase">
                                                        OFFLINE
                                                    </span>
                                                </>
                                            ) : !address ? (
                                                <div className="animate-pulse">
                                                    <span className="text-ludo-xs font-extrabold text-warn uppercase tracking-widest leading-none">
                                                        SYNCING
                                                    </span>
                                                </div>
                                            ) : (
                                                <>
                                                    <span className="text-3xl md:text-4xl font-mono font-extrabold text-accent tracking-tighter">
                                                        {searchTime}s
                                                    </span>
                                                    <div className="flex items-center gap-1 mt-1">
                                                        <div className="w-1 h-3 bg-accent-soft rounded-full overflow-hidden flex items-end">
                                                            <motion.div
                                                                animate={{ scaleY: [0.25, 1, 0.4] }}
                                                                transition={{ duration: 1, repeat: Infinity }}
                                                                className="w-full h-full origin-bottom bg-accent"
                                                            />
                                                        </div>
                                                        <span className="text-ludo-xs font-extrabold text-ink-muted tracking-widest uppercase">
                                                            {gameMode} | {matchType}
                                                        </span>
                                                    </div>
                                                </>
                                            )}
                                        </div>
                                    </div>

                                    {/* Status Display Below Radar */}
                                    <div className="absolute top-[92%] left-1/2 -translate-x-1/2 flex flex-col items-center min-w-[280px]">
                                        <div className="flex items-center gap-2.5 px-4 py-1.5 rounded-full bg-surface-recessed border border-line-soft backdrop-blur-md shadow-lg">
                                            {isSearching ? (
                                                <ThinkingOrb state="searching" size={20} />
                                            ) : (
                                                <div className="flex gap-1">
                                                    {[0, 1, 2].map((dot) => (
                                                        <motion.div
                                                            key={dot}
                                                            animate={{ opacity: [0.3, 1, 0.3] }}
                                                            transition={{ duration: 1, repeat: Infinity, delay: dot * 0.2 }}
                                                            className={`w-1.5 h-1.5 rounded-full ${status === 'error' || status === 'timeout' ? 'bg-negative' : 'bg-accent'}`}
                                                        />
                                                    ))}
                                                </div>
                                            )}
                                            <span className={`text-ludo-sm uppercase font-extrabold tracking-[0.18em] ${status === 'error' || status === 'timeout' ? 'text-negative' : 'text-accent'}`}>
                                                {status === 'error' ? 'FAULT DETECTED' :
                                                 status === 'timeout' ? 'LINK TIMEOUT' :
                                                 showExpansionOptions ? 'WIDEN THE SEARCH' :
                                                 status === 'expanding' ? 'REACH EXPANDED' :
                                                 status === 'idle' ? 'PREPARING SIGNAL' :
                                                 'SCANNING LUDO ARENA'}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    </TeamUpWrapper>

                    {/* Widen-the-search overlay */}
                    <AnimatePresence>
                        {showExpansionOptions && status !== 'matched' && (
                            <motion.div
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                className="absolute inset-0 z-[150] flex items-center justify-center px-5 pointer-events-auto"
                            >
                                <div
                                    className="absolute inset-0 bg-surface-page/75 backdrop-blur-sm"
                                    onClick={() => setShowExpansionOptions(false)}
                                />
                                <motion.div
                                    initial={{ y: 16, scale: 0.96 }}
                                    animate={{ y: 0, scale: 1 }}
                                    exit={{ y: 12, scale: 0.97 }}
                                    className="ludo-quick-scope panel-shell-3077 relative w-full max-w-[360px] rounded-[24px] border border-line-strong bg-surface-panel p-5 shadow-2xl flex flex-col gap-3 overflow-hidden"
                                    style={{ backdropFilter: 'blur(32px)' }}
                                >
                                    <HudCornerTicks />
                                    <div className="flex justify-between items-center relative z-10">
                                        <div className="flex items-center gap-2">
                                            <div className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
                                            <h3 className="text-ludo-xs font-extrabold text-accent uppercase tracking-[0.22em]">
                                                Widen the search
                                            </h3>
                                        </div>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => setShowExpansionOptions(false)}
                                            aria-label="Keep searching this fee"
                                            className="h-8 w-8 rounded-full p-0 justify-center"
                                            leftIcon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="icon-sm"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>}
                                        />
                                    </div>

                                    <p className="text-ludo-sm text-ink-muted font-bold leading-snug relative z-10">
                                        No one at{' '}
                                        <span className="text-warn tabular-nums">{feeLabel(activeWager)}</span>{' '}
                                        right now. Jump to a nearby preset — same lobby fee ladder.
                                    </p>

                                    <div className="flex flex-col gap-2 relative z-10">
                                        {snappedPools.length > 0 ? (
                                            <>
                                                <p className="text-ludo-xs font-extrabold text-positive uppercase tracking-[0.2em]">
                                                    Players waiting
                                                </p>
                                                {snappedPools.map((pool) => (
                                                    <Button
                                                        key={`pool-${pool.fee}`}
                                                        variant="secondary"
                                                        onClick={() => handleExpandWager(pool.fee)}
                                                        className="w-full justify-between px-4"
                                                    >
                                                        <span className="text-sm font-extrabold text-accent tabular-nums">
                                                            {feeLabel(pool.fee)}
                                                        </span>
                                                        <span className="text-ludo-xs font-extrabold text-positive uppercase tracking-widest">
                                                            {pool.waiters} waiting
                                                        </span>
                                                    </Button>
                                                ))}
                                            </>
                                        ) : (
                                            <>
                                                {lowerFee !== undefined && (
                                                    <Button
                                                        variant="primary"
                                                        fullWidth
                                                        onClick={() => handleExpandWager(lowerFee)}
                                                        className="uppercase tracking-[0.16em]"
                                                    >
                                                        Try {feeLabel(lowerFee)}
                                                    </Button>
                                                )}
                                                {higherFee !== undefined && (
                                                    <Button
                                                        variant="secondary"
                                                        fullWidth
                                                        onClick={() => handleExpandWager(higherFee)}
                                                        className="uppercase tracking-[0.16em]"
                                                    >
                                                        Try {feeLabel(higherFee)}
                                                    </Button>
                                                )}
                                            </>
                                        )}

                                        {snappedPools.length > 0 && (lowerFee !== undefined || higherFee !== undefined) && (
                                            <div className="flex gap-2">
                                                {lowerFee !== undefined && (
                                                    <Chip
                                                        type="filter"
                                                        size="sm"
                                                        onClick={() => handleExpandWager(lowerFee)}
                                                        className="flex-1 justify-center rounded-xl py-2.5 text-ludo-sm tracking-[0.12em]"
                                                    >
                                                        {feeLabel(lowerFee)}
                                                    </Chip>
                                                )}
                                                {higherFee !== undefined && (
                                                    <Chip
                                                        type="filter"
                                                        size="sm"
                                                        onClick={() => handleExpandWager(higherFee)}
                                                        className="flex-1 justify-center rounded-xl py-2.5 text-ludo-sm tracking-[0.12em]"
                                                    >
                                                        {feeLabel(higherFee)}
                                                    </Chip>
                                                )}
                                            </div>
                                        )}

                                        <Button
                                            variant="secondary"
                                            fullWidth
                                            onClick={() => handleExpandWager('any')}
                                            className="uppercase tracking-[0.2em]"
                                        >
                                            Match any fee
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            fullWidth
                                            onClick={handleStayHere}
                                            className="uppercase tracking-[0.2em]"
                                        >
                                            Keep waiting at {feeLabel(activeWager)}
                                        </Button>
                                    </div>
                                </motion.div>
                            </motion.div>
                        )}
                    </AnimatePresence>

                    {/* Timeout / Error Recovery Screen */}
                    {(status === 'timeout' || status === 'error') && (
                        <div className="absolute inset-0 z-[160] bg-surface-panel/95 backdrop-blur-xl flex flex-col items-center justify-center p-5 text-center pointer-events-auto">
                            <div className="w-20 h-20 bg-warn/15 rounded-full flex items-center justify-center mb-4 border border-warn/30 text-warn">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="w-8 h-8 animate-pulse"><path d="M12 2s-8 11.5-8 16c0 4.4 3.6 8 8 8s8-3.6 8-8c0-4.5-8-16-8-16z" /></svg>
                            </div>

                            <h3 className="text-xl font-bold text-ink-strong uppercase tracking-wide mb-1">
                                {status === 'error' ? 'Connection Fault' : 'Server is Quiet'}
                            </h3>
                            <p className="text-sm text-ink-muted font-medium mb-4 max-w-[240px]">
                                {status === 'error' && matchError
                                    ? (/<[^>]*>|doctype/i.test(matchError) || matchError.includes('503') || matchError.includes('502')
                                        ? 'Matchmaking service is temporarily unreachable. Please retry in a moment.'
                                        : matchError)
                                    : "No players found matching your criteria. It's a bit lonely out here!"}
                            </p>

                            <div className="w-full max-w-[300px] flex flex-col gap-2">
                                <Button
                                    variant="primary"
                                    fullWidth
                                    onClick={handleRetry}
                                    className="uppercase tracking-[0.2em]"
                                >
                                    Retry {matchType} · {feeLabel(activeWager)}
                                </Button>

                                <div className="p-4 rounded-2xl bg-accent-soft/40 border border-accent/25 flex flex-col gap-3">
                                    <p className="text-ludo-xs text-ink-muted font-medium uppercase tracking-widest leading-relaxed">
                                        Strongly advise practicing in <span className="text-accent font-bold">Offline Mode</span> to sharpen your strategy and skills.
                                    </p>
                                    <Button variant="secondary" fullWidth onClick={handleForceBotMatch}>
                                        Play with AI
                                    </Button>
                                </div>

                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={handleBackToLobby}
                                    className="mt-2 uppercase tracking-widest"
                                >
                                    Back to Menu
                                </Button>
                            </div>
                        </div>
                    )}
                </div>

                {/* Bottom Actions */}
                <div className="mt-auto px-5 pb-5 pt-3 border-t border-line-soft bg-surface-recessed/70 backdrop-blur-sm relative z-10 shrink-0">
                    <div className="w-full flex gap-2">
                        <Button
                            variant="secondary"
                            onClick={handleBackToLobby}
                            leftIcon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="icon-md"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>}
                            className="flex-1 justify-center uppercase tracking-[0.2em]"
                        >
                            Cancel
                        </Button>
                        <Button
                            variant="secondary"
                            onClick={handleForceBotMatch}
                            className="flex-1 uppercase tracking-[0.2em]"
                        >
                            Play with AI
                        </Button>
                    </div>
                </div>

                {/* Search Reveal Overlay */}
                {status === 'matched' && (
                    <div className="absolute inset-0 z-[200] flex flex-col items-center justify-center p-6 text-center bg-surface-panel/95 backdrop-blur-2xl overflow-y-auto no-scrollbar">
                        <div className="relative z-10 flex flex-col items-center gap-5 w-full">
                            <div className="flex flex-col items-center gap-2">
                                <div className="text-4xl md:text-6xl font-extrabold text-ink-strong tracking-tight uppercase">
                                    Match!
                                </div>
                                <div className="px-4 py-1.5 rounded-full bg-accent-soft border border-accent/35 flex items-center gap-2.5 flex-wrap justify-center">
                                    <span className="text-ludo-xs font-extrabold text-accent uppercase tracking-[0.2em]">{matchType}</span>
                                    <div className="w-1 h-3 bg-line-strong rounded-full" />
                                    <span className="text-ludo-xs font-extrabold text-ink-muted uppercase tracking-[0.2em]">{gameMode}</span>
                                    <div className="w-1 h-3 bg-line-strong rounded-full" />
                                    <div className="flex items-center gap-1">
                                        <ChipsHexIcon className="w-3.5 h-3.5 text-warn" active />
                                        <span className="text-ludo-xs font-extrabold font-mono text-warn tracking-[0.1em] tabular-nums">
                                            {wagerRange?.max === undefined && wagerRange?.min === 0
                                                ? 'Any'
                                                : feeLabel(activeWager)}
                                        </span>
                                    </div>
                                </div>
                                {hookMatchId && (
                                    <span className="text-ludo-xs font-bold text-ink-faint uppercase tracking-[0.2em] tabular-nums">
                                        Match {hookMatchId.slice(0, 8)}
                                    </span>
                                )}
                            </div>

                            <div className="flex items-center justify-around w-full max-w-md">
                                {/* Player 1 (You) */}
                                <div className="flex flex-col items-center gap-3">
                                    <div className="relative">
                                        <div className="w-24 h-24 md:w-28 md:h-28 rounded-3xl bg-surface-recessed border-2 border-accent/60 flex items-center justify-center p-1.5">
                                            <div className="hud-avatar-frame w-full h-full rounded-2xl overflow-hidden bg-surface-panel flex items-center justify-center">
                                                {profile?.avatar_url ? (
                                                    <img loading="lazy" decoding="async" src={profile.avatar_url} alt="You" className="w-full h-full object-cover" width={96} height={96} />
                                                ) : (
                                                    <div className="w-full h-full bg-accent-soft flex items-center justify-center text-accent">
                                                        <PilotAvatarFallbackIcon className="w-10 h-10 md:w-12 md:h-12" />
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                        <div className="hud-status-breath absolute -inset-1 border border-accent/35 rounded-[28px] pointer-events-none" />
                                    </div>
                                    <div className="flex flex-col items-center">
                                        <span className="text-lg font-bold text-ink-strong tracking-tight">{finalName}</span>
                                        <div className="flex items-center gap-2 mt-1">
                                            <span className="text-ludo-xs font-extrabold text-accent uppercase tracking-widest">You</span>
                                            <div className="w-1 h-1 bg-line-strong rounded-full" />
                                            <span className="text-ludo-xs font-extrabold text-warn uppercase tracking-widest">
                                                Lv. {getProgression(profile?.lxp || 0, profile?.rxp || 0).level}
                                            </span>
                                        </div>
                                    </div>
                                </div>

                                {/* VS Badge */}
                                <div className="flex flex-col items-center">
                                    <div className="hud-chamfer-sm w-14 h-14 md:w-16 md:h-16 rounded-full bg-accent text-accent-ink flex items-center justify-center text-xl md:text-2xl font-extrabold font-mono shadow-[0_0_28px_color-mix(in_srgb,var(--accent)_40%,transparent)]">
                                        VS
                                    </div>
                                </div>

                                {/* Opponent */}
                                <div className="flex flex-col items-center gap-3">
                                    <div className="relative">
                                        <div className="w-24 h-24 md:w-28 md:h-28 rounded-3xl bg-surface-recessed border-2 border-warn/60 flex items-center justify-center p-1.5">
                                            <div className="hud-avatar-frame w-full h-full rounded-2xl overflow-hidden bg-surface-panel flex items-center justify-center">
                                                {isLoadingRival ? (
                                                    <ThinkingOrb state="searching" size={32} tone="warn" label="Scanning opponent" />
                                                ) : opponentProfile?.avatar_url ? (
                                                    <img loading="lazy" decoding="async" src={opponentProfile.avatar_url} alt="Rival" className="w-full h-full object-cover" width={96} height={96} />
                                                ) : (
                                                    <div className="w-full h-full bg-warn/15 flex items-center justify-center text-warn">
                                                        <SimBotIcon className="w-10 h-10 md:w-12 md:h-12" />
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                        {!isLoadingRival && <div className="hud-status-breath absolute -inset-1 border border-warn/35 rounded-[28px] pointer-events-none" />}
                                    </div>
                                    <div className="flex flex-col items-center">
                                        <h3 className="text-lg font-bold text-ink-strong tracking-tight text-center">
                                            {isLoadingRival ? 'Scanning...' : (opponentProfile?.username || 'Rival')}
                                        </h3>
                                        {opponentProfile && (
                                            <div className="flex flex-col items-center gap-1.5 mt-1.5">
                                                <div className="flex items-center gap-2 bg-surface-recessed px-3 py-1 rounded-full border border-line-soft">
                                                    <span className="text-ludo-xs font-extrabold text-warn uppercase tracking-widest">
                                                        Lv. {getProgression(opponentProfile.lxp, opponentProfile.rxp).level}
                                                    </span>
                                                    <div className="w-1 h-1 bg-line-strong rounded-full" />
                                                    <span className="text-ludo-xs font-extrabold text-accent uppercase tracking-widest">
                                                        {getProgression(opponentProfile.lxp, opponentProfile.rxp).tier} {getProgression(opponentProfile.lxp, opponentProfile.rxp).subRank}
                                                    </span>
                                                </div>
                                                <div className="flex items-center gap-1.5 px-3 py-0.5 rounded-full bg-positive/15 border border-positive/30">
                                                    <span className="text-ludo-xs font-extrabold text-positive uppercase tracking-[0.18em]">
                                                        Win Rate: {Math.round((opponentProfile.total_wins / Math.max(1, opponentProfile.total_games)) * 100)}%
                                                    </span>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* Connection Status Subtext */}
                            <div className="mt-2 flex flex-col items-center gap-3">
                                {isStalled && (
                                    <motion.div
                                        initial={{ opacity: 0, y: 10 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        className="hud-status-breath mb-1 px-4 py-1.5 rounded-full bg-warn/15 border border-warn/35 text-ludo-xs font-extrabold text-warn uppercase tracking-widest"
                                    >
                                        {roomStatus === 'failed'
                                            ? roomError === 'not-deployed'
                                                ? 'Game room unavailable on this deployment'
                                                : 'Unable to connect to game room — retrying…'
                                            : p2pHost
                                                ? 'Opponent hasn’t linked yet…'
                                                : 'Still linking both players…'}
                                    </motion.div>
                                )}
                                <div className="flex items-center gap-3">
                                    <div className="flex gap-1.5">
                                        {[0, 1, 2].map(i => (
                                            <motion.div
                                                key={i}
                                                animate={{ opacity: [0.2, 1, 0.2] }}
                                                transition={{ duration: 1, repeat: Infinity, delay: i * 0.2 }}
                                                className="w-1.5 h-1.5 rounded-full bg-accent"
                                            />
                                        ))}
                                    </div>
                                    <span className="text-ludo-xs font-extrabold text-ink-muted uppercase tracking-[0.25em]">
                                        {isStalled
                                            ? 'Holding your seat'
                                            : isLobbyConnected
                                                ? 'Players linked — starting…'
                                                : 'Match found — setting up the table…'}
                                    </span>
                                </div>

                                {isStalled && (
                                    <div className="flex w-full max-w-[280px] flex-col gap-2">
                                        <Button
                                            variant="primary"
                                            fullWidth
                                            onClick={handleForceBotMatch}
                                            className="uppercase tracking-[0.2em]"
                                        >
                                            Play with AI instead
                                        </Button>
                                        <Button
                                            variant="secondary"
                                            fullWidth
                                            onClick={() => {
                                                cancelSearch();
                                                handleBackToLobby();
                                            }}
                                            className="uppercase tracking-[0.2em]"
                                        >
                                            Leave this match
                                        </Button>
                                    </div>
                                )}

                                {(activeWager <= 0 || isStalled) && (
                                    <Button
                                        variant="secondary"
                                        onClick={handleCancelAndClose}
                                        className="px-8 uppercase tracking-[0.2em]"
                                    >
                                        Cancel Match
                                    </Button>
                                )}

                                <p className={`max-w-[300px] text-ludo-xs leading-relaxed ${activeWager > 0 ? 'text-warn font-mono' : 'text-ink-faint'}`}>
                                    {activeWager > 0
                                        ? `Match Locked · Leaving or disconnecting forfeits your ${activeWager.toLocaleString()} CHIPS stake and counts as a loss.`
                                        : 'Safe Exit: No coins will be lost before the game board loads. If the match fails to sync, you will be returned to the lobby.'}
                                </p>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </GamePanelShell>
    );
};
