/* eslint-disable @typescript-eslint/no-explicit-any -- lint burn-down quarantine 2026-09-23 */
"use client";

import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence, useMotionValue, useTransform, animate } from 'framer-motion';
import { FiX, FiMessageSquare, FiSend, FiTrendingUp, FiZap, FiChevronDown, FiChevronUp, FiAward } from 'react-icons/fi';
import { formatUnits } from 'viem';
import { supabase } from '@/lib/supabase';
import { ActiveBettingWindow } from '@/hooks/useSpectatorSync';
import { BetType, PlayerColor } from '@/lib/types';
import { seatedColorsFor } from '@/lib/engine/core';
import { useAccount } from 'wagmi';
import { useGameData } from '@/hooks/GameDataContext';
import { getFollowed } from '@/lib/follow';
import { useAppSession } from '@/hooks/useAppSession';
import { useArenaVault } from '@/hooks/useArenaVault';
import { useChipsBalance } from '@/hooks/useChipsBalance';
import { usePlayerSigner } from '@/hooks/usePlayerSigner';
import {
    SPECTATOR_BET_MAX_CHIPS,
    SPECTATOR_BET_MIN_CHIPS,
    SPECTATOR_BET_PRESETS,
    type SpectatorPoolSummary,
} from '@/lib/spectatorBettingMath';
import { useToast } from './Toast';

// ─────────────────────────────────────────────────────────────
// SpectatorHUD — Solid, height-adjustable Watch & Bet overlay
//
// Invariant: NEVER alters `.board-main` / `.board-area` layout or padding.
// Solid opaque surface so board colors never bleed through.
// User can drag top handle smoothly from a 1-line bar (56px) up to full panel.
// ─────────────────────────────────────────────────────────────

const MIN_DRAWER_HEIGHT = 56;
const ONE_LINE_THRESHOLD = 96;

function clampDrawerHeight(h: number, maxH: number): number {
    return Math.min(Math.max(MIN_DRAWER_HEIGHT, Math.round(h)), Math.max(MIN_DRAWER_HEIGHT + 40, maxH));
}

function getDefaultExpandedHeight(): number {
    if (typeof window === 'undefined') return 380;
    const isDesktop = window.innerWidth >= 1024;
    return isDesktop
        ? Math.max(460, window.innerHeight - 96)
        : Math.min(440, Math.max(300, Math.round(window.innerHeight * 0.46)));
}

function getMaxDrawerHeight(): number {
    if (typeof window === 'undefined') return 680;
    return Math.max(360, window.innerHeight - 80);
}

function AnimatedNumber({ value, decimals = 1 }: { value: number; decimals?: number }) {
    const motionVal = useMotionValue(value);
    const display = useTransform(motionVal, v => v.toFixed(decimals));
    const [displayStr, setDisplayStr] = useState(value.toFixed(decimals));

    useEffect(() => {
        const controls = animate(motionVal, value, { duration: 0.6, ease: 'easeOut' });
        const unsub = display.on('change', v => setDisplayStr(v));
        return () => { controls.stop(); unsub(); };
    }, [value, motionVal, display]);

    return <span>{displayStr}</span>;
}

function calcWinProb(
    positions: Record<string, number[]>,
    seatedColors: readonly PlayerColor[],
): Record<string, number> {
    const weights = seatedColors.map(color => {
        const tokens = positions[color] ?? [-1, -1, -1, -1];
        const score = tokens.reduce((acc, p) => acc + (p >= 0 ? p + 4 : 1), 0);
        return { color, score };
    });
    const total = weights.reduce((acc, w) => acc + w.score, 0) || 1;
    return Object.fromEntries(weights.map(({ color, score }) => [color, score / total]));
}

const COLOR_STYLES: Record<string, { bg: string; text: string }> = {
    green:  { bg: '#22c55e', text: '#000' },
    red:    { bg: '#ef4444', text: '#fff' },
    yellow: { bg: '#eab308', text: '#000' },
    blue:   { bg: '#3b82f6', text: '#fff' },
};

function formatCompactChips(n: number): string {
    if (n >= 1_000_000) return `${Number((n / 1_000_000).toFixed(1))}M`;
    if (n >= 1_000) return `${Number((n / 1_000).toFixed(1))}K`;
    return n.toLocaleString();
}

interface ChatMessage {
    id: string;
    author: string;
    text: string;
    createdAt: number;
    system?: boolean;
}

interface SpectatorBetRecord {
    id: string;
    player_id: string;
    bet_type: string;
    bet_value: string;
    amount: number | string;
    payout_amount?: number | string | null;
    status: 'open' | 'won' | 'lost' | 'cashed_out' | 'cancelled';
    bet_metadata?: Record<string, unknown> | null;
}

interface ServerWindowSnapshot {
    status: string;
    betType: string;
    openedAt: string | null;
    closedAt: string | null;
    serverNow: string;
}

interface BetChoiceOption {
    value: string;
    label: string;
    colors: PlayerColor[];
}

interface SpectatorHUDProps {
    roomCode: string;
    matchId: string;
    playerCount?: '1v1' | '2v2' | '4P';
    activeBetWindow: ActiveBettingWindow | null;
    positions: Record<string, number[]>;
    onClose?: () => void;
}

