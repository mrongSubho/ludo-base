"use client";

import React from 'react';
import { motion } from 'framer-motion';
import { FiEye, FiTv, FiList, FiUsers } from 'react-icons/fi';
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

function formatVol(v?: number) {
    const n = v ?? 0;
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${Math.round(n / 1000)}k`;
    return String(n);
}

/**
 * Broadcast HUD lives ONLY on the LED wall of the plate.
 * `.arena-screen` is the monitor bounds; truss, floor, and crowd stay clean.
 */
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
    const side = matches.slice(1, 4);
    const watching = matches.reduce((s, m) => s + (m.spectator_count || 0), 0);
    const onAir = matches.filter(m => m.bet_window_status === 'open').length;
    const live = featured?.bet_window_status === 'open';

    return (
        <div className="ludo-arena-stage flex-1 min-h-0 flex flex-col relative z-10">
            <div className="arena-venue relative flex-1 min-h-[340px] mx-1 mt-1 overflow-hidden">
                <img
                    src="/arena/venue-hall.png"
                    alt=""
                    className="arena-venue-plate"
                    draggable={false}
                    onError={(e) => {
                        (e.currentTarget as HTMLImageElement).style.display = 'none';
                    }}
                />

                {/* ── LED monitor bounds — all broadcast UI lives here ── */}
                <div className="arena-screen">
                    {featured ? (
                        <>
                            {/* LIVE bug · network bug (on the screen, not the hall) */}
                            <div className="arena-screen-top">
                                <span className="arena-bug-live">
                                    <span className={`arena-bug-dot ${live ? 'is-live' : ''}`} />
                                    {live ? 'LIVE' : 'REPLAY'}
                                </span>
                                <span className="arena-bug-net">LB</span>
                            </div>

                            {/* Side room tickets on the screen edges */}
                            {side.map((m, i) => (
                                <motion.button
                                    key={m.match_id}
                                    type="button"
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    transition={{ delay: 0.05 * i }}
                                    onClick={() => onWatch(m.room_code)}
                                    className="arena-screen-side group"
                                    style={i < 2
                                        ? { left: '3%', top: `${30 + i * 16}%` }
                                        : { right: '3%', top: `${30 + (i - 2) * 16}%` }}
                                    aria-label={`Watch ${m.room_code}`}
                                >
                                    <FiTv className="w-3 h-3" />
                                    <span>{m.room_code}</span>
                                </motion.button>
                            ))}

                            {/* Match title — center of the monitor */}
                            <motion.div
                                key={featured.match_id}
                                initial={{ opacity: 0, y: 6 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.35 }}
                                className="arena-screen-title"
                            >
                                <span className="arena-screen-mode">
                                    {featured.game_mode?.toUpperCase() || 'CLASSIC'}
                                </span>
                                <span className="arena-screen-room">
                                    {featured.room_code}
                                </span>
                            </motion.div>

                            {/* Lower third — stats + WATCH on the screen */}
                            <div className="arena-screen-third">
                                <div className="arena-screen-stats">
                                    <span className="arena-screen-stat">
                                        <FiEye className="w-3 h-3" />
                                        {featured.spectator_count || 0}
                                    </span>
                                    <span className="arena-screen-stat arena-screen-stat--amber">
                                        {formatVol(featured.total_bet_volume)}
                                    </span>
                                    <span className="arena-screen-stat arena-screen-stat--live">
                                        {live ? 'ON AIR' : 'STANDBY'}
                                    </span>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => onWatch(featured.room_code)}
                                    className="arena-screen-watch group"
                                    aria-label={`Watch ${featured.room_code}`}
                                >
                                    WATCH
                                </button>
                            </div>
                        </>
                    ) : (
                        <div className="arena-screen arena-screen--empty">
                            <div className="arena-screen-top">
                                <span className="arena-bug-live arena-bug-live--off">
                                    <span className="arena-bug-dot" />
                                    OFFLINE
                                </span>
                                <span className="arena-bug-net">LB</span>
                            </div>
                            <EmptyState
                                title="Screen is dark"
                                body="When a host goes live, it shows up here."
                                actionLabel="List"
                                onAction={onSwitchToList}
                            />
                        </div>
                    )}
                </div>
            </div>

            <div className="mx-1.5 mt-1.5 mb-1.5 rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2">
                <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[9px] font-black uppercase tracking-[0.22em] text-white/40">Arena floor</span>
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
                <p className="mt-1.5 text-[9px] font-bold text-white/25 uppercase tracking-wider text-center flex items-center justify-center gap-1.5">
                    <FiUsers className="w-3 h-3" />
                    Read-only spectating · wagers stay safe
                </p>
            </div>
        </div>
    );
}
