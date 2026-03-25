"use client";

import React, { useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence, useMotionValue, useTransform, animate } from 'framer-motion';
import { FiX, FiMessageSquare, FiSend, FiTrendingUp, FiZap } from 'react-icons/fi';
import { supabase } from '@/lib/supabase';
import { ActiveBettingWindow } from '@/hooks/useSpectatorSync';
import { BetType, SpectatorBet } from '@/lib/types';
import { useAccount } from 'wagmi';
import { useGameData } from '@/hooks/GameDataContext';

// ─────────────────────────────────────────────────────────────
// SpectatorHUD — Overlay for live match spectators
//
// Sections:
//  1. Win Probability bar (V1 heuristic)
//  2. Betting Window countdown + quick-bet buttons
//  3. Real-time spectator chat
//
// Placed as a frosted right-panel on desktop, bottom sheet on mobile.
// ─────────────────────────────────────────────────────────────

// ─── Animated odds counter ───────────────────────────────────
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

// ─── Win probability heuristic ───────────────────────────────
// V1: sum of positions / 228 per player (max position = 57 × 4 tokens)
function calcWinProb(positions: Record<string, number[]>): Record<string, number> {
    const players = Object.entries(positions);
    const sums = players.map(([color, pos]) => ({
        color,
        sum: pos.reduce((a, b) => a + Math.max(0, b), 0),
    }));
    const total = sums.reduce((a, b) => a + b.sum, 0) || 1;
    return Object.fromEntries(sums.map(({ color, sum }) => [color, sum / total]));
}

const COLOR_STYLES: Record<string, { bg: string; text: string }> = {
    green:  { bg: '#22c55e', text: '#000' },
    red:    { bg: '#ef4444', text: '#fff' },
    yellow: { bg: '#eab308', text: '#000' },
    blue:   { bg: '#3b82f6', text: '#fff' },
};

// ─── Bet presets ─────────────────────────────────────────────
const BET_PRESETS = [100, 500, 1000, 5000];

interface ChatMessage {
    id: string;
    author: string;
    text: string;
    createdAt: number;
}

interface SpectatorHUDProps {
    roomCode: string;
    matchId: string;
    activeBetWindow: ActiveBettingWindow | null;
    positions: Record<string, number[]>;
    onClose?: () => void;
}