export const SpectatorHUD = ({
    roomCode,
    matchId,
    playerCount = '4P',
    activeBetWindow,
    positions,
    onClose,
}: SpectatorHUDProps) => {
    const { address: wagmiAddress } = useAccount();
    const player = usePlayerSigner();
    const address = (player.address ?? wagmiAddress) as `0x${string}` | undefined;
    const { myProfile } = useGameData();
    const { ensureAppSession, peekAppSession } = useAppSession();
    const vault = useArenaVault();
    const chipsBal = useChipsBalance();
    const toast = useToast();

    const [betAmount, setBetAmount] = useState<number>(500);
    const [customMode, setCustomMode] = useState<boolean>(false);
    const [customInput, setCustomInput] = useState<string>('2500');
    const [selectedBetValue, setSelectedBetValue] = useState<string | null>(null);
    const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
    const [chatInput, setChatInput] = useState('');
    const [isBetting, setIsBetting] = useState(false);
    const [betStatusStep, setBetStatusStep] = useState<string | null>(null);
    const [betResults, setBetResults] = useState<{ id: string; status: 'won' | 'lost'; text: string }[]>([]);
    const [myBets, setMyBets] = useState<SpectatorBetRecord[]>([]);
    const [poolSummary, setPoolSummary] = useState<SpectatorPoolSummary>({ totalPot: 0, betCount: 0, bySide: {} });
    const [serverWindow, setServerWindow] = useState<ServerWindowSnapshot | null>(null);
    const [serverSkewMs, setServerSkewMs] = useState<number>(0);

    const [drawerHeight, setDrawerHeight] = useState<number>(() => getDefaultExpandedHeight());
    const [isDragging, setIsDragging] = useState(false);
    const [mobileTab, setMobileTab] = useState<'bet' | 'comm'>('bet');
    const lastExpandedHeightRef = useRef<number>(getDefaultExpandedHeight());
    const dragStartYRef = useRef(0);
    const dragStartHeightRef = useRef(0);
    const seenResultsRef = useRef<Set<string>>(new Set());

    const walletChips = useMemo(() => {
        if (chipsBal.balance == null) return null;
        return Math.floor(Number(formatUnits(chipsBal.balance, 18)));
    }, [chipsBal.balance]);

    // Keep height within viewport bounds on resize/rotation
    useEffect(() => {
        const onResize = () => {
            const maxH = getMaxDrawerHeight();
            setDrawerHeight(prev => clampDrawerHeight(prev, maxH));
        };
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, []);

    // Drag handlers for smooth 1-line to full-panel adjustment
    const handleDragStart = (e: React.PointerEvent<HTMLDivElement>) => {
        if (e.button !== 0 && e.pointerType === 'mouse') return;
        e.currentTarget.setPointerCapture(e.pointerId);
        dragStartYRef.current = e.clientY;
        dragStartHeightRef.current = drawerHeight;
        setIsDragging(true);
    };

    const handleDragMove = (e: React.PointerEvent<HTMLDivElement>) => {
        if (!isDragging) return;
        const deltaY = dragStartYRef.current - e.clientY;
        const nextHeight = clampDrawerHeight(dragStartHeightRef.current + deltaY, getMaxDrawerHeight());
        setDrawerHeight(nextHeight);
        if (nextHeight > ONE_LINE_THRESHOLD) {
            lastExpandedHeightRef.current = nextHeight;
        }
    };

    const handleDragEnd = (e: React.PointerEvent<HTMLDivElement>) => {
        if (!isDragging) return;
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
            e.currentTarget.releasePointerCapture(e.pointerId);
        }
        setIsDragging(false);
        setDrawerHeight(prev => (prev <= 80 ? MIN_DRAWER_HEIGHT : prev));
    };

    const isOneLine = drawerHeight <= ONE_LINE_THRESHOLD;

    const toggleCollapse = () => {
        if (isOneLine) {
            const restore = Math.max(260, lastExpandedHeightRef.current || getDefaultExpandedHeight());
            setDrawerHeight(clampDrawerHeight(restore, getMaxDrawerHeight()));
        } else {
            lastExpandedHeightRef.current = drawerHeight;
            setDrawerHeight(MIN_DRAWER_HEIGHT);
        }
    };

    const handleSettledBets = useCallback((rows: SpectatorBetRecord[]) => {
        const fresh: { id: string; status: 'won' | 'lost'; text: string }[] = [];
        for (const b of rows) {
            if ((b.status === 'won' || b.status === 'lost') && !seenResultsRef.current.has(b.id)) {
                seenResultsRef.current.add(b.id);
                const amountNum = Math.floor(Number(b.amount || 0));
                const payoutNum = Math.floor(Number(b.payout_amount || 0));
                const isRefund = b.status === 'won' && payoutNum <= amountNum;
                const text =
                    b.status === 'won'
                        ? isRefund
                            ? `${payoutNum.toLocaleString()} CHIPS refunded · Credited to Vault / Claim Hub`
                            : `+${payoutNum.toLocaleString()} CHIPS won · Credited to Vault / Claim Hub`
                        : 'Bet settled · Better luck next round';

                fresh.push({ id: b.id, status: b.status, text });
                if (b.status === 'won') {
                    toast(text, 'success');
                    if (typeof window !== 'undefined') {
                        window.dispatchEvent(new CustomEvent('ludo-arena-vault-updated'));
                    }
                }

                setTimeout(() => {
                    seenResultsRef.current.delete(b.id);
                    setBetResults(prev => prev.filter(r => r.id !== b.id));
                }, 8000);
            }
        }
        if (fresh.length > 0) setBetResults(prev => [...prev, ...fresh].slice(-3));
    }, [toast]);

    const fetchBetSummary = useCallback(async (overrideSid?: string): Promise<void> => {
        if (!address || !matchId) return;
        try {
            const sessionId = overrideSid || peekAppSession() || (await ensureAppSession().catch(() => null));
            if (!sessionId) return;
            const params = new URLSearchParams({ matchId, walletAddress: address, summary: '1' });
            const res = await fetch(`/api/spectator-bets?${params.toString()}`, {
                headers: { Authorization: `Bearer ${sessionId}` },
                cache: 'no-store',
            });
            if (!res.ok) return;
            const payload = await res.json();
            if (payload?.poolSummary) setPoolSummary(payload.poolSummary);
            if (Array.isArray(payload?.myBets)) {
                setMyBets(payload.myBets);
                handleSettledBets(payload.myBets);
            }
            if (payload?.window) {
                setServerWindow(payload.window as ServerWindowSnapshot);
                const srvMs = Date.parse(payload.window.serverNow);
                if (Number.isFinite(srvMs)) {
                    setServerSkewMs(srvMs - Date.now());
                }
            }
        } catch {
            /* transient — next poll retries */
        }
    }, [address, matchId, peekAppSession, ensureAppSession, handleSettledBets]);

    // Poll pool summary, window state, and settled bets
    useEffect(() => {
        if (!address || !matchId) return;
        let cancelled = false;
        const run = async () => {
            if (!cancelled) await fetchBetSummary();
        };
        void run();
        const t = setInterval(run, 5000);
        return () => {
            cancelled = true;
            clearInterval(t);
        };
    }, [address, matchId, fetchBetSummary]);

    const [followedBets, setFollowedBets] = useState<{ id: string; bet_type: string; bet_value: string }[]>([]);
    const [timeLeft, setTimeLeft] = useState(0);

    const seatedColors = useMemo(() => Array.from(seatedColorsFor(playerCount)), [playerCount]);
    const winProb = calcWinProb(positions, seatedColors);

    const betChoices: BetChoiceOption[] = useMemo(() => {
        if (playerCount === '2v2') {
            return [
                { value: 'team 1', label: 'Team 1 (G+B)', colors: ['green', 'blue'] },
                { value: 'team 2', label: 'Team 2 (R+Y)', colors: ['red', 'yellow'] },
            ];
        }
        return seatedColors.map((color) => ({
            value: color,
            label: color,
            colors: [color],
        }));
    }, [playerCount, seatedColors]);

    // Authoritative window reconciliation (server window overrides stale client bootstrap)
    const effectiveWindow = useMemo(() => {
        if (serverWindow && serverWindow.closedAt) {
            const closedMs = Date.parse(serverWindow.closedAt);
            const openedMs = serverWindow.openedAt ? Date.parse(serverWindow.openedAt) : closedMs - 90_000;
            const isClosedStatus = serverWindow.status !== 'open';
            return {
                status: serverWindow.status,
                betType: serverWindow.betType || 'winner',
                openedAt: Number.isFinite(openedMs) ? openedMs : Date.now(),
                expiresAt: Number.isFinite(closedMs) ? closedMs : 0,
                windowClosedAt: isClosedStatus ? serverWindow.closedAt : null,
            };
        }
        if (activeBetWindow) {
            return {
                status: activeBetWindow.windowClosedAt ? 'closed' : 'open',
                betType: activeBetWindow.betType || 'winner',
                openedAt: activeBetWindow.openedAt ?? activeBetWindow.expiresAt - 90_000,
                expiresAt: activeBetWindow.expiresAt,
                windowClosedAt: activeBetWindow.windowClosedAt,
            };
        }
        return null;
    }, [serverWindow, activeBetWindow]);

    useEffect(() => {
        if (!effectiveWindow?.expiresAt || effectiveWindow.windowClosedAt) {
            setTimeLeft(0);
            return;
        }
        const tick = () => {
            const approxServerNow = Date.now() + serverSkewMs;
            setTimeLeft(Math.max(0, effectiveWindow.expiresAt - approxServerNow));
        };
        tick();
        const timer = setInterval(tick, 200);
        return () => clearInterval(timer);
    }, [effectiveWindow, serverSkewMs]);

    useEffect(() => {
        const channel = supabase
            .channel(`chat-${roomCode}`)
            .on('broadcast', { event: 'spectator-chat' }, ({ payload }) => {
                setChatMessages(prev => [...prev.slice(-49), payload as ChatMessage]);
            })
            .subscribe();
        return () => { supabase.removeChannel(channel); };
    }, [roomCode]);

    const sendChat = useCallback(async () => {
        if (!chatInput.trim() || !address) return;
        const msg: ChatMessage = {
            id: crypto.randomUUID(),
            author: myProfile?.username ?? address.slice(0, 6) + '…',
            text: chatInput.trim().slice(0, 120),
            createdAt: Date.now(),
        };
        setChatMessages(prev => [...prev.slice(-49), msg]);
        setChatInput('');
        await supabase.channel(`chat-${roomCode}`).send({
            type: 'broadcast', event: 'spectator-chat', payload: msg,
        });
    }, [chatInput, address, myProfile, roomCode]);

    const windowOpen = Boolean(
        effectiveWindow &&
        effectiveWindow.status === 'open' &&
        !effectiveWindow.windowClosedAt &&
        timeLeft > 0,
    );

    const placeBet = useCallback(async (betValue: string, label: string, betType: BetType = 'winner') => {
        if (!address) {
            toast('Connect wallet to place bets.', 'error');
            return;
        }
        if (!matchId) {
            toast('Syncing match room — please wait a moment.', 'error');
            return;
        }
        if (!windowOpen) {
            toast('Betting window is closed for this match.', 'error');
            return;
        }
        if (isBetting) return;

        const cleanAmount = Math.floor(Number(betAmount));
        if (!Number.isInteger(cleanAmount) || cleanAmount < SPECTATOR_BET_MIN_CHIPS || cleanAmount > SPECTATOR_BET_MAX_CHIPS) {
            toast(`Enter a bet between ${SPECTATOR_BET_MIN_CHIPS} and ${SPECTATOR_BET_MAX_CHIPS.toLocaleString()} CHIPS.`, 'error');
            return;
        }

        if (walletChips != null && vault.availableChips + walletChips < cleanAmount) {
            toast('Not enough CHIPS across Match Vault and Wallet for this bet.', 'error');
            return;
        }

        setIsBetting(true);
        setBetStatusStep(vault.availableChips >= cleanAmount ? 'Placing bet from Vault…' : 'Checking CHIPS allowance…');

        try {
            const sessionId = await ensureAppSession({ context: 'betting' });
            if (!sessionId) throw new Error('Sign-in required to place bets');

            // 1. Ensure Vault has enough balance; if short, SignWaitModal requests CHIPS approval + deficit deposit.
            if (vault.availableChips < cleanAmount) {
                setBetStatusStep('Approve CHIPS deposit to Match Vault…');
            }
            await vault.ensureVaultForStake(cleanAmount, sessionId);

            setBetStatusStep('Confirming pool entry…');
            const response = await fetch('/api/spectator-bets', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    walletAddress: address,
                    sessionId,
                    matchId,
                    betType,
                    betValue,
                    amount: cleanAmount,
                    actionId: crypto.randomUUID(),
                }),
            });
            const body = await response.json().catch(() => ({}));

            if (!response.ok) {
                toast(body?.error || 'Failed to place bet.', 'error');
                await fetchBetSummary(sessionId);
                return;
            }

            setSelectedBetValue(betValue);
            await Promise.all([
                fetchBetSummary(sessionId),
                vault.refresh(sessionId),
                chipsBal.refresh().catch(() => undefined),
            ]);

            toast(`Backed ${label} with ${cleanAmount.toLocaleString()} CHIPS`, 'success');

            const name = myProfile?.username ?? address.slice(0, 6) + '…';
            const callout: ChatMessage = {
                id: crypto.randomUUID(),
                author: '',
                text: `${name} backed ${label} · ${cleanAmount.toLocaleString()} CHIPS`,
                createdAt: Date.now(),
                system: true,
            };
            setChatMessages(prev => [...prev.slice(-49), callout]);
            void supabase.channel(`chat-${roomCode}`).send({
                type: 'broadcast', event: 'spectator-chat', payload: callout,
            });
        } catch (err) {
            const msg = (err as Error)?.message || 'Bet failed.';
            if (!msg.toLowerCase().includes('rejected') && !msg.toLowerCase().includes('cancel')) {
                toast(msg, 'error');
            }
        } finally {
            setIsBetting(false);
            setBetStatusStep(null);
        }
    }, [
        address,
        matchId,
        windowOpen,
        isBetting,
        betAmount,
        walletChips,
        vault,
        ensureAppSession,
        fetchBetSummary,
        chipsBal,
        toast,
        myProfile,
        roomCode,
    ]);

    useEffect(() => {
        if (!address || !matchId) return;
        const ids = getFollowed(address);
        if (ids.length === 0) {
            setFollowedBets([]);
            return;
        }
        let cancelled = false;
        (async () => {
            const sessionId = peekAppSession() || (await ensureAppSession().catch(() => null));
            if (!sessionId || cancelled) return;
            const response = await fetch(`/api/spectator-bets?matchId=${encodeURIComponent(matchId)}&walletAddress=${encodeURIComponent(address)}`, {
                headers: { Authorization: `Bearer ${sessionId}` },
            });
            const data = response.ok ? await response.json() : [];
            if (!cancelled && Array.isArray(data)) {
                setFollowedBets(
                    (data as any[])
                        .filter(row => ids.includes(String(row.player_id).toLowerCase()))
                        .map(row => ({
                            id: String(row.id),
                            bet_type: String(row.bet_type),
                            bet_value: String(row.bet_value),
                        })),
                );
            }
        })();
        return () => { cancelled = true; };
    }, [address, matchId, peekAppSession, ensureAppSession]);

    const myOpenStakesBySide = useMemo(() => {
        const map = new Map<string, number>();
        for (const b of myBets) {
            if (b.status !== 'open' && b.status !== 'won') continue;
            const key = String(b.bet_value).trim().toLowerCase();
            map.set(key, (map.get(key) ?? 0) + Math.floor(Number(b.amount || 0)));
        }
        return map;
    }, [myBets]);

    const totalMyStaked = useMemo(
        () => myBets.reduce((sum, b) => sum + (b.status === 'cancelled' ? 0 : Math.floor(Number(b.amount || 0))), 0),
        [myBets],
    );

    const totalWindowMs = effectiveWindow?.expiresAt
        ? Math.max(3000, effectiveWindow.expiresAt - effectiveWindow.openedAt)
        : 90_000;
    const progressPct = effectiveWindow?.expiresAt
        ? Math.min(100, Math.max(0, (timeLeft / totalWindowMs) * 100))
        : 0;

    return (
        <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            style={{
                height: `${drawerHeight}px`,
                backgroundColor: '#090d16',
            }}
            className={`fixed inset-x-2.5 bottom-3 lg:inset-x-auto lg:left-auto lg:right-4 lg:bottom-4 lg:w-[332px] z-[120] flex flex-col pointer-events-auto rounded-[22px] border border-cyan-400/25 shadow-[0_12px_40px_rgba(0,0,0,0.85)] overflow-hidden ${
                isDragging ? 'select-none' : 'transition-[height] duration-150 ease-out'
            }`}
        >
            {/* Settled Bet Toast Queue */}
            <div className="absolute inset-x-3 top-14 z-30 flex flex-col items-center gap-2 pointer-events-none">
                <AnimatePresence>
                    {betResults.map((res) => (
                        <motion.div
                            key={res.id}
                            initial={{ opacity: 0, scale: 0.9, y: -12 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.9, y: -12 }}
                            className={`px-3.5 py-2 rounded-2xl border shadow-xl flex items-center gap-2 text-center ${
                                res.status === 'won'
                                    ? 'bg-emerald-500 border-emerald-300 text-slate-950'
                                    : 'bg-slate-800 border-white/20 text-white'
                            }`}
                        >
                            <FiAward className="w-4 h-4 shrink-0" />
                            <span className="font-bold text-ludo-xs uppercase tracking-wider">
                                {res.text}
                            </span>
                        </motion.div>
                    ))}
                </AnimatePresence>
            </div>

            {/* ── Top Resize Drag Handle + Single-Line Header ───────── */}
            <div
                onPointerDown={handleDragStart}
                onPointerMove={handleDragMove}
                onPointerUp={handleDragEnd}
                onPointerCancel={handleDragEnd}
                className="shrink-0 relative z-20 touch-none cursor-ns-resize bg-[#0d1422] border-b border-white/10"
            >
                <div className="w-full flex justify-center pt-1.5 pb-0.5 pointer-events-none">
                    <div className="w-10 h-1 rounded-full bg-white/30" />
                </div>

                <div className="flex items-center justify-between gap-2 px-3.5 pb-2 pt-0.5">
                    <div className="flex items-center gap-2 min-w-0">
                        <span className={`w-2 h-2 rounded-full shrink-0 ${windowOpen ? 'bg-pink-400 animate-pulse' : 'bg-cyan-400'}`} />
                        <span className="text-ludo-xs font-bold text-cyan-300 uppercase tracking-[0.14em] truncate">
                            {isOneLine
                                ? (windowOpen ? `Bet Live · ${(timeLeft / 1000).toFixed(0)}s` : `Watch #${roomCode}`)
                                : `Live Sync · #${roomCode}`}
                        </span>
                        {!isOneLine && windowOpen && (
                            <span className="text-ludo-xs font-mono font-bold text-pink-300 tabular-nums shrink-0">
                                {(timeLeft / 1000).toFixed(0)}s
                            </span>
                        )}
                    </div>

                    <div
                        className="flex items-center gap-1.5 shrink-0"
                        onPointerDown={(e) => e.stopPropagation()}
                    >
                        <button
                            type="button"
                            onClick={toggleCollapse}
                            aria-label={isOneLine ? 'Expand Watch & Bet drawer' : 'Collapse to one line'}
                            title={isOneLine ? 'Expand panel' : 'Collapse to one line'}
                            className="w-7 h-7 rounded-full bg-[#172033] border border-white/15 flex items-center justify-center text-white/80 hover:text-white hover:border-cyan-400/50 transition-all active:scale-95"
                        >
                            {isOneLine ? <FiChevronUp className="w-4 h-4" /> : <FiChevronDown className="w-4 h-4" />}
                        </button>
                        {onClose && (
                            <button
                                type="button"
                                onClick={() => onClose()}
                                aria-label="Exit watch mode"
                                title="Exit watch mode"
                                className="w-7 h-7 rounded-full bg-[#172033] border border-white/15 flex items-center justify-center text-white/80 hover:text-white hover:bg-red-600 hover:border-red-400 transition-all active:scale-95"
                            >
                                <FiX className="w-4 h-4" />
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {!isOneLine && (
                <>
                    {/* Mobile Sub-tabs (< lg) */}
                    <div className="grid grid-cols-2 gap-1.5 px-3 pt-2 pb-1 shrink-0 lg:hidden bg-[#090d16] relative z-20">
                        <button
                            type="button"
                            onClick={() => setMobileTab('bet')}
                            className={`py-1.5 px-2.5 rounded-xl text-ludo-xs font-bold uppercase tracking-wider transition-all ${
                                mobileTab === 'bet'
                                    ? 'bg-[#12263a] text-cyan-200 border border-cyan-400/50'
                                    : 'bg-[#101726] text-white/60 border border-white/10 hover:text-white'
                            }`}
                        >
                            Bet &amp; Oracle
                        </button>
                        <button
                            type="button"
                            onClick={() => setMobileTab('comm')}
                            className={`py-1.5 px-2.5 rounded-xl text-ludo-xs font-bold uppercase tracking-wider transition-all ${
                                mobileTab === 'comm'
                                    ? 'bg-[#12263a] text-cyan-200 border border-cyan-400/50'
                                    : 'bg-[#101726] text-white/60 border border-white/10 hover:text-white'
                            }`}
                        >
                            Comm ({chatMessages.length})
                        </button>
                    </div>

                    {/* Solid Body Content */}
                    <div className="flex-1 min-h-0 flex flex-col gap-2.5 p-3 overflow-y-auto no-scrollbar bg-[#090d16] relative z-10">
                        {/* ── Oracle & Betting Sections ──────────────────── */}
                        <div className={`flex-col gap-2.5 ${mobileTab === 'bet' ? 'flex' : 'hidden lg:flex'}`}>
                            {/* AI Oracle Engine */}
                            <div className="px-3.5 py-2.5 rounded-2xl border border-white/10 bg-[#101726]">
                                <div className="flex items-center gap-2 mb-2">
                                    <FiTrendingUp className="w-3.5 h-3.5 text-cyan-400" />
                                    <span className="text-ludo-xs font-bold text-cyan-300 uppercase tracking-[0.16em]">
                                        AI Oracle Engine
                                    </span>
                                </div>
                                <div className="grid grid-cols-2 lg:grid-cols-1 gap-x-3 gap-y-1.5">
                                    {Object.entries(winProb)
                                        .sort(([, a], [, b]) => b - a)
                                        .map(([color, pct]) => (
                                            <div key={color} className="flex items-center gap-2">
                                                <div
                                                    className="w-2 h-2 rounded-full shrink-0"
                                                    style={{ background: COLOR_STYLES[color]?.bg ?? '#fff' }}
                                                />
                                                <span className="text-ludo-xs font-mono uppercase text-white/75 w-10 truncate">
                                                    {color}
                                                </span>
                                                <div className="flex-1 h-1.5 rounded-full bg-[#1a2235] overflow-hidden">
                                                    <motion.div
                                                        className="h-full rounded-full"
                                                        animate={{ width: `${pct * 100}%` }}
                                                        transition={{ duration: 0.6, ease: 'easeOut' }}
                                                        style={{ background: COLOR_STYLES[color]?.bg ?? '#fff' }}
                                                    />
                                                </div>
                                                <span
                                                    className="text-ludo-xs font-mono font-bold w-10 text-right tabular-nums"
                                                    style={{ color: COLOR_STYLES[color]?.bg }}
                                                >
                                                    <AnimatedNumber value={pct * 100} />%
                                                </span>
                                            </div>
                                        ))}
                                </div>
                            </div>

                            {/* Pari-Mutuel Winner Betting Pool */}
                            <div
                                className="px-3.5 py-3 rounded-2xl border flex flex-col gap-2.5 transition-all"
                                style={{
                                    backgroundColor: windowOpen ? '#190f1f' : '#101726',
                                    borderColor: windowOpen ? '#ec489980' : 'rgba(255, 255, 255, 0.1)',
                                }}
                            >
                                <div className="flex items-center justify-between gap-2">
                                    <span className="text-ludo-xs font-bold text-white/85 uppercase tracking-[0.14em] truncate">
                                        {windowOpen ? 'WINNER POOL OPEN' : 'POOL LOCKED'}
                                    </span>
                                    {windowOpen ? (
                                        <div className="flex items-center gap-1 shrink-0">
                                            <FiZap className="w-3.5 h-3.5 text-pink-400" />
                                            <span className="text-ludo-xs font-mono font-bold text-pink-300 tabular-nums">
                                                {(timeLeft / 1000).toFixed(0)}s
                                            </span>
                                        </div>
                                    ) : (
                                        <span className="text-ludo-xs font-mono font-bold text-white/50 shrink-0">
                                            {poolSummary.totalPot.toLocaleString()} CHIPS
                                        </span>
                                    )}
                                </div>

                                {windowOpen && (
                                    <div className="w-full h-1.5 rounded-full bg-[#2a1933] overflow-hidden">
                                        <motion.div
                                            className="h-full rounded-full"
                                            style={{ width: `${progressPct}%`, background: 'linear-gradient(90deg, #ec4899, #f97316)' }}
                                            transition={{ duration: 0.1 }}
                                        />
                                    </div>
                                )}

                                {/* Vault Balance & Pool Info Strip */}
                                <div className="flex items-center justify-between text-ludo-xs font-mono text-white/65 bg-black/30 rounded-xl px-2.5 py-1.5 border border-white/5">
                                    <span className="truncate">
                                        Vault: <strong className="text-cyan-300">{vault.availableChips.toLocaleString()}</strong>
                                    </span>
                                    <span className="truncate text-right">
                                        Pool: <strong className="text-amber-300">{formatCompactChips(poolSummary.totalPot)}</strong>
                                    </span>
                                </div>

                                {/* Team / Color Pick Buttons (Pari-Mutuel Pool Share, no fixed 2x/5x) */}
                                <div className="grid grid-cols-2 gap-1.5">
                                    {betChoices.map((choice) => {
                                        const stats = poolSummary.bySide[choice.value] ?? { amount: 0, count: 0, sharePct: 0 };
                                        const myStakeOnSide = myOpenStakesBySide.get(choice.value) ?? 0;
                                        const isPicked = selectedBetValue === choice.value || myStakeOnSide > 0;
                                        const primaryColor = choice.colors[0];

                                        return (
                                            <button
                                                key={choice.value}
                                                type="button"
                                                disabled={isBetting || !windowOpen}
                                                onClick={() => void placeBet(choice.value, choice.label, 'winner')}
                                                className="px-2.5 py-2 min-h-[46px] rounded-xl text-ludo-xs font-bold border transition-all flex flex-col justify-between gap-1 active:scale-95 disabled:opacity-55 text-left"
                                                style={{
                                                    backgroundColor: isPicked ? '#3b1530' : '#24172b',
                                                    borderColor: isPicked ? '#ec4899' : `${COLOR_STYLES[primaryColor]?.bg ?? '#fff'}55`,
                                                    color: '#fff',
                                                }}
                                            >
                                                <span className="flex items-center justify-between gap-1 w-full">
                                                    <span className="flex items-center gap-1 min-w-0">
                                                        {choice.colors.map((c) => (
                                                            <span
                                                                key={c}
                                                                className="w-2.5 h-2.5 rounded-full shrink-0 border border-white/30"
                                                                style={{ background: COLOR_STYLES[c]?.bg ?? '#fff' }}
                                                            />
                                                        ))}
                                                        <span className="capitalize truncate">{choice.label}</span>
                                                    </span>
                                                    <span className="font-mono text-white/70 shrink-0">
                                                        {stats.sharePct > 0 ? `${stats.sharePct}%` : '0%'}
                                                    </span>
                                                </span>
                                                <span className="text-ludo-xs font-mono text-white/60 flex items-center justify-between w-full">
                                                    <span>{formatCompactChips(stats.amount)}</span>
                                                    {myStakeOnSide > 0 && (
                                                        <span className="text-emerald-300 font-bold">
                                                            You: {formatCompactChips(myStakeOnSide)}
                                                        </span>
                                                    )}
                                                </span>
                                            </button>
                                        );
                                    })}
                                </div>

                                {windowOpen && (
                                    <>
                                        {/* Presets: 100, 500, 1K, 10K, 100K + Custom */}
                                        <div className="grid grid-cols-3 gap-1.5">
                                            {SPECTATOR_BET_PRESETS.map((p) => {
                                                const active = !customMode && betAmount === p;
                                                return (
                                                    <button
                                                        key={p}
                                                        type="button"
                                                        disabled={isBetting}
                                                        onClick={() => {
                                                            setCustomMode(false);
                                                            setBetAmount(p);
                                                        }}
                                                        className="py-1.5 min-h-[34px] rounded-lg text-ludo-xs font-mono font-bold uppercase border transition-all"
                                                        style={{
                                                            backgroundColor: active ? '#3b1530' : '#201326',
                                                            borderColor: active ? '#ec4899' : '#3a2244',
                                                            color: active ? '#f9a8d4' : 'rgba(255,255,255,0.75)',
                                                        }}
                                                    >
                                                        {p >= 1000 ? `${p / 1000}K` : p}
                                                    </button>
                                                );
                                            })}
                                            <button
                                                type="button"
                                                disabled={isBetting}
                                                onClick={() => {
                                                    setCustomMode(true);
                                                    const parsed = Math.floor(Number(customInput));
                                                    if (Number.isFinite(parsed) && parsed > 0) setBetAmount(parsed);
                                                }}
                                                className="py-1.5 min-h-[34px] rounded-lg text-ludo-xs font-mono font-bold uppercase border transition-all"
                                                style={{
                                                    backgroundColor: customMode ? '#3b1530' : '#201326',
                                                    borderColor: customMode ? '#ec4899' : '#3a2244',
                                                    color: customMode ? '#f9a8d4' : 'rgba(255,255,255,0.75)',
                                                }}
                                            >
                                                Custom
                                            </button>
                                        </div>

                                        {customMode && (
                                            <div className="flex items-center gap-1.5">
                                                <input
                                                    type="number"
                                                    min={SPECTATOR_BET_MIN_CHIPS}
                                                    max={SPECTATOR_BET_MAX_CHIPS}
                                                    step={1}
                                                    value={customInput}
                                                    onChange={(e) => {
                                                        setCustomInput(e.target.value);
                                                        const parsed = Math.floor(Number(e.target.value));
                                                        if (Number.isFinite(parsed) && parsed > 0) {
                                                            setBetAmount(parsed);
                                                        }
                                                    }}
                                                    placeholder="Custom CHIPS"
                                                    autoComplete="off"
                                                    autoCorrect="off"
                                                    autoCapitalize="none"
                                                    spellCheck={false}
                                                    className="flex-1 min-w-0 bg-[#090d16] border border-pink-500/45 rounded-xl px-2.5 py-1.5 text-ludo-xs font-mono text-white placeholder-white/35 outline-none focus:border-pink-400"
                                                />
                                                <span className="text-ludo-xs font-mono text-white/60 shrink-0">
                                                    CHIPS
                                                </span>
                                            </div>
                                        )}

                                        <div className="text-ludo-xs font-mono text-white/55 flex items-center justify-between gap-2">
                                            <span className="truncate">
                                                {betStatusStep
                                                    ? betStatusStep
                                                    : vault.availableChips >= betAmount
                                                      ? '0-gas instant Vault bet'
                                                      : 'Wallet will prompt CHIPS Vault top-up'}
                                            </span>
                                            {walletChips != null && (
                                                <span className="shrink-0 text-white/45">
                                                    Wallet: {formatCompactChips(walletChips)}
                                                </span>
                                            )}
                                        </div>
                                    </>
                                )}

                                {!windowOpen && (
                                    <p className="text-ludo-xs text-white/60 text-center font-bold uppercase tracking-wider py-1">
                                        {effectiveWindow
                                            ? effectiveWindow.status === 'settled'
                                                ? 'Pool Settled · Winnings in Claim Hub'
                                                : 'Betting Window Closed · Pool Locked'
                                            : 'Awaiting Market Open…'}
                                    </p>
                                )}

                                {totalMyStaked > 0 && (
                                    <div className="text-ludo-xs font-mono text-emerald-300/90 text-center border-t border-white/10 pt-1.5">
                                        Your active wager: {totalMyStaked.toLocaleString()} CHIPS · 5% fee on win, 100% refund if unopposed
                                    </div>
                                )}
                            </div>

                            {/* Followed Predictors */}
                            {followedBets.length > 0 && (
                                <div className="px-3.5 py-2.5 rounded-2xl border border-yellow-500/35 bg-[#1b180e] flex flex-col gap-1.5">
                                    <span className="text-ludo-xs font-bold text-yellow-300 uppercase tracking-[0.16em]">
                                        Following · Tap to mirror
                                    </span>
                                    {followedBets.slice(0, 3).map(b => (
                                        <div key={b.id} className="flex items-center gap-2">
                                            <span className="flex-1 min-w-0 text-ludo-xs font-bold text-white/85 truncate capitalize">
                                                {b.bet_value}
                                            </span>
                                            <button
                                                type="button"
                                                onClick={() => void placeBet(b.bet_value, b.bet_value, b.bet_type as BetType)}
                                                disabled={isBetting || !windowOpen}
                                                className="shrink-0 px-3 min-h-[34px] rounded-lg text-ludo-xs font-bold uppercase tracking-wider bg-[#2b2310] border border-yellow-500/50 text-yellow-200 hover:bg-yellow-400 hover:text-slate-950 active:scale-95 transition-all disabled:opacity-40"
                                            >
                                                Mirror
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* ── Global Network Chat (solid surface) ──────────── */}
                        <div
                            className={`flex-1 min-h-[140px] rounded-2xl border border-white/10 bg-[#101726] flex-col overflow-hidden ${
                                mobileTab === 'comm' ? 'flex' : 'hidden lg:flex'
                            }`}
                        >
                            <div className="flex items-center justify-between px-3.5 py-2 border-b border-white/10 bg-[#141d30] shrink-0">
                                <span className="text-ludo-xs font-bold text-cyan-300 uppercase tracking-widest">
                                    Global Comm
                                </span>
                                <span className="text-ludo-xs font-mono font-bold text-cyan-300 bg-[#0d2238] px-2 py-0.5 rounded-full">
                                    {chatMessages.length}
                                </span>
                            </div>

                            <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2 space-y-2 no-scrollbar">
                                <AnimatePresence initial={false}>
                                    {chatMessages.map(msg => (
                                        msg.system ? (
                                            <motion.div
                                                key={msg.id}
                                                initial={{ opacity: 0, scale: 0.95 }}
                                                animate={{ opacity: 1, scale: 1 }}
                                                className="text-center text-ludo-xs font-bold uppercase tracking-wider text-pink-300 py-0.5"
                                            >
                                                {msg.text}
                                            </motion.div>
                                        ) : (
                                            <motion.div
                                                key={msg.id}
                                                initial={{ opacity: 0, x: -6 }}
                                                animate={{ opacity: 1, x: 0 }}
                                                className="flex flex-col relative pl-2"
                                            >
                                                <div className="absolute left-0 top-0.5 bottom-0.5 w-[2px] bg-cyan-400/50 rounded-full" />
                                                <span className="text-ludo-xs font-bold text-white/55 uppercase tracking-wider">{msg.author}</span>
                                                <span className="text-ludo-sm font-medium text-white/95 leading-snug">{msg.text}</span>
                                            </motion.div>
                                        )
                                    ))}
                                </AnimatePresence>
                                {chatMessages.length === 0 && (
                                    <div className="h-full flex flex-col items-center justify-center py-4 opacity-50">
                                        <FiMessageSquare className="w-5 h-5 mb-1.5 text-white" />
                                        <p className="text-ludo-xs text-white font-bold uppercase tracking-wider text-center">
                                            Establish uplink to broadcast
                                        </p>
                                    </div>
                                )}
                            </div>

                            <div className="flex items-center gap-2 px-2.5 py-2 border-t border-white/10 bg-[#141d30] shrink-0">
                                <textarea
                                    value={chatInput}
                                    onChange={e => setChatInput(e.target.value)}
                                    rows={1}
                                    onKeyDown={e => {
                                        if (e.key === 'Enter' && !e.shiftKey) {
                                            e.preventDefault();
                                            void sendChat();
                                        }
                                    }}
                                    placeholder="Transmit data…"
                                    maxLength={120}
                                    autoComplete="off"
                                    autoCorrect="off"
                                    autoCapitalize="sentences"
                                    spellCheck={false}
                                    enterKeyHint="send"
                                    className="flex-1 bg-[#090d16] border border-white/15 rounded-xl px-3 py-1.5 text-ludo-xs font-medium text-white placeholder-white/35 outline-none focus:border-cyan-400/60 transition-all"
                                />
                                <button
                                    type="button"
                                    onClick={() => void sendChat()}
                                    disabled={!chatInput.trim()}
                                    aria-label="Send broadcast message"
                                    className="w-8 h-8 rounded-xl bg-[#10263b] border border-cyan-400/40 flex items-center justify-center text-cyan-300 hover:bg-[#173552] transition-all disabled:opacity-35"
                                >
                                    <FiSend className="w-3.5 h-3.5" />
                                </button>
                            </div>
                        </div>
                    </div>
                </>
            )}
        </motion.div>
    );
};
