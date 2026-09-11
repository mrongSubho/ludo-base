"use client";

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useTeamUpContext } from '@/hooks/TeamUpContext';
import { ActionDice } from './ActionDice';
import { PanelErrorBoundary } from './PanelErrorBoundary';
import { LiveBroadcastCard } from './ActivityFeed';
import dynamic from 'next/dynamic';
const TeamUpMatchPanel = dynamic(() => import('./TeamUpMatchPanel').then(m => m.TeamUpMatchPanel));
const OfflineMatchPanel = dynamic(() => import('./OfflineMatchPanel').then(m => m.OfflineMatchPanel));
const QuickMatchPanel = dynamic(() => import('./QuickMatchPanel').then(m => m.QuickMatchPanel));
import { useSoundEffects } from '../hooks/useSoundEffects';
import { LuMinus, LuPlus } from 'react-icons/lu';
import { supabase } from '@/lib/supabase';
import { useAccount } from 'wagmi';
import { useGuestWall } from '@/hooks/GuestWallContext';

interface GameLobbyProps {
    gameMode: 'classic' | 'power';
    setGameMode: (mode: 'classic' | 'power') => void;
    matchType: '1v1' | '2v2' | '4P';
    setMatchType: (type: '1v1' | '2v2' | '4P') => void;
    wager: number;
    setWager: (wager: number) => void;
    onStartGame: (isBotMatch?: boolean, difficulty?: import('@/lib/types').BotDifficulty) => void;
    onOpenProfile?: (address: string) => void;
}

