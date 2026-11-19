"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import dynamic from "next/dynamic";
import { FiTv, FiStar } from "react-icons/fi";
import { LuMonitor, LuRefreshCw, LuUsers, LuEye, LuCrown } from "react-icons/lu";
import { supabase } from "@/lib/supabase";
import { getFollowed, toggleFollow } from "@/lib/follow";
import { useAccount } from "wagmi";
import { LiveArenaStage, type StageRoom } from "./LiveArenaStage";
import { ArenaRoomCard } from "./arena/ArenaRoomCard";
import { MatchInspectionSheet } from "./arena/MatchInspectionSheet";
import type { ArenaDirectoryResponse, ArenaDirectoryRoom } from "@/lib/arena/types";
import { ArenaBladesIcon } from "./icons";

const ClanProfileModal = dynamic(() => import("./ClanProfileModal"), { ssr: false });

export const LiveTile = () => (
    <div className="hud-chamfer-sm w-7 h-7 rounded-xl bg-accent-soft border border-cyan-400/40 flex items-center justify-center shadow-[0_0_16px_rgba(0,229,255,0.22)]">
        <ArenaBladesIcon className="w-4 h-4 text-cyan-300" />
    </div>
);

type ArenaFilter = "all" | "open" | "live" | "vip";

interface LiveArenaContentProps {
    onWatchMatch?: (roomCode: string) => void;
    onJoinDemoMatch?: (room: ArenaDirectoryRoom) => void;
    onOpenProfile?: (wallet: string) => void;
    onClosePanel?: () => void;
    onStats?: (live: number, watching: number, vol: number, openCount?: number) => void;
}

