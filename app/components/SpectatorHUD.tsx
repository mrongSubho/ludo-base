/* eslint-disable @typescript-eslint/no-explicit-any -- lint burn-down quarantine 2026-09-23 */
"use client";

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { motion, AnimatePresence, useMotionValue, useTransform, animate } from 'framer-motion';
import { FiX, FiMessageSquare, FiSend, FiTrendingUp, FiZap, FiChevronDown, FiChevronUp, FiAward } from 'react-icons/fi';
import { supabase } from '@/lib/supabase';
import { ActiveBettingWindow } from '@/hooks/useSpectatorSync';
import { BetType, PlayerColor, SpectatorBet } from '@/lib/types';
import { seatedColorsFor } from '@/lib/engine/core';
import { useAccount } from 'wagmi';
import { useGameData } from '@/hooks/GameDataContext';
import { getFollowed } from '@/lib/follow';
import { useAppSession } from '@/hooks/useAppSession';
import { useToast } from './Toast';

// ─────────────────────────────────────────────────────────────
// SpectatorHUD — Non-intrusive Watch & Bet overlay
//
// Invariant: NEVER alters `.board-main` / `.board-area` layout or padding.
// Desktop (`lg+`): Right-side floating terminal glass drawer (collapsible).
// Mobile (`< lg`): Bottom-docked glass drawer with compact tabs & collapse bar.
// ─────────────────────────────────────────────────────────────

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

// Baseline + progress weighted share across actively seated colors so Oracle
// bars are always informative even before tokens deploy from the yard (-1).
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

const BET_PRESETS = [100, 500, 1000, 5000];

interface ChatMessage {
    id: string;
    author: string;
    text: string;
    createdAt: number;
    system?: boolean;
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
    const { address } = useAccount();
    const { myProfile, updateMyProfileOptimistic } = useGameData();
    const { ensureAppSession } = useAppSession();
    const toast = useToast();
    const [betAmount, setBetAmount] = useState(500);
    const [selectedBetValue, setSelectedBetValue] = useState<string | null>(null);
    const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
    const [chatInput, setChatInput] = useState('');
    const [isBetting, setIsBetting] = useState(false);
    const [betResults, setBetResults] = useState<{ id: string; status: 'won' | 'lost' }[]>([]);
    const [isMinimized, setIsMinimized] = useState(false);
    const [mobileTab, setMobileTab] = useState<'bet' | 'comm'>('bet');
    const seenResultsRef = useRef<Set<string>>(new Set());

    // Poll settled bets
    useEffect(() => {
        if (!address || !matchId) return;
        let cancelled = false;
        const poll = async () => {
            try {
                const sessionId = await ensureAppSession().catch(() => null);
                if (!sessionId || cancelled) return;
                const params = new URLSearchParams({ matchId, walletAddress: address, sessionId, mine: '1' });
                const res = await fetch(`/api/spectator-bets?${params.toString()}`);
                if (!res.ok || cancelled) return;
                const bets = await res.json();
                if (!Array.isArray(bets) || cancelled) return;
                const fresh: { id: string; status: 'won' | 'lost' }[] = [];
                for (const b of bets) {
                    if ((b.status === 'won' || b.status === 'lost') && !seenResultsRef.current.has(b.id)) {
                        seenResultsRef.current.add(b.id);
                        fresh.push({ id: b.id, status: b.status });
                        setTimeout(() => {
                            seenResultsRef.current.delete(b.id);
                            setBetResults(prev => prev.filter(r => r.id !== b.id));
                        }, 8000);
                    }
                }
                if (fresh.length > 0) setBetResults(prev => [...prev, ...fresh].slice(-3));
            } catch {
                /* transient — next poll retries */
            }
        };
        void poll();
        const t = setInterval(poll, 10000);
        return () => {
            cancelled = true;
            clearInterval(t);
        };
    }, [address, matchId, ensureAppSession]);

    const [myBet, setMyBet] = useState<{ id: string; odds: number; amount: number } | null>(null);
    const [isCashingOut, setIsCashingOut] = useState(false);
    const [followedBets, setFollowedBets] = useState<(SpectatorBet & { id: string })[]>([]);
    const profileRef = useRef(myProfile);
    profileRef.current = myProfile;
    const [timeLeft, setTimeLeft] = useState(0);

    const seatedColors = Array.from(seatedColorsFor(playerCount));
    const winProb = calcWinProb(positions, seatedColors);