export default function GameLobby({
    gameMode,
    setGameMode,
    matchType,
    setMatchType,
    wager,
    setWager,
    onStartGame,
    onOpenProfile,
}: GameLobbyProps) {
    const {
        roomId,
        isLobbyConnected,
        isHost,
        hostGame,
        joinGame,
        hostQuickLobby,
        lobbyState,
        sendInvite,
        swapPlayers,
        kickPlayer,
        leaveGame,
        allowOpenJoins
    } = useTeamUpContext();
    const { address } = useAccount();
    // Guests can only enter offline/bot matches — online entry shows the wall.
    const { guard } = useGuestWall();

    // Configuration State
    const { playSelect, playCoin } = useSoundEffects();
    const [showTeamUpOptions, setShowTeamUpOptions] = useState(false);
    const [showOfflineOptions, setShowOfflineOptions] = useState(false);
    const [isQuickMatchActive, setIsQuickMatchActive] = useState(false);
    const [hybridParams, setHybridParams] = useState<{ roomCode: string; slotsNeeded: number; matchType: '1v1' | '2v2' | '4P' } | null>(null);
    // Embedded hunt: the hybrid radar lives INSIDE the TeamUp page (mini
    // view) instead of yanking the host out to the solo radar. The search
    // engine (QuickMatchPanel) mounts hidden; TeamUp shows HuntView.
    // 40s cap: no fill → timeout message → auto-return to invites.
    const HUNT_TIMEOUT_S = 40;
    const [embeddedHunt, setEmbeddedHunt] = useState(false);
    const [huntExpired, setHuntExpired] = useState(false);
    const huntingRef = useRef(false);
    huntingRef.current = embeddedHunt;
    const huntTimers = useRef<{ stop?: ReturnType<typeof setTimeout>; back?: ReturnType<typeof setTimeout> }>({});
    const clearHuntTimers = useCallback(() => {
        if (huntTimers.current.stop) clearTimeout(huntTimers.current.stop);
        if (huntTimers.current.back) clearTimeout(huntTimers.current.back);
        huntTimers.current = {};
    }, []);
    useEffect(() => () => clearHuntTimers(), [clearHuntTimers]);

    // Overflow-driven compaction: if the setup column actually overflows its
    // box (any device, any chrome), drop into compact mode. Behavior, not
    // breakpoints — toggling can't oscillate because the observed box is
    // parent-constrained, so class flips don't resize it.
    const setupRef = useRef<HTMLDivElement | null>(null);
    const [lobbyCompact, setLobbyCompact] = useState(false);
    useEffect(() => {
        const el = setupRef.current;
        if (!el) return;
        const check = () => setLobbyCompact(el.scrollHeight > el.clientHeight + 2);
        check();
        const t = setTimeout(check, 600);
        window.addEventListener('resize', check);
        let ro: ResizeObserver | null = null;
        if (typeof ResizeObserver !== 'undefined') {
            ro = new ResizeObserver(check);
            ro.observe(el);
        }
        return () => {
            clearTimeout(t);
            window.removeEventListener('resize', check);
            ro?.disconnect();
        };
    }, []);
    const [searchId, setSearchId] = useState(0);

    // Party join feedback: every join tap (feed, chat, link) funnels here.
    // 20s window (mobile data + free signaling is slow); the message is
    // staged — transport up but unseated means full/started, never-contacted
    // means the host is gone. A late seat still opens the room.
    const [pendingJoin, setPendingJoin] = useState<{ code: string; since: number } | null>(null);
    const [joinError, setJoinError] = useState<string | null>(null);
    const [showFee, setShowFee] = useState(false);
    const lastJoinRef = useRef<{ code: string; seat?: number; secret?: string | null } | null>(null);
    const lobbyRef = useRef(lobbyState);
    lobbyRef.current = lobbyState;
    const joinedCodeRef = useRef<string | null>(null);
    // Fail fast: Supabase JOIN_REQUEST seats in ~1s when the host is online.
    // 8s covers one realtime round-trip + PeerJS retry without a 20s dead wait.
    const JOIN_TIMEOUT_MS = 8000;

    const isSeatedIn = useCallback((code: string) => {
        const L = lobbyRef.current;
        const me = address?.toLowerCase();
        return !!L && L.roomCode?.toUpperCase() === code.toUpperCase() &&
            (L.slots || []).some(s => s.status === 'joined' && s.playerId?.toLowerCase() === me);
    }, [address]);

    const startPartyJoin = useCallback((code: string, seat?: number, secret?: string | null) => {
        guard('online-play', () => {
            setJoinError(null);
            joinedCodeRef.current = code;
            lastJoinRef.current = { code, seat, secret };
            setPendingJoin({ code, since: Date.now() });
            joinGame(code, secret ?? undefined, seat);
            window.setTimeout(() => {
                if (joinedCodeRef.current !== code) return; // already seated or superseded
                if (isSeatedIn(code)) {
                    joinedCodeRef.current = null;
                    setPendingJoin(null);
                    setShowTeamUpOptions(true);
                    return;
                }
                setPendingJoin(null);
                setJoinError("Couldn’t reach the host. They may be offline, or the room is full or already started.");
            }, JOIN_TIMEOUT_MS);
        });
    }, [guard, joinGame, isSeatedIn]);

    // Fast path: the instant our seat lands, open the room (no 20s wait).
    // Keyed on the joined code, not the pending flag — a seat landing just
    // after the timeout still opens instead of stranding us on an error.
    useEffect(() => {
        if (!lobbyState) return;
        const code = joinedCodeRef.current;
        if (!code) return;
        const me = address?.toLowerCase();
        if (lobbyState.roomCode?.toUpperCase() === code &&
            (lobbyState.slots || []).some(s => s.status === 'joined' && s.playerId?.toLowerCase() === me)) {
            joinedCodeRef.current = null;
            setPendingJoin(null);
            setJoinError(null);
            setShowTeamUpOptions(true);
        }
    }, [lobbyState, address]);

    // Incoming invite links (?room=CODE&seat=N): room-only links fill any
    // open seat — ONE link serves the whole party, no per-seat spam.
    // Seat links request that exact seat (honored when still empty).
    // Runs once on lobby mount (post-connect, post-onboarding by construction).
    useEffect(() => {
        try {
            const params = new URLSearchParams(window.location.search);
            const code = params.get('room');
            if (!code || code.trim().length < 3) return;
            const seatRaw = params.get('seat');
            const seat = seatRaw !== null && /^\d+$/.test(seatRaw) ? parseInt(seatRaw, 10) : undefined;
            const secret = params.get('s');
            // Consume: never re-join on re-render.
            window.history.replaceState(null, '', window.location.pathname);
            startPartyJoin(code.trim().toUpperCase(), seat, secret);
        } catch { /* no link — normal entry */ }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Handle Joining from Live Feed
    useEffect(() => {
        const handleJoinPool = (e: any) => {
            const pool = e.detail;
            if (pool) {
                console.log('📡 [Lobby] Joining pool from feed:', pool);
                setWager(pool.entryFee);
                setGameMode(pool.mode);
                setMatchType(pool.matchType);
                // Trigger search on next tick to ensure state sync
                setTimeout(() => {
                    handleStartQuickMatch();
                }, 100);
            }
        };
        window.addEventListener('join_pool', handleJoinPool);
        // Direct party link from the broadcast feed: room code present means
        // a hosted party with open seats — join it straight, no queue.
        const handleJoinParty = (e: Event) => {
            const detail = (e as CustomEvent)?.detail;
            const code = detail?.roomCode;
            if (typeof code === 'string' && code.trim().length >= 3) {
                console.log('📡 [Lobby] Joining party from feed:', code);
                const seat = typeof detail?.seat === 'number' ? detail.seat : undefined;
                startPartyJoin(code.trim().toUpperCase(), seat);
            }
        };
        window.addEventListener('join_party', handleJoinParty);
        return () => {
            window.removeEventListener('join_pool', handleJoinPool);
            window.removeEventListener('join_party', handleJoinParty);
        };
    }, [setWager, setGameMode, setMatchType, guard, joinGame]);

    const handleStartQuickMatch = () => {
        guard('online-play', () => {
            setSearchId(prev => prev + 1);
            setIsQuickMatchActive(true);
        });
    };

    const handleCancelQuickMatch = useCallback(() => {
        clearHuntTimers();
        setIsQuickMatchActive(false);
        setHybridParams(null);
        setEmbeddedHunt(false);
        setHuntExpired(false);
    }, [clearHuntTimers]);

    // Fill Remaining with Quick Match: host advertises the room, the hybrid
    // search pairs public-pool guests straight into it (they joinGame the
    // room code and get seated). TeamUp STAYS OPEN with a mini hunt view;
    // seats fill live behind it. Cancel returns to the invite roster.
    const handleFillWithQuickMatch = () => {
        if (!lobbyState || !isHost) return;
        const empty = lobbyState.slots.filter(s => s.status === 'empty').length;
        if (empty === 0) return;
        playSelect();
        // Matchmaking-paired guests present ticket tokens, not the room secret.
        allowOpenJoins();
        setHybridParams({ roomCode: lobbyState.roomCode, slotsNeeded: empty, matchType: lobbyState.matchType });
        setSearchId(prev => prev + 1);
        setHuntExpired(false);
        setEmbeddedHunt(true);
        // 40s cap: still hunting → timeout message, then auto-return.
        clearHuntTimers();
        huntTimers.current.stop = setTimeout(() => {
            if (!huntingRef.current) return;
            setHuntExpired(true);
            huntTimers.current.back = setTimeout(() => handleCancelQuickMatch(), 3500);
        }, HUNT_TIMEOUT_S * 1000);
    };

    // Hunt complete: all seats filled → stop the engine, back to roster.
    useEffect(() => {
        if (!embeddedHunt || !lobbyState) return;
        const empty = lobbyState.slots.filter(s => s.status === 'empty').length;
        if (empty === 0) handleCancelQuickMatch();
    }, [embeddedHunt, lobbyState, handleCancelQuickMatch]);

    return (
        <div className={`ludo-lobby-scope relative isolate w-full max-w-4xl mx-auto px-3 sm:px-4 py-3 sm:py-8 min-h-[600px] h-full flex flex-col items-center justify-start${lobbyCompact ? ' lobby-compact' : ''}`}>
            {/* Theme photo backdrop (fixed layer, behind everything, taps pass through) */}
            <div className="lobby-backdrop" aria-hidden />
            {/* 1. INITIAL SETUP PANEL */}
            {(!isQuickMatchActive && lobbyState?.status !== 'quickmatch') && (
                <div
                    key="setup"
                    ref={setupRef}
                    className="w-full max-w-[420px] mx-auto flex flex-col gap-2 sm:gap-3 h-full setup-tier"
                >
                    {/* 1. SELECTION GROUP */}
                    <div className="w-full space-y-3 flex flex-col">
                        {/* Mode Section */}
                        <div className="flex flex-col items-center w-full">
                            <div className="flex justify-center w-full mb-3 mt-1">
                                <div className="inline-block px-5 py-1.5 bg-[rgba(0,0,0,0.35)] border border-white/10 rounded-full backdrop-blur-md">
                                    <h3 className="text-white/90 text-[10px] font-black uppercase tracking-[0.2em] text-center drop-shadow-md">Select Game Mode</h3>
                                </div>
                            </div>
                            <div className="flex justify-center gap-3">
                                {(['classic', 'power'] as const).map(mode => (
                                    <button
                                        key={mode}
                                        onClick={() => {
                                            playSelect();
                                            setGameMode(mode);
                                        }}
                                        className={`relative w-40 py-1 rounded-full border transition-all duration-200 ease-out glass-panel flex flex-col items-center justify-center hover:scale-[1.02] active:scale-95 ${gameMode === mode
                                            ? 'border-cyan-400 shadow-[0_0_15px_rgba(34,211,238,0.2)] bg-[rgba(0,0,0,0.5)]'
                                            : 'border-white/20 hover:border-white/40 bg-[rgba(0,0,0,0.5)]'
                                            }`}
                                    >
                                        {gameMode === mode && (
                                            <span className="porcelain-holo-tick absolute left-0 top-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-cyan-500 flex items-center justify-center shadow-lg z-10">
                                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" className="w-2.5 h-2.5 text-white"><polyline points="20 6 9 17 4 12" /></svg>
                                            </span>
                                        )}
                                        <div className="relative z-10 text-center">
                                            <span className={`block text-lg font-black italic tracking-tighter capitalize drop-shadow-md leading-none ${gameMode === mode ? 'text-cyan-400' : 'text-white/90'}`}>{mode}</span>
                                            <div className={`mt-0.5 inline-block px-1.5 py-px rounded-full border backdrop-blur-md ${gameMode === mode ? 'bg-[rgba(0,0,0,0.35)] border-cyan-500/30' : 'bg-[rgba(0,0,0,0.35)] border-white/10'}`}>
                                                <span className={`text-[8px] font-black uppercase tracking-[0.16em] whitespace-nowrap ${gameMode === mode ? 'text-cyan-400' : 'text-white/50'}`}>{mode === 'classic' ? 'Original Rules' : 'Special Power-ups'}</span>
                                            </div>
                                        </div>
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Match Type Section */}
                        <div className="flex flex-col items-center w-full">
                            <div className="flex justify-center w-full mt-1 mb-3">
                                <div className="inline-block px-5 py-1.5 bg-[rgba(0,0,0,0.35)] border border-white/10 rounded-full backdrop-blur-md">
                                    <h3 className="text-white/90 text-[10px] font-black uppercase tracking-[0.2em] text-center drop-shadow-md">Match Type</h3>
                                </div>
                            </div>
                            <div className="flex justify-center gap-3">
                                {(['1v1', '2v2', '4P'] as const).map(type => (
                                    <button
                                        key={type}
                                        onClick={() => {
                                            playSelect();
                                            setMatchType(type);
                                        }}
                                        className={`w-12 h-12 rounded-full border transition-all duration-200 ease-out glass-panel flex items-center justify-center hover:scale-110 active:scale-90 relative ${matchType === type
                                            ? 'border-cyan-400 shadow-[0_0_15px_rgba(34,211,238,0.3)] bg-[rgba(0,0,0,0.5)]'
                                            : 'border-white/10 hover:border-white/30 bg-[rgba(0,0,0,0.5)]'
                                            }`}
                                    >
                                        {matchType === type && (
                                            <span className="porcelain-holo-tick absolute left-0 top-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-cyan-500 flex items-center justify-center shadow-lg z-10">
                                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" className="w-2.5 h-2.5 text-white"><polyline points="20 6 9 17 4 12" /></svg>
                                            </span>
                                        )}
                                        <span className={`block text-lg font-black italic tracking-tighter drop-shadow-md ${matchType === type ? 'text-cyan-400' : 'text-white/60'}`}>{type}</span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* 2. WAGER — collapsed by default (casual tables are Free).
                        Expand only when staking; Free stays one tap. */}
                    <div className="fee-tier rounded-[20px] glass-panel flex flex-col items-center shadow-2xl border-t border-white/20 border-x border-white/5 border-b border-black/20 shadow-[inset_0_1px_1px_rgba(255,255,255,0.1)]">
                        <button
                            type="button"
                            onClick={() => { playSelect(); setShowFee(v => !v); }}
                            aria-expanded={showFee}
                            className="w-full flex items-center justify-between px-3 py-2 rounded-[18px] hover:bg-white/5 active:scale-[0.99] transition-all"
                        >
                            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white/90 drop-shadow-md">
                                Wager
                            </span>
                            <span className={`text-[11px] font-black tracking-wide ${wager > 0 ? 'text-cyan-300' : 'text-white/50'}`}>
                                {wager === 0 ? 'Free' : wager >= 1000000 ? `${wager / 1000000} M` : wager >= 1000 ? `${wager / 1000} k` : wager}
                            </span>
                        </button>
                        {showFee && (
                            <div className="w-full px-1.5 pb-2 flex flex-col items-center gap-1">
                                <div className="flex items-center justify-between w-full px-2 mb-1">
                                    <button onClick={() => { playCoin(); setWager(Math.max(0, wager - (wager >= 1000 ? 1000 : 100))); }} aria-label="Decrease wager" className="w-11 h-11 rounded-[14px] bg-[rgba(0,0,0,0.35)] border border-white/10 flex items-center justify-center text-white/80 hover:bg-white/10 hover:scale-105 active:scale-95 shadow-lg backdrop-blur-md transition-all duration-200">
                                        <LuMinus className="w-5 h-5 stroke-[3px]" />
                                    </button>
                                    <div className="flex-1 flex flex-col items-center justify-center relative">
                                        <input type="number" value={wager} onChange={(e) => setWager(Math.max(0, parseInt(e.target.value) || 0))} className="w-full bg-transparent text-center text-xl font-black text-white drop-shadow-[0_0_15px_rgba(255,255,255,0.3)] focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60 rounded-xl [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
                                    </div>
                                    <button onClick={() => { playCoin(); setWager(wager + (wager >= 1000 ? 1000 : 100)); }} aria-label="Increase wager" className="w-11 h-11 rounded-[14px] bg-[rgba(0,0,0,0.35)] border border-white/10 flex items-center justify-center text-white/80 hover:bg-white/10 hover:scale-105 active:scale-95 shadow-lg backdrop-blur-md transition-all duration-200">
                                        <LuPlus className="w-5 h-5 stroke-[3px]" />
                                    </button>
                                </div>
                                <div className="flex gap-1.5 justify-center flex-wrap">
                                    {[0, 1000, 10000, 100000, 1000000].map(val => (
                                        <button key={val} onClick={() => { playCoin(); setWager(val); }} className={`px-3 min-h-[44px] inline-flex items-center justify-center rounded-full border transition-all duration-200 hover:scale-105 active:scale-95 backdrop-blur-md shadow-sm text-[11px] font-black ${wager === val ? 'border-cyan-400 bg-[rgba(0,0,0,0.35)] text-cyan-400 shadow-[0_0_15px_rgba(34,211,238,0.3)]' : 'bg-[rgba(0,0,0,0.35)] hover:bg-white/15 border-white/10 text-white/90'}`}>
                                            {val === 0 ? 'Free' : val >= 1000000 ? `${val / 1000000} M` : val >= 1000 ? `${val / 1000} k` : val}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* 3. ACTION DICE - flex-1 so it rides lower, centered in
                        the free space between entry fee and the card */}
                    <div className="w-full flex-1 flex items-center justify-center relative z-30 min-h-0">
                        <ActionDice 
                            onSelectQuickMatch={handleStartQuickMatch}
                            onSelectTeamUp={() => guard('teamup', () => setShowTeamUpOptions(true))}
                            onSelectOfflineMatch={() => setShowOfflineOptions(true)}
                        />
                    </div>

                    {/* 4. LIVE BROADCAST — slim; full feed opens on tap */}
                    <div className="w-full mt-auto pt-2">
                        <LiveBroadcastCard onOpenProfile={onOpenProfile} />
                    </div>

                </div>
            )}

            {/* --- OVERLAY PANELS --- */}
            {pendingJoin && (
                <div className="fixed inset-0 z-[190] flex items-center justify-center px-6 bg-black/55 backdrop-blur-sm">
                    <div
                        className="w-full max-w-[320px] rounded-[24px] border border-white/10 px-6 py-8 flex flex-col items-center gap-4 text-center shadow-2xl"
                        style={{ background: 'var(--panel-bg, rgba(13,13,13,0.96))', backdropFilter: 'blur(32px)' }}
                    >
                        <div className="w-10 h-10 border-[3px] border-cyan-500/20 border-t-cyan-400 rounded-full animate-spin" />
                        <p className="text-[10px] font-black uppercase tracking-[0.3em] text-cyan-300">
                            Joining room
                        </p>
                        <p className="text-2xl font-black text-white tracking-[0.25em]">{pendingJoin.code}</p>
                        <p className="text-[11px] text-white/40 font-bold uppercase tracking-wider">
                            Waiting for host…
                        </p>
                    </div>
                </div>
            )}
            {/* Join feedback popup: full/started/closed rooms say so plainly */}
            {joinError && (
                <div
                    className="fixed inset-0 z-[200] flex items-center justify-center px-6 bg-black/60 backdrop-blur-sm"
                    onClick={() => setJoinError(null)}
                >
                    <div
                        className="w-full max-w-[340px] rounded-[24px] border border-white/10 px-6 py-6 flex flex-col items-center gap-2.5 text-center shadow-2xl"
                        style={{ background: 'var(--panel-bg-image, var(--ludo-bg-cosmic))', backgroundColor: 'var(--panel-bg, rgba(13,13,13,0.95))', backdropFilter: 'blur(32px)' }}
                        onClick={e => e.stopPropagation()}
                    >
                        <p className="text-[10px] font-black uppercase tracking-[0.3em] text-amber-300">
                            Room unavailable
                        </p>
                        <p className="text-[13px] font-bold text-white/80 leading-relaxed">
                            {joinError}
                        </p>
                        <p className="text-[11px] text-white/40 leading-relaxed">
                            Use the full invite link (with the secret), or ask the host to copy it again.
                        </p>
                        {lastJoinRef.current && (
                            <button
                                onClick={() => {
                                    const j = lastJoinRef.current;
                                    setJoinError(null);
                                    if (j) startPartyJoin(j.code, j.seat, j.secret);
                                }}
                                className="mt-1 w-full py-3 rounded-2xl bg-cyan-400 text-black text-xs font-black uppercase tracking-[0.2em] hover:bg-cyan-300 active:scale-[0.99] transition-all"
                            >
                                Try again
                            </button>
                        )}
                        <button
                            onClick={() => setJoinError(null)}
                            className="mt-1 w-full py-3 rounded-2xl bg-white text-black text-xs font-black uppercase tracking-[0.2em] hover:bg-white/90 active:scale-[0.99] transition-all"
                        >
                            Got it
                        </button>
                    </div>
                </div>
            )}
            {showTeamUpOptions && (
                <PanelErrorBoundary
                    name="teamup"
                    onClose={() => {
                        leaveGame();
                        setShowTeamUpOptions(false);
                    }}
                >
                <TeamUpMatchPanel
                    key="teamup"
                    onClose={() => {
                        leaveGame();
                        setShowTeamUpOptions(false);
                    }}
                    onJoin={(code: string) => joinGame(code)}
                    onHost={() => hostQuickLobby(matchType, gameMode, wager)}
                    currentRoomId={roomId}
                    isHost={isHost}
                    isLobbyConnected={isLobbyConnected}
                    lobbyState={lobbyState}
                    onStartMatch={() => {
                        setShowTeamUpOptions(false);
                        onStartGame();
                    }}
                    onSwapPlayers={swapPlayers}
                    onKickPlayer={kickPlayer}
                    onSendInvite={sendInvite}
                    onQuickMatch={handleFillWithQuickMatch}
                    hunting={embeddedHunt}
                    huntExpired={huntExpired}
                    huntTimeoutS={HUNT_TIMEOUT_S}
                    onCancelHunt={handleCancelQuickMatch}
                    matchType={matchType}
                    gameMode={gameMode}
                    entryFee={wager}
                />
                </PanelErrorBoundary>
            )}

            {showOfflineOptions && (
                <OfflineMatchPanel
                    key="offline"
                    gameMode={gameMode}
                    matchType={matchType}
                    onClose={() => setShowOfflineOptions(false)}
                    onStartOfflineGame={(difficulty) => {
                        setShowOfflineOptions(false);
                        onStartGame(true, difficulty);
                    }}
                />
            )}

            {/* Solo radar (own overlay) */}
            {(isQuickMatchActive || lobbyState?.status === 'quickmatch') && (
                <QuickMatchPanel
                    key={`quickmatch-${searchId}`}
                    gameMode={gameMode}
                    matchType={matchType}
                    wager={wager}
                    onStartGame={onStartGame}
                    onCancel={handleCancelQuickMatch}
                    isHybrid={lobbyState?.status === 'quickmatch'}
                    roomCode={roomId}
                    slotsNeeded={lobbyState?.slots.filter(s => s.status === 'empty').length}
                />
            )}

            {/* Embedded hunt engine: hidden mount owns the hybrid search
                lifecycle (mount = hunt, unmount = cancelSearch); the visible
                mini radar lives inside the TeamUp page. */}
            {embeddedHunt && hybridParams && (
                <div className="hidden" aria-hidden>
                    <QuickMatchPanel
                        key={`quickmatch-${searchId}`}
                        gameMode={gameMode}
                        matchType={hybridParams.matchType}
                        wager={wager}
                        onStartGame={onStartGame}
                        onCancel={handleCancelQuickMatch}
                        isHybrid
                        roomCode={hybridParams.roomCode}
                        slotsNeeded={hybridParams.slotsNeeded}
                    />
                </div>
            )}
        </div>
    );
}
