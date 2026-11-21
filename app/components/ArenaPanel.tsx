"use client";

import React, { useState, useCallback, useEffect } from "react";
import { LiveArenaContent, LiveTile } from "./LiveArenaDirectory";
import {
    UnifiedBroadcastFeed,
    useBroadcastData,
    type BroadcastData,
} from "./ActivityFeed";
import { LuRadio, LuTv } from "react-icons/lu";
import { GamePanelShell } from "./GamePanelShell";
import { PanelTabs, TabCount } from "./PanelTabs";

export type ArenaHubTab = "arena" | "comms";
type NavTab =
    | "friends"
    | "leaderboard"
    | "mission"
    | "arena"
    | "marketplace"
    | "settings"
    | "messages"
    | "wallet"
    | "profile"
    | "clan"
    | null;

interface ArenaPanelProps {
    isOpen: boolean;
    onClose: () => void;
    onSwitchTab?: (tab: NavTab) => void;
    onWatchMatch?: (roomCode: string) => void;
    onJoinDemoMatch?: (room: import("@/lib/arena/types").ArenaDirectoryRoom) => void;
    onOpenProfile?: (address: string) => void;
    initialTab?: ArenaHubTab;
    broadcastData?: BroadcastData;
}

function ArenaPanelInner({
    isOpen,
    onClose,
    onWatchMatch,
    onJoinDemoMatch,
    onOpenProfile,
    initialTab = "arena",
    externalBroadcastData,
}: {
    isOpen: boolean;
    onClose: () => void;
    onWatchMatch?: (roomCode: string) => void;
    onJoinDemoMatch?: (room: import("@/lib/arena/types").ArenaDirectoryRoom) => void;
    onOpenProfile?: (address: string) => void;
    initialTab?: ArenaHubTab;
    externalBroadcastData?: BroadcastData;
}) {
    const fallbackBroadcast = useBroadcastData();
    const broadcastData = externalBroadcastData ?? fallbackBroadcast;

    const [activeHubTab, setActiveHubTab] = useState<ArenaHubTab>(initialTab);
    const [liveStats, setLiveStats] = useState({ live: 0, watching: 0, vol: 0, open: 0 });

    useEffect(() => {
        if (isOpen) {
            setActiveHubTab(initialTab);
        }
    }, [isOpen, initialTab]);

    const handleLiveStats = useCallback(
        (live: number, watching: number, vol: number, openCount = 0) => {
            setLiveStats((prev) =>
                prev.live === live &&
                prev.watching === watching &&
                prev.vol === vol &&
                prev.open === openCount
                    ? prev
                    : { live, watching, vol, open: openCount },
            );
        },
        [],
    );

    if (!isOpen) return null;

    const openRoomsInFeed = broadcastData.rooms.filter((r) => r.open).length;
    const totalCommsSignals = broadcastData.chats.length + openRoomsInFeed;

    return (
        <GamePanelShell
            scopeClass="ludo-arena-scope ludo-broadcast-scope"
            kicker="// ARENA DIRECTORY & COMMS"
            title={(
                <span className="inline-flex items-center gap-2">
                    <LiveTile />
                    <span>Live Arena</span>
                </span>
            )}
            subtitle={(
                <span className="arena-stats-8px inline-flex items-center gap-1.5 font-mono uppercase">
                    {(liveStats.live > 0 || liveStats.open > 0) && (
                        <span className="hud-status-breath w-1 h-1 rounded-full bg-accent" />
                    )}
                    <span className="font-bold text-accent tabular-nums">
                        {liveStats.open} open
                    </span>
                    <span className="w-0.5 h-0.5 rounded-full bg-line-strong" />
                    <span className="font-bold text-ink-muted tabular-nums">
                        {liveStats.live} live
                    </span>
                    <span className="w-0.5 h-0.5 rounded-full bg-line-strong" />
                    <span className="font-bold text-ink-muted tabular-nums">
                        {liveStats.watching.toLocaleString()} watching
                    </span>
                </span>
            )}
            onClose={onClose}
            hideOrbs
            compactHeader
            bodyScroll={false}
        >
            {/* Dual Hub Tab Switcher — pulled cleanly up beneath header */}
            <div className="px-3 pt-1.5 pb-1.5 border-b border-line-soft relative z-10 shrink-0">
                <PanelTabs
                    cols={2}
                    value={activeHubTab}
                    onPick={setActiveHubTab}
                    options={[
                        {
                            value: "arena",
                            label: "Arena Rooms",
                            icon: <LuTv className="w-3.5 h-3.5" />,
                            badge: (
                                <TabCount active={activeHubTab === "arena"}>
                                    {liveStats.open + liveStats.live}
                                </TabCount>
                            ),
                        },
                        {
                            value: "comms",
                            label: "Live Comms",
                            icon: <LuRadio className="w-3.5 h-3.5" />,
                            badge:
                                totalCommsSignals > 0 ? (
                                    <TabCount active={activeHubTab === "comms"}>
                                        {totalCommsSignals}
                                    </TabCount>
                                ) : undefined,
                        },
                    ]}
                />
            </div>

            {/* Tab Viewport */}
            {activeHubTab === "arena" ? (
                <LiveArenaContent
                    onWatchMatch={onWatchMatch}
                    onJoinDemoMatch={onJoinDemoMatch}
                    onOpenProfile={onOpenProfile}
                    onClosePanel={onClose}
                    onStats={handleLiveStats}
                />
            ) : (
                <div className="flex-1 min-h-0 overflow-hidden relative z-10 flex flex-col">
                    <UnifiedBroadcastFeed
                        onOpenProfile={onOpenProfile}
                        onJoin={onClose}
                        data={broadcastData}
                    />
                </div>
            )}
        </GamePanelShell>
    );
}

export default function ArenaPanel(props: ArenaPanelProps) {
    return (
        <ArenaPanelInner
            isOpen={props.isOpen}
            onClose={props.onClose}
            onWatchMatch={props.onWatchMatch}
            onJoinDemoMatch={props.onJoinDemoMatch}
            onOpenProfile={props.onOpenProfile}
            initialTab={props.initialTab}
            externalBroadcastData={props.broadcastData}
        />
    );
}
