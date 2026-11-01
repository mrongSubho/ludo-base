/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import React, { useState, useEffect } from "react";
import { useClanData } from "@/hooks/useClanData";
import { useClanWar } from "@/hooks/useClanWar";
import { useClanClaims } from "@/hooks/useClanClaims";
import Button from "./Button";
import Chip from "./Chip";
import { ThinkingOrb } from "./ThinkingOrb";
import type { Clan } from "@/lib/clan/types";

interface ClanPanelProps {
    isOpen: boolean;
    onClose: () => void;
}

type ClanTab = "hall" | "war" | "missions" | "treasury" | "members";

export function ClanPanel({ isOpen, onClose }: ClanPanelProps) {
    const {
        clan,
        member,
        levelConfig,
        members,
        chatMessages,
        sendChatMessage,
        createClan,
        requestJoin,
        leaveClan,
        kickMember,
        updateRole,
        refresh: refreshClan,
    } = useClanData();

    const {
        warCall,
        stakes,
        totalCommitted,
        activeWar,
        fixtures,
        warBoard,
        postNotice,
        cancelNotice,
        buyIn,
        startSearch,
        fetchWarBoard,
        matchOpponent,
        refresh: refreshWar,
    } = useClanWar(clan?.id);

    const {
        totalClaimableChips,
        claimAll,
        isClaimingAll,
    } = useClanClaims();

    const [activeTab, setActiveTab] = useState<ClanTab>("hall");
    const [chatInput, setChatInput] = useState("");
    const [sendingChat, setSendingChat] = useState(false);

    // Discovery / Creation modal states
    const [isCreatingClan, setIsCreatingClan] = useState(false);
    const [createName, setCreateName] = useState("");
    const [createTag, setCreateTag] = useState("");
    const [createBio, setCreateBio] = useState("");
    const [createSubmitting, setCreateSubmitting] = useState(false);
    const [createError, setCreateError] = useState<string | null>(null);

    // Search clans state
    const [searchQuery, setSearchQuery] = useState("");
    const [discoveredClans, setDiscoveredClans] = useState<Clan[]>([]);
    const [isSearching, setIsSearching] = useState(false);

    // War notice form state
    const [isPostingNotice, setIsPostingNotice] = useState(false);
    const [noticeBracket, setNoticeBracket] = useState<5 | 10 | 15 | 20>(10);
    const [noticeFee, setNoticeFee] = useState<number>(5000);
    const [splitStakers, setSplitStakers] = useState<number>(50);
    const [splitTreasury, setSplitTreasury] = useState<number>(25);
    const [splitLeader, setSplitLeader] = useState<number>(15);
    const [splitOfficers, setSplitOfficers] = useState<number>(10);
    const [noticeSubmitting, setNoticeSubmitting] = useState(false);

    // Open War Board modal
    const [showWarBoard, setShowWarBoard] = useState(false);
    const [matchingCallId, setMatchingCallId] = useState<string | null>(null);

    // Search clans for discovery
    useEffect(() => {
        if (!clan) {
            setIsSearching(true);
            const q = searchQuery ? `&query=${encodeURIComponent(searchQuery)}` : "";
            fetch(`/api/clans?limit=20${q}`)
                .then((res) => res.json())
                .then((data) => {
                    setDiscoveredClans(data.clans || []);
                })
                .catch((e) => console.warn("Failed to load discovery clans", e))
                .finally(() => setIsSearching(false));
        }
    }, [clan, searchQuery]);

    if (!isOpen) return null;

    const isCommander = member?.role === "commander";
    const isOfficer = member?.role === "officer" || isCommander;

    const handleSendMessage = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!chatInput.trim() || sendingChat) return;
        setSendingChat(true);
        try {
            await sendChatMessage(chatInput.trim());
            setChatInput("");
        } catch (err) {
            console.error("Chat error", err);
        } finally {
            setSendingChat(false);
        }
    };

    const handleCreateClanSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setCreateSubmitting(true);
        setCreateError(null);
        try {
            await createClan({
                name: createName.trim(),
                tag: createTag.trim().toUpperCase(),
                bio: createBio.trim() || undefined,
            });
            setIsCreatingClan(false);
            await refreshClan();
        } catch (err: any) {
            setCreateError(err.message || "Failed to create clan");
        } finally {
            setCreateSubmitting(false);
        }
    };

    const handlePostNoticeSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setNoticeSubmitting(true);
        try {
            await postNotice({
                bracket: noticeBracket,
                memberFee: noticeFee,
                stakersPct: splitStakers,
                treasuryPct: splitTreasury,
                leaderPct: splitLeader,
                officersPct: splitOfficers,
            });
            setIsPostingNotice(false);
            await refreshWar();
        } catch (err: any) {
            alert(err.message || "Failed to post notice");
        } finally {
            setNoticeSubmitting(false);
        }
    };

    const handleJoinWarRoster = async () => {
        if (!warCall) return;
        try {
            await buyIn(warCall.member_fee);
            await refreshWar();
        } catch (err: any) {
            alert(err.message || "Buy-in failed");
        }
    };

    const handleMatchOpponent = async (opposingCallId: string) => {
        if (!warCall) return;
        setMatchingCallId(opposingCallId);
        try {
            await matchOpponent(warCall.id, opposingCallId);
            setShowWarBoard(false);
            await refreshWar();
        } catch (err: any) {
            alert(err.message || "Match failed");
        } finally {
            setMatchingCallId(null);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/80 backdrop-blur-md">
            <div className="relative w-full max-w-4xl max-h-[92vh] flex flex-col rounded-3xl bg-[#07080B] border border-cyan-500/30 shadow-[0_0_50px_rgba(0,229,255,0.15)] overflow-hidden text-white font-sans">
                {/* ── Top Header Bar ─────────────────────────────────────────── */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-white/[0.02]">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/40 flex items-center justify-center text-cyan-400 font-black tracking-widest text-lg shadow-[0_0_15px_rgba(0,229,255,0.3)]">
                            {clan ? clan.tag.slice(0, 2) : "🛡️"}
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <h2 className="text-lg font-black tracking-wide text-white">
                                    {clan ? clan.name : "Tactical Clans"}
                                </h2>
                                {clan && (
                                    <span className="px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 font-mono text-xs font-bold border border-cyan-500/30">
                                        [{clan.tag}]
                                    </span>
                                )}
                            </div>
                            <div className="flex items-center gap-2 text-xs font-mono text-white/50">
                                {clan ? (
                                    <>
                                        <span className="text-cyan-400 font-bold">LVL {clan.level}</span>
                                        <span>•</span>
                                        <span>{clan.division} Division</span>
                                        <span>•</span>
                                        <span>{clan.member_count}/{levelConfig?.member_cap ?? 20} Members</span>
                                    </>
                                ) : (
                                    <span>Form or join an on-chain tactical syndicate</span>
                                )}
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center gap-3">
                        {totalClaimableChips > 0 && (
                            <button
                                onClick={() => claimAll()}
                                disabled={isClaimingAll}
                                className="px-3 py-1.5 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 text-emerald-300 font-mono text-xs font-bold flex items-center gap-2 transition-all shadow-[0_0_12px_rgba(16,185,129,0.3)]"
                            >
                                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                                <span>{totalClaimableChips} CHIPS Claimable</span>
                            </button>
                        )}

                        <button
                            onClick={onClose}
                            className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-white/60 hover:text-white transition-colors"
                        >
                            ✕
                        </button>
                    </div>
                </div>

                {/* ── Main Body ──────────────────────────────────────────────── */}
                {!clan ? (
                    /* ── NOT IN A CLAN: Discovery & Creation Screen ─────────── */
                    <div className="flex-1 overflow-y-auto p-6 space-y-6">
                        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
                            <div className="relative flex-1">
                                <input
                                    type="text"
                                    placeholder="Search clans by name or tag..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="w-full px-4 py-3 rounded-2xl bg-white/[0.04] border border-white/10 text-white placeholder-white/40 text-sm focus:outline-none focus:border-cyan-400 font-mono transition-colors"
                                />
                            </div>
                            <Button
                                variant="primary"
                                size="md"
                                onClick={() => setIsCreatingClan(true)}
                                className="font-bold tracking-wider shrink-0"
                            >
                                + CREATE CLAN (10,000 CHIPS)
                            </Button>
                        </div>

                        {/* Clan Discovery Grid */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {isSearching ? (
                                <div className="col-span-2 py-12 flex flex-col items-center justify-center text-white/40 gap-3">
                                    <ThinkingOrb state="solving" size={32} />
                                    <span className="font-mono text-xs">Scanning On-Chain Syndicates...</span>
                                </div>
                            ) : discoveredClans.length === 0 ? (
                                <div className="col-span-2 py-12 text-center text-white/40 font-mono text-sm">
                                    No clans found matching your search. Create the first one!
                                </div>
                            ) : (
                                discoveredClans.map((c) => (
                                    <div
                                        key={c.id}
                                        className="p-4 rounded-2xl bg-white/[0.02] border border-white/10 hover:border-cyan-500/40 transition-all flex flex-col justify-between gap-4"
                                    >
                                        <div className="flex items-start justify-between">
                                            <div className="flex items-center gap-3">
                                                <div className="w-12 h-12 rounded-xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400 font-black text-lg">
                                                    {c.tag.slice(0, 2)}
                                                </div>
                                                <div>
                                                    <div className="flex items-center gap-2">
                                                        <span className="font-bold text-white text-base">{c.name}</span>
                                                        <span className="text-xs font-mono text-cyan-400">[{c.tag}]</span>
                                                    </div>
                                                    <div className="text-xs text-white/50 font-mono">
                                                        LVL {c.level} • {c.division} • {c.member_count} Members
                                                    </div>
                                                </div>
                                            </div>
                                            <Chip size="sm" status={c.join_policy === "open" ? "ok" : "warn"}>
                                                {c.join_policy === "open" ? "OPEN" : "REQUEST"}
                                            </Chip>
                                        </div>

                                        {c.bio && (
                                            <p className="text-xs text-white/60 line-clamp-2 italic">
                                                "{c.bio}"
                                            </p>
                                        )}

                                        <div className="flex items-center justify-between pt-2 border-t border-white/5">
                                            <span className="text-xs font-mono text-white/40">CWR: {c.cwr}</span>
                                            <button
                                                onClick={() => requestJoin(c.id)}
                                                className="px-4 py-1.5 rounded-xl bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/40 text-cyan-300 font-mono text-xs font-bold uppercase transition-all"
                                            >
                                                {c.join_policy === "open" ? "Join Now" : "Apply to Join"}
                                            </button>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                ) : (
                    /* ── IN A CLAN: 5 Sub-Tabs Layout ───────────────────────── */
                    <div className="flex-1 flex flex-col min-h-0">
                        {/* Tab Switcher */}
                        <div className="flex items-center px-6 border-b border-white/10 bg-white/[0.01] gap-6 text-sm font-mono overflow-x-auto">
                            {(["hall", "war", "missions", "treasury", "members"] as ClanTab[]).map((tab) => (
                                <button
                                    key={tab}
                                    onClick={() => setActiveTab(tab)}
                                    className={`py-3 font-bold uppercase tracking-wider relative transition-colors ${
                                        activeTab === tab
                                            ? "text-cyan-400 border-b-2 border-cyan-400"
                                            : "text-white/50 hover:text-white"
                                    }`}
                                >
                                    {tab === "war" && warCall && (
                                        <span className="inline-block w-2 h-2 rounded-full bg-amber-400 mr-2 animate-ping" />
                                    )}
                                    {tab}
                                </button>
                            ))}
                        </div>

                        {/* Sub-Tab Viewport */}
                        <div className="flex-1 overflow-y-auto p-6">
                            {/* 1. HALL TAB */}
                            {activeTab === "hall" && (
                                <div className="h-full flex flex-col space-y-4">
                                    {/* Active War Notice Banner */}
                                    {warCall && (
                                        <div className="p-4 rounded-2xl bg-gradient-to-r from-amber-500/10 via-amber-500/5 to-transparent border border-amber-500/30 flex items-center justify-between">
                                            <div className="flex items-center gap-3">
                                                <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400 text-lg">
                                                    ⚔️
                                                </div>
                                                <div>
                                                    <div className="text-sm font-bold text-amber-300">
                                                        WAR CALL: {warCall.bracket}v{warCall.bracket} BRACKET
                                                    </div>
                                                    <div className="text-xs font-mono text-white/60">
                                                        Entry Fee: {warCall.member_fee} CHIPS • Roster: {stakes.length}/{warCall.bracket} Filled
                                                    </div>
                                                </div>
                                            </div>
                                            <Button
                                                variant="secondary"
                                                size="sm"
                                                onClick={() => setActiveTab("war")}
                                                className="text-xs font-mono uppercase"
                                            >
                                                View War Room
                                            </Button>
                                        </div>
                                    )}

                                    {/* Live Plaintext Clan Chat */}
                                    <div className="flex-1 flex flex-col justify-between rounded-2xl bg-white/[0.02] border border-white/10 p-4 min-h-[300px]">
                                        <div className="flex-1 overflow-y-auto space-y-3 pr-2">
                                            {chatMessages.length === 0 ? (
                                                <div className="h-full flex items-center justify-center text-white/30 font-mono text-xs">
                                                    No messages yet. Send a broadcast to your clan!
                                                </div>
                                            ) : (
                                                chatMessages.map((msg) => (
                                                    <div key={msg.id} className="text-xs font-mono space-y-0.5">
                                                        <div className="flex items-center gap-2">
                                                            <span className="text-cyan-400 font-bold">{msg.sender_name}</span>
                                                            <span className="text-white/30 text-[10px]">
                                                                {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                            </span>
                                                        </div>
                                                        <p className="text-white/80 leading-relaxed break-words pl-2 border-l border-white/10">
                                                            {msg.content}
                                                        </p>
                                                    </div>
                                                ))
                                            )}
                                        </div>

                                        <form onSubmit={handleSendMessage} className="mt-4 flex gap-2 pt-3 border-t border-white/10">
                                            <input
                                                type="text"
                                                placeholder="Type live tactical message (max 280 chars)..."
                                                value={chatInput}
                                                onChange={(e) => setChatInput(e.target.value)}
                                                maxLength={280}
                                                className="flex-1 px-4 py-2.5 rounded-xl bg-white/[0.04] border border-white/10 text-white placeholder-white/30 text-xs font-mono focus:outline-none focus:border-cyan-400"
                                            />
                                            <Button variant="primary" size="sm" type="submit" disabled={sendingChat || !chatInput.trim()}>
                                                {sendingChat ? "Sending..." : "Transmit"}
                                            </Button>
                                        </form>
                                    </div>
                                </div>
                            )}

                            {/* 2. WAR TAB */}
                            {activeTab === "war" && (
                                <div className="space-y-6">
                                    {!warCall && !activeWar ? (
                                        <div className="py-12 flex flex-col items-center justify-center text-center space-y-4">
                                            <div className="w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-3xl text-amber-400 shadow-[0_0_20px_rgba(245,158,11,0.2)]">
                                                ⚔️
                                            </div>
                                            <div>
                                                <h3 className="text-lg font-black text-white">No Active War Call</h3>
                                                <p className="text-xs font-mono text-white/50 max-w-md mt-1">
                                                    Commanders and officers can post a Call-to-Arms notice to rally the clan roster for stake-backed weekend combat.
                                                </p>
                                            </div>
                                            {isOfficer && (
                                                <Button
                                                    variant="primary"
                                                    size="md"
                                                    onClick={() => setIsPostingNotice(true)}
                                                    className="font-bold tracking-wider"
                                                >
                                                    + POST WAR NOTICE
                                                </Button>
                                            )}
                                        </div>
                                    ) : warCall && !activeWar ? (
                                        /* NOTICE / SEARCHING PHASE */
                                        <div className="space-y-6">
                                            <div className="p-6 rounded-2xl bg-white/[0.02] border border-amber-500/30 space-y-4">
                                                <div className="flex items-center justify-between">
                                                    <div>
                                                        <div className="flex items-center gap-2">
                                                            <Chip size="sm" status={warCall.status === "searching" ? "ok" : "warn"}>
                                                                {warCall.status === "searching" ? "SEARCHING FOR MATCH" : "CALL TO ARMS OPEN"}
                                                            </Chip>
                                                            <span className="font-mono text-xs text-white/40">
                                                                {warCall.bracket}v{warCall.bracket} Bracket
                                                            </span>
                                                        </div>
                                                        <div className="text-2xl font-black font-mono text-white mt-1">
                                                            {totalCommitted} / {warCall.bracket * warCall.member_fee} CHIPS
                                                        </div>
                                                    </div>

                                                    <div className="flex items-center gap-2">
                                                        <button
                                                            onClick={() => {
                                                                fetchWarBoard(warCall.bracket);
                                                                setShowWarBoard(true);
                                                            }}
                                                            className="px-3 py-2 rounded-xl bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/40 text-cyan-300 font-mono text-xs font-bold"
                                                        >
                                                            Open War Board
                                                        </button>
                                                        {isOfficer && (
                                                            <button
                                                                onClick={cancelNotice}
                                                                className="px-3 py-2 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/40 text-rose-300 font-mono text-xs font-bold"
                                                            >
                                                                Cancel Notice
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>

                                                {/* Split Sliders Breakdown */}
                                                <div className="p-4 rounded-xl bg-white/[0.02] border border-white/5 grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs font-mono">
                                                    <div>
                                                        <div className="text-white/40">Merit Pool (WP)</div>
                                                        <div className="text-base font-bold text-cyan-400">80% Net Pot</div>
                                                    </div>
                                                    <div>
                                                        <div className="text-white/40">Stakers Share</div>
                                                        <div className="text-base font-bold text-amber-400">{warCall.stakers_pct}%</div>
                                                    </div>
                                                    <div>
                                                        <div className="text-white/40">Clan Treasury</div>
                                                        <div className="text-base font-bold text-emerald-400">{warCall.treasury_pct}%</div>
                                                    </div>
                                                    <div>
                                                        <div className="text-white/40">Officers & Leader</div>
                                                        <div className="text-base font-bold text-white/80">{warCall.leader_pct + warCall.officers_pct}%</div>
                                                    </div>
                                                </div>

                                                {/* Roster Buy-in CTA */}
                                                <div className="flex items-center justify-between pt-2">
                                                    <span className="text-xs font-mono text-white/60">
                                                        Entry fee: <strong className="text-white">{warCall.member_fee} CHIPS</strong>
                                                    </span>

                                                    {stakes.length < warCall.bracket ? (
                                                        <Button variant="primary" size="md" onClick={handleJoinWarRoster}>
                                                            Confirm Participation & Lock Fee
                                                        </Button>
                                                    ) : isOfficer && warCall.status === "notice_open" ? (
                                                        <Button variant="primary" size="md" onClick={startSearch}>
                                                            Roster Full! Start War Search
                                                        </Button>
                                                    ) : (
                                                        <Chip size="sm" status="ok">Waiting for Match</Chip>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    ) : (
                                        /* ACTIVE / PREP WAR PHASE */
                                        <div className="space-y-6">
                                            <div className="p-6 rounded-2xl bg-white/[0.02] border border-cyan-500/40 flex items-center justify-between">
                                                <div>
                                                    <Chip size="sm" status="ok">
                                                        {activeWar?.status === "prep_phase" ? "48H PREPARATION PHASE" : "ACTIVE WAR COMBAT"}
                                                    </Chip>
                                                    <div className="text-2xl font-black font-mono text-white mt-1">
                                                        {activeWar?.clan_a_score} - {activeWar?.clan_b_score}
                                                    </div>
                                                </div>
                                                <span className="font-mono text-xs text-white/50">
                                                    30 Fixtures Matrix (20×1v1 + 10×2v2)
                                                </span>
                                            </div>

                                            {/* Fixtures Matrix List */}
                                            <div className="space-y-2">
                                                <h4 className="text-xs font-mono font-bold text-white/60 uppercase">Scheduled Fixtures</h4>
                                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[350px] overflow-y-auto">
                                                    {fixtures.map((f) => (
                                                        <div
                                                            key={f.id}
                                                            className="p-3 rounded-xl bg-white/[0.02] border border-white/5 flex items-center justify-between text-xs font-mono"
                                                        >
                                                            <div className="flex items-center gap-2">
                                                                <span className="px-1.5 py-0.5 rounded bg-white/5 text-white/40">
                                                                    #{f.fixture_index}
                                                                </span>
                                                                <span className="font-bold text-cyan-400">{f.game_shape}</span>
                                                                <span className="text-white/60 truncate max-w-[120px]">
                                                                    {f.clan_a_seats[0]?.slice(0, 6)} vs {f.clan_b_seats[0]?.slice(0, 6)}
                                                                </span>
                                                            </div>

                                                            <Chip size="sm" status={f.status === "completed" ? "ok" : "off"}>
                                                                {f.status}
                                                            </Chip>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* 3. MISSIONS TAB */}
                            {activeTab === "missions" && (
                                <div className="space-y-4 text-xs font-mono">
                                    <div className="p-4 rounded-2xl bg-white/[0.02] border border-white/10 flex items-center justify-between">
                                        <div>
                                            <div className="text-white font-bold text-sm">Sunday Vault Reserve</div>
                                            <div className="text-white/50">Unlocks every Sunday 23:59 UTC</div>
                                        </div>
                                        <div className="text-lg font-black text-amber-400">50,000 CHIPS</div>
                                    </div>

                                    <div className="space-y-3">
                                        <h4 className="font-bold text-white/60 uppercase">Daily Clan Contracts</h4>
                                        {[
                                            { title: "Capture 15 Opponent Pawns", reward: "+150 CXP", progress: "9/15" },
                                            { title: "Win 3 2v2 Tactical Team Matches", reward: "+250 CXP", progress: "2/3" },
                                            { title: "Mobilize 5 Members for War Roster", reward: "+500 CXP", progress: "5/5" },
                                        ].map((m, idx) => (
                                            <div key={idx} className="p-3 rounded-xl bg-white/[0.02] border border-white/5 flex items-center justify-between">
                                                <div>
                                                    <div className="font-bold text-white">{m.title}</div>
                                                    <div className="text-cyan-400">{m.reward}</div>
                                                </div>
                                                <span className="px-2 py-1 rounded bg-white/5 text-white/60">{m.progress}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* 4. TREASURY TAB */}
                            {activeTab === "treasury" && (
                                <div className="space-y-4 text-xs font-mono">
                                    <div className="p-6 rounded-2xl bg-white/[0.02] border border-cyan-500/30 flex items-center justify-between">
                                        <div>
                                            <div className="text-white/50">Clan Treasury Balance</div>
                                            <div className="text-2xl font-black text-cyan-300 font-mono">
                                                {clan.treasury_balance} CHIPS
                                            </div>
                                        </div>
                                        <Button variant="secondary" size="sm">
                                            + Fund Treasury
                                        </Button>
                                    </div>

                                    <div className="p-4 rounded-xl bg-white/[0.02] border border-white/5 flex items-center justify-between">
                                        <div>
                                            <div className="font-bold text-white">Vice-Versa War Subsidy</div>
                                            <div className="text-white/40">Automatically subsidize roster member war stakes from treasury</div>
                                        </div>
                                        <Chip size="sm" status="ok">ENABLED</Chip>
                                    </div>
                                </div>
                            )}

                            {/* 5. MEMBERS TAB */}
                            {activeTab === "members" && (
                                <div className="space-y-4">
                                    <div className="flex items-center justify-between text-xs font-mono text-white/50">
                                        <span>Roster ({clan.member_count} Members)</span>
                                        <button onClick={leaveClan} className="text-rose-400 hover:underline">
                                            Leave Clan
                                        </button>
                                    </div>

                                    <div className="space-y-2 max-h-[380px] overflow-y-auto">
                                        {members.length === 0 ? (
                                            <div className="p-3 rounded-xl bg-white/[0.02] border border-white/10 flex items-center justify-between text-xs font-mono">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-8 h-8 rounded-lg bg-cyan-500/20 text-cyan-400 flex items-center justify-center font-bold">
                                                        👑
                                                    </div>
                                                    <div>
                                                        <div className="font-bold text-white">{clan.leader_wallet.slice(0, 8)}...</div>
                                                        <div className="text-cyan-400 text-[10px]">COMMANDER</div>
                                                    </div>
                                                </div>
                                                <span className="text-white/40">Leader</span>
                                            </div>
                                        ) : (
                                            members.map((m) => (
                                                <div
                                                    key={m.id}
                                                    className="p-3 rounded-xl bg-white/[0.02] border border-white/5 flex items-center justify-between text-xs font-mono"
                                                >
                                                    <div className="flex items-center gap-3">
                                                        <div className="w-8 h-8 rounded-lg bg-cyan-500/10 text-cyan-400 flex items-center justify-center font-bold">
                                                            {m.role === "commander" ? "👑" : m.role === "officer" ? "⭐" : "🛡️"}
                                                        </div>
                                                        <div>
                                                            <div className="font-bold text-white">{m.wallet_address.slice(0, 8)}...</div>
                                                            <div className="text-cyan-400 text-[10px] uppercase">{m.role}</div>
                                                        </div>
                                                    </div>

                                                    <div className="flex items-center gap-2">
                                                        {isCommander && m.wallet_address !== clan.leader_wallet && (
                                                            <>
                                                                <button
                                                                    onClick={() => updateRole(m.wallet_address, m.role === "officer" ? "member" : "officer")}
                                                                    className="px-2 py-1 rounded bg-white/5 hover:bg-white/10 text-white/60 hover:text-white"
                                                                >
                                                                    {m.role === "officer" ? "Demote" : "Promote"}
                                                                </button>
                                                                <button
                                                                    onClick={() => kickMember(m.wallet_address)}
                                                                    className="px-2 py-1 rounded bg-rose-500/10 hover:bg-rose-500/20 text-rose-400"
                                                                >
                                                                    Kick
                                                                </button>
                                                            </>
                                                        )}
                                                    </div>
                                                </div>
                                            ))
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* ── Modal: Create Clan ──────────────────────────────────────── */}
                {isCreatingClan && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
                        <div className="relative w-full max-w-md p-6 rounded-3xl bg-[#0D1117] border border-cyan-500/40 shadow-2xl space-y-4">
                            <h3 className="text-lg font-black text-white">Create Tactical Clan</h3>
                            <div className="p-3 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-xs font-mono text-cyan-300">
                                Clan creation costs <strong>10,000 CHIPS</strong>, debited atomically from your escrow balance to the protocol treasury.
                            </div>

                            {createError && (
                                <div className="p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs font-mono text-rose-400">
                                    {createError}
                                </div>
                            )}

                            <form onSubmit={handleCreateClanSubmit} className="space-y-3 font-mono text-xs">
                                <div>
                                    <label className="text-white/60 block mb-1">Clan Name (3-24 chars)</label>
                                    <input
                                        type="text"
                                        required
                                        minLength={3}
                                        maxLength={24}
                                        value={createName}
                                        onChange={(e) => setCreateName(e.target.value)}
                                        placeholder="e.g. Cyber Vanguard"
                                        className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-white focus:outline-none focus:border-cyan-400"
                                    />
                                </div>

                                <div>
                                    <label className="text-white/60 block mb-1">Clan Tag (2-5 uppercase chars)</label>
                                    <input
                                        type="text"
                                        required
                                        minLength={2}
                                        maxLength={5}
                                        value={createTag}
                                        onChange={(e) => setCreateTag(e.target.value.toUpperCase())}
                                        placeholder="e.g. CYBER"
                                        className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-white focus:outline-none focus:border-cyan-400 uppercase"
                                    />
                                </div>

                                <div>
                                    <label className="text-white/60 block mb-1">Motto / Bio (optional)</label>
                                    <input
                                        type="text"
                                        maxLength={200}
                                        value={createBio}
                                        onChange={(e) => setCreateBio(e.target.value)}
                                        placeholder="Tactical supremacy on Base Sepolia"
                                        className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-white focus:outline-none focus:border-cyan-400"
                                    />
                                </div>

                                <div className="flex gap-2 pt-2">
                                    <Button
                                        variant="secondary"
                                        size="md"
                                        type="button"
                                        onClick={() => setIsCreatingClan(false)}
                                        className="flex-1"
                                    >
                                        Cancel
                                    </Button>
                                    <Button
                                        variant="primary"
                                        size="md"
                                        type="submit"
                                        disabled={createSubmitting}
                                        className="flex-1"
                                    >
                                        {createSubmitting ? "Debiting Escrow..." : "Forge Clan"}
                                    </Button>
                                </div>
                            </form>
                        </div>
                    </div>
                )}

                {/* ── Modal: Post War Notice ─────────────────────────────────── */}
                {isPostingNotice && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
                        <div className="relative w-full max-w-md p-6 rounded-3xl bg-[#0D1117] border border-amber-500/40 shadow-2xl space-y-4">
                            <h3 className="text-lg font-black text-white">Call to Arms: Post War Notice</h3>
                            <form onSubmit={handlePostNoticeSubmit} className="space-y-4 font-mono text-xs">
                                <div>
                                    <label className="text-white/60 block mb-1">Bracket Size</label>
                                    <div className="grid grid-cols-4 gap-2">
                                        {([5, 10, 15, 20] as const).map((b) => (
                                            <button
                                                key={b}
                                                type="button"
                                                onClick={() => setNoticeBracket(b)}
                                                className={`py-2 rounded-xl border text-center font-bold ${
                                                    noticeBracket === b
                                                        ? "border-amber-400 bg-amber-500/20 text-amber-300"
                                                        : "border-white/10 bg-white/5 text-white/50"
                                                }`}
                                            >
                                                {b}v{b}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                <div>
                                    <label className="text-white/60 block mb-1">Member Entry Fee (CHIPS)</label>
                                    <input
                                        type="number"
                                        min={500}
                                        step={500}
                                        value={noticeFee}
                                        onChange={(e) => setNoticeFee(Number(e.target.value))}
                                        className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-white focus:outline-none focus:border-amber-400"
                                    />
                                </div>

                                <div className="p-3 rounded-xl bg-white/[0.02] border border-white/5 space-y-2">
                                    <span className="text-white/40 block font-bold">20% Governance Split (Must sum to 100%)</span>
                                    <div className="grid grid-cols-2 gap-2">
                                        <div>
                                            <label className="text-white/60 block">Stakers: {splitStakers}%</label>
                                            <input
                                                type="range"
                                                min={0}
                                                max={100}
                                                value={splitStakers}
                                                onChange={(e) => setSplitStakers(Number(e.target.value))}
                                                className="w-full accent-amber-400"
                                            />
                                        </div>
                                        <div>
                                            <label className="text-white/60 block">Treasury: {splitTreasury}%</label>
                                            <input
                                                type="range"
                                                min={0}
                                                max={100}
                                                value={splitTreasury}
                                                onChange={(e) => setSplitTreasury(Number(e.target.value))}
                                                className="w-full accent-emerald-400"
                                            />
                                        </div>
                                        <div>
                                            <label className="text-white/60 block">Leader: {splitLeader}%</label>
                                            <input
                                                type="range"
                                                min={0}
                                                max={50}
                                                value={splitLeader}
                                                onChange={(e) => setSplitLeader(Number(e.target.value))}
                                                className="w-full accent-cyan-400"
                                            />
                                        </div>
                                        <div>
                                            <label className="text-white/60 block">Officers: {splitOfficers}%</label>
                                            <input
                                                type="range"
                                                min={0}
                                                max={50}
                                                value={splitOfficers}
                                                onChange={(e) => setSplitOfficers(Number(e.target.value))}
                                                className="w-full accent-white"
                                            />
                                        </div>
                                    </div>
                                </div>

                                <div className="flex gap-2 pt-2">
                                    <Button
                                        variant="secondary"
                                        size="md"
                                        type="button"
                                        onClick={() => setIsPostingNotice(false)}
                                        className="flex-1"
                                    >
                                        Cancel
                                    </Button>
                                    <Button
                                        variant="primary"
                                        size="md"
                                        type="submit"
                                        disabled={noticeSubmitting}
                                        className="flex-1"
                                    >
                                        {noticeSubmitting ? "Posting..." : "Broadcast Notice"}
                                    </Button>
                                </div>
                            </form>
                        </div>
                    </div>
                )}

                {/* ── Modal: Open War Board ──────────────────────────────────── */}
                {showWarBoard && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
                        <div className="relative w-full max-w-2xl max-h-[80vh] flex flex-col p-6 rounded-3xl bg-[#0D1117] border border-cyan-500/40 shadow-2xl space-y-4">
                            <div className="flex items-center justify-between">
                                <h3 className="text-lg font-black text-white">Open War Board (Searching Clans)</h3>
                                <button
                                    onClick={() => setShowWarBoard(false)}
                                    className="text-white/60 hover:text-white"
                                >
                                    ✕
                                </button>
                            </div>

                            <div className="flex-1 overflow-y-auto space-y-3">
                                {warBoard.length === 0 ? (
                                    <div className="py-12 text-center text-white/40 font-mono text-xs">
                                        No other clans currently searching in this bracket. Your notice is listed for other clans to match!
                                    </div>
                                ) : (
                                    warBoard.map((c) => (
                                        <div
                                            key={c.id}
                                            className="p-3.5 rounded-xl bg-white/[0.02] border border-white/10 flex items-center justify-between text-xs font-mono"
                                        >
                                            <div className="flex items-center gap-3">
                                                <div className="w-10 h-10 rounded-lg bg-amber-500/20 text-amber-300 flex items-center justify-center font-bold">
                                                    ⚔️
                                                </div>
                                                <div>
                                                    <div className="font-bold text-white text-sm">
                                                        {c.clan?.name} <span className="text-cyan-400">[{c.clan?.tag}]</span>
                                                    </div>
                                                    <div className="text-white/50">
                                                        {c.bracket}v{c.bracket} • Stake: {c.total_stake} CHIPS • CWR: {c.clan?.cwr}
                                                    </div>
                                                </div>
                                            </div>

                                            <button
                                                disabled={matchingCallId === c.id}
                                                onClick={() => handleMatchOpponent(c.id)}
                                                className="px-4 py-2 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-300 font-bold transition-all"
                                            >
                                                {matchingCallId === c.id ? "Matching..." : "Adjust & Match"}
                                            </button>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