    // Betting window countdown
    useEffect(() => {
        if (!activeBetWindow?.expiresAt || activeBetWindow.windowClosedAt) {
            setTimeLeft(0);
            return;
        }
        const tick = () => setTimeLeft(Math.max(0, activeBetWindow.expiresAt - Date.now()));
        tick();
        const timer = setInterval(tick, 100);
        return () => clearInterval(timer);
    }, [activeBetWindow]);

    // Spectator chat via Supabase Broadcast
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

    const placeBet = useCallback(async (betValue: string, betType: BetType) => {
        if (!address) {
            toast('Connect wallet to place bets.', 'error');
            return;
        }
        if (!matchId) {
            toast('Syncing match room — please wait a moment.', 'error');
            return;
        }
        if (!activeBetWindow || activeBetWindow.windowClosedAt) return;
        if (betAmount <= 0 || isBetting) return;

        const currentCoins = myProfile?.coins ?? 0;
        if (currentCoins < betAmount) {
            toast('Not enough Link Coins for that bet.', 'error');
            return;
        }

        setIsBetting(true);
        try {
            updateMyProfileOptimistic({ coins: currentCoins - betAmount });

            const bet: SpectatorBet = {
                match_id: matchId,
                bet_type: betType,
                bet_value: betValue,
                amount: betAmount,
                odds: betType === 'dice_roll' ? 5.0 : 2.0,
                potential_payout: Math.floor(betAmount * (betType === 'dice_roll' ? 5.0 : 2.0)),
                window_closed_at: new Date(activeBetWindow.expiresAt).toISOString(),
            };

            const sessionId = await ensureAppSession({ context: 'betting' });
            if (!sessionId) throw new Error('Sign-in required to place bets');
            const response = await fetch('/api/spectator-bets', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ walletAddress: address, sessionId, ...bet }),
            });
            const body = await response.json().catch(() => ({}));