const PredictorsStrip = () => {
    const [board, setBoard] = useState<
        { rank: number; player_id: string; username: string; avatar_url: string | null; wins: number; profit: number }[]
    >([]);
    const { address } = useAccount();
    const [followed, setFollowed] = useState<string[]>([]);

    useEffect(() => {
        (async () => {
            try {
                const res = await fetch("/api/predictors/board");
                if (res.ok) setBoard((await res.json()).slice(0, 3));
            } catch {
                /* decorative strip */
            }
        })();
        setFollowed(getFollowed(address));
    }, [address]);

    if (board.length === 0) return null;

    return (
        <div className="px-4 pt-2.5 relative z-10">
            <div className="flex items-center gap-2 rounded-2xl border border-pink-500/20 bg-pink-500/[0.06] px-3 py-1.5">
                <span className="text-ludo-xs font-bold uppercase tracking-[0.16em] text-pink-300 shrink-0 font-mono">
                    Sharpest
                </span>
                <div className="flex-1 min-w-0 flex items-center gap-3 overflow-hidden">
                    {board.map((p) => (
                        <div key={p.player_id} className="flex items-center gap-1.5 min-w-0">
                            <span className="text-ludo-xs font-bold text-pink-300/70 tabular-nums font-mono">
                                #{p.rank}
                            </span>
                            <span className="text-ludo-xs font-bold text-white/80 truncate max-w-[78px]">
                                {p.username}
                            </span>
                            <span
                                className={`text-ludo-xs font-bold tabular-nums font-mono ${
                                    p.profit >= 0 ? "text-emerald-300" : "text-white/40"
                                }`}
                            >
                                {p.profit >= 0 ? "+" : ""}
                                {p.profit.toLocaleString()}
                            </span>
                            {address && (
                                <button
                                    type="button"
                                    onClick={() => setFollowed(toggleFollow(address, p.player_id))}
                                    aria-label={
                                        followed.includes(p.player_id.toLowerCase())
                                            ? `Unfollow ${p.username}`
                                            : `Follow ${p.username}`
                                    }
                                    className="shrink-0 w-6 h-6 flex items-center justify-center rounded-full hover:bg-white/10 transition-all"
                                >
                                    <FiStar
                                        className={`w-3 h-3 ${
                                            followed.includes(p.player_id.toLowerCase())
                                                ? "text-yellow-400 fill-yellow-400"
                                                : "text-white/30"
                                        }`}
                                    />
                                </button>
                            )}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

export const LiveArenaContent = ({
    onWatchMatch,
    onJoinDemoMatch,
    onOpenProfile,
    onClosePanel,
    onStats,
}: LiveArenaContentProps) => {
    const [directory, setDirectory] = useState<ArenaDirectoryResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [view, setView] = useState<"list" | "stage">("list");
    const [filter, setFilter] = useState<ArenaFilter>("all");
    const [inspectRoom, setInspectRoom] = useState<ArenaDirectoryRoom | null>(null);
    const [inspectClanTag, setInspectClanTag] = useState<string | null>(null);

    const fetchDirectory = useCallback(async () => {
        try {
            const res = await fetch("/api/live-arena/directory", { cache: "no-store" });
            if (!res.ok) return;
            const data = (await res.json()) as ArenaDirectoryResponse;
            setDirectory(data);
        } catch {
            /* keep previous snapshot */
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void fetchDirectory();

        const pollId = window.setInterval(() => {
            void fetchDirectory();
        }, 8000);

        const channel = supabase
            .channel("live-arena-unified-directory")
            .on("postgres_changes", { event: "*", schema: "public", table: "live_matches" }, () => {
                void fetchDirectory();
            })
            .on("postgres_changes", { event: "*", schema: "public", table: "live_chat" }, () => {
                void fetchDirectory();
            })
            .subscribe();

        return () => {
            window.clearInterval(pollId);
            void supabase.removeChannel(channel);
        };
    }, [fetchDirectory]);

    const rooms = useMemo(() => directory?.rooms || [], [directory]);

    useEffect(() => {
        const stats = directory?.stats;
        if (!stats) return;
        onStats?.(stats.liveCount, stats.watchingTotal, stats.volumeTotal, stats.openCount);
    }, [directory?.stats, onStats]);

    const filteredRooms = useMemo(() => {
        if (filter === "open") return rooms.filter((r) => r.kind === "open");
        if (filter === "live") return rooms.filter((r) => r.kind === "live");
        if (filter === "vip") return rooms.filter((r) => r.tier.isVip || Math.max(r.wager, r.totalBetVolume) >= 500_000);
        return rooms;
    }, [rooms, filter]);

    const stageMatches: StageRoom[] = useMemo(() => {
        const liveOnly = rooms.filter((r) => r.kind === "live" && r.roomCode);
        if (liveOnly.length > 0) {
            return liveOnly.map((r) => ({
                match_id: r.matchId || r.id,
                room_code: r.roomCode!,
                bet_window_status: r.betWindowStatus === "settled" ? "closed" : r.betWindowStatus,
                spectator_count: r.spectatorCount,
                created_at: r.createdAt,
                game_mode: r.gameMode,
                total_bet_volume: r.totalBetVolume,
            }));
        }
        return [
            {
                match_id: "power4p-ai",
                room_code: "ARENA-POWER-4P",
                bet_window_status: "closed",
                spectator_count: 0,
                created_at: new Date().toISOString(),
                game_mode: "power",
                total_bet_volume: 0,
            },
        ];
    }, [rooms]);

    const handleWatch = useCallback(
        (roomCode: string) => {
            onWatchMatch?.(roomCode);
        },
        [onWatchMatch],
    );

    const handleJoinSeat = useCallback(
        (room: ArenaDirectoryRoom, seatIndex?: number) => {
            if (room.joinMode === "ai_match" && onJoinDemoMatch) {
                onJoinDemoMatch(room);
                onClosePanel?.();
                return;
            }
            if (room.joinMode === "party" && room.roomCode) {
                window.dispatchEvent(
                    new CustomEvent("join_party", {
                        detail: { roomCode: room.roomCode, seat: seatIndex },
                    }),
                );
            } else {
                window.dispatchEvent(
                    new CustomEvent("join_pool", {
                        detail: {
                            entryFee: room.wager,
                            mode: room.gameMode,
                            matchType: room.matchShape,
                        },
                    }),
                );
            }
            onClosePanel?.();
        },
        [onJoinDemoMatch, onClosePanel],
    );

    const openTotal = rooms.filter((r) => r.kind === "open").length;
    const liveTotal = rooms.filter((r) => r.kind === "live").length;
    const vipTotal = rooms.filter((r) => r.tier.isVip || Math.max(r.wager, r.totalBetVolume) >= 500_000).length;

    return (
        <div className="flex-1 min-h-0 flex flex-col relative z-10">
            <PredictorsStrip />

            {/* Filter & View Bar */}
            <div className="px-4 pt-2.5 pb-2 flex items-center justify-between gap-2 shrink-0">
                <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
                    {(
                        [
                            { id: "all", label: `All (${rooms.length})` },
                            { id: "open", label: `Join (${openTotal})`, icon: <LuUsers className="w-3 h-3" /> },
                            { id: "live", label: `Watch (${liveTotal})`, icon: <LuEye className="w-3 h-3" /> },
                            { id: "vip", label: `500K–10M (${vipTotal})`, icon: <LuCrown className="w-3 h-3" /> },
                        ] as Array<{ id: ArenaFilter; label: string; icon?: React.ReactNode }>
                    ).map((f) => {
                        const active = filter === f.id && view === "list";
                        return (
                            <button
                                key={f.id}
                                type="button"
                                onClick={() => {
                                    setView("list");
                                    setFilter(f.id);
                                }}
                                className={`px-2.5 py-1 rounded-full border font-mono text-ludo-xs font-bold inline-flex items-center gap-1 whitespace-nowrap transition-colors ${
                                    active
                                        ? "bg-accent-soft border-cyan-400/50 text-cyan-300"
                                        : "bg-white/[0.04] border-white/10 text-white/60 hover:text-white"
                                }`}
                            >
                                {f.icon}
                                <span>{f.label}</span>
                            </button>
                        );
                    })}
                </div>

                <div className="flex items-center gap-1 shrink-0">
                    <button
                        type="button"
                        onClick={() => setView((v) => (v === "stage" ? "list" : "stage"))}
                        className={`px-2.5 py-1 rounded-full border font-mono text-ludo-xs font-bold inline-flex items-center gap-1 transition-colors ${
                            view === "stage"
                                ? "bg-accent-soft border-cyan-400/50 text-cyan-300"
                                : "bg-white/[0.04] border-white/10 text-white/65 hover:text-white"
                        }`}
                        title={view === "stage" ? "Back to Room Cards" : "Open 3D LED Stage"}
                    >
                        <LuMonitor className="w-3 h-3" />
                        <span>{view === "stage" ? "Cards" : "Stage"}</span>
                    </button>

                    <button
                        type="button"
                        onClick={() => void fetchDirectory()}
                        className="p-1.5 rounded-full border border-white/10 bg-white/[0.04] text-white/60 hover:text-white transition-colors"
                        title="Refresh Arena Directory"
                        aria-label="Refresh Arena Directory"
                    >
                        <LuRefreshCw className="w-3.5 h-3.5" />
                    </button>
                </div>
            </div>

            {view === "stage" ? (
                <LiveArenaStage
                    matches={stageMatches}
                    onWatch={handleWatch}
                    onSwitchToList={() => setView("list")}
                />
            ) : (
                <>
                    <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar px-4 pb-4 space-y-2.5 relative z-10">
                        {loading && rooms.length === 0 ? (
                            <div className="py-14 text-center space-y-2">
                                <div className="w-8 h-8 border-2 border-cyan-400/30 border-t-cyan-400 rounded-full animate-spin mx-auto" />
                                <p className="text-ludo-xs font-mono text-white/50 uppercase tracking-wider">
                                    Scanning Live Arena Tables...
                                </p>
                            </div>
                        ) : filteredRooms.length > 0 ? (
                            filteredRooms.map((room) => (
                                <ArenaRoomCard
                                    key={room.id}
                                    room={room}
                                    onInspect={(r) => setInspectRoom(r)}
                                    onJoinSeat={handleJoinSeat}
                                    onWatch={handleWatch}
                                    onOpenProfile={onOpenProfile}
                                />
                            ))
                        ) : (
                            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-6 text-center space-y-3 my-2">
                                <div className="w-14 h-14 rounded-2xl bg-white/5 border border-white/10 mx-auto flex items-center justify-center text-cyan-300">
                                    <FiTv className="w-6 h-6" />
                                </div>
                                <div className="space-y-1">
                                    <p className="text-white font-bold text-ludo-md">
                                        {filter === "all"
                                            ? "No Open or Live Tables Right Now"
                                            : "No Tables Match This Filter"}
                                    </p>
                                    <p className="text-white/50 text-ludo-xs max-w-xs mx-auto leading-relaxed">
                                        Any player with enough CHIPS (Free to 10M) can start a match in the lobby or jump into the 3D Arena Demo Stage.
                                    </p>
                                </div>
                                <div className="flex items-center justify-center gap-2 pt-1">
                                    {filter !== "all" && (
                                        <button
                                            type="button"
                                            onClick={() => setFilter("all")}
                                            className="px-3.5 py-2 rounded-xl border border-white/15 bg-white/5 text-white font-mono text-ludo-xs font-bold uppercase"
                                        >
                                            Show All
                                        </button>
                                    )}
                                    <button
                                        type="button"
                                        onClick={() => handleWatch("ARENA-POWER-4P")}
                                        className="px-3.5 py-2 rounded-xl bg-accent-soft border border-cyan-400/45 text-cyan-300 font-mono text-ludo-xs font-bold uppercase"
                                    >
                                        Watch Exhibition
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="w-full px-4 py-2.5 bg-black/20 border-t border-white/10 text-center relative z-20 shrink-0">
                        <span className="text-ludo-xs font-mono text-white/45 uppercase tracking-[0.14em]">
                            Tap [+] to Join Open Seats · Tap Card to Inspect · Free → 10M CHIPS
                        </span>
                    </div>
                </>
            )}

            <MatchInspectionSheet
                room={inspectRoom}
                onClose={() => setInspectRoom(null)}
                onJoinSeat={handleJoinSeat}
                onWatch={handleWatch}
                onOpenProfile={onOpenProfile}
                onInspectClan={(tag) => setInspectClanTag(tag)}
            />

            <ClanProfileModal
                isOpen={Boolean(inspectClanTag)}
                clanIdOrTag={inspectClanTag}
                onClose={() => setInspectClanTag(null)}
                onInspectMember={onOpenProfile}
            />
        </div>
    );
};
