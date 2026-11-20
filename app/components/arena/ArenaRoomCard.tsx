"use client";

import React from "react";
import {
    LuCrown,
    LuEye,
    LuEyeOff,
    LuGlobe,
    LuLock,
    LuPlus,
    LuSwords,
    LuUsers,
    LuZap,
} from "react-icons/lu";
import {
    formatArenaChips,
    type ArenaDirectoryRoom,
    type ArenaPlayerSeat,
} from "@/lib/arena/types";
import { HudCornerTicks } from "../HudPrimitives";
import { ChipsHexIcon } from "../icons";

interface ArenaRoomCardProps {
    room: ArenaDirectoryRoom;
    onInspect: (room: ArenaDirectoryRoom) => void;
    onJoinSeat: (room: ArenaDirectoryRoom, seatIndex?: number) => void;
    onWatch: (roomCode: string) => void;
    onOpenProfile?: (wallet: string) => void;
}

function SeatAvatarSlot({
    seat,
    seatIndex,
    isVip,
    canJoin,
    onJoin,
    onOpenProfile,
}: {
    seat?: ArenaPlayerSeat;
    seatIndex: number;
    isVip: boolean;
    canJoin: boolean;
    onJoin: (seatIndex: number) => void;
    onOpenProfile?: (wallet: string) => void;
}) {
    if (!seat) {
        return (
            <button
                type="button"
                disabled={!canJoin}
                onClick={(e) => {
                    e.stopPropagation();
                    if (canJoin) onJoin(seatIndex);
                }}
                className="flex flex-col items-center gap-1 group/slot shrink-0 w-[52px]"
                title={canJoin ? `Join Seat #${seatIndex + 1}` : "Empty seat"}
            >
                <span
                    className={`w-11 h-11 rounded-full border-2 border-dashed flex items-center justify-center transition-all ${
                        canJoin
                            ? "border-accent/60 bg-accent-soft text-accent group-hover/slot:scale-105 group-hover/slot:border-accent"
                            : "border-line-soft bg-surface-recessed text-ink-faint"
                    }`}
                >
                    <LuPlus className="w-4 h-4" />
                </span>
                <span className="text-ludo-xs font-mono text-ink-muted truncate w-full text-center">
                    {canJoin ? "Join" : "Open"}
                </span>
            </button>
        );
    }

    const initials = (seat.username || "PL").slice(0, 2).toUpperCase();

    return (
        <div
            onClick={(e) => {
                if (onOpenProfile && seat.walletAddress) {
                    e.stopPropagation();
                    onOpenProfile(seat.walletAddress);
                }
            }}
            className={`flex flex-col items-center gap-1 shrink-0 w-[52px] ${
                onOpenProfile ? "cursor-pointer" : ""
            }`}
            title={seat.clanTag ? `[${seat.clanTag}] ${seat.username}` : seat.username}
        >
            <div className="relative">
                <div
                    className={`hud-avatar-frame w-11 h-11 rounded-full overflow-hidden flex items-center justify-center font-mono text-ludo-xs font-bold border-2 ${
                        isVip
                            ? "border-warn shadow-[0_0_12px_rgba(245,158,11,0.3)] bg-warn/20 text-warn"
                            : "border-accent/55 bg-surface-recessed text-ink-strong"
                    }`}
                >
                    {seat.avatarUrl ? (
                        <img
                            src={seat.avatarUrl}
                            alt={seat.username}
                            className="w-full h-full object-cover"
                            width={44}
                            height={44}
                        />
                    ) : (
                        <span>{initials}</span>
                    )}
                </div>

                {seat.isHost && (
                    <span className="absolute -bottom-1 -left-1 w-4 h-4 rounded-full bg-warn text-accent-ink flex items-center justify-center shadow">
                        <LuCrown className="w-2.5 h-2.5" />
                    </span>
                )}

                {seat.clanTag && (
                    <span className="absolute -top-1 -right-1.5 px-1 rounded bg-surface-panel border border-accent/45 text-accent font-mono text-ludo-xs font-bold leading-tight">
                        {seat.clanTag}
                    </span>
                )}
            </div>

            <span className="text-ludo-xs font-mono text-ink-strong truncate w-full text-center">
                {seat.username}
            </span>
        </div>
    );
}

