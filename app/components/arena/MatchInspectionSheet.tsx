"use client";

import React from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
    LuCoins,
    LuCrown,
    LuEye,
    LuPlus,
    LuShield,
    LuSwords,
    LuUsers,
    LuZap,
} from "react-icons/lu";
import { formatArenaChips, type ArenaDirectoryRoom } from "@/lib/arena/types";
import { HudCornerTicks } from "../HudPrimitives";
import { Button } from "../Button";
import { CloseReticleIcon } from "../icons";

interface MatchInspectionSheetProps {
    room: ArenaDirectoryRoom | null;
    onClose: () => void;
    onJoinSeat: (room: ArenaDirectoryRoom, seatIndex?: number) => void;
    onWatch: (roomCode: string) => void;
    onOpenProfile?: (wallet: string) => void;
    onInspectClan?: (tag: string) => void;
}

export function MatchInspectionSheet({
    room,
    onClose,
    onJoinSeat,
    onWatch,
    onOpenProfile,
    onInspectClan,
}: MatchInspectionSheetProps) {
    return (
        <AnimatePresence>
            {room && (
                <>
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={onClose}
                        className="fixed inset-0 z-[205] bg-surface-page/75 backdrop-blur-sm"
                    />

                    <motion.div
                        initial={{ opacity: 0, scale: 0.96, y: 12 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.96, y: 10 }}
                        transition={{ duration: 0.18 }}
                        className="ludo-arena-scope ludo-pubprofile-scope panel-shell-3077 fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[calc(100%-24px)] max-w-md max-h-[82dvh] overflow-hidden border border-line-strong rounded-[28px] z-[215] shadow-2xl flex flex-col text-ink-strong font-sans"
                        style={{
                            backgroundImage: "var(--panel-bg-image, var(--ludo-bg-cosmic))",
                            backgroundColor: "var(--panel-bg, #0b111c)",
                            backdropFilter: "blur(32px)",
                        }}
                        role="dialog"
                        aria-modal="true"
                        aria-label="Match Inspection"
                    >
                        <HudCornerTicks />

                        {/* Header */}
                        <div className="shrink-0 flex items-center justify-between px-4 py-3.5 border-b border-line-soft bg-surface-recessed/70 relative z-10">
                            <div className="flex items-center gap-2.5 min-w-0">
                                <span
                                    className="w-8 h-8 rounded-xl border flex items-center justify-center shrink-0"
                                    style={{
                                        backgroundColor: `${room.tier.accentColor}20`,
                                        borderColor: `${room.tier.accentColor}50`,
                                        color: room.tier.accentColor,
                                    }}
                                >
                                    {room.gameMode === "power" ? (
                                        <LuZap className="w-4 h-4" />
                                    ) : (
                                        <LuSwords className="w-4 h-4" />
                                    )}
                                </span>
                                <div className="min-w-0">
                                    <div className="flex items-center gap-1.5">
                                        <span className="text-ludo-sm font-bold text-ink-strong uppercase">
                                            {room.gameMode} · {room.matchShape}
                                        </span>
                                        <span
                                            className="px-1.5 py-0.5 rounded font-mono text-ludo-xs font-bold uppercase"
                                            style={{
                                                backgroundColor: `${room.tier.accentColor}22`,
                                                color: room.tier.accentColor,
                                            }}
                                        >
                                            {room.tier.label}
                                        </span>
                                    </div>
                                    <div className="text-ludo-xs font-mono text-ink-faint truncate">
                                        {room.roomCode ? `Room #${room.roomCode}` : "Public Matchmaking Pool"}
                                    </div>
                                </div>
                            </div>

                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={onClose}
                                className="panel-close-3077 bg-surface-hover border border-line-soft shrink-0"
                                aria-label="Close match inspection"
                            >
                                <CloseReticleIcon className="icon-md" />
                            </Button>
                        </div>

                        {/* Body */}
                        <div className="flex-1 overflow-y-auto p-4 space-y-3.5 no-scrollbar relative z-10">
                            {/* Telemetry Strip */}
                            <div className="grid grid-cols-3 gap-2">
                                <div className="rounded-xl border border-line-soft bg-surface-panel p-2.5 text-center">
                                    <div className="text-ludo-xs font-mono text-ink-faint uppercase">Entry Stake</div>
                                    <div className="text-ludo-sm font-bold font-mono text-warn mt-0.5 inline-flex items-center gap-1">
                                        <LuCoins className="w-3.5 h-3.5" />
                                        {formatArenaChips(room.wager)}
                                    </div>
                                </div>
                                <div className="rounded-xl border border-line-soft bg-surface-panel p-2.5 text-center">
                                    <div className="text-ludo-xs font-mono text-ink-faint uppercase">Seats</div>
                                    <div className="text-ludo-sm font-bold font-mono text-ink-strong mt-0.5 inline-flex items-center gap-1">
                                        <LuUsers className="w-3.5 h-3.5 text-accent" />
                                        {room.seats.length}/{room.maxSeats}
                                    </div>
                                </div>
                                <div className="rounded-xl border border-line-soft bg-surface-panel p-2.5 text-center">
                                    <div className="text-ludo-xs font-mono text-ink-faint uppercase">Watchers</div>
                                    <div className="text-ludo-sm font-bold font-mono text-positive mt-0.5 inline-flex items-center gap-1">
                                        <LuEye className="w-3.5 h-3.5" />
                                        {room.spectatorCount}
                                    </div>
                                </div>
                            </div>

                            {room.summaryText && (
                                <div className="rounded-xl border border-line-soft bg-surface-recessed px-3 py-2 text-ludo-xs font-mono text-ink-muted">
                                    {room.summaryText}
                                </div>
                            )}

                            {/* Seat Inspection List */}
                            <div className="space-y-2">
                                <div className="text-ludo-xs font-mono uppercase tracking-wider text-ink-faint font-bold">
                                    Match Seat Lineup (Unrestricted Entry)
                                </div>
                                {Array.from({ length: room.maxSeats }, (_, idx) => {
                                    const seat = room.seats[idx];
                                    const teamLabel =
                                        room.matchShape === "2v2"
                                            ? idx < 2
                                                ? "Team G/B"
                                                : "Team R/Y"
                                            : `Seat #${idx + 1}`;

                                    if (!seat) {
                                        return (
                                            <div
                                                key={idx}
                                                className="rounded-xl border border-dashed border-accent/35 bg-accent-soft px-3 py-2.5 flex items-center justify-between gap-2"
                                            >
                                                <div className="flex items-center gap-2.5">
                                                    <span className="w-9 h-9 rounded-full bg-surface-recessed border border-accent/40 flex items-center justify-center text-accent">
                                                        <LuPlus className="w-4 h-4" />
                                                    </span>
                                                    <div>
                                                        <div className="text-ludo-xs font-bold text-ink-strong">Open Slot</div>
                                                        <div className="text-ludo-xs font-mono text-ink-muted">
                                                            {teamLabel} · Ready to join
                                                        </div>
                                                    </div>
                                                </div>
                                                {room.kind === "open" && (
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            onJoinSeat(room, idx);
                                                            onClose();
                                                        }}
                                                        className="px-3 py-1.5 rounded-lg bg-accent text-accent-ink font-mono text-ludo-xs font-bold uppercase"
                                                    >
                                                        Join Seat
                                                    </button>
                                                )}
                                            </div>
                                        );
                                    }

                                    const wr =
                                        seat.totalGames > 0
                                            ? Math.round((seat.wins / seat.totalGames) * 100)
                                            : 0;

                                    return (
                                        <div
                                            key={`${seat.walletAddress}-${idx}`}
                                            className="rounded-xl border border-line-soft bg-surface-panel px-3 py-2.5 flex items-center justify-between gap-2"
                                        >
                                            <div className="flex items-center gap-2.5 min-w-0">
                                                <div className="w-9 h-9 rounded-full overflow-hidden border border-line-strong bg-surface-recessed flex items-center justify-center font-mono text-ludo-xs font-bold text-ink-strong shrink-0">
                                                    {seat.avatarUrl ? (
                                                        <img
                                                            src={seat.avatarUrl}
                                                            alt={seat.username}
                                                            className="w-full h-full object-cover"
                                                            width={36}
                                                            height={36}
                                                        />
                                                    ) : (
                                                        seat.username.slice(0, 2).toUpperCase()
                                                    )}
                                                </div>
                                                <div className="min-w-0">
                                                    <div className="flex items-center gap-1.5 flex-wrap">
                                                        <button
                                                            type="button"
                                                            onClick={() => onOpenProfile?.(seat.walletAddress)}
                                                            className="text-ludo-xs font-bold text-ink-strong hover:text-accent truncate"
                                                        >
                                                            {seat.username}
                                                        </button>
                                                        {seat.isHost && (
                                                            <LuCrown className="w-3.5 h-3.5 text-warn shrink-0" />
                                                        )}
                                                        {seat.clanTag && (
                                                            <button
                                                                type="button"
                                                                onClick={() => onInspectClan?.(seat.clanTag!)}
                                                                className="px-1.5 py-0.5 rounded bg-accent-soft border border-accent/35 font-mono text-ludo-xs text-accent font-bold"
                                                            >
                                                                [{seat.clanTag}]
                                                            </button>
                                                        )}
                                                    </div>
                                                    <div className="text-ludo-xs font-mono text-ink-muted">
                                                        {teamLabel} · {seat.rankTier || "Unranked"} · {wr}% WR
                                                    </div>
                                                </div>
                                            </div>
                                            <span className="text-ludo-xs font-mono text-accent font-bold shrink-0">
                                                {seat.rxp.toLocaleString()} RXP
                                            </span>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Footer Action */}
                        <div className="shrink-0 p-4 border-t border-line-soft bg-surface-recessed/70 flex items-center gap-2 relative z-10">
                            {room.kind === "open" ? (
                                <button
                                    type="button"
                                    onClick={() => {
                                        onJoinSeat(room);
                                        onClose();
                                    }}
                                    className="flex-1 py-2.5 rounded-xl bg-accent hover:opacity-90 text-accent-ink font-mono text-ludo-xs font-bold uppercase tracking-wider flex items-center justify-center gap-2 shadow-lg transition-all"
                                >
                                    <LuPlus className="w-4 h-4" />
                                    <span>Join Table ({formatArenaChips(room.wager)} CHIPS)</span>
                                </button>
                            ) : (
                                <button
                                    type="button"
                                    onClick={() => {
                                        if (room.roomCode) {
                                            onWatch(room.roomCode);
                                            onClose();
                                        }
                                    }}
                                    className="flex-1 py-2.5 rounded-xl bg-positive hover:opacity-90 text-accent-ink font-mono text-ludo-xs font-bold uppercase tracking-wider flex items-center justify-center gap-2 shadow-lg transition-all"
                                >
                                    <LuEye className="w-4 h-4" />
                                    <span>
                                        {room.betWindowStatus === "open"
                                            ? "Enter Arena & Place Bet"
                                            : "Spectate Live Match"}
                                    </span>
                                </button>
                            )}
                            <span className="inline-flex items-center gap-1 px-2.5 py-2.5 rounded-xl border border-line-soft bg-surface-panel text-ludo-xs font-mono text-ink-muted">
                                <LuShield className="w-3.5 h-3.5 text-accent" />
                            </span>
                        </div>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
}
