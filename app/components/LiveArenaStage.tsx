"use client";

import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import { FiEye, FiTv, FiList } from 'react-icons/fi';
import { EmptyState } from './EmptyState';

export type StageRoom = {
    match_id: string;
    room_code: string;
    bet_window_status: 'open' | 'closed' | 'resolving';
    spectator_count: number;
    created_at: string;
    game_mode?: string;
    total_bet_volume?: number;
};

/** Deterministic wall layout: up to 9 nodes on a shallow arc. */
function wallSlots(count: number): { x: number; y: number; scale: number }[] {
    const n = Math.min(count, 9);
    if (n <= 0) return [];
    const slots: { x: number; y: number; scale: number }[] = [];
    for (let i = 0; i < n; i++) {
        const t = n === 1 ? 0.5 : i / (n - 1);
        // Arc: higher in the middle (curved wall)
        const y = 18 + Math.sin(t * Math.PI) * 10 + (i % 2) * 6;
        const x = 8 + t * 84;
        const scale = 0.92 + Math.sin(t * Math.PI) * 0.08;
        slots.push({ x, y, scale });
    }
    return slots;
}

function formatVol(v?: number) {
    const n = v ?? 0;
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${Math.round(n / 1000)}k`;
    return String(n);
}

export function LiveArenaStage({
    matches,
    onWatch,
    onSwitchToList,
}: {
    matches: StageRoom[];
    onWatch: (roomCode: string) => void;
    onSwitchToList: () => void;
}) {
    const featured = matches[0];
    const wall = matches.slice(1, 10);
    const slots = useMemo(() => wallSlots(wall.length), [wall.length]);
    const watching = matches.reduce((s, m) => s + (m.spectator_count || 0), 0);
    const vol = matches.reduce((s, m) => s + (m.total_bet_volume || 0), 0);
    const onAir = matches.filter(m => m.bet_window_status === 'open').length;

    return (
        <div className="ludo-arena-stage flex-1 min-h-0 flex flex-col relative z-10">
            {/* ── Zone A: curved LED wall ── */}
            <div className="arena-wall relative flex-1 min-h-[200px] mx-3 mt-2 rounded-[20px] overflow-hidden border border-cyan-500/20">
                {/* Horizon glow + circuit grid */}
                <div className="arena-wall-glow" aria-hidden />
                <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
                    <defs>
                        <linearGradient id="arena-trace" x1="0" y1="0" x2="1" y2="0">
                            <stop offset="0%" stopColor="#00E5FF" stopOpacity="0" />
                            <stop offset="50%" stopColor="#00E5FF" stopOpacity="0.55" />
                            <stop offset="100%" stopColor="#00E5FF" stopOpacity="0" />
                        </linearGradient>
                    </defs>
                    {/* horizontal circuit lines */}
                    {[28, 48, 68].map(y => (
                        <line key={y} x1="4" y1={y} x2="96" y2={y} stroke="url(#arena-trace)" strokeWidth="0.35" />
                    ))}
                    {/* soft vertical risers */}
                    {[20, 50, 80].map(x => (
                        <line key={x} x1={x} y1="20" x2={x} y2="78" stroke="#00E5FF" strokeOpacity="0.08" strokeWidth="0.3" />
                    ))}
                </svg>

                {wall.length === 0 && !featured ? (
                    <div className="absolute inset-0 flex items-center justify-center p-6">
                        <EmptyState
                            title="No matches on the floor"
                            body="When someone hosts a live match, it lights up on the wall."
                            actionLabel="Open list view"
                            onAction={onSwitchToList}
                        />
                    </div>
                ) : (
                    <div className="absolute inset-0">
                        {wall.map((m, i) => {
                            const slot = slots[i];
                            if (!slot) return null;
                            const live = m.bet_window_status === 'open';
                            return (
                                <motion.button
                                    key={m.match_id}
                                    type="button"
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ delay: 0.05 * i, duration: 0.35 }}
                                    onClick={() => onWatch(m.room_code)}
                                    className="absolute arena-node group"
                                    style={{
                                        left: `${slot.x}%`,
                                        top: `${slot.y}%`,
                                        transform: `translate(-50%, -50%) scale(${slot.scale})`,
                                    }}
                                    aria-label={`Watch room ${m.room_code}`}
                                >
                                    <div className={`arena-node-core ${live ? 'is-live' : ''}`}>
                                        <FiTv className="w-3.5 h-3.5" />
                                    </div>
                                    <div className="arena-node-meta">
                                        <span className="text-[10px] font-black tracking-wider uppercase text-white/90">
                                            {m.game_mode?.toUpperCase() || 'CLASSIC'}
                                        </span>
                                        <span className="flex items-center gap-1 text-[9px] font-bold text-cyan-300/80 tabular-nums">
                                            <FiEye className="w-2.5 h-2.5" />
                                            {m.spectator_count || 0}
                                        </span>
                                    </div>
                                    <span className="arena-node-code">{m.room_code}</span>
                                </motion.button>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* ── Zone B: floor strip (featured) ── */}
            {featured && (
                <motion.button
                    type="button"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    onClick={() => onWatch(featured.room_code)}
                    className="arena-floor mx-3 mt-2 w-[calc(100%-1.5rem)] text-left rounded-2xl border border-cyan-400/30 px-4 py-3 relative overflow-hidden"
                >
                    <div className="arena-floor-beam" aria-hidden />
                    <div className="relative flex items-center justify-between gap-3">
                        <div className="min-w-0">
                            <div className="flex items-center gap-2 mb-0.5">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.9)] animate-pulse" />
                                <span className="text-[9px] font-black uppercase tracking-[0.28em] text-emerald-300">
                                    {featured.bet_window_status === 'open' ? 'On air' : 'Live'}
                                </span>
                                <span className="text-[10px] font-black text-white/70 uppercase tracking-wide">
                                    {featured.game_mode?.toUpperCase() || 'CLASSIC'}
                                </span>
                            </div>
                            <p className="text-[11px] font-bold text-white/50 truncate">
                                Room {featured.room_code} · pot {formatVol(featured.total_bet_volume)}
                            </p>
                        </div>
                        <span className="shrink-0 min-h-[36px] px-3 rounded-full bg-cyan-400 text-black text-[10px] font-black uppercase tracking-[0.14em] flex items-center">
                            Watch
                        </span>
                    </div>
                </motion.button>
            )}

            {/* ── Zone C: audience rail (density, not faces) ── */}
            <div className="arena-rail mx-3 mt-2 mb-2 rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2.5">
                <div className="flex items-center justify-between mb-2">
                    <span className="text-[9px] font-black uppercase tracking-[0.22em] text-white/40">
                        Arena floor
                    </span>
                    <button
                        type="button"
                        onClick={onSwitchToList}
                        className="flex items-center gap-1 min-h-[32px] px-2 rounded-full border border-white/15 text-[10px] font-black uppercase tracking-[0.12em] text-white/70 hover:text-white hover:bg-white/10 transition-all"
                    >
                        <FiList className="w-3 h-3" />
                        List
                    </button>
                </div>
                <div className="grid grid-cols-3 gap-2">
                    <div className="arena-stat">
                        <span className="arena-stat-val">{matches.length}</span>
                        <span className="arena-stat-lab">Rooms</span>
                    </div>
                    <div className="arena-stat">
                        <span className="arena-stat-val">{watching}</span>
                        <span className="arena-stat-lab">Watching</span>
                    </div>
                    <div className="arena-stat">
                        <span className="arena-stat-val">{onAir}</span>
                        <span className="arena-stat-lab">Betting</span>
                    </div>
                </div>
                {/* Density bars */}
                <div className="mt-2 flex items-end gap-[3px] h-8" aria-hidden>
                    {matches.slice(0, 12).map((m, i) => {
                        const h = Math.min(100, 18 + (m.spectator_count || 0) * 8 + (m.total_bet_volume ? 12 : 0));
                        return (
                            <div
                                key={m.match_id}
                                className={`flex-1 rounded-t-sm ${m.bet_window_status === 'open' ? 'bg-cyan-400/70' : 'bg-white/15'}`}
                                style={{ height: `${h}%` }}
                            />
                        );
                    })}
                    {matches.length === 0 && (
                        <div className="flex-1 rounded-t-sm bg-white/10 h-[20%]" />
                    )}
                </div>
                <p className="mt-1.5 text-[9px] font-bold text-white/30 uppercase tracking-wider text-center">
                    Spectating is read-only · wagers stay safe
                </p>
            </div>
        </div>
    );
}
