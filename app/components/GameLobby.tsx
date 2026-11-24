"use client";

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTeamUpContext } from '@/hooks/TeamUpContext';
import { ActionDice } from './ActionDice';
import { PanelErrorBoundary } from './PanelErrorBoundary';
import { LiveBroadcastCard } from './ActivityFeed';
import dynamic from 'next/dynamic';
const TeamUpMatchPanel = dynamic(() => import('./TeamUpMatchPanel').then(m => m.TeamUpMatchPanel));
const OfflineMatchPanel = dynamic(() => import('./OfflineMatchPanel').then(m => m.OfflineMatchPanel));
const QuickMatchPanel = dynamic(() => import('./QuickMatchPanel').then(m => m.QuickMatchPanel));
import { useSoundEffects } from '../hooks/useSoundEffects';
import { useGuestWall } from '@/hooks/GuestWallContext';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useAppSession } from '@/hooks/useAppSession';
import { useToast } from './Toast';
import SecurityLadderChip from './SecurityLadderChip';
import ThemeNudge from './ThemeNudge';
import { usePreferences } from '@/hooks/usePreferences';
import { useArenaVault } from '@/hooks/useArenaVault';
import { useChipsBalance } from '@/hooks/useChipsBalance';
import { formatUnits } from 'viem';
import { Button } from './Button';
import { HudCornerTicks } from './HudPrimitives';
import { ThinkingOrb } from './ThinkingOrb';
import {
    CheckGlyphIcon,
    ChevronGlyphIcon,
    ChipsHexIcon,
    VaultShieldIcon,
    WarningHexIcon,
} from './icons';
import { DaybreakFeePicker } from './DaybreakFeePicker';
import { DAYBREAK_PALETTES, DaybreakStudioDeck } from './DaybreakStudioDeck';
import { EntryFeeKnob } from './EntryFeeKnob';
import { LobbyCommandDeck } from './LobbyCommandDeck';
import { OrbitalCanopyDeck } from './OrbitalCanopyDeck';
import { OrbitalFeeDock } from './OrbitalFeeDock';
import { RetroSynthFeeFader } from './RetroSynthFeeFader';
import { useDeployTheme } from '@/lib/deployTheme';

const RETRO_FEE_PALETTES = {
    quick: { hex: '#5CE1FF', rgb: '92, 225, 255', bright: '#A5F3FC' },
    team: { hex: '#FBBF24', rgb: '251, 191, 36', bright: '#FDE68A' },
    offline: { hex: '#34D399', rgb: '52, 211, 153', bright: '#A7F3D0' },
} as const;

/**
 * Suggested default fee from balance:
 * ≥100k → 10k · ≥10k → 1k · ≥1k → 500 · else Free
 */
export function suggestedEntryFee(chips: number): number {
    if (chips >= 10_000_000) return 100_000;
    if (chips >= 1_000_000) return 10_000;
    if (chips >= 100_000) return 1_000;
    if (chips >= 1_000) return 500;
    return 0;
}

export function formatEntryFee(val: number): string {
    if (val === 0) return 'Free';
    if (val >= 1_000_000) {
        const m = val / 1_000_000;
        return Number.isInteger(m) ? `${m} M` : `${m.toFixed(1)} M`;
    }
    if (val >= 1_000) return `${val / 1_000} k`;
    return String(val);
}

export interface PendingRematchSearch {
    id: number;
    mode: 'solo' | 'hybrid';
    gameMode: 'classic' | 'power';
    matchType: '1v1' | '2v2' | '4P';
    wager: number;
    roomCode?: string;
    slotsNeeded?: number;
}

interface GameLobbyProps {
    gameMode: 'classic' | 'power';
    setGameMode: (mode: 'classic' | 'power') => void;
    matchType: '1v1' | '2v2' | '4P';
    setMatchType: (type: '1v1' | '2v2' | '4P') => void;
    wager: number;
    setWager: (wager: number) => void;
    onStartGame: (isBotMatch?: boolean, difficulty?: import('@/lib/types').BotDifficulty) => void;
    /** G2 — pass-and-play (all-human hot-seat). */
    onStartPassAndPlay?: () => void;
    onOpenProfile?: (address: string) => void;
    onBroadcastOpenChange?: (open: boolean) => void;
    onOpenArena?: (tab?: 'arena' | 'comms') => void;
    pendingRematchSearch?: PendingRematchSearch | null;
    onConsumeRematchSearch?: () => void;
}