export function ArenaRoomCard({
    room,
    onInspect,
    onJoinSeat,
    onWatch,
    onOpenProfile,
}: ArenaRoomCardProps) {
    const isOpen = room.kind === "open";
    const canJoin = isOpen && room.seats.length < room.maxSeats;
    const isBetOpen = room.betWindowStatus === "open";

    const seatsByIndex: Array<ArenaPlayerSeat | undefined> = Array.from(
        { length: room.maxSeats },
        (_, idx) => room.seats[idx],
    );

    return (
        <div
            onClick={() => onInspect(room)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onInspect(room);
                }
            }}
            className={`card-3077 relative rounded-2xl border p-3.5 transition-all cursor-pointer overflow-hidden space-y-3 bg-surface-panel ${
                room.tier.isVip
                    ? "border-warn/45 hover:border-warn"
                    : "border-line-soft hover:border-accent/45"
            }`}
            style={{
                backgroundImage: `radial-gradient(circle at top right, ${room.tier.accentColor}1A, transparent 60%)`,
            }}
        >
            {room.tier.isVip && <HudCornerTicks />}
            {room.tier.isVip && (
                <span
                    aria-hidden="true"
                    className="pointer-events-none select-none absolute bottom-1.5 right-3 font-mono font-extrabold text-ludo-xl tracking-widest opacity-10"
                    style={{ color: room.tier.accentColor }}
                >
                    {room.tier.label}
                </span>
            )}

            {/* Top Meta Ribbon */}
            <div className="flex items-center justify-between gap-2 relative z-[1]">
                <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                    <span
                        className="px-2 py-0.5 rounded-md font-mono text-ludo-xs font-bold uppercase tracking-wider border shrink-0"
                        style={{
                            backgroundColor: `${room.tier.accentColor}22`,
                            borderColor: `${room.tier.accentColor}55`,
                            color: room.tier.accentColor,
                        }}
                    >
                        {room.tier.label}
                    </span>

                    <span className="inline-flex items-center gap-1 text-ludo-xs font-bold uppercase text-ink-strong">
                        {room.gameMode === "power" ? (
                            <LuZap className="w-3.5 h-3.5 text-warn" />
                        ) : (
                            <LuSwords className="w-3.5 h-3.5 text-accent" />
                        )}
                        <span>{room.gameMode}</span>
                    </span>

                    <span className="inline-flex items-center gap-1 text-ludo-xs font-mono text-ink-muted">
                        <LuUsers className="w-3 h-3" />
                        <span>{room.matchShape}</span>
                    </span>

                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-surface-recessed border border-line-soft text-ludo-xs font-mono font-bold text-warn">
                        <ChipsHexIcon className="w-3.5 h-3.5 text-warn" active />
                        <span>{formatArenaChips(room.wager)}</span>
                    </span>

                    {room.isDemoAi && (
                        <span className="px-1.5 py-0.5 rounded bg-surface-recessed border border-line-soft font-mono text-ludo-xs font-bold uppercase text-ink-muted">
                            AI
                        </span>
                    )}
                </div>

                {/* Right Status */}
                <div className="flex items-center gap-2 shrink-0 text-ludo-xs font-mono text-ink-muted">
                    {isBetOpen && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-positive/15 border border-positive/40 text-positive font-bold uppercase">
                            <span className="hud-status-breath w-1.5 h-1.5 rounded-full bg-positive" />
                            {room.currentBetType ? `BET · ${room.currentBetType.replace(/_/g, " ")}` : "BET"}
                        </span>
                    )}
                    {room.isPrivate ? (
                        <LuLock className="w-3.5 h-3.5 text-warn" title="Private Room" />
                    ) : (
                        <LuGlobe className="w-3.5 h-3.5 text-ink-faint" title="Public Table" />
                    )}
                    <span className="inline-flex items-center gap-1">
                        {room.streamingEnabled ? (
                            <LuEye className="w-3.5 h-3.5 text-accent" />
                        ) : (
                            <LuEyeOff className="w-3.5 h-3.5 text-ink-faint" />
                        )}
                        <span className="tabular-nums">{room.spectatorCount}</span>
                    </span>
                </div>
            </div>

            {/* Bottom Matrix: Avatars / VS / Open [+] Seats + Action CTA */}
            <div className="flex items-center justify-between gap-2 relative z-[1]">
                <div className="flex items-center gap-1.5 min-w-0 overflow-x-auto no-scrollbar">
                    {room.matchShape === "1v1" ? (
                        <>
                            <SeatAvatarSlot
                                seat={seatsByIndex[0]}
                                seatIndex={0}
                                isVip={room.tier.isVip}
                                canJoin={canJoin}
                                onJoin={(idx) => onJoinSeat(room, idx)}
                                onOpenProfile={onOpenProfile}
                            />
                            <span className="px-1.5 font-mono text-ludo-xs font-extrabold italic text-ink-muted shrink-0">
                                VS
                            </span>
                            <SeatAvatarSlot
                                seat={seatsByIndex[1]}
                                seatIndex={1}
                                isVip={room.tier.isVip}
                                canJoin={canJoin}
                                onJoin={(idx) => onJoinSeat(room, idx)}
                                onOpenProfile={onOpenProfile}
                            />
                        </>
                    ) : room.matchShape === "2v2" ? (
                        <>
                            <SeatAvatarSlot
                                seat={seatsByIndex[0]}
                                seatIndex={0}
                                isVip={room.tier.isVip}
                                canJoin={canJoin}
                                onJoin={(idx) => onJoinSeat(room, idx)}
                                onOpenProfile={onOpenProfile}
                            />
                            <SeatAvatarSlot
                                seat={seatsByIndex[1]}
                                seatIndex={1}
                                isVip={room.tier.isVip}
                                canJoin={canJoin}
                                onJoin={(idx) => onJoinSeat(room, idx)}
                                onOpenProfile={onOpenProfile}
                            />
                            <span className="px-1 font-mono text-ludo-xs font-extrabold italic text-ink-muted shrink-0">
                                VS
                            </span>
                            <SeatAvatarSlot
                                seat={seatsByIndex[2]}
                                seatIndex={2}
                                isVip={room.tier.isVip}
                                canJoin={canJoin}
                                onJoin={(idx) => onJoinSeat(room, idx)}
                                onOpenProfile={onOpenProfile}
                            />
                            <SeatAvatarSlot
                                seat={seatsByIndex[3]}
                                seatIndex={3}
                                isVip={room.tier.isVip}
                                canJoin={canJoin}
                                onJoin={(idx) => onJoinSeat(room, idx)}
                                onOpenProfile={onOpenProfile}
                            />
                        </>
                    ) : (
                        seatsByIndex.map((s, idx) => (
                            <SeatAvatarSlot
                                key={idx}
                                seat={s}
                                seatIndex={idx}
                                isVip={room.tier.isVip}
                                canJoin={canJoin}
                                onJoin={(seatIdx) => onJoinSeat(room, seatIdx)}
                                onOpenProfile={onOpenProfile}
                            />
                        ))
                    )}
                </div>

                {/* Primary CTA on Right */}
                <div className="shrink-0 flex flex-col items-end gap-1">
                    {isOpen ? (
                        <button
                            type="button"
                            onClick={(e) => {
                                e.stopPropagation();
                                onJoinSeat(room);
                            }}
                            className="fee-preset-3077 px-3.5 py-2 rounded-xl bg-accent hover:opacity-90 text-accent-ink font-mono text-ludo-xs font-bold uppercase tracking-wider inline-flex items-center gap-1.5 shadow-[0_0_14px_rgba(0,229,255,0.28)] transition-all active:scale-95"
                        >
                            <LuPlus className="w-3.5 h-3.5" />
                            <span>Join</span>
                        </button>
                    ) : (
                        <button
                            type="button"
                            onClick={(e) => {
                                e.stopPropagation();
                                if (room.roomCode) onWatch(room.roomCode);
                            }}
                            className={`fee-preset-3077 px-3.5 py-2 rounded-xl font-mono text-ludo-xs font-bold uppercase tracking-wider inline-flex items-center gap-1.5 transition-all active:scale-95 ${
                                isBetOpen
                                    ? "bg-positive hover:opacity-90 text-accent-ink shadow-[0_0_14px_rgba(52,211,153,0.3)]"
                                    : "bg-accent-soft hover:bg-accent/20 border border-accent/45 text-accent"
                            }`}
                        >
                            <LuEye className="w-3.5 h-3.5" />
                            <span>{isBetOpen ? "Watch & Bet" : "Watch"}</span>
                        </button>
                    )}

                    {room.totalBetVolume > 0 && (
                        <span className="text-ludo-xs font-mono text-ink-faint">
                            Pot {formatArenaChips(room.totalBetVolume)}
                        </span>
                    )}
                </div>
            </div>
        </div>
    );
}
