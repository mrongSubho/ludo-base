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
    accentColor,
    canJoin,
    onJoin,
    onOpenProfile,
}: {
    seat?: ArenaPlayerSeat;
    seatIndex: number;
    accentColor: string;
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
                className="flex flex-col items-center gap-0.5 group/slot shrink-0 w-[40px]"
                title={canJoin ? `Join Seat #${seatIndex + 1}` : "Empty seat"}
            >
                <span
                    className={`w-8 h-8 rounded-full border border-dashed flex items-center justify-center transition-all ${
                        canJoin
                            ? "border-accent/65 bg-accent-soft text-accent group-hover/slot:scale-105 group-hover/slot:border-accent"
                            : "border-line-soft bg-surface-recessed text-ink-faint"
                    }`}
                >
                    <LuPlus className="w-3.5 h-3.5" />
                </span>
                <span className="arena-seat-label font-mono text-ink-muted truncate w-full text-center">
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
            className={`flex flex-col items-center gap-0.5 shrink-0 w-[40px] ${
                onOpenProfile ? "cursor-pointer" : ""
            }`}
            title={seat.clanTag ? `[${seat.clanTag}] ${seat.username}` : seat.username}
        >
            <div className="relative">
                <div
                    className="hud-avatar-frame w-8 h-8 rounded-full overflow-hidden flex items-center justify-center font-mono text-ludo-xs font-bold border bg-surface-recessed text-ink-strong"
                    style={{
                        borderColor: `${accentColor}88`,
                        boxShadow: `0 0 8px ${accentColor}26`,
                    }}
                >
                    {seat.avatarUrl ? (
                        <img
                            src={seat.avatarUrl}
                            alt={seat.username}
                            className="w-full h-full object-cover"
                            width={32}
                            height={32}
                        />
                    ) : (
                        <span>{initials}</span>
                    )}
                </div>

                {seat.isHost && (
                    <span className="absolute -bottom-0.5 -left-1 w-3.5 h-3.5 rounded-full bg-warn text-accent-ink flex items-center justify-center shadow z-10">
                        <LuCrown className="w-2 h-2" />
                    </span>
                )}

                {seat.clanTag && (
                    <span
                        className="arena-clan-badge absolute -top-1.5 -right-1.5 z-10 px-1 py-[1px] rounded-[4px] bg-surface-page/95 border font-mono font-extrabold uppercase tracking-wider shadow-sm max-w-[34px] truncate"
                        style={{
                            borderColor: `${accentColor}88`,
                            color: accentColor,
                            boxShadow: `0 2px 6px ${accentColor}30`,
                        }}
                    >
                        {seat.clanTag}
                    </span>
                )}
            </div>

            <span className="arena-seat-label font-mono text-ink-strong truncate w-full text-center">
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
    const accent = room.tier.accentColor;

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
            className="card-3077 relative rounded-xl border px-2.5 py-2 transition-all cursor-pointer overflow-hidden space-y-1 bg-surface-panel"
            style={{
                borderColor: `${accent}4D`,
                backgroundImage: `radial-gradient(circle at top right, ${accent}22, transparent 62%)`,
                boxShadow: `inset 2px 0 0 ${accent}99`,
            }}
        >
            {room.tier.isVip && <HudCornerTicks />}
            {room.wager > 0 && (
                <span
                    aria-hidden="true"
                    className="pointer-events-none select-none absolute bottom-1 right-2 font-mono font-extrabold text-ludo-lg tracking-widest opacity-10"
                    style={{ color: accent }}
                >
                    {room.tier.label}
                </span>
            )}

            {/* Top Meta Ribbon (compact single line) */}
            <div className="flex items-center justify-between gap-1.5 relative z-[1] min-w-0">
                <div className="flex items-center gap-1 min-w-0 flex-nowrap overflow-hidden">
                    <span
                        className="px-1.5 py-[1px] rounded font-mono text-ludo-xs font-extrabold uppercase tracking-wider border shrink-0"
                        style={{
                            backgroundColor: `${accent}24`,
                            borderColor: `${accent}66`,
                            color: accent,
                        }}
                    >
                        {room.tier.label}
                    </span>

                    <span className="inline-flex items-center gap-0.5 text-ludo-xs font-bold uppercase text-ink-strong shrink-0">
                        {room.gameMode === "power" ? (
                            <LuZap className="w-3 h-3 text-warn" />
                        ) : (
                            <LuSwords className="w-3 h-3 text-accent" />
                        )}
                        <span>{room.gameMode}</span>
                    </span>

                    <span className="inline-flex items-center gap-0.5 text-ludo-xs font-mono text-ink-muted shrink-0">
                        <LuUsers className="w-2.5 h-2.5" />
                        <span>{room.matchShape}</span>
                    </span>

                    <span
                        className="inline-flex items-center gap-0.5 px-1.5 py-[1px] rounded bg-surface-recessed border text-ludo-xs font-mono font-bold shrink-0"
                        style={{
                            borderColor: `${accent}44`,
                            color: room.wager > 0 ? accent : "var(--ink-muted)",
                        }}
                    >
                        <ChipsHexIcon className="w-3 h-3 shrink-0" active={room.wager > 0} />
                        <span>{formatArenaChips(room.wager)}</span>
                    </span>

                    {room.isDemoAi && (
                        <span className="px-1 py-[1px] rounded bg-surface-recessed border border-line-soft font-mono text-ludo-xs font-bold uppercase text-ink-muted shrink-0">
                            AI
                        </span>
                    )}
                </div>

                {/* Right Status */}
                <div className="flex items-center gap-1.5 shrink-0 text-ludo-xs font-mono text-ink-muted">
                    {isBetOpen && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-[1px] rounded bg-positive/15 border border-positive/40 text-positive font-bold uppercase">
                            <span className="hud-status-breath w-1.5 h-1.5 rounded-full bg-positive" />
                            <span>BET</span>
                        </span>
                    )}
                    {room.isPrivate ? (
                        <LuLock className="w-3 h-3 text-warn" title="Private Room" />
                    ) : (
                        <LuGlobe className="w-3 h-3 text-ink-faint" title="Public Table" />
                    )}
                    <span className="inline-flex items-center gap-0.5">
                        {room.streamingEnabled ? (
                            <LuEye className="w-3 h-3 text-accent" />
                        ) : (
                            <LuEyeOff className="w-3 h-3 text-ink-faint" />
                        )}
                        <span className="tabular-nums">{room.spectatorCount}</span>
                    </span>
                </div>
            </div>

            {/* Bottom Matrix: Compact Avatars (with pt-2 for clan tag headroom) + Action CTA */}
            <div className="flex items-center justify-between gap-2 relative z-[1]">
                <div className="flex items-center gap-1 min-w-0 overflow-x-auto no-scrollbar pt-2 pb-0.5">
                    {room.matchShape === "1v1" ? (
                        <>
                            <SeatAvatarSlot
                                seat={seatsByIndex[0]}
                                seatIndex={0}
                                accentColor={accent}
                                canJoin={canJoin}
                                onJoin={(idx) => onJoinSeat(room, idx)}
                                onOpenProfile={onOpenProfile}
                            />
                            <span className="px-0.5 font-mono text-ludo-xs font-extrabold italic text-ink-muted shrink-0">
                                VS
                            </span>
                            <SeatAvatarSlot
                                seat={seatsByIndex[1]}
                                seatIndex={1}
                                accentColor={accent}
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
                                accentColor={accent}
                                canJoin={canJoin}
                                onJoin={(idx) => onJoinSeat(room, idx)}
                                onOpenProfile={onOpenProfile}
                            />
                            <SeatAvatarSlot
                                seat={seatsByIndex[1]}
                                seatIndex={1}
                                accentColor={accent}
                                canJoin={canJoin}
                                onJoin={(idx) => onJoinSeat(room, idx)}
                                onOpenProfile={onOpenProfile}
                            />
                            <span className="px-0.5 font-mono text-ludo-xs font-extrabold italic text-ink-muted shrink-0">
                                VS
                            </span>
                            <SeatAvatarSlot
                                seat={seatsByIndex[2]}
                                seatIndex={2}
                                accentColor={accent}
                                canJoin={canJoin}
                                onJoin={(idx) => onJoinSeat(room, idx)}
                                onOpenProfile={onOpenProfile}
                            />
                            <SeatAvatarSlot
                                seat={seatsByIndex[3]}
                                seatIndex={3}
                                accentColor={accent}
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
                                accentColor={accent}
                                canJoin={canJoin}
                                onJoin={(seatIdx) => onJoinSeat(room, seatIdx)}
                                onOpenProfile={onOpenProfile}
                            />
                        ))
                    )}
                </div>

                {/* Primary CTA on Right */}
                <div className="shrink-0 flex flex-col items-end gap-0.5 pt-1">
                    {isOpen ? (
                        <button
                            type="button"
                            onClick={(e) => {
                                e.stopPropagation();
                                onJoinSeat(room);
                            }}
                            className="fee-preset-3077 px-2.5 py-1.5 rounded-lg bg-accent hover:opacity-90 text-accent-ink font-mono text-ludo-xs font-bold uppercase tracking-wider inline-flex items-center gap-1 shadow-[0_0_12px_color-mix(in_srgb,var(--accent)_26%,transparent)] transition-all active:scale-95"
                        >
                            <LuPlus className="w-3 h-3" />
                            <span>Join</span>
                        </button>
                    ) : (
                        <button
                            type="button"
                            onClick={(e) => {
                                e.stopPropagation();
                                if (room.roomCode) onWatch(room.roomCode);
                            }}
                            className={`fee-preset-3077 px-2.5 py-1.5 rounded-lg font-mono text-ludo-xs font-bold uppercase tracking-wider inline-flex items-center gap-1 transition-all active:scale-95 ${
                                isBetOpen
                                    ? "bg-positive hover:opacity-90 text-accent-ink shadow-[0_0_12px_rgba(52,211,153,0.28)]"
                                    : "bg-accent-soft hover:bg-accent/20 border border-accent/45 text-accent"
                            }`}
                        >
                            <LuEye className="w-3 h-3" />
                            <span>{isBetOpen ? "Watch & Bet" : "Watch"}</span>
                        </button>
                    )}

                    {room.totalBetVolume > 0 && (
                        <span className="arena-seat-label font-mono text-ink-faint tabular-nums">
                            Pot {formatArenaChips(room.totalBetVolume)}
                        </span>
                    )}
                </div>
            </div>
        </div>
    );
}