export default function GameLobby({
    gameMode,
    setGameMode,
    matchType,
    setMatchType,
    wager,
    setWager,
    onStartGame,
    onStartPassAndPlay,
    onOpenProfile,
    onBroadcastOpenChange,
    onOpenArena,
    pendingRematchSearch,
    onConsumeRematchSearch,
}: GameLobbyProps) {
    const {
        roomId,
        isLobbyConnected,
        isHost,
        joinGame,
        hostQuickLobby,
        lobbyState,
        sendInvite,
        swapPlayers,
        kickPlayer,
        leaveGame,
        allowOpenJoins,
        lowerEntryFee,
        createProvisionalSession,
    } = useTeamUpContext();
    const { address, profile } = useCurrentUser();
    const coins = profile?.coins ?? 0;
    const chipsBal = useChipsBalance();
    const vault = useArenaVault();
    const walletChips =
        chipsBal.balance !== undefined ? Math.floor(Number(formatUnits(chipsBal.balance, 18))) : 0;
    const playableChips =
        chipsBal.balance !== undefined || vault.availableChips > 0
            ? walletChips + vault.availableChips
            : coins;
    // Guests can only enter offline/bot matches — online entry shows the wall.
    const { guard } = useGuestWall();
    const { ensureAppSession } = useAppSession();
    const toast = useToast();
    const reservedTeamUpRef = useRef<Set<string>>(new Set());

    // Configuration State
    const { preferences } = usePreferences();
    const is3077 = preferences.theme === '3077';
    const isRetro = preferences.theme === 'retro';
    const { theme: deployTheme } = useDeployTheme();
    const { playSelect } = useSoundEffects();
    const [showTeamUpOptions, setShowTeamUpOptions] = useState(false);
    const [showOfflineOptions, setShowOfflineOptions] = useState(false);
    const [isQuickMatchActive, setIsQuickMatchActive] = useState(false);
    const [hybridParams, setHybridParams] = useState<{ roomCode: string; slotsNeeded: number; matchType: '1v1' | '2v2' | '4P' } | null>(null);
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

    useEffect(() => {
        if (!pendingRematchSearch) return;
        clearHuntTimers();
        if (pendingRematchSearch.mode === 'hybrid' && pendingRematchSearch.roomCode) {
            allowOpenJoins();
            setHybridParams({
                roomCode: pendingRematchSearch.roomCode,
                slotsNeeded: pendingRematchSearch.slotsNeeded ?? 1,
                matchType: pendingRematchSearch.matchType,
            });
        } else {
            setHybridParams(null);
        }
        setSearchId((prev) => prev + 1);
        setIsQuickMatchActive(true);
        onConsumeRematchSearch?.();
    }, [pendingRematchSearch, onConsumeRematchSearch, allowOpenJoins, clearHuntTimers]);

    const [pendingJoin, setPendingJoin] = useState<{ code: string; since: number } | null>(null);
    const [joinError, setJoinError] = useState<string | null>(null);
    const [showFee, setShowFee] = useState(false);
    const [dialWager, setDialWager] = useState(wager);
    const [dialWarning, setDialWarning] = useState<string | null>(null);
    const feeTierRef = useRef<HTMLDivElement | null>(null);
    const lastJoinRef = useRef<{ code: string; seat?: number; secret?: string | null } | null>(null);
    const feeInitRef = useRef(false);

    const openFeeSelector = useCallback(() => {
        playSelect();
        setShowFee((prev) => {
            const next = !prev;
            if (next) {
                setDialWager(wager);
                setDialWarning(null);
            }
            return next;
        });
    }, [playSelect, wager]);

    useEffect(() => {
        if (!showFee) return;
        const handlePointerDown = (e: PointerEvent) => {
            const el = feeTierRef.current;
            if (el && !el.contains(e.target as Node)) {
                setShowFee(false);
                setDialWarning(null);
            }
        };
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                setShowFee(false);
                setDialWarning(null);
            }
        };
        document.addEventListener('pointerdown', handlePointerDown);
        window.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('pointerdown', handlePointerDown);
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [showFee]);

    // Smart default fee from real CHIPS + Match Vault balance; clamp if balance can't cover current stake.
    useEffect(() => {
        if (playableChips <= 0) return;
        if (!feeInitRef.current) {
            feeInitRef.current = true;
            const suggested = suggestedEntryFee(playableChips);
            if (wager === 0 || wager > playableChips) setWager(suggested);
            return;
        }
        if (wager > 0 && wager > playableChips) {
            setWager(suggestedEntryFee(playableChips));
        }
    }, [playableChips, setWager, wager]);
    const lobbyRef = useRef(lobbyState);
    lobbyRef.current = lobbyState;
    const joinedCodeRef = useRef<string | null>(null);
    const JOIN_TIMEOUT_MS = 8000;

    const isSeatedIn = useCallback((code: string) => {
        const L = lobbyRef.current;
        const me = address?.toLowerCase();
        return !!L && L.roomCode?.toUpperCase() === code.toUpperCase() &&
            (L.slots || []).some(s => s.status === 'joined' && s.playerId?.toLowerCase() === me);
    }, [address]);

    const startPartyJoin = useCallback(async (code: string, seat?: number, secret?: string | null) => {
        guard('online-play', async () => {
            setJoinError(null);
            joinedCodeRef.current = code;
            lastJoinRef.current = { code, seat, secret };

            const session = await ensureAppSession({
                context: 'teamup',
                title: 'PARTY SIGN-IN REQUIRED',
                statusText: 'Please approve the sign-in request in your wallet to join this party.',
            });
            if (!session) {
                toast('Sign-in cancelled. Could not join party.', 'error');
                return;
            }

            setPendingJoin({ code, since: Date.now() });
            void createProvisionalSession(`room:${code}`, code, {
                context: 'teamup',
                title: 'JOINING PARTY SESSION',
                statusText: 'Authorizing multiplayer session in your wallet...',
            }).then(result => {
                if (!result.ok) console.warn('🔑 [TeamUp] pre-match authorization failed:', result.error);
            });
            joinGame(code, secret ?? undefined, seat);
            window.setTimeout(() => {
                if (joinedCodeRef.current !== code) return;
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
    }, [guard, joinGame, isSeatedIn, createProvisionalSession, ensureAppSession, toast]);

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

    useEffect(() => {
        if (!lobbyState || !address || isHost) return;
        if (lobbyState.status !== 'forming') return;
        const me = address.toLowerCase();
        const seated = (lobbyState.slots || []).some(
            s => s.status === 'joined' && s.playerId?.toLowerCase() === me,
        );
        if (seated) {
            setPendingJoin(null);
            setJoinError(null);
            setShowTeamUpOptions(true);

            const roomKey = `room:${lobbyState.roomCode}`;
            if (lobbyState.entryFee > 0 && !reservedTeamUpRef.current.has(roomKey)) {
                reservedTeamUpRef.current.add(roomKey);
                void vault
                    .ensureVaultAndReserve({
                        matchKey: roomKey,
                        entryFeeChips: lobbyState.entryFee,
                    })
                    .catch((err: unknown) => {
                        reservedTeamUpRef.current.delete(roomKey);
                        const msg = err instanceof Error ? err.message : undefined;
                        toast(msg || 'Match fee approval required to join paid room', 'error');
                        leaveGame();
                        setShowTeamUpOptions(false);
                    });
            }
        }
    }, [lobbyState, address, isHost, vault, leaveGame, toast]);

    useEffect(() => {
        try {
            const params = new URLSearchParams(window.location.search);
            const code = params.get('room');
            if (!code || code.trim().length < 3) return;
            const seatRaw = params.get('seat');
            const seat = seatRaw !== null && /^\d+$/.test(seatRaw) ? parseInt(seatRaw, 10) : undefined;
            const secret = params.get('s');
            window.history.replaceState(null, '', window.location.pathname);
            void startPartyJoin(code.trim().toUpperCase(), seat, secret);
        } catch { /* no link — normal entry */ }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleStartQuickMatch = useCallback((overrideMode?: 'classic' | 'power', overrideMatchType?: '1v1' | '2v2' | '4P', overrideWager?: number) => {
        guard('online-play', async () => {
            const targetMode = overrideMode || gameMode;
            const targetType = overrideMatchType || matchType;
            const targetWager = typeof overrideWager === 'number' ? overrideWager : wager;
            const myAddr = address?.toLowerCase();
            if (!myAddr) return;

            const session = await ensureAppSession({ context: 'quick-match' });
            if (!session) {
                toast('Sign-in cancelled. Please approve the wallet request to search for matches.', 'error');
                return;
            }

            const provKey = `search:${myAddr}:${targetMode}:${targetType}`;
            const provResult = await createProvisionalSession(provKey, undefined, { context: 'quick-match' });
            if (!provResult.ok) {
                toast(provResult.error || 'Matchmaking session authorization rejected. Returning to lobby.', 'error');
                return;
            }

            if (targetWager > 0) {
                try {
                    await vault.ensureVaultAndReserve({
                        matchKey: `qm:${myAddr}`,
                        entryFeeChips: targetWager,
                    });
                } catch (err: unknown) {
                    const msg = err instanceof Error ? err.message : undefined;
                    toast(msg || 'Vault deposit cancelled. Match search aborted.', 'error');
                    return;
                }
            }

            setSearchId(prev => prev + 1);
            setIsQuickMatchActive(true);
        });
    }, [guard, gameMode, matchType, address, ensureAppSession, createProvisionalSession, toast, wager, vault]);

    useEffect(() => {
        const handleJoinPool = (e: Event) => {
            const pool = (e as CustomEvent<{
                entryFee?: number;
                mode?: 'classic' | 'power';
                matchType?: '1v1' | '2v2' | '4P';
            }>)?.detail;
            if (pool && pool.mode && pool.matchType) {
                console.log('📡 [Lobby] Joining pool from feed:', pool);
                const fee = Number(pool.entryFee ?? 0);
                setWager(fee);
                setGameMode(pool.mode);
                setMatchType(pool.matchType);
                setTimeout(() => {
                    handleStartQuickMatch(pool.mode, pool.matchType, fee);
                }, 100);
            }
        };
        window.addEventListener('join_pool', handleJoinPool);
        const handleJoinParty = (e: Event) => {
            const detail = (e as CustomEvent<{ roomCode?: string; seat?: number }>)?.detail;
            const code = detail?.roomCode;
            if (typeof code === 'string' && code.trim().length >= 3) {
                console.log('📡 [Lobby] Joining party from feed:', code);
                const seat = typeof detail?.seat === 'number' ? detail.seat : undefined;
                void startPartyJoin(code.trim().toUpperCase(), seat);
            }
        };
        window.addEventListener('join_party', handleJoinParty);
        return () => {
            window.removeEventListener('join_pool', handleJoinPool);
            window.removeEventListener('join_party', handleJoinParty);
        };
    }, [setWager, setGameMode, setMatchType, handleStartQuickMatch, startPartyJoin]);

    const handleStartTeamUp = useCallback(() => {
        guard('teamup', async () => {
            const session = await ensureAppSession({ context: 'teamup' });
            if (!session) {
                toast('Sign-in cancelled. You must approve the request to access Team Up.', 'error');
                return;
            }
            setShowTeamUpOptions(true);
        });
    }, [guard, ensureAppSession, toast]);

    const handleCancelQuickMatch = useCallback(() => {
        clearHuntTimers();
        setIsQuickMatchActive(false);
        setHybridParams(null);
        setEmbeddedHunt(false);
        setHuntExpired(false);
    }, [clearHuntTimers]);

    const handleFillWithQuickMatch = () => {
        if (!lobbyState || !isHost) return;
        const empty = lobbyState.slots.filter(s => s.status === 'empty').length;
        if (empty === 0) return;
        playSelect();
        allowOpenJoins();
        setHybridParams({ roomCode: lobbyState.roomCode, slotsNeeded: empty, matchType: lobbyState.matchType });
        setSearchId(prev => prev + 1);
        setHuntExpired(false);
        setEmbeddedHunt(true);
        clearHuntTimers();
        huntTimers.current.stop = setTimeout(() => {
            if (!huntingRef.current) return;
            setHuntExpired(true);
            huntTimers.current.back = setTimeout(() => handleCancelQuickMatch(), 3500);
        }, HUNT_TIMEOUT_S * 1000);
    };

    useEffect(() => {
        if (!embeddedHunt || !lobbyState) return;
        const empty = lobbyState.slots.filter(s => s.status === 'empty').length;
        if (empty === 0) handleCancelQuickMatch();
    }, [embeddedHunt, lobbyState, handleCancelQuickMatch]);

    return (
        <div className={`ludo-lobby-scope relative isolate w-full max-w-4xl mx-auto ${isRetro ? 'px-1 sm:px-2' : 'px-3 sm:px-4'} py-2 sm:py-4 min-h-0 h-full flex flex-col items-center justify-start ${showFee ? 'fee-open overflow-visible' : 'overflow-hidden'}${lobbyCompact ? ' lobby-compact' : ''}`}>
            {/* Theme photo backdrop (fixed layer, behind everything, taps pass through) */}
            <div className="lobby-backdrop" aria-hidden />

            {/* 1. INITIAL SETUP PANEL */}
            {(!isQuickMatchActive && lobbyState?.status !== 'quickmatch') && (
                <div
                    key="setup"
                    ref={setupRef}
                    className={`w-full ${isRetro ? 'max-w-[480px]' : 'max-w-[420px]'} mx-auto flex flex-col gap-2 sm:gap-3 min-h-0 h-full setup-tier ${showFee ? 'overflow-visible' : 'overflow-hidden'}`}
                >
                    {/* 1. SELECTION GROUP + ENTRY FEE */}
                    {is3077 ? (
                        <div className="relative z-50 w-full flex flex-col items-center">
                            <div className="flex justify-center w-full mb-1.5 mt-0.5">
                                <SecurityLadderChip />
                            </div>
                            <div className="flex justify-center w-full mb-1.5">
                                <ThemeNudge />
                            </div>
                            <OrbitalCanopyDeck
                                themeVariant="3077"
                                gameMode={gameMode}
                                onChangeGameMode={setGameMode}
                                matchType={matchType}
                                onChangeMatchType={setMatchType}
                                sfxEnabled={preferences.sfx}
                                hapticsEnabled={preferences.haptics}
                                feeDock={
                                    <OrbitalFeeDock
                                        themeVariant="3077"
                                        circular
                                        expandedClassName="fee-tier-expanded-3077"
                                        wager={wager}
                                        dialWager={dialWager}
                                        playableChips={playableChips}
                                        showFee={showFee}
                                        dialWarning={dialWarning}
                                        feeTierRef={feeTierRef}
                                        onToggleOpen={openFeeSelector}
                                        onClose={() => {
                                            playSelect();
                                            setShowFee(false);
                                            setDialWarning(null);
                                        }}
                                        onConfirm={() => {
                                            if (dialWager > playableChips) {
                                                playSelect();
                                                setDialWarning(
                                                    `Insufficient CHIPS · Balance: ${formatEntryFee(playableChips)}`,
                                                );
                                                return;
                                            }
                                            playSelect();
                                            setWager(dialWager);
                                            setDialWarning(null);
                                            setShowFee(false);
                                        }}
                                        formatFee={formatEntryFee}
                                        expandedBody={
                                            <EntryFeeKnob
                                                circular
                                                wager={dialWager}
                                                playableChips={playableChips}
                                                onChange={(next) => {
                                                    setDialWager(next);
                                                    setDialWarning(null);
                                                }}
                                                sfxEnabled={preferences.sfx}
                                                formatBalance={formatEntryFee}
                                            />
                                        }
                                    />
                                }
                            />
                        </div>
                    ) : isRetro ? (() => {
                        const retroFee = RETRO_FEE_PALETTES[deployTheme.id] ?? RETRO_FEE_PALETTES.quick;
                        return (
                            <div className="relative z-50 w-full flex flex-col items-center">
                                <div className="flex justify-center w-full mb-1.5 mt-0.5">
                                    <SecurityLadderChip />
                                </div>
                                <div className="flex justify-center w-full mb-1.5">
                                    <ThemeNudge />
                                </div>
                                <LobbyCommandDeck
                                    themeVariant="retro"
                                    gameMode={gameMode}
                                    onChangeGameMode={setGameMode}
                                    matchType={matchType}
                                    onChangeMatchType={setMatchType}
                                    sfxEnabled={preferences.sfx}
                                    hapticsEnabled={preferences.haptics}
                                    feeDock={
                                        <div
                                            ref={feeTierRef}
                                            className="fee-tier relative z-40 w-full rounded-xl flex flex-col items-center border"
                                            style={{
                                                background: 'rgba(6, 11, 20, 0.78)',
                                                borderColor:
                                                    wager > playableChips
                                                        ? 'rgba(251, 113, 133, 0.58)'
                                                        : `rgba(${retroFee.rgb}, 0.42)`,
                                                boxShadow:
                                                    wager > playableChips
                                                        ? undefined
                                                        : `0 0 14px rgba(${retroFee.rgb}, 0.14)`,
                                            }}
                                        >
                                            <button
                                                type="button"
                                                onClick={openFeeSelector}
                                                aria-expanded={showFee}
                                                className="w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl hover:bg-surface-hover active:scale-[0.99] transition-[background-color,transform] cursor-pointer"
                                            >
                                                <span
                                                    className="inline-flex items-center gap-2 text-ludo-xs label-chrome font-bold uppercase tracking-[0.2em]"
                                                    style={{ color: retroFee.bright }}
                                                >
                                                    <ChipsHexIcon
                                                        className="w-4 h-4 shrink-0"
                                                        active={wager > 0}
                                                    />
                                                    <span>Entry Fee</span>
                                                </span>
                                                <span className="inline-flex items-center gap-2">
                                                    <span
                                                        className={`text-ludo-sm font-mono font-bold tracking-wide tabular-nums ${
                                                            wager > playableChips
                                                                ? 'text-negative animate-knob-alert-blink'
                                                                : ''
                                                        }`}
                                                        style={wager > playableChips ? undefined : { color: retroFee.bright }}
                                                    >
                                                        {formatEntryFee(wager)}
                                                    </span>
                                                    <ChevronGlyphIcon
                                                        direction="down"
                                                        className={`w-3.5 h-3.5 transition-transform duration-200 ${showFee ? 'rotate-180' : ''}`}
                                                    />
                                                </span>
                                            </button>

                                            <AnimatePresence initial={false}>
                                                {showFee && (
                                                    <motion.div
                                                        key="fee-synth-dropdown"
                                                        initial={{ opacity: 0, y: -4, scaleY: 0.94 }}
                                                        animate={{ opacity: 1, y: 0, scaleY: 1 }}
                                                        exit={{ opacity: 0, y: -4, scaleY: 0.94 }}
                                                        transition={{ duration: 0.16, ease: [0.2, 0, 0, 1] }}
                                                        style={{
                                                            transformOrigin: 'top center',
                                                            background: 'rgba(6, 11, 20, 0.98)',
                                                            borderColor:
                                                                dialWager > playableChips
                                                                    ? 'rgba(251, 113, 133, 0.85)'
                                                                    : `rgba(${retroFee.rgb}, 0.80)`,
                                                            boxShadow:
                                                                dialWager > playableChips
                                                                    ? '0 0 22px rgba(251, 113, 133, 0.25), var(--panel-shadow)'
                                                                    : `0 0 24px rgba(${retroFee.rgb}, 0.24), var(--panel-shadow)`,
                                                        }}
                                                        className="fee-tier fee-tier-expanded-retro absolute top-0 left-0 right-0 z-50 rounded-2xl border backdrop-blur-2xl flex flex-col items-center overflow-hidden"
                                                    >
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                playSelect();
                                                                setShowFee(false);
                                                                setDialWarning(null);
                                                            }}
                                                            aria-expanded={true}
                                                            className="relative z-10 w-full flex items-center justify-between px-3 py-2 rounded-t-2xl hover:bg-surface-hover active:scale-[0.99] transition-[background-color,transform] cursor-pointer"
                                                        >
                                                            <span
                                                                className="inline-flex items-center gap-2 text-ludo-xs label-chrome font-bold uppercase tracking-[0.2em]"
                                                                style={{ color: retroFee.bright }}
                                                            >
                                                                <ChipsHexIcon
                                                                    className="w-4 h-4 shrink-0"
                                                                    active={dialWager > 0}
                                                                />
                                                                <span>Entry Fee</span>
                                                            </span>
                                                            <span
                                                                className="inline-flex items-center gap-2"
                                                                style={{ color: retroFee.bright }}
                                                            >
                                                                <span
                                                                    className={`text-ludo-sm font-mono font-bold tracking-wide tabular-nums ${
                                                                        dialWager > playableChips
                                                                            ? 'text-negative animate-knob-alert-blink'
                                                                            : ''
                                                                    }`}
                                                                >
                                                                    {formatEntryFee(dialWager)}
                                                                </span>
                                                                <ChevronGlyphIcon
                                                                    direction="down"
                                                                    className="w-3.5 h-3.5 rotate-180 transition-transform duration-200"
                                                                />
                                                            </span>
                                                        </button>

                                                        <div className="relative z-10 w-full px-2.5 pb-3 pt-1 flex flex-col items-center gap-2.5">
                                                            <RetroSynthFeeFader
                                                                wager={dialWager}
                                                                playableChips={playableChips}
                                                                onChange={(next) => {
                                                                    setDialWager(next);
                                                                    setDialWarning(null);
                                                                }}
                                                                sfxEnabled={preferences.sfx}
                                                                formatBalance={formatEntryFee}
                                                            />
                                                            {dialWarning && (
                                                                <div
                                                                    role="alert"
                                                                    className="w-full px-3 py-1.5 rounded-xl bg-negative/15 border border-negative/40 text-negative flex items-center justify-center gap-1.5 text-ludo-xs font-mono font-bold"
                                                                >
                                                                    <WarningHexIcon className="w-3.5 h-3.5 shrink-0" />
                                                                    <span className="truncate">{dialWarning}</span>
                                                                </div>
                                                            )}
                                                            <Button
                                                                variant={dialWager > playableChips ? 'danger' : 'primary'}
                                                                size="md"
                                                                fullWidth
                                                                onClick={() => {
                                                                    if (dialWager > playableChips) {
                                                                        playSelect();
                                                                        setDialWarning(
                                                                            `Insufficient CHIPS · Balance: ${formatEntryFee(playableChips)}`,
                                                                        );
                                                                        return;
                                                                    }
                                                                    playSelect();
                                                                    setWager(dialWager);
                                                                    setDialWarning(null);
                                                                    setShowFee(false);
                                                                }}
                                                                className="uppercase tracking-[0.18em] font-extrabold"
                                                            >
                                                                Confirm · {formatEntryFee(dialWager)}
                                                            </Button>
                                                        </div>
                                                    </motion.div>
                                                )}
                                            </AnimatePresence>
                                        </div>
                                    }
                                />
                            </div>
                        );
                    })() : (() => {
                        const daybreakPalette =
                            DAYBREAK_PALETTES[deployTheme.id] ?? DAYBREAK_PALETTES.quick;
                        const isOverBalance = wager > playableChips;
                        const isDialOverBalance = dialWager > playableChips;
                        return (
                            <div className="relative z-50 w-full flex flex-col items-center">
                                <div className="flex justify-center w-full mb-1.5 mt-0.5">
                                    <SecurityLadderChip />
                                </div>
                                <div className="flex justify-center w-full mb-1.5">
                                    <ThemeNudge />
                                </div>
                                <DaybreakStudioDeck
                                    gameMode={gameMode}
                                    onChangeGameMode={setGameMode}
                                    matchType={matchType}
                                    onChangeMatchType={setMatchType}
                                    sfxEnabled={preferences.sfx}
                                    hapticsEnabled={preferences.haptics}
                                    feeDock={
                                        <div
                                            ref={feeTierRef}
                                            className="fee-tier daybreak-fee-capsule relative z-40 w-full rounded-xl flex flex-col items-center border"
                                            style={{
                                                background: '#F7F4EE',
                                                borderColor: isOverBalance
                                                    ? 'rgba(185, 28, 28, 0.45)'
                                                    : wager > 0
                                                      ? `rgba(${daybreakPalette.rgb}, 0.36)`
                                                      : 'rgba(28, 25, 23, 0.11)',
                                                boxShadow:
                                                    'inset 0 1px 0 rgba(255, 255, 255, 0.85), 0 1px 3px rgba(28, 25, 23, 0.06)',
                                            }}
                                        >
                                            <button
                                                type="button"
                                                onClick={openFeeSelector}
                                                aria-expanded={showFee}
                                                className="w-full flex items-center justify-between px-3 py-2 rounded-xl hover:bg-surface-hover active:scale-[0.99] transition-[background-color,transform] cursor-pointer"
                                            >
                                                <span
                                                    className="inline-flex items-center gap-2 text-ludo-xs label-chrome font-bold uppercase tracking-[0.2em]"
                                                    style={{
                                                        color:
                                                            wager > 0
                                                                ? daybreakPalette.deep
                                                                : 'var(--ink-strong)',
                                                    }}
                                                >
                                                    <ChipsHexIcon
                                                        className="w-4 h-4 shrink-0"
                                                        active={wager > 0}
                                                    />
                                                    <span>Entry Fee</span>
                                                </span>
                                                <span className="inline-flex items-center gap-2">
                                                    <span
                                                        className={`text-ludo-sm font-mono font-bold tracking-wide tabular-nums ${
                                                            isOverBalance ? 'text-negative' : ''
                                                        }`}
                                                        style={
                                                            isOverBalance
                                                                ? undefined
                                                                : {
                                                                      color:
                                                                          wager > 0
                                                                              ? daybreakPalette.deep
                                                                              : 'var(--ink-muted)',
                                                                  }
                                                        }
                                                    >
                                                        {formatEntryFee(wager)}
                                                    </span>
                                                    <ChevronGlyphIcon
                                                        direction="down"
                                                        className={`w-3.5 h-3.5 text-ink-muted transition-transform duration-200 ${
                                                            showFee ? 'rotate-180' : ''
                                                        }`}
                                                    />
                                                </span>
                                            </button>

                                            <AnimatePresence initial={false}>
                                                {showFee && (
                                                    <motion.div
                                                        key="daybreak-fee-vernier"
                                                        initial={{ opacity: 0, y: -6, scale: 0.96 }}
                                                        animate={{ opacity: 1, y: 0, scale: 1 }}
                                                        exit={{ opacity: 0, y: -4, scale: 0.97 }}
                                                        transition={{
                                                            duration: 0.16,
                                                            ease: [0.22, 1, 0.36, 1],
                                                        }}
                                                        style={{
                                                            transformOrigin: 'top center',
                                                            background:
                                                                'linear-gradient(180deg, #FFFFFF 0%, #FAF8F3 100%)',
                                                            borderColor: isDialOverBalance
                                                                ? 'rgba(185, 28, 28, 0.55)'
                                                                : `rgba(${daybreakPalette.rgb}, 0.42)`,
                                                            boxShadow:
                                                                '0 20px 44px -12px rgba(28, 25, 23, 0.22), inset 0 1px 0 #FFFFFF',
                                                        }}
                                                        className="fee-tier daybreak-fee-drawer absolute -top-2 left-0 right-0 z-40 rounded-2xl border flex flex-col items-center overflow-hidden"
                                                    >
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                playSelect();
                                                                setShowFee(false);
                                                                setDialWarning(null);
                                                            }}
                                                            aria-expanded={true}
                                                            className="relative z-10 w-full flex items-center justify-between px-3.5 py-2.5 rounded-t-2xl hover:bg-surface-hover active:scale-[0.99] transition-[background-color,transform] cursor-pointer"
                                                        >
                                                            <span
                                                                className="inline-flex items-center gap-2 text-ludo-xs label-chrome font-bold uppercase tracking-[0.2em]"
                                                                style={{ color: daybreakPalette.deep }}
                                                            >
                                                                <ChipsHexIcon
                                                                    className="w-4 h-4 shrink-0"
                                                                    active={dialWager > 0}
                                                                />
                                                                <span>Entry Fee</span>
                                                            </span>
                                                            <span className="inline-flex items-center gap-2">
                                                                <span
                                                                    className={`text-ludo-sm font-mono font-bold tracking-wide tabular-nums ${
                                                                        isDialOverBalance
                                                                            ? 'text-negative'
                                                                            : ''
                                                                    }`}
                                                                    style={
                                                                        isDialOverBalance
                                                                            ? undefined
                                                                            : {
                                                                                  color: daybreakPalette.deep,
                                                                              }
                                                                    }
                                                                >
                                                                    {formatEntryFee(dialWager)}
                                                                </span>
                                                                <ChevronGlyphIcon
                                                                    direction="down"
                                                                    className="w-3.5 h-3.5 rotate-180 text-ink-muted"
                                                                />
                                                            </span>
                                                        </button>

                                                        <div className="relative z-10 w-full px-3 pb-3 pt-1 flex flex-col items-center gap-2.5">
                                                            <DaybreakFeePicker
                                                                wager={dialWager}
                                                                playableChips={playableChips}
                                                                onChange={(next) => {
                                                                    setDialWager(next);
                                                                    setDialWarning(null);
                                                                }}
                                                                sfxEnabled={preferences.sfx}
                                                                hapticsEnabled={preferences.haptics}
                                                                formatBalance={formatEntryFee}
                                                            />
                                                            {(vault.availableChips > 0 || dialWager > 0) && (
                                                                <div className="w-full px-3 py-1.5 rounded-xl bg-surface-recessed border border-line-soft flex items-center justify-between gap-2 text-ludo-xs font-mono">
                                                                    <span className="inline-flex items-center gap-1.5 text-accent font-bold shrink-0">
                                                                        <VaultShieldIcon
                                                                            className="w-3.5 h-3.5 shrink-0"
                                                                            active
                                                                        />
                                                                        <span>
                                                                            Vault:{' '}
                                                                            {formatEntryFee(
                                                                                vault.availableChips,
                                                                            )}
                                                                        </span>
                                                                    </span>
                                                                    <span className="text-ink-muted truncate">
                                                                        {dialWager === 0 ? (
                                                                            'Safe for next match'
                                                                        ) : vault.availableChips >=
                                                                          dialWager ? (
                                                                            <span className="inline-flex items-center gap-1 text-positive font-semibold">
                                                                                <CheckGlyphIcon className="w-3 h-3 shrink-0" />
                                                                                <span>Covered (0 gas)</span>
                                                                            </span>
                                                                        ) : vault.availableChips > 0 ? (
                                                                            `Top up ${formatEntryFee(
                                                                                dialWager -
                                                                                    vault.availableChips,
                                                                            )}`
                                                                        ) : (
                                                                            '1-step top-up'
                                                                        )}
                                                                    </span>
                                                                </div>
                                                            )}
                                                            {dialWarning && (
                                                                <div
                                                                    role="alert"
                                                                    className="w-full px-3 py-1.5 rounded-xl bg-negative/10 border border-negative/35 text-negative flex items-center justify-center gap-1.5 text-ludo-xs font-mono font-bold"
                                                                >
                                                                    <WarningHexIcon className="w-3.5 h-3.5 shrink-0" />
                                                                    <span className="truncate">
                                                                        {dialWarning}
                                                                    </span>
                                                                </div>
                                                            )}
                                                            <Button
                                                                variant={
                                                                    isDialOverBalance
                                                                        ? 'danger'
                                                                        : 'primary'
                                                                }
                                                                size="md"
                                                                fullWidth
                                                                onClick={() => {
                                                                    if (isDialOverBalance) {
                                                                        playSelect();
                                                                        setDialWarning(
                                                                            `Insufficient CHIPS · Balance: ${formatEntryFee(
                                                                                playableChips,
                                                                            )}`,
                                                                        );
                                                                        return;
                                                                    }
                                                                    playSelect();
                                                                    setWager(dialWager);
                                                                    setDialWarning(null);
                                                                    setShowFee(false);
                                                                }}
                                                                className="uppercase tracking-[0.16em] font-extrabold rounded-full"
                                                            >
                                                                Confirm · {formatEntryFee(dialWager)}
                                                            </Button>
                                                        </div>
                                                    </motion.div>
                                                )}
                                            </AnimatePresence>
                                        </div>
                                    }
                                />
                            </div>
                        );
                    })()}

                    {/* 3. ACTION DICE */}
                    <div className={`w-full flex-1 flex items-center justify-center relative isolate z-10 min-h-0 transition-opacity duration-150 ${showFee ? 'pointer-events-none opacity-25' : 'opacity-100'}`}>
                        <ActionDice
                            onSelectQuickMatch={() => handleStartQuickMatch()}
                            onSelectTeamUp={handleStartTeamUp}
                            onSelectOfflineMatch={() => setShowOfflineOptions(true)}
                        />
                    </div>

                    {/* 4. LIVE BROADCAST */}
                    <div className="broadcast-anchor w-full mt-auto pt-2">
                        <LiveBroadcastCard
                            onOpenProfile={onOpenProfile}
                            onOpenChange={onBroadcastOpenChange}
                            onOpenArena={onOpenArena}
                        />
                    </div>
                </div>
            )}

            {/* --- OVERLAY PANELS --- */}
            {pendingJoin && (
                <div className="fixed inset-0 z-[250] flex items-center justify-center px-6 bg-surface-page/75 backdrop-blur-sm">
                    <div
                        className="panel-shell-3077 relative w-full max-w-[320px] rounded-[24px] border border-line-strong bg-surface-panel px-6 py-8 flex flex-col items-center gap-4 text-center shadow-2xl overflow-hidden"
                        style={{ backdropFilter: 'blur(32px)' }}
                    >
                        <HudCornerTicks />
                        <ThinkingOrb state="searching" size={32} tone="accent" label="Joining room" />
                        <p className="text-ludo-xs font-extrabold uppercase tracking-[0.3em] text-accent">
                            Joining room
                        </p>
                        <p className="text-2xl font-extrabold text-ink-strong tracking-[0.25em]">{pendingJoin.code}</p>
                        <p className="text-ludo-sm text-ink-muted font-bold uppercase tracking-wider">
                            Waiting for host…
                        </p>
                    </div>
                </div>
            )}

            {joinError && (
                <div
                    className="fixed inset-0 z-[200] flex items-center justify-center px-6 bg-surface-page/75 backdrop-blur-sm"
                    onClick={() => setJoinError(null)}
                >
                    <div
                        className="panel-shell-3077 relative w-full max-w-[340px] rounded-[24px] border border-line-strong bg-surface-panel px-6 py-6 flex flex-col items-center gap-2.5 text-center shadow-2xl overflow-hidden"
                        style={{ backdropFilter: 'blur(32px)' }}
                        onClick={e => e.stopPropagation()}
                    >
                        <HudCornerTicks />
                        <p className="text-ludo-xs font-extrabold uppercase tracking-[0.3em] text-warn">
                            Room unavailable
                        </p>
                        <p className="text-ludo-md font-bold text-ink-strong leading-relaxed">
                            {joinError}
                        </p>
                        <p className="text-ludo-sm text-ink-muted leading-relaxed">
                            Use the full invite link (with the secret), or ask the host to copy it again.
                        </p>
                        {lastJoinRef.current && (
                            <Button
                                variant="primary"
                                size="md"
                                fullWidth
                                onClick={() => {
                                    const j = lastJoinRef.current;
                                    setJoinError(null);
                                    if (j) void startPartyJoin(j.code, j.seat, j.secret);
                                }}
                                className="mt-1 uppercase tracking-[0.2em]"
                            >
                                Try again
                            </Button>
                        )}
                        <Button
                            variant="secondary"
                            size="md"
                            fullWidth
                            onClick={() => setJoinError(null)}
                            className="mt-1 uppercase tracking-[0.2em]"
                        >
                            Got it
                        </Button>
                    </div>
                </div>
            )}

            {/* Hide Team Up while a join is in flight so the Joining overlay is visible */}
            {showTeamUpOptions && !pendingJoin && (
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
                            const closingCode = lobbyState?.roomCode || roomId;
                            if (closingCode && reservedTeamUpRef.current.has(`room:${closingCode}`)) {
                                const key = `room:${closingCode}`;
                                reservedTeamUpRef.current.delete(key);
                                void vault.releaseMatchStake(key).then((released) => {
                                    if (released > 0) {
                                        toast(
                                            `${released.toLocaleString()} CHIPS returned to your Match Vault for your next match (0 gas).`,
                                            'info',
                                        );
                                    }
                                });
                            }
                            leaveGame();
                            setShowTeamUpOptions(false);
                        }}
                        onJoin={(code: string, secret?: string) => void startPartyJoin(code, undefined, secret || null)}
                        onHost={() => {
                            const code = hostQuickLobby(matchType, gameMode, wager);
                            if (wager > 0 && code) {
                                const key = `room:${code}`;
                                reservedTeamUpRef.current.add(key);
                                void vault
                                    .ensureVaultAndReserve({ matchKey: key, entryFeeChips: wager })
                                    .catch((err: unknown) => {
                                        reservedTeamUpRef.current.delete(key);
                                        const msg = err instanceof Error ? err.message : undefined;
                                        toast(msg || 'Match fee approval required to host a paid room.', 'error');
                                        leaveGame();
                                    });
                            }
                        }}
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
                        onLowerFee={() => {
                            lowerEntryFee();
                            const activeCode = lobbyState?.roomCode || roomId;
                            const feeOrder = [10_000_000, 1_000_000, 500_000, 100_000, 10_000, 1_000, 500, 0];
                            const cur = lobbyState?.entryFee ?? wager;
                            const next = feeOrder.find(p => p < cur);
                            if (activeCode && next !== undefined) {
                                const key = `room:${activeCode}`;
                                if (next === 0) {
                                    reservedTeamUpRef.current.delete(key);
                                    void vault.releaseMatchStake(key).then((rel) => {
                                        if (rel > 0) toast(`${rel.toLocaleString()} CHIPS returned to your Match Vault (0 gas).`, 'info');
                                    });
                                } else {
                                    void vault.ensureVaultAndReserve({ matchKey: key, entryFeeChips: next });
                                }
                            }
                        }}
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
                    onStartPassAndPlay={() => {
                        setShowOfflineOptions(false);
                        onStartPassAndPlay?.();
                    }}
                />
            )}

            {/* Solo or Hybrid radar (own overlay) */}
            {(isQuickMatchActive || lobbyState?.status === 'quickmatch') && (
                <QuickMatchPanel
                    key={`quickmatch-${searchId}`}
                    gameMode={gameMode}
                    matchType={matchType}
                    wager={wager}
                    onStartGame={onStartGame}
                    onCancel={handleCancelQuickMatch}
                    isHybrid={Boolean(hybridParams) || lobbyState?.status === 'quickmatch'}
                    roomCode={hybridParams?.roomCode || roomId}
                    slotsNeeded={
                        hybridParams?.slotsNeeded ??
                        lobbyState?.slots.filter(s => s.status === 'empty').length
                    }
                />
            )}

            {/* Embedded hunt engine */}
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