            if (!response.ok) {
                updateMyProfileOptimistic({ coins: currentCoins });
                toast(body?.error || 'Failed to transmit bet to node.', 'error');
            } else {
                setSelectedBetValue(betValue);
                if (body?.id) {
                    setMyBet({ id: body.id, odds: betType === 'dice_roll' ? 5.0 : 2.0, amount: betAmount });
                }
                const name = myProfile?.username ?? address.slice(0, 6) + '…';
                const odds = betType === 'dice_roll' ? 5.0 : 2.0;
                const callout: ChatMessage = {
                    id: crypto.randomUUID(),
                    author: '',
                    text: `${name} backed ${betValue} @ ${odds}× · ${betAmount.toLocaleString()}`,
                    createdAt: Date.now(),
                    system: true,
                };
                setChatMessages(prev => [...prev.slice(-49), callout]);
                void supabase.channel(`chat-${roomCode}`).send({
                    type: 'broadcast', event: 'spectator-chat', payload: callout,
                });
            }
        } catch (err) {
            updateMyProfileOptimistic({ coins: currentCoins });
            toast((err as Error)?.message || 'Bet failed.', 'error');
        } finally {
            setIsBetting(false);
        }
    }, [address, activeBetWindow, betAmount, matchId, isBetting, myProfile, roomCode, ensureAppSession, updateMyProfileOptimistic, toast]);

    // Reset local pick when a new betting window opens
    useEffect(() => {
        setMyBet(null);
        setSelectedBetValue(null);
    }, [activeBetWindow?.windowId, activeBetWindow?.expiresAt]);

    const windowOpen = !!activeBetWindow && !activeBetWindow.windowClosedAt && timeLeft > 0;

    const handleCashOut = useCallback(async () => {
        if (!address || !myBet || !windowOpen || isCashingOut) return;
        setIsCashingOut(true);
        try {
            const sessionId = await ensureAppSession({ context: 'betting' });
            if (!sessionId) throw new Error('Sign-in required to cash out');
            const response = await fetch('/api/spectator-bets', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ walletAddress: address, sessionId, action: 'cash_out', betId: myBet.id }),
            });
            const body = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(body?.error || 'Cash-out rejected');
            const credited = Number(body?.credited ?? 0);
            updateMyProfileOptimistic({ coins: (myProfile?.coins ?? 0) + credited });
            const name = profileRef.current?.username ?? address.slice(0, 6) + '…';
            const feed: ChatMessage = {
                id: crypto.randomUUID(),
                author: '',
                text: `${name} cashed out +${credited.toLocaleString()}`,
                createdAt: Date.now(),
                system: true,
            };
            setChatMessages(prev => [...prev.slice(-49), feed]);
            void supabase.channel(`chat-${roomCode}`).send({
                type: 'broadcast', event: 'spectator-chat', payload: feed,
            });
            setMyBet(null);
            setSelectedBetValue(null);
        } catch {
            /* window locked or bet gone — leave state untouched */
        } finally {
            setIsCashingOut(false);
        }
    }, [address, myBet, windowOpen, isCashingOut, myProfile, roomCode, ensureAppSession, updateMyProfileOptimistic]);

    useEffect(() => {
        if (!address || !matchId) return;
        const ids = getFollowed(address);
        if (ids.length === 0) {
            setFollowedBets([]);
            return;
        }
        let cancelled = false;
        (async () => {
            const sessionId = await ensureAppSession().catch(() => null);
            if (!sessionId || cancelled) return;
            const response = await fetch(`/api/spectator-bets?matchId=${encodeURIComponent(matchId)}&walletAddress=${encodeURIComponent(address)}&sessionId=${encodeURIComponent(sessionId)}`);
            const data = response.ok ? await response.json() : [];
            if (!cancelled && Array.isArray(data)) {
                setFollowedBets((data as any[]).filter(row => ids.includes(String(row.player_id).toLowerCase())) as unknown as (SpectatorBet & { id: string })[]);
            }
        })();
        return () => { cancelled = true; };
    }, [address, matchId, ensureAppSession]);

    const totalWindowMs = activeBetWindow?.expiresAt
        ? Math.max(3000, activeBetWindow.expiresAt - (activeBetWindow.openedAt ?? activeBetWindow.expiresAt - 90_000))
        : 90_000;
    const progressPct = activeBetWindow?.expiresAt
        ? Math.min(100, Math.max(0, (timeLeft / totalWindowMs) * 100))
        : 0;

    if (isMinimized) {
        return (
            <div className="fixed left-3 bottom-3 lg:left-auto lg:right-4 lg:bottom-4 z-[120] flex items-center gap-1.5 pointer-events-auto">
                <button
                    type="button"
                    onClick={() => setIsMinimized(false)}
                    className="h-9 px-3 rounded-full border border-cyan-400/40 shadow-xl flex items-center gap-2 text-ludo-xs font-bold uppercase tracking-wider text-white transition-all hover:border-cyan-300/70 active:scale-95"
                    style={{
                        background: 'var(--panel-bg-image, var(--ludo-bg-cosmic))',
                        backgroundColor: 'var(--panel-bg, rgba(13, 13, 13, 0.94))',
                        backdropFilter: 'blur(24px)',
                    }}
                >
                    <span className={`w-2 h-2 rounded-full ${windowOpen ? 'bg-pink-400 animate-pulse' : 'bg-cyan-400'}`} />
                    <span>{windowOpen ? `Bet · ${(timeLeft / 1000).toFixed(0)}s` : 'Watch & Bet'}</span>
                    <FiChevronUp className="w-3.5 h-3.5 text-cyan-300" />
                </button>
                {onClose && (
                    <button
                        type="button"
                        onClick={() => onClose()}
                        aria-label="Exit watch mode"
                        title="Exit watch mode"
                        className="w-9 h-9 rounded-full border border-white/15 bg-black/75 text-white/80 hover:text-white hover:bg-red-500/80 hover:border-red-400/60 flex items-center justify-center shadow-xl transition-all active:scale-95"
                    >
                        <FiX className="w-4 h-4" />
                    </button>
                )}
            </div>
        );
    }

    return (
        <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="fixed inset-x-2.5 bottom-3 max-h-[52dvh] lg:inset-x-auto lg:left-auto lg:right-4 lg:top-[76px] lg:bottom-4 lg:w-[320px] lg:max-h-none z-[120] flex flex-col pointer-events-auto rounded-[26px] border border-white/15 shadow-2xl overflow-hidden"
            style={{
                background: 'var(--panel-bg-image, var(--ludo-bg-cosmic))',
                backgroundColor: 'var(--panel-bg, rgba(13, 13, 13, 0.94))',
                backdropFilter: 'blur(28px)',
            }}
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
                            className={`px-4 py-2 rounded-full border shadow-xl flex items-center gap-2 ${
                                res.status === 'won'
                                    ? 'bg-emerald-500/95 border-emerald-300 text-slate-950'
                                    : 'bg-red-500/95 border-red-300 text-white'
                            }`}
                        >
                            <FiAward className="w-4 h-4 shrink-0" />
                            <span className="font-bold text-ludo-xs uppercase tracking-wider">
                                {res.status === 'won' ? 'Big Win · Coins credited' : 'Bet Settled · Better luck next'}
                            </span>
                        </motion.div>
                    ))}
                </AnimatePresence>
            </div>

            {/* ── Header: Live Sync + Minimize + Exit Watch ──────────── */}
            <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-white/10 bg-black/25 shrink-0 relative z-20">
                <div className="flex items-center gap-2.5 min-w-0">
                    <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse shrink-0" />
                    <div className="flex flex-col min-w-0">
                        <span className="text-ludo-xs font-bold text-cyan-300 uppercase tracking-[0.18em] truncate">
                            Live Sync · #{roomCode}
                        </span>
                        <span className="text-ludo-xs font-mono text-white/50 uppercase tracking-wider truncate">
                            {windowOpen ? `Market Open · ${(timeLeft / 1000).toFixed(0)}s` : 'Spectator Telemetry'}
                        </span>
                    </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                    <button
                        type="button"
                        onClick={() => setIsMinimized(true)}
                        aria-label="Hide Watch & Bet drawer"
                        title="Minimize to see full board"
                        className="w-8 h-8 rounded-full bg-white/10 border border-white/15 flex items-center justify-center text-white/75 hover:text-white hover:bg-white/20 transition-all active:scale-95"
                    >
                        <FiChevronDown className="w-4 h-4" />
                    </button>
                    {onClose && (
                        <button
                            type="button"
                            onClick={() => onClose()}
                            aria-label="Exit watch mode"
                            title="Exit watch mode"
                            className="w-8 h-8 rounded-full bg-white/10 border border-white/15 flex items-center justify-center text-white/75 hover:text-white hover:bg-red-500/80 hover:border-red-400/60 transition-all active:scale-95"
                        >
                            <FiX className="w-4 h-4" />
                        </button>
                    )}
                </div>
            </div>

            {/* Mobile Sub-tabs so board remains clearly visible above sheet */}
            <div className="grid grid-cols-2 gap-1.5 px-3 pt-2 pb-1 shrink-0 lg:hidden relative z-20">
                <button
                    type="button"
                    onClick={() => setMobileTab('bet')}
                    className={`py-1.5 px-2.5 rounded-xl text-ludo-xs font-bold uppercase tracking-wider transition-all ${
                        mobileTab === 'bet'
                            ? 'bg-accent-soft text-white shadow-[inset_0_0_0_1px_rgba(34,211,238,0.5)]'
                            : 'bg-white/5 text-white/55 hover:text-white'
                    }`}
                >
                    Bet & Oracle
                </button>
                <button
                    type="button"
                    onClick={() => setMobileTab('comm')}
                    className={`py-1.5 px-2.5 rounded-xl text-ludo-xs font-bold uppercase tracking-wider transition-all ${
                        mobileTab === 'comm'
                            ? 'bg-accent-soft text-white shadow-[inset_0_0_0_1px_rgba(34,211,238,0.5)]'
                            : 'bg-white/5 text-white/55 hover:text-white'
                    }`}
                >
                    Comm ({chatMessages.length})
                </button>
            </div>

            {/* Body Content */}
            <div className="flex-1 min-h-0 flex flex-col gap-2.5 p-3 overflow-y-auto no-scrollbar relative z-10">
                {/* ── Oracle & Betting Sections ────────────────────────── */}
                <div className={`flex-col gap-2.5 ${mobileTab === 'bet' ? 'flex' : 'hidden lg:flex'}`}>
                    {/* AI Oracle Engine */}
                    <div className="px-3.5 py-2.5 rounded-2xl border border-white/10 bg-black/30">
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
                                        <span className="text-ludo-xs font-mono uppercase text-white/70 w-10 truncate">
                                            {color}
                                        </span>
                                        <div className="flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden">
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

                    {/* Betting Window */}
                    <div
                        className="px-3.5 py-3 rounded-2xl border flex flex-col gap-2.5 transition-all"
                        style={{
                            background: windowOpen ? 'rgba(236, 72, 153, 0.08)' : 'rgba(0, 0, 0, 0.32)',
                            borderColor: windowOpen ? 'rgba(236, 72, 153, 0.45)' : 'rgba(255, 255, 255, 0.1)',
                        }}
                    >
                        <div className="flex items-center justify-between">
                            <span className="text-ludo-xs font-bold text-white/70 uppercase tracking-[0.16em]">
                                {windowOpen ? (activeBetWindow?.betType?.replace('_', ' ').toUpperCase() ?? 'BET LIVE') : 'Next Window'}
                            </span>
                            {windowOpen && (
                                <div className="flex items-center gap-1">
                                    <FiZap className="w-3.5 h-3.5 text-pink-400" />
                                    <span className="text-ludo-xs font-mono font-bold text-pink-300 tabular-nums">
                                        {(timeLeft / 1000).toFixed(1)}s
                                    </span>
                                </div>
                            )}
                        </div>

                        {windowOpen && (
                            <div className="w-full h-1.5 rounded-full bg-white/10 overflow-hidden">
                                <motion.div
                                    className="h-full rounded-full"
                                    style={{ width: `${progressPct}%`, background: 'linear-gradient(90deg, #ec4899, #f97316)' }}
                                    transition={{ duration: 0.1 }}
                                />
                            </div>
                        )}

                        {windowOpen && activeBetWindow?.betType === 'dice_roll' && (
                            <div className="grid grid-cols-3 gap-1.5">
                                {[1, 2, 3, 4, 5, 6].map(val => (
                                    <button
                                        key={val}
                                        type="button"
                                        disabled={isBetting || !!selectedBetValue}
                                        onClick={() => placeBet(String(val), 'dice_roll')}
                                        className="py-1.5 min-h-[40px] rounded-xl text-ludo-sm font-bold border transition-all flex flex-col items-center justify-center leading-none gap-0.5 active:scale-95"
                                        style={{
                                            background: selectedBetValue === String(val) ? '#ec4899' : 'rgba(255,255,255,0.06)',
                                            borderColor: selectedBetValue === String(val) ? '#ec4899' : 'rgba(255,255,255,0.12)',
                                            color: selectedBetValue === String(val) ? '#000' : '#fff',
                                            opacity: isBetting ? 0.5 : 1,
                                        }}
                                    >
                                        <span>{val}</span>
                                        <span className="text-ludo-xs font-mono opacity-75">5×</span>
                                    </button>
                                ))}
                            </div>
                        )}

                        {windowOpen && activeBetWindow?.betType === 'winner' && (
                            <div className="grid grid-cols-2 gap-1.5">
                                {seatedColors.map(color => (
                                    <button
                                        key={color}
                                        type="button"
                                        disabled={isBetting || !!selectedBetValue}
                                        onClick={() => placeBet(color, 'winner')}
                                        className="px-2.5 py-2 min-h-[42px] rounded-xl text-ludo-xs font-bold border transition-all capitalize flex items-center justify-between gap-1 active:scale-95 disabled:opacity-60"
                                        style={{
                                            background: selectedBetValue === color
                                                ? COLOR_STYLES[color]?.bg ?? '#fff'
                                                : 'rgba(255,255,255,0.06)',
                                            borderColor: `${COLOR_STYLES[color]?.bg ?? '#fff'}65`,
                                            color: selectedBetValue === color ? COLOR_STYLES[color]?.text : '#fff',
                                        }}
                                    >
                                        <span className="flex items-center gap-1.5 truncate">
                                            <span
                                                className="w-2.5 h-2.5 rounded-full shrink-0 border border-white/30"
                                                style={{ background: COLOR_STYLES[color]?.bg ?? '#fff' }}
                                            />
                                            <span>{color}</span>
                                        </span>
                                        <span className="font-mono opacity-85 shrink-0">2×</span>
                                    </button>
                                ))}
                            </div>
                        )}

                        {windowOpen && (
                            <div className="flex gap-1.5">
                                {BET_PRESETS.map(p => (
                                    <button
                                        key={p}
                                        type="button"
                                        onClick={() => setBetAmount(p)}
                                        className="flex-1 py-1 min-h-[38px] rounded-lg text-ludo-xs font-mono font-bold uppercase border transition-all"
                                        style={{
                                            background: betAmount === p ? 'rgba(236,72,153,0.18)' : 'rgba(255,255,255,0.04)',
                                            borderColor: betAmount === p ? '#ec4899' : 'rgba(255,255,255,0.1)',
                                            color: betAmount === p ? '#f9a8d4' : 'rgba(255,255,255,0.65)',
                                        }}
                                    >
                                        {p >= 1000 ? `${p / 1000}k` : p}
                                    </button>
                                ))}
                            </div>
                        )}

                        {windowOpen && myBet && (
                            <button
                                type="button"
                                onClick={handleCashOut}
                                disabled={isCashingOut}
                                className="w-full py-2 min-h-[40px] rounded-xl text-ludo-xs font-bold uppercase tracking-[0.14em] bg-emerald-500/20 border border-emerald-400/50 text-emerald-200 hover:bg-emerald-500/30 active:scale-95 transition-all disabled:opacity-60"
                            >
                                {isCashingOut ? 'Cashing out…' : `Cash out +${Math.floor(myBet.amount * myBet.odds * 0.5).toLocaleString()}`}
                            </button>
                        )}

                        {!windowOpen && (
                            <p className="text-ludo-xs text-white/55 text-center font-bold uppercase tracking-widest py-1.5">
                                Awaiting Market Open…
                            </p>
                        )}
                    </div>

                    {/* Followed Predictors */}
                    {followedBets.length > 0 && (
                        <div className="px-3.5 py-2.5 rounded-2xl border border-yellow-500/25 bg-yellow-500/[0.06] flex flex-col gap-1.5">
                            <span className="text-ludo-xs font-bold text-yellow-300/85 uppercase tracking-[0.16em]">
                                Following · Tap to mirror
                            </span>
                            {followedBets.slice(0, 3).map(b => (
                                <div key={b.id} className="flex items-center gap-2">
                                    <span className="flex-1 min-w-0 text-ludo-xs font-bold text-white/80 truncate">
                                        {b.bet_value} @ {b.bet_type === 'dice_roll' ? '5×' : '2×'}
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() => placeBet(b.bet_value, b.bet_type as BetType)}
                                        disabled={isBetting || !!selectedBetValue || !windowOpen}
                                        className="shrink-0 px-3 min-h-[34px] rounded-lg text-ludo-xs font-bold uppercase tracking-wider bg-yellow-500/20 border border-yellow-500/45 text-yellow-200 hover:bg-yellow-400 hover:text-slate-950 active:scale-95 transition-all disabled:opacity-40"
                                    >
                                        Mirror
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* ── Global Network Chat ──────────────────────────────── */}
                <div
                    className={`flex-1 min-h-[140px] rounded-2xl border border-white/10 bg-black/30 flex-col overflow-hidden ${
                        mobileTab === 'comm' ? 'flex' : 'hidden lg:flex'
                    }`}
                >
                    <div className="flex items-center justify-between px-3.5 py-2 border-b border-white/10 bg-white/[0.03] shrink-0">
                        <span className="text-ludo-xs font-bold text-cyan-300 uppercase tracking-widest">
                            Global Comm
                        </span>
                        <span className="text-ludo-xs font-mono font-bold text-cyan-300 bg-cyan-500/15 px-2 py-0.5 rounded-full">
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
                                        <div className="absolute left-0 top-0.5 bottom-0.5 w-[2px] bg-cyan-400/40 rounded-full" />
                                        <span className="text-ludo-xs font-bold text-white/50 uppercase tracking-wider">{msg.author}</span>
                                        <span className="text-ludo-sm font-medium text-white/90 leading-snug">{msg.text}</span>
                                    </motion.div>
                                )
                            ))}
                        </AnimatePresence>
                        {chatMessages.length === 0 && (
                            <div className="h-full flex flex-col items-center justify-center py-4 opacity-40">
                                <FiMessageSquare className="w-5 h-5 mb-1.5 text-white" />
                                <p className="text-ludo-xs text-white font-bold uppercase tracking-wider text-center">
                                    Establish uplink to broadcast
                                </p>
                            </div>
                        )}
                    </div>

                    <div className="flex items-center gap-2 px-2.5 py-2 border-t border-white/10 bg-white/[0.02] shrink-0">
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
                            className="flex-1 bg-black/50 border border-white/15 rounded-xl px-3 py-1.5 text-xs font-medium text-white placeholder-white/30 outline-none focus:border-cyan-400/60 transition-all"
                        />
                        <button
                            type="button"
                            onClick={() => void sendChat()}
                            disabled={!chatInput.trim()}
                            aria-label="Send broadcast message"
                            className="w-8 h-8 rounded-xl bg-cyan-500/20 border border-cyan-400/40 flex items-center justify-center text-cyan-300 hover:bg-cyan-500/35 transition-all disabled:opacity-30"
                        >
                            <FiSend className="w-3.5 h-3.5" />
                        </button>
                    </div>
                </div>
            </div>
        </motion.div>
    );
};
