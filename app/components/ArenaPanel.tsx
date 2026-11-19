/* eslint-disable @typescript-eslint/no-explicit-any -- legacy wire/UI types */
"use client";

import React, { useState, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useIsMobileView } from "@/hooks/useIsMobileView";
import { LiveArenaContent, LiveTile } from "./LiveArenaDirectory";
import {
    UnifiedBroadcastFeed,
    useBroadcastData,
    type BroadcastData,
} from "./ActivityFeed";
import { LuRadio, LuTv } from "react-icons/lu";
import { Button } from "./Button";
import { PanelTabs, TabCount } from "./PanelTabs";
import { HudCornerTicks } from "./HudPrimitives";
import { CloseReticleIcon } from "./icons";

export type ArenaHubTab = "arena" | "comms";

interface ArenaPanelProps {
    isOpen: boolean;
    onClose: () => void;
    onSwitchTab?: (tab: any) => void;
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
    const isMobile = useIsMobileView();
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

    const openRoomsInFeed = broadcastData.rooms.filter((r) => r.open).length;
    const totalCommsSignals = broadcastData.chats.length + openRoomsInFeed;

    return (
        <AnimatePresence initial={false}>
            {isOpen && (
                <>
                    <div
                        className="fixed top-[64px] bottom-[80px] left-0 right-0 z-40 bg-transparent"
                        onClick={onClose}
                    />
                    <div className="fixed inset-0 z-[110] flex justify-center pointer-events-none">
                        <motion.div
                            initial={isMobile ? false : { opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={
                                isMobile
                                    ? { opacity: 0, transition: { duration: 0 } }
                                    : { opacity: 0, y: 20 }
                            }
                            transition={
                                isMobile
                                    ? { duration: 0 }
                                    : { type: "tween", duration: 0.22, ease: [0.22, 1, 0.36, 1] }
                            }
                            className="w-full max-w-[500px] relative h-full pointer-events-auto panel-motion-host"
                        >
                            <div
                                className="ludo-arena-scope ludo-broadcast-scope absolute top-[64px] bottom-[80px] left-[8px] right-[8px] border border-white/10 rounded-[32px] flex flex-col shadow-2xl overflow-hidden"
                                style={{
                                    background: "var(--panel-bg-image, var(--ludo-bg-cosmic))",
                                    backgroundColor: "var(--panel-bg, rgba(13, 13, 13, 0.92))",
                                    backdropFilter: "blur(32px)",
                                }}
                            >
                                <HudCornerTicks />
                                <div className="absolute top-[-20%] left-[-20%] w-full h-full cosmic-orb cosmic-orb-1 opacity-20 scale-150 pointer-events-none" />
                                <div className="absolute bottom-[-20%] right-[-20%] w-full h-full cosmic-orb cosmic-orb-2 opacity-15 scale-150 pointer-events-none" />

                                {/* Drag Handle */}
                                <div className="w-full flex justify-center pt-2 pb-1 relative z-10 shrink-0">
                                    <div className="panel-handle-bar w-12 h-1.5 bg-white/20 rounded-full" />
                                </div>

                                {/* Panel Header + Dual Hub Tab Switcher */}
                                <div className="px-5 pb-3 border-b border-white/10 relative z-10 shrink-0 space-y-2.5">
                                    <div className="flex items-center justify-between mt-1">
                                        <div>
                                            <h2 className="text-xl font-bold text-white flex items-center gap-2">
                                                <LiveTile />
                                                <span>Live Arena</span>
                                            </h2>
                                            <div className="flex items-center gap-2 px-0.5 mt-1">
                                                {(liveStats.live > 0 || liveStats.open > 0) && (
                                                    <span className="hud-status-breath w-1.5 h-1.5 rounded-full bg-cyan-400" />
                                                )}
                                                <span className="text-ludo-xs font-mono font-bold text-cyan-300 tracking-wide uppercase tabular-nums">
                                                    {liveStats.open} open
                                                </span>
                                                <span className="w-0.5 h-0.5 rounded-full bg-white/25" />
                                                <span className="text-ludo-xs font-mono font-bold text-white/70 tracking-wide uppercase tabular-nums">
                                                    {liveStats.live} live
                                                </span>
                                                <span className="w-0.5 h-0.5 rounded-full bg-white/25" />
                                                <span className="text-ludo-xs font-mono font-bold text-white/70 tracking-wide uppercase tabular-nums">
                                                    {liveStats.watching.toLocaleString()} watching
                                                </span>
                                            </div>
                                        </div>

                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            onClick={onClose}
                                            aria-label="Close arena"
                                            className="panel-close-3077 bg-surface-hover border border-line-soft shrink-0"
                                        >
                                            <CloseReticleIcon className="icon-md" />
                                        </Button>
                                    </div>

                                    {/* 2 Iconic Primary Tabs: Arena Rooms | Live Comms */}
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
                            </div>
                        </motion.div>
                    </div>
                </>
            )}
        </AnimatePresence>
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