export const SpectatorHUD = ({
    roomCode,
    matchId,
    activeBetWindow,
    positions,
    onClose,
}: SpectatorHUDProps) => {
    const { address } = useAccount();
    const { myProfile, updateMyProfileOptimistic } = useGameData();
    const [betAmount, setBetAmount] = useState(500);
    const [selectedBetValue, setSelectedBetValue] = useState<string | null>(null);
    const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
    const [chatInput, setChatInput] = useState('');
    const [isBetting, setIsBetting] = useState(false);
    const [betResults, setBetResults] = useState<{ id: string; status: 'won' | 'lost' }[]>([]);
    const [timeLeft, setTimeLeft] = useState(0);
    const [isChatOpen, setIsChatOpen] = useState(false);

    const winProb = calcWinProb(positions);

    // ── Betting window countdown ──────────────────────────────
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

    // ── Spectator chat via Supabase Broadcast ────────────────
    useEffect(() => {
        const channel = supabase
            .channel(`chat-${roomCode}`)
            .on('broadcast', { event: 'spectator-chat' }, ({ payload }) => {
                setChatMessages(prev => [...prev.slice(-49), payload as ChatMessage]);
            })
            .subscribe();
        return () => { supabase.removeChannel(channel); };
    }, [roomCode]);

    // ── Real-time Bet Results ────────────────────────────────
    useEffect(() => {
        if (!address || !matchId) return;
        
        const channel = supabase
            .channel(`bet-results-${address}`)
            .on(
                'postgres_changes',
                {
                    event: 'UPDATE',
                    schema: 'public',
                    table: 'spectator_bets',
                    filter: `player_id=eq.${address.toLowerCase()}`
                },
                (payload) => {
                    const newBet = payload.new as SpectatorBet & { status: string };
                    if (newBet.match_id === matchId && (newBet.status === 'won' || newBet.status === 'lost')) {
                        const resultId = crypto.randomUUID();
                        setBetResults(prev => [...prev, { id: resultId, status: newBet.status as 'won' | 'lost' }]);
                        // Remove after 4 seconds
                        setTimeout(() => {
                            setBetResults(prev => prev.filter(r => r.id !== resultId));
                        }, 4000);
                    }
                }
            )
            .subscribe();

        return () => { supabase.removeChannel(channel); };
    }, [address, matchId]);

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

    // ── Place bet ─────────────────────────────────────────────
    const placeBet = useCallback(async (betValue: string, betType: BetType) => {
        if (!address || !activeBetWindow || activeBetWindow.windowClosedAt) return;
        if (betAmount <= 0 || isBetting) return;

        // 💰 Check coins
        const currentCoins = myProfile?.coins ?? 0;
        if (currentCoins < betAmount) {
            alert("Insufficient Link Coins!");
            return;
        }

        setIsBetting(true);
        try {
            // Optimistic deduction
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

            const { error } = await supabase.from('spectator_bets').insert({
                ...bet,
                player_id: address.toLowerCase(),
            });

            if (error) {
                console.error("Bet error:", error);
                // Rollback coins
                updateMyProfileOptimistic({ coins: currentCoins });
                alert("Failed to transmit bet to node.");
            } else {
                setSelectedBetValue(betValue);
            }
        } catch (err) {
            updateMyProfileOptimistic({ coins: currentCoins });
        } finally {
            setIsBetting(false);
        }
    }, [address, activeBetWindow, betAmount, matchId, isBetting, myProfile, updateMyProfileOptimistic]);

    const windowOpen = !!activeBetWindow && !activeBetWindow.windowClosedAt;
    const progressPct = activeBetWindow?.expiresAt
        ? Math.min(100, (timeLeft / 3000) * 100)
        : 0;

    return (
        <motion.div
            initial={{ opacity: 0, x: 24, scale: 0.95 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 24, scale: 0.95 }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="fixed right-4 top-[84px] bottom-[100px] w-[320px] z-50 flex flex-col gap-3 pointer-events-auto"
        >
            {/* ── Immersive Stage Environment ─────────────────── */}
            <div className="absolute inset-0 pointer-events-none overflow-hidden rounded-[32px] border border-cyan-500/20 shadow-[0_0_40px_rgba(34,211,238,0.1)]">
                {/* Stage Background */}
                <div className="absolute inset-0 bg-[#020205]" />
                <div className="absolute inset-0 bg-gradient-to-b from-blue-900/10 via-transparent to-black" />
                
                {/* Top Spotlights */}
                <div className="absolute -top-32 -left-20 w-[300px] h-[400px] bg-cyan-400/10 blur-[80px] rotate-45 transform-gpu" />
                <div className="absolute -top-32 -right-20 w-[300px] h-[400px] bg-pink-400/10 blur-[80px] -rotate-45 transform-gpu" />

                {/* Audience Silhouettes (Subtle) */}
                <div className="absolute bottom-0 left-0 right-0 h-24 z-20 pointer-events-none">
                    <div className="absolute bottom-0 left-0 right-0 h-12 flex items-end justify-center gap-1 px-4 opacity-40">
                        {[...Array(8)].map((_, i) => (
                            <motion.div
                                key={i}
                                animate={{ y: [0, -1, 0] }}
                                transition={{ duration: 4 + i, repeat: Infinity, ease: "easeInOut" }}
                                className="w-6 h-10 bg-black rounded-t-full relative"
                                style={{ opacity: 0.5 + (i % 3) * 0.1 }}
                            >
                                <div className="absolute top-0 left-0 right-0 h-[1px] bg-cyan-400/20 rounded-full" />
                            </motion.div>
                        ))}
                    </div>
                </div>

                {/* Scanlines */}
                <div className="absolute inset-0 opacity-[0.05] bg-[linear-gradient(transparent_50%,rgba(0,0,0,1)_50%)] bg-[length:100%_4px]" />
            </div>

            <motion.div 
                style={{ 
                    perspective: '1000px',
                    transformStyle: 'preserve-3d',
                    height: '100%',
                    width: '100%'
                }}
                className="relative z-10 flex flex-col pt-2 pb-6 px-2"
            >
                {/* ── Result Overlay (Queue) ────────────────── */}
                <div className="absolute inset-x-0 top-20 z-[100] flex flex-col items-center gap-2 pointer-events-none">
                    <AnimatePresence>
                        {betResults.map((res) => (
                            <motion.div
                                key={res.id}
                                initial={{ opacity: 0, scale: 0.5, y: -20 }}
                                animate={{ opacity: 1, scale: 1, y: 0 }}
                                exit={{ opacity: 0, scale: 0.5, y: -20 }}
                                className={`
                                    px-6 py-3 rounded-full border-2 shadow-[0_0_30px_rgba(0,0,0,0.5)] flex items-center gap-3
                                    ${res.status === 'won' 
                                        ? 'bg-green-500/90 border-green-400 text-white shadow-green-500/40' 
                                        : 'bg-red-500/90 border-red-400 text-white shadow-red-500/40'}
                                `}
                            >
                                <div className="text-2xl">
                                    {res.status === 'won' ? '🎉' : '💔'}
                                </div>
                                <div className="flex flex-col">
                                    <span className="font-black italic text-lg tracking-tighter uppercase leading-none">
                                        {res.status === 'won' ? 'BIG WIN!' : 'BET LOST'}
                                    </span>
                                    <span className="text-[10px] font-bold opacity-80 uppercase">
                                        {res.status === 'won' ? 'Coins credited!' : 'Hard luck!'}
                                    </span>
                                </div>
                            </motion.div>
                        ))}
                    </AnimatePresence>
                </div>

                <motion.div
                    style={{ 
                        rotateY: -2,
                        scale: 1.01,
                        transformOrigin: 'right'
                    }}
                    className="flex-1 flex flex-col gap-3"
                >
                {/* ── Header: AI Link ───────────────────────────── */}
                <div
                    className="flex items-center justify-between px-4 py-3 rounded-2xl border border-cyan-500/20 bg-black/40 shadow-[inset_0_0_20px_rgba(34,211,238,0.1)] relative overflow-hidden"
                >
                    <div className="absolute inset-0 bg-gradient-to-r from-cyan-500/10 to-transparent w-1/2" />
                    <div className="flex items-center gap-3 relative z-10">
                        <div className="relative flex items-center justify-center">
                            <div className="absolute w-4 h-4 rounded-full border border-cyan-400 animate-[spin_3s_linear_infinite] opacity-50" />
                            <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse shadow-[0_0_10px_rgba(34,211,238,1)]" />
                        </div>
                        <div className="flex flex-col">
                            <span className="text-[11px] font-black italic text-cyan-400 uppercase tracking-[0.3em] drop-shadow-[0_0_5px_rgba(34,211,238,0.8)]">Live Sync</span>
                            <span className="text-[8px] font-medium text-cyan-200/50 tracking-widest uppercase">MCP Agent Node Connected</span>
                        </div>
                    </div>
                {onClose && (
                    <button
                        onClick={onClose}
                        className="w-7 h-7 rounded-full bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-500/50 hover:text-cyan-400 hover:bg-cyan-500/20 hover:shadow-[0_0_10px_rgba(34,211,238,0.3)] transition-all relative z-10"
                    >
                        <FiX className="w-3.5 h-3.5" />
                    </button>
                )}
            </div>

            {/* ── AI Oracle Engine (Win Probability) ───────── */}
            <div
                className="px-4 py-4 rounded-2xl border border-white/5 bg-black/40 relative overflow-hidden shadow-[inset_0_0_10px_rgba(255,255,255,0.02)]"
            >
                <div className="absolute top-0 right-0 w-32 h-32 bg-cyan-500/5 rounded-full blur-3xl pointer-events-none" />
                
                <div className="flex items-center gap-2 mb-3">
                    <FiTrendingUp className="w-3.5 h-3.5 text-cyan-400" />
                    <span className="text-[10px] font-black text-cyan-300 uppercase tracking-[0.2em] drop-shadow-[0_0_5px_rgba(34,211,238,0.5)]">AI Oracle Engine</span>
                </div>
                <div className="flex flex-col gap-2.5 relative z-10">
                    {Object.entries(winProb)
                        .filter(([, pct]) => pct > 0)
                        .sort(([, a], [, b]) => b - a)
                        .map(([color, pct]) => (
                            <div key={color} className="flex items-center gap-3">
                                <div
                                    className="w-1.5 h-1.5 rounded-sm flex-shrink-0 animate-pulse"
                                    style={{ background: COLOR_STYLES[color]?.bg ?? '#fff', boxShadow: `0 0 8px ${COLOR_STYLES[color]?.bg}` }}
                                />
                                <div className="flex-1 h-1 rounded-full bg-white/5 overflow-hidden relative">
                                    <div className="absolute inset-0 bg-[linear-gradient(90deg,transparent_0%,rgba(255,255,255,0.2)_50%,transparent_100%)] w-[200%] animate-[scan_2s_linear_infinite]" />
                                    <motion.div
                                        className="h-full rounded-full"
                                        animate={{ width: `${pct * 100}%` }}
                                        transition={{ duration: 0.8, ease: 'easeOut' }}
                                        style={{ background: COLOR_STYLES[color]?.bg ?? '#fff' }}
                                    />
                                </div>
                                <span className="text-[11px] font-black w-9 text-right capitalize tabular-nums tracking-wider" style={{ color: COLOR_STYLES[color]?.bg }}>
                                    <AnimatedNumber value={pct * 100} />%
                                </span>
                            </div>
                        ))}
                </div>
            </div>

            {/* ── Betting Window ──────────────────────────────── */}
            <div
                className="px-4 py-4 rounded-2xl border flex flex-col gap-3 transition-all duration-300 relative overflow-hidden"
                style={{
                    background: windowOpen ? 'rgba(236,72,153,0.05)' : 'rgba(0,0,0,0.4)',
                    borderColor: windowOpen ? 'rgba(236,72,153,0.4)' : 'rgba(255,255,255,0.05)',
                    boxShadow: windowOpen ? '0 0 30px rgba(236,72,153,0.15), inset 0 0 20px rgba(236,72,153,0.05)' : 'none',
                }}
            >
                {windowOpen && <div className="absolute inset-0 bg-[url('/hex-pattern.png')] opacity-[0.02] mix-blend-overlay pointer-events-none" />}

                <div className="flex items-center justify-between">
                    <span className="text-[9px] font-black text-white/30 uppercase tracking-[0.2em]">
                        {windowOpen ? activeBetWindow?.betType?.replace('_', ' ').toUpperCase() ?? 'Bet Live' : 'Next Window'}
                    </span>
                    {windowOpen && (
                        <div className="flex items-center gap-1">
                            <FiZap className="w-3 h-3 text-pink-400" />
                            <span className="text-[10px] font-black text-pink-400">
                                {(timeLeft / 1000).toFixed(1)}s
                            </span>
                        </div>
                    )}
                </div>

                {/* Progress bar */}
                {windowOpen && (
                    <div className="w-full h-1 rounded-full bg-white/5 overflow-hidden">
                        <motion.div
                            className="h-full rounded-full"
                            style={{ width: `${progressPct}%`, background: 'linear-gradient(90deg, #ec4899, #f97316)' }}
                            transition={{ duration: 0.1 }}
                        />
                    </div>
                )}

                {/* Dice prop bet buttons */}
                {windowOpen && activeBetWindow?.betType === 'dice_roll' && (
                    <div className="grid grid-cols-3 gap-2">
                        {[1, 2, 3, 4, 5, 6].map(val => (
                            <motion.button
                                key={val}
                                whileHover={{ scale: 1.05 }}
                                whileTap={{ scale: 0.95 }}
                                disabled={isBetting || !!selectedBetValue}
                                onClick={() => placeBet(String(val), 'dice_roll')}
                                className="py-2 rounded-xl text-sm font-black border transition-all"
                                style={{
                                    background: selectedBetValue === String(val) ? '#ec4899' : 'rgba(255,255,255,0.05)',
                                    borderColor: selectedBetValue === String(val) ? '#ec4899' : 'rgba(255,255,255,0.08)',
                                    color: selectedBetValue === String(val) ? '#000' : '#fff',
                                    opacity: isBetting ? 0.5 : 1,
                                }}
                            >
                                {val}
                            </motion.button>
                        ))}
                    </div>
                )}

                {/* Winner bet buttons */}
                {windowOpen && activeBetWindow?.betType === 'winner' && (
                    <div className="flex flex-col gap-2">
                        {Object.keys(positions).filter(c => positions[c].some(p => p >= 0)).map(color => (
                            <motion.button
                                key={color}
                                whileHover={{ scale: 1.02 }}
                                whileTap={{ scale: 0.98 }}
                                disabled={isBetting || !!selectedBetValue}
                                onClick={() => placeBet(color, 'winner')}
                                className="py-2 rounded-xl text-xs font-black border transition-all capitalize"
                                style={{
                                    background: selectedBetValue === color
                                        ? COLOR_STYLES[color]?.bg ?? '#fff'
                                        : 'rgba(255,255,255,0.04)',
                                    borderColor: `${COLOR_STYLES[color]?.bg ?? '#fff'}40`,
                                    color: selectedBetValue === color ? COLOR_STYLES[color]?.text : '#fff',
                                }}
                            >
                                {color} Wins — 2×
                            </motion.button>
                        ))}
                    </div>
                )}

                {/* Amount presets */}
                {windowOpen && (
                    <div className="flex gap-1.5">
                        {BET_PRESETS.map(p => (
                            <button
                                key={p}
                                onClick={() => setBetAmount(p)}
                                className="flex-1 py-1 rounded-lg text-[9px] font-black uppercase border transition-all"
                                style={{
                                    background: betAmount === p ? '#ec489920' : 'rgba(255,255,255,0.03)',
                                    borderColor: betAmount === p ? '#ec4899' : 'rgba(255,255,255,0.06)',
                                    color: betAmount === p ? '#ec4899' : 'rgba(255,255,255,0.4)',
                                }}
                            >
                                {p >= 1000 ? `${p / 1000}k` : p}
                            </button>
                        ))}
                    </div>
                )}

                {!windowOpen && (
                    <div className="flex flex-col items-center justify-center py-2 relative z-10">
                        <div className="w-12 h-[1px] bg-gradient-to-r from-transparent via-white/20 to-transparent mb-2" />
                        <p className="text-[10px] text-white/40 text-center font-bold uppercase tracking-widest drop-shadow-md">
                            Awaiting Market Open…
                        </p>
                        <div className="w-12 h-[1px] bg-gradient-to-r from-transparent via-white/20 to-transparent mt-2" />
                    </div>
                )}
            </div>

            {/* ── Global Network Chat ────────────────────────── */}
            <div
                className="flex-1 rounded-2xl border border-white/5 bg-black/40 flex flex-col overflow-hidden relative"
            >
                <div className="absolute top-0 w-full h-8 bg-gradient-to-b from-cyan-500/5 to-transparent pointer-events-none" />
                <div className="flex items-center justify-between px-4 py-3 border-b border-white/5 bg-white/[0.02]">
                    <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-sm border border-cyan-400 flex items-center justify-center opacity-70">
                             <div className="w-0.5 h-0.5 bg-cyan-400" />
                        </div>
                        <span className="text-[10px] font-black text-cyan-300 uppercase tracking-widest drop-shadow-[0_0_5px_rgba(34,211,238,0.4)]">Global Comm</span>
                    </div>
                    <span className="text-[10px] font-black text-cyan-500 bg-cyan-500/10 px-2 py-0.5 rounded-full">{chatMessages.length} nodes</span>
                </div>

                <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 custom-scrollbar">
                    <AnimatePresence initial={false}>
                        {chatMessages.map(msg => (
                            <motion.div
                                key={msg.id}
                                initial={{ opacity: 0, x: -8, filter: 'blur(4px)' }}
                                animate={{ opacity: 1, x: 0, filter: 'blur(0px)' }}
                                exit={{ opacity: 0, scale: 0.9 }}
                                className="flex flex-col relative pl-2"
                            >
                                <div className="absolute left-0 top-1 bottom-1 w-[1px] bg-cyan-500/30" />
                                <span className="text-[9px] font-black text-white/40 uppercase tracking-widest mb-0.5">{msg.author}</span>
                                <span className="text-[11px] font-medium text-white/90 leading-tight drop-shadow-sm">{msg.text}</span>
                            </motion.div>
                        ))}
                    </AnimatePresence>
                    {chatMessages.length === 0 && (
                        <div className="h-full flex flex-col items-center justify-center pt-4 opacity-30">
                            <FiMessageSquare className="w-6 h-6 mb-2 text-white" />
                            <p className="text-[9px] text-white font-bold uppercase tracking-widest text-center leading-relaxed">
                                Establish uplink<br/>to broadcast
                            </p>
                        </div>
                    )}
                </div>

                <div className="flex items-center gap-2 px-3 py-3 border-t border-white/5 bg-white/[0.02]">
                    <input
                        value={chatInput}
                        onChange={e => setChatInput(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && sendChat()}
                        placeholder="Transmit data…"
                        maxLength={120}
                        className="flex-1 bg-black/50 border border-white/10 rounded-xl px-3 py-2 text-xs font-medium text-white placeholder-white/20 outline-none focus:border-cyan-400/50 focus:bg-cyan-900/10 transition-all shadow-inner"
                    />
                    <button
                        onClick={sendChat}
                        disabled={!chatInput.trim()}
                        className="w-8 h-8 rounded-xl bg-cyan-500/20 border border-cyan-500/30 flex items-center justify-center text-cyan-300 hover:bg-cyan-500/40 transition-all disabled:opacity-30 hover:shadow-[0_0_15px_rgba(34,211,238,0.4)]"
                    >
                        <FiSend className="w-3.5 h-3.5" />
                    </button>
                </div>
            </div>
                </motion.div>
            </motion.div>
        </motion.div>
    );
};
