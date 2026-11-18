/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import { useAccount } from "wagmi";
import { useTeamUpContext } from "@/hooks/TeamUpContext";
import { useClanData } from "@/hooks/useClanData";
import { useClanWar } from "@/hooks/useClanWar";
import { useClanClaims } from "@/hooks/useClanClaims";
import { shortHex } from "@/lib/chips";
import Button from "./Button";
import Chip from "./Chip";
import { ThinkingOrb } from "./ThinkingOrb";
import {
    ClanCrestBadge,
    CREST_EMBLEMS,
    CREST_PALETTES,
    CrownIcon,
    SettingsGearIcon,
    ShieldIcon,
    StarIcon,
    SwordsIcon,
    type CrestEmblem,
} from "./ClanCrestBadge";
import type { Clan, ClanJoinPolicy, ClanWarFixture } from "@/lib/clan/types";

interface ClanPanelProps {
    isOpen: boolean;
    onClose: () => void;
}

type ClanTab = "hall" | "war" | "missions" | "treasury" | "members";

const DIVISIONS = ["All", "Bronze", "Silver", "Gold", "Platinum", "Diamond", "Master"] as const;
const TREASURY_PRESETS = [500, 1000, 5000, 10000] as const;

export function ClanPanel({ isOpen, onClose }: ClanPanelProps) {
    const {
        clan,
        member,
        levelConfig,
        nextLevelConfig,
        members,
        joinRequests,
        treasuryLedger,
        missions,
        weeklyVault,
        chatMessages,
        error: clanDataError,
        sendChatMessage,
        createClan,
        fundTreasury,
        requestJoin,
        reviewRequest,
        leaveClan,
        kickMember,
        updateRole,
        updateSettings,
        refresh: refreshClan,
    } = useClanData();

    const {
        warCall,
        stakes,
        totalCommitted,
        activeWar,
        fixtures,
        warBoard,
        error: warError,
        postNotice,
        cancelNotice,
        buyIn,
        startSearch,
        fetchWarBoard,
        matchOpponent,
        scheduleFixture,
        refresh: refreshWar,
    } = useClanWar(clan?.id);

    const {
        totalClaimableChips,
        claimAll,
        isClaimingAll,
        error: claimError,
    } = useClanClaims();

    const { address } = useAccount();
    const { hostGame, joinGame, initQuickLobby } = useTeamUpContext();

    const [activeTab, setActiveTab] = useState<ClanTab>("hall");
    const [chatInput, setChatInput] = useState("");
    const [sendingChat, setSendingChat] = useState(false);
    const [actionError, setActionError] = useState<string | null>(null);
    const [actionSuccess, setActionSuccess] = useState<string | null>(null);

    const chatEndRef = useRef<HTMLDivElement | null>(null);

    // Discovery & Creation modal states
    const [isCreatingClan, setIsCreatingClan] = useState(false);
    const [createName, setCreateName] = useState("");
    const [createTag, setCreateTag] = useState("");
    const [createBio, setCreateBio] = useState("");
    const [createEmblem, setCreateEmblem] = useState<CrestEmblem>("shield");
    const [createPaletteIdx, setCreatePaletteIdx] = useState(0);
    const [createSubmitting, setCreateSubmitting] = useState(false);
    const [createError, setCreateError] = useState<string | null>(null);

    // Search clans state
    const [searchQuery, setSearchQuery] = useState("");
    const [divisionFilter, setDivisionFilter] = useState<string>("All");
    const [discoveredClans, setDiscoveredClans] = useState<Clan[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const [joiningClanId, setJoiningClanId] = useState<string | null>(null);

    // War notice form state
    const [isPostingNotice, setIsPostingNotice] = useState(false);
    const [noticeBracket, setNoticeBracket] = useState<5 | 10 | 15 | 20>(10);
    const [noticeFee, setNoticeFee] = useState<number>(5000);
    const [noticeSubsidy, setNoticeSubsidy] = useState<number>(0);
    const [splitStakers, setSplitStakers] = useState<number>(50);
    const [splitTreasury, setSplitTreasury] = useState<number>(25);
    const [splitLeader, setSplitLeader] = useState<number>(15);
    const [splitOfficers, setSplitOfficers] = useState<number>(10);
    const [noticeSubmitting, setNoticeSubmitting] = useState(false);
    const [buyInSubmitting, setBuyInSubmitting] = useState(false);
    const [buyInError, setBuyInError] = useState<string | null>(null);

    // Open War Board modal
    const [showWarBoard, setShowWarBoard] = useState(false);
    const [matchingCallId, setMatchingCallId] = useState<string | null>(null);

    // Fixture scheduling state
    const [schedulingFixture, setSchedulingFixture] = useState<ClanWarFixture | null>(null);
    const [scheduleTimeInput, setScheduleTimeInput] = useState("");
    const [scheduleSubmitting, setScheduleSubmitting] = useState(false);

    // Treasury funding state
    const [isFundingTreasury, setIsFundingTreasury] = useState(false);
    const [fundAmountInput, setFundAmountInput] = useState("1000");
    const [fundSubmitting, setFundSubmitting] = useState(false);

    // Clan Settings modal
    const [isEditingSettings, setIsEditingSettings] = useState(false);
    const [settingsBio, setSettingsBio] = useState("");
    const [settingsPolicy, setSettingsPolicy] = useState<ClanJoinPolicy>("request");
    const [settingsMinLevel, setSettingsMinLevel] = useState(1);
    const [settingsChannel, setSettingsChannel] = useState("");
    const [settingsSubmitting, setSettingsSubmitting] = useState(false);

    // Lookup map wallet -> display name from hydrated clan members
    const memberNameMap = useMemo(() => {
        const m = new Map<string, string>();
        for (const row of members) {
            const name = row.player?.username || shortHex(row.wallet_address);
            m.set(row.wallet_address.toLowerCase(), name);
        }
        return m;
    }, [members]);

    const formatSeatLabel = (wallets: string[]) =>
        wallets.map((w) => memberNameMap.get(w.toLowerCase()) || shortHex(w)).join(" & ");

    // Auto-scroll chat to newest message
    useEffect(() => {
        if (activeTab === "hall" && chatEndRef.current) {
            chatEndRef.current.scrollIntoView({ behavior: "smooth" });
        }
    }, [chatMessages.length, activeTab]);

    // Search clans for discovery
    useEffect(() => {
        if (!clan && isOpen) {
            setIsSearching(true);
            const params = new URLSearchParams({ limit: "20" });
            if (searchQuery.trim()) params.set("query", searchQuery.trim());
            if (divisionFilter !== "All") params.set("division", divisionFilter);
            fetch(`/api/clans?${params.toString()}`)
                .then((res) => res.json())
                .then((data) => {
                    setDiscoveredClans(data.clans || []);
                })
                .catch((e) => console.warn("Failed to load discovery clans", e))
                .finally(() => setIsSearching(false));
        }
    }, [clan, isOpen, searchQuery, divisionFilter]);

    if (!isOpen) return null;

    const isCommander = member?.role === "commander";
    const isOfficer = member?.role === "officer" || isCommander;

    const splitSum = splitStakers + splitTreasury + splitLeader + splitOfficers;
    const isSplitValid = splitSum === 100 && splitLeader <= 50 && splitOfficers <= 50;

    // CXP progress bar math
    const currentLevelFloor = levelConfig?.cxp_required ?? 0;
    const nextLevelTarget = nextLevelConfig?.cxp_required ?? null;
    const cxpPct =
        clan && nextLevelTarget && nextLevelTarget > currentLevelFloor
            ? Math.min(100, Math.max(0, Math.round(((clan.cxp - currentLevelFloor) / (nextLevelTarget - currentLevelFloor)) * 100)))
            : 100;

    const showErr = (err: unknown, fallback: string) => {
        setActionSuccess(null);
        setActionError(err instanceof Error ? err.message : fallback);
    };

    const handleDeployFixture = (f: ClanWarFixture) => {
        if (!activeWar) return;
        const roomCode = `cw-${activeWar.id.slice(0, 6)}-${f.fixture_index}`;
        const myAddr = address?.toLowerCase();
        const isClanA = (f.clan_a_seats || []).some((s: string) => s.toLowerCase() === myAddr);

        if (typeof window !== "undefined") {
            sessionStorage.setItem("ludo_active_fixture_id", f.id);
            sessionStorage.setItem("ludo_active_war_id", activeWar.id);
        }

        if (isClanA) {
            hostGame(roomCode);
            initQuickLobby(roomCode, f.game_shape, "classic", 0);
        } else {
            joinGame(roomCode);
        }
        onClose();
    };

    const handleSendMessage = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!chatInput.trim() || sendingChat) return;
        setSendingChat(true);
        setActionError(null);
        try {
            await sendChatMessage(chatInput.trim());
            setChatInput("");
        } catch (err) {
            showErr(err, "Failed to send chat message");
        } finally {
            setSendingChat(false);
        }
    };

    const handleCreateClanSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setCreateSubmitting(true);
        setCreateError(null);
        try {
            const palette = CREST_PALETTES[createPaletteIdx] || CREST_PALETTES[0];
            await createClan({
                name: createName.trim(),
                tag: createTag.trim().toUpperCase(),
                bio: createBio.trim() || undefined,
                crest: {
                    emblem: createEmblem,
                    primary: palette.primary,
                    secondary: palette.secondary,
                },
            });
            setIsCreatingClan(false);
            setCreateName("");
            setCreateTag("");
            setCreateBio("");
            await refreshClan();
        } catch (err: any) {
            setCreateError(err.message || "Failed to create clan");
        } finally {
            setCreateSubmitting(false);
        }
    };

    const handleJoinClan = async (targetClanId: string) => {
        setJoiningClanId(targetClanId);
        setActionError(null);
        setActionSuccess(null);
        try {
            const res = await requestJoin(targetClanId);
            setActionSuccess(res?.message || "Join request processed");
        } catch (err) {
            showErr(err, "Failed to join clan");
        } finally {
            setJoiningClanId(null);
        }
    };

    const handlePostNoticeSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!isSplitValid) {
            setActionError(`Governance split must equal 100% (currently ${splitSum}%)`);
            return;
        }
        setNoticeSubmitting(true);
        setActionError(null);
        try {
            await postNotice({
                bracket: noticeBracket,
                memberFee: noticeFee,
                stakersPct: splitStakers,
                treasuryPct: splitTreasury,
                leaderPct: splitLeader,
                officersPct: splitOfficers,
                treasurySubsidy: noticeSubsidy > 0 ? noticeSubsidy : undefined,
            });
            setIsPostingNotice(false);
            setActionSuccess("War notice broadcast to clan roster.");
            await refreshWar();
        } catch (err: any) {
            showErr(err, "Failed to post war notice");
        } finally {
            setNoticeSubmitting(false);
        }
    };

    const handleJoinWarRoster = async () => {
        if (!warCall || buyInSubmitting) return;
        setBuyInSubmitting(true);
        setBuyInError(null);
        try {
            await buyIn(warCall.member_fee);
            await refreshWar();
        } catch (err: any) {
            setBuyInError(err.message || "War stake transaction failed");
        } finally {
            setBuyInSubmitting(false);
        }
    };

    const handleMatchOpponent = async (opposingCallId: string) => {
        if (!warCall) return;
        setMatchingCallId(opposingCallId);
        setActionError(null);
        try {
            await matchOpponent(warCall.id, opposingCallId);
            setShowWarBoard(false);
            setActionSuccess("Clan war matched! 48h preparation phase started.");
            await refreshWar();
        } catch (err: any) {
            showErr(err, "Failed to match opponent");
        } finally {
            setMatchingCallId(null);
        }
    };

    const handleProposeSchedule = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!schedulingFixture || !scheduleTimeInput) return;
        setScheduleSubmitting(true);
        setActionError(null);
        try {
            const iso = new Date(scheduleTimeInput).toISOString();
            await scheduleFixture(schedulingFixture.id, iso, "propose");
            setSchedulingFixture(null);
            setScheduleTimeInput("");
            setActionSuccess("Schedule proposal sent to opponent.");
        } catch (err) {
            showErr(err, "Failed to propose schedule");
        } finally {
            setScheduleSubmitting(false);
        }
    };

    const handleConfirmSchedule = async (fixtureId: string) => {
        setActionError(null);
        try {
            await scheduleFixture(fixtureId, undefined, "confirm");
            setActionSuccess("Fixture match time confirmed bilaterally.");
        } catch (err) {
            showErr(err, "Failed to confirm fixture time");
        }
    };

    const handleFundTreasurySubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const amt = Math.floor(Number(fundAmountInput));
        if (!Number.isFinite(amt) || amt <= 0) {
            setActionError("Enter a valid CHIPS amount greater than 0");
            return;
        }
        setFundSubmitting(true);
        setActionError(null);
        try {
            await fundTreasury(amt);
            setIsFundingTreasury(false);
            setActionSuccess(`Deposited ${amt.toLocaleString()} CHIPS to Clan Treasury.`);
        } catch (err) {
            showErr(err, "Treasury deposit failed");
        } finally {
            setFundSubmitting(false);
        }
    };

    const openSettingsModal = () => {
        if (!clan) return;
        setSettingsBio(clan.bio || "");
        setSettingsPolicy(clan.join_policy);
        setSettingsMinLevel(clan.min_level);
        setSettingsChannel(clan.farcaster_channel || "");
        setIsEditingSettings(true);
    };

    const handleSaveSettings = async (e: React.FormEvent) => {
        e.preventDefault();
        setSettingsSubmitting(true);
        setActionError(null);
        try {
            await updateSettings({
                bio: settingsBio,
                join_policy: settingsPolicy,
                min_level: settingsMinLevel,
                farcaster_channel: settingsChannel,
            });
            setIsEditingSettings(false);
            setActionSuccess("Clan settings updated.");
        } catch (err) {
            showErr(err, "Failed to update settings");
        } finally {
            setSettingsSubmitting(false);
        }
    };

    const bannerError = actionError || clanDataError || warError || claimError;

    return (
        <>
            <div
                className="fixed top-[64px] bottom-[80px] left-0 right-0 z-40 bg-transparent"
                onClick={onClose}
            />

            <div className="fixed inset-0 z-[110] flex justify-center pointer-events-none">
                <div className="w-full max-w-[500px] relative h-full">
                    <div
                        className="ludo-clan-scope panel-shell-3077 pointer-events-auto absolute top-[64px] bottom-[80px] left-[8px] right-[8px] border border-white/10 rounded-[32px] flex flex-col shadow-2xl overflow-hidden text-white font-sans"
                        style={{
                            background: "var(--panel-bg-image, var(--ludo-bg-cosmic))",
                            backgroundColor: "var(--panel-bg, rgba(13, 13, 13, 0.92))",
                        }}
                    >
                        {/* Authentic Subdued Cosmic Orbs */}
                        <div className="absolute top-[-20%] left-[-20%] w-full h-full cosmic-orb cosmic-orb-1 opacity-20 scale-150 pointer-events-none" />
                        <div className="absolute bottom-[-20%] right-[-20%] w-full h-full cosmic-orb cosmic-orb-2 opacity-15 scale-150 pointer-events-none" />

                        {/* Drag Handle */}
                        <div className="w-full flex justify-center pt-2 pb-1 relative z-10 shrink-0">
                            <div className="w-12 h-1.5 bg-white/20 rounded-full" />
                        </div>

                        {/* ── Top Header Bar ─────────────────────────────────────────── */}
                        <div className="flex items-center justify-between gap-2 px-5 pb-3 pt-1 border-b border-white/10 relative z-10 shrink-0">
                            <div className="flex items-center gap-3 min-w-0">
                                <ClanCrestBadge crest={clan?.crest} tag={clan?.tag} size="md" />
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2 min-w-0">
                                        <h2 className="text-ludo-lg font-bold tracking-wide text-white truncate">
                                            {clan ? clan.name : "Tactical Clans"}
                                        </h2>
                                        {clan && (
                                            <span className="px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 font-mono text-ludo-xs font-bold border border-cyan-500/30 shrink-0">
                                                [{clan.tag}]
                                            </span>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-1.5 text-ludo-xs font-mono text-white/50 truncate">
                                        {clan ? (
                                            <>
                                                <span className="text-cyan-400 font-bold">LVL {clan.level}</span>
                                                <span>•</span>
                                                <span>{clan.division}</span>
                                                <span>•</span>
                                                <span>{clan.member_count}/{levelConfig?.member_cap ?? 20}</span>
                                            </>
                                        ) : (
                                            <span className="truncate">Form or join an on-chain syndicate</span>
                                        )}
                                    </div>
                                    {clan && (
                                        <div className="mt-1.5 flex items-center gap-2">
                                            <div className="flex-1 h-1 rounded-full bg-white/10 overflow-hidden max-w-[140px]">
                                                <div
                                                    className="h-full rounded-full transition-all"
                                                    style={{
                                                        width: `${cxpPct}%`,
                                                        backgroundColor: clan.crest?.primary || "#00E5FF",
                                                    }}
                                                />
                                            </div>
                                            <span className="text-ludo-xs font-mono text-white/40">
                                                {nextLevelTarget
                                                    ? `${clan.cxp.toLocaleString()}/${nextLevelTarget.toLocaleString()} CXP`
                                                    : `${clan.cxp.toLocaleString()} CXP · MAX`}
                                            </span>
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className="flex items-center gap-2 shrink-0">
                                {totalClaimableChips > 0 && (
                                    <button
                                        onClick={() => void claimAll().catch((e) => showErr(e, "Claim failed"))}
                                        disabled={isClaimingAll}
                                        className="px-2.5 py-1.5 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 text-emerald-300 font-mono text-ludo-xs font-bold flex items-center gap-1.5 transition-all"
                                    >
                                        <span className="w-2 h-2 rounded-full bg-emerald-400" />
                                        <span>{totalClaimableChips.toLocaleString()} Claim</span>
                                    </button>
                                )}

                                <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={onClose}
                                    aria-label="Close Tactical Clans panel"
                                    className="bg-surface-recessed border border-line-soft shrink-0"
                                >
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                                        <line x1="18" y1="6" x2="6" y2="18" />
                                        <line x1="6" y1="6" x2="18" y2="18" />
                                    </svg>
                                </Button>
                            </div>
                        </div>

                        {/* Inline Feedback Banner */}
                        {(bannerError || actionSuccess) && (
                            <div className="px-5 pt-3 relative z-10 shrink-0">
                                <div
                                    className={`px-3 py-2 rounded-xl border text-ludo-xs font-mono flex items-center justify-between gap-2 ${
                                        bannerError
                                            ? "bg-red-500/10 border-red-500/30 text-red-300"
                                            : "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
                                    }`}
                                >
                                    <span className="break-words">{bannerError || actionSuccess}</span>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setActionError(null);
                                            setActionSuccess(null);
                                        }}
                                        className="text-white/50 hover:text-white shrink-0 font-bold"
                                        aria-label="Dismiss message"
                                    >
                                        ×
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* ── Main Body ──────────────────────────────────────────────── */}
                        {!clan ? (
                            /* ── NOT IN A CLAN: Discovery & Creation Screen ─────────── */
                            <div className="panel-body-3077 flex-1 overflow-y-auto p-5 space-y-4 relative z-10">
                                <div className="flex flex-col gap-3">
                                    <input
                                        type="text"
                                        placeholder="Search clans by name or tag..."
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                        autoComplete="off"
                                        autoCorrect="off"
                                        autoCapitalize="none"
                                        spellCheck={false}
                                        className="w-full px-4 py-3 rounded-2xl bg-white/[0.04] border border-white/10 text-white placeholder:text-white/25 text-ludo-sm focus:outline-none focus:border-cyan-400 font-mono transition-colors"
                                    />

                                    <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
                                        {DIVISIONS.map((div) => (
                                            <button
                                                key={div}
                                                type="button"
                                                onClick={() => setDivisionFilter(div)}
                                                className={`px-2.5 py-1 rounded-lg font-mono text-ludo-xs font-bold border shrink-0 transition-colors ${
                                                    divisionFilter === div
                                                        ? "bg-cyan-500/20 border-cyan-400 text-cyan-300"
                                                        : "bg-white/[0.04] border-white/10 text-white/50 hover:text-white"
                                                }`}
                                            >
                                                {div}
                                            </button>
                                        ))}
                                    </div>

                                    <Button
                                        variant="primary"
                                        size="md"
                                        onClick={() => {
                                            setCreateError(null);
                                            setIsCreatingClan(true);
                                        }}
                                        className="w-full font-bold tracking-wider"
                                    >
                                        + CREATE CLAN (10,000 CHIPS)
                                    </Button>
                                </div>

                                <div className="grid grid-cols-1 gap-3">
                                    {isSearching ? (
                                        <div className="py-12 flex flex-col items-center justify-center text-white/40 gap-3">
                                            <ThinkingOrb state="solving" size={32} />
                                            <span className="font-mono text-ludo-xs">Scanning On-Chain Syndicates...</span>
                                        </div>
                                    ) : discoveredClans.length === 0 ? (
                                        <div className="py-10 text-center text-white/40 font-mono text-ludo-sm">
                                            No clans found matching your search. Create the first one!
                                        </div>
                                    ) : (
                                        discoveredClans.map((c) => {
                                            const policyLabel =
                                                c.join_policy === "open"
                                                    ? "OPEN"
                                                    : c.join_policy === "invite_only"
                                                      ? "INVITE ONLY"
                                                      : "REQUEST";
                                            const policyStatus =
                                                c.join_policy === "open"
                                                    ? "ok"
                                                    : c.join_policy === "invite_only"
                                                      ? "off"
                                                      : "warn";
                                            const isInviteOnly = c.join_policy === "invite_only";
                                            return (
                                                <div
                                                    key={c.id}
                                                    className="p-4 rounded-2xl bg-white/[0.04] border border-white/10 hover:border-cyan-500/40 transition-all flex flex-col justify-between gap-3"
                                                >
                                                    <div className="flex items-start justify-between gap-2">
                                                        <div className="flex items-center gap-3 min-w-0">
                                                            <ClanCrestBadge crest={c.crest} tag={c.tag} size="lg" />
                                                            <div className="min-w-0">
                                                                <div className="flex items-center gap-2">
                                                                    <span className="font-bold text-white text-ludo-md truncate">{c.name}</span>
                                                                    <span className="text-ludo-xs font-mono text-cyan-400 shrink-0">[{c.tag}]</span>
                                                                </div>
                                                                <div className="text-ludo-xs text-white/50 font-mono">
                                                                    LVL {c.level} • {c.division} • {c.member_count} Members
                                                                </div>
                                                            </div>
                                                        </div>
                                                        <Chip size="sm" status={policyStatus}>
                                                            {policyLabel}
                                                        </Chip>
                                                    </div>

                                                    {c.bio && (
                                                        <p className="text-ludo-xs text-white/60 line-clamp-2 italic">
                                                            &ldquo;{c.bio}&rdquo;
                                                        </p>
                                                    )}

                                                    <div className="flex items-center justify-between pt-2 border-t border-white/5">
                                                        <span className="text-ludo-xs font-mono text-white/40">CWR: {c.cwr}</span>
                                                        <button
                                                            disabled={isInviteOnly || joiningClanId === c.id}
                                                            onClick={() => void handleJoinClan(c.id)}
                                                            className={`px-4 py-1.5 rounded-xl border font-mono text-ludo-xs font-bold uppercase transition-all ${
                                                                isInviteOnly
                                                                    ? "bg-white/5 border-white/10 text-white/30 cursor-not-allowed"
                                                                    : "bg-cyan-500/20 hover:bg-cyan-500/30 border-cyan-500/40 text-cyan-300"
                                                            }`}
                                                        >
                                                            {joiningClanId === c.id
                                                                ? "Joining..."
                                                                : c.join_policy === "open"
                                                                  ? "Join Now"
                                                                  : isInviteOnly
                                                                    ? "Invite Only"
                                                                    : "Apply to Join"}
                                                        </button>
                                                    </div>
                                                </div>
                                            );
                                        })
                                    )}
                                </div>
                            </div>
                        ) : (
                            /* ── IN A CLAN: 5 Sub-Tabs Layout ───────────────────────── */
                            <div className="flex-1 flex flex-col min-h-0 relative z-10">
                                {/* Tab Switcher */}
                                <div className="flex items-center px-4 border-b border-white/10 gap-4 text-ludo-xs font-mono overflow-x-auto no-scrollbar shrink-0">
                                    {(["hall", "war", "missions", "treasury", "members"] as ClanTab[]).map((tab) => (
                                        <button
                                            key={tab}
                                            onClick={() => setActiveTab(tab)}
                                            className={`py-3 font-bold uppercase tracking-wider relative transition-colors shrink-0 ${
                                                activeTab === tab
                                                    ? "text-cyan-400 border-b-2 border-cyan-400"
                                                    : "text-white/50 hover:text-white"
                                            }`}
                                        >
                                            {tab === "war" && (warCall || activeWar) && (
                                                <span className="inline-block w-2 h-2 rounded-full bg-amber-400 mr-1.5" />
                                            )}
                                            {tab === "members" && isOfficer && joinRequests.length > 0 && (
                                                <span className="inline-block w-2 h-2 rounded-full bg-cyan-400 mr-1.5" />
                                            )}
                                            {tab}
                                        </button>
                                    ))}
                                </div>

                                {/* Sub-Tab Viewport */}
                                <div className="panel-body-3077 flex-1 overflow-y-auto p-5">
                                    {/* 1. HALL TAB */}
                                    {activeTab === "hall" && (
                                        <div className="h-full flex flex-col space-y-4">
                                            {(warCall || activeWar) && (
                                                <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex flex-wrap items-center justify-between gap-3">
                                                    <div className="flex items-center gap-3 min-w-0">
                                                        <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400 shrink-0">
                                                            <SwordsIcon className="w-5 h-5" />
                                                        </div>
                                                        <div className="min-w-0">
                                                            <div className="text-ludo-sm font-bold text-amber-300 truncate">
                                                                {activeWar
                                                                    ? `ACTIVE WAR: ${activeWar.clan_a_score} – ${activeWar.clan_b_score}`
                                                                    : `WAR CALL: ${warCall!.bracket}v${warCall!.bracket} BRACKET`}
                                                            </div>
                                                            <div className="text-ludo-xs font-mono text-white/60">
                                                                {activeWar
                                                                    ? `${activeWar.bracket}v${activeWar.bracket} · ${activeWar.status.replace("_", " ").toUpperCase()}`
                                                                    : `Fee: ${warCall!.member_fee.toLocaleString()} CHIPS • ${stakes.length}/${warCall!.bracket} Filled`}
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <Button
                                                        variant="secondary"
                                                        size="sm"
                                                        onClick={() => setActiveTab("war")}
                                                        className="text-ludo-xs font-mono uppercase shrink-0"
                                                    >
                                                        View War Room
                                                    </Button>
                                                </div>
                                            )}

                                            {/* Live Plaintext Clan Chat */}
                                            <div className="flex-1 flex flex-col justify-between rounded-2xl bg-white/[0.04] border border-white/10 p-4 min-h-[280px]">
                                                <div className="chat-thread-scroll flex-1 overflow-y-auto space-y-3 pr-2">
                                                    {chatMessages.length === 0 ? (
                                                        <div className="h-full flex items-center justify-center text-white/30 font-mono text-ludo-xs text-center">
                                                            No messages yet. Send a broadcast to your clan!
                                                        </div>
                                                    ) : (
                                                        chatMessages.map((msg) => (
                                                            <div key={msg.id} className="text-ludo-xs font-mono space-y-0.5">
                                                                <div className="flex items-center gap-2">
                                                                    <span className="text-cyan-400 font-bold">{msg.sender_name}</span>
                                                                    <span className="text-white/30 text-ludo-xs">
                                                                        {new Date(msg.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                                                                    </span>
                                                                </div>
                                                                <p className="text-white/80 leading-relaxed break-words pl-2 border-l border-white/10">
                                                                    {msg.content}
                                                                </p>
                                                            </div>
                                                        ))
                                                    )}
                                                    <div ref={chatEndRef} />
                                                </div>

                                                <form onSubmit={handleSendMessage} className="mt-4 flex gap-2 pt-3 border-t border-white/10">
                                                    <input
                                                        type="text"
                                                        placeholder="Type live tactical message (max 280 chars)..."
                                                        value={chatInput}
                                                        onChange={(e) => setChatInput(e.target.value)}
                                                        maxLength={280}
                                                        autoComplete="off"
                                                        autoCorrect="off"
                                                        autoCapitalize="none"
                                                        spellCheck={false}
                                                        className="flex-1 min-w-0 px-3.5 py-2.5 rounded-xl bg-white/[0.04] border border-white/10 text-white placeholder:text-white/25 text-ludo-xs font-mono focus:outline-none focus:border-cyan-400"
                                                    />
                                                    <Button variant="primary" size="sm" type="submit" disabled={sendingChat || !chatInput.trim()} className="shrink-0">
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
                                                    <div className="w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 shadow-[0_0_20px_rgba(245,158,11,0.2)]">
                                                        <SwordsIcon className="w-8 h-8" />
                                                    </div>
                                                    <div>
                                                        <h3 className="text-ludo-lg font-bold text-white">No Active War Call</h3>
                                                        <p className="text-ludo-xs font-mono text-white/50 max-w-md mt-1">
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
                                                <div className="space-y-5">
                                                    <div className="p-4 rounded-2xl bg-white/[0.04] border border-amber-500/30 space-y-4">
                                                        <div className="flex flex-wrap items-center justify-between gap-3">
                                                            <div>
                                                                <div className="flex items-center gap-2">
                                                                    <Chip size="sm" status={warCall.status === "searching" ? "ok" : "warn"}>
                                                                        {warCall.status === "searching" ? "SEARCHING FOR MATCH" : "CALL TO ARMS OPEN"}
                                                                    </Chip>
                                                                    <span className="font-mono text-ludo-xs text-white/40">
                                                                        {warCall.bracket}v{warCall.bracket} Bracket
                                                                    </span>
                                                                </div>
                                                                <div className="text-ludo-lg font-bold font-mono text-white mt-1">
                                                                    {totalCommitted.toLocaleString()} / {(warCall.bracket * warCall.member_fee).toLocaleString()} CHIPS
                                                                </div>
                                                            </div>

                                                            <div className="flex flex-wrap items-center gap-2">
                                                                {isOfficer && warCall.status === "searching" && (
                                                                    <button
                                                                        onClick={() => {
                                                                            void fetchWarBoard(warCall.bracket);
                                                                            setShowWarBoard(true);
                                                                        }}
                                                                        className="px-3 py-2 rounded-xl bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/40 text-cyan-300 font-mono text-ludo-xs font-bold"
                                                                    >
                                                                        Open War Board
                                                                    </button>
                                                                )}
                                                                {isOfficer && (
                                                                    <button
                                                                        onClick={() => void cancelNotice().catch((e) => showErr(e, "Failed to cancel notice"))}
                                                                        className="px-3 py-2 rounded-xl bg-red-500/20 hover:bg-red-500/30 border border-red-500/40 text-red-300 font-mono text-ludo-xs font-bold"
                                                                    >
                                                                        Cancel Notice
                                                                    </button>
                                                                )}
                                                            </div>
                                                        </div>

                                                        <div className="p-3.5 rounded-xl bg-white/[0.04] border border-white/10 grid grid-cols-2 gap-3 text-ludo-xs font-mono">
                                                            <div>
                                                                <div className="text-white/40">Merit Pool (WP)</div>
                                                                <div className="text-ludo-md font-bold text-cyan-400">80% Net Pot</div>
                                                            </div>
                                                            <div>
                                                                <div className="text-white/40">Stakers Share</div>
                                                                <div className="text-ludo-md font-bold text-amber-400">{warCall.stakers_pct}%</div>
                                                            </div>
                                                            <div>
                                                                <div className="text-white/40">Clan Treasury</div>
                                                                <div className="text-ludo-md font-bold text-emerald-400">{warCall.treasury_pct}%</div>
                                                            </div>
                                                            <div>
                                                                <div className="text-white/40">Officers &amp; Leader</div>
                                                                <div className="text-ludo-md font-bold text-white/80">{warCall.leader_pct + warCall.officers_pct}%</div>
                                                            </div>
                                                        </div>

                                                        {buyInError && (
                                                            <div className="p-2.5 rounded-xl bg-red-500/10 border border-red-500/20 text-ludo-xs font-mono text-red-400">
                                                                {buyInError}
                                                            </div>
                                                        )}

                                                        <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                                                            <span className="text-ludo-xs font-mono text-white/60">
                                                                Entry fee: <strong className="text-white">{warCall.member_fee.toLocaleString()} CHIPS</strong> ({stakes.length}/{warCall.bracket} Roster)
                                                            </span>

                                                            {(() => {
                                                                const myAddr = address?.toLowerCase();
                                                                const myStake = myAddr
                                                                    ? stakes.find(
                                                                          (s) =>
                                                                              s.wallet_address.toLowerCase() === myAddr &&
                                                                              s.kind === "member_fee",
                                                                      )
                                                                    : undefined;

                                                                if (stakes.length >= warCall.bracket) {
                                                                    return isOfficer && warCall.status === "notice_open" ? (
                                                                        <Button
                                                                            variant="primary"
                                                                            size="md"
                                                                            onClick={() => void startSearch().catch((e) => showErr(e, "Failed to start search"))}
                                                                        >
                                                                            Roster Full! Start War Search
                                                                        </Button>
                                                                    ) : (
                                                                        <Chip size="sm" status="ok">Waiting for Match</Chip>
                                                                    );
                                                                }

                                                                if (myStake) {
                                                                    return (
                                                                        <Chip size="sm" status="ok">
                                                                            Roster Locked ({Number(myStake.stake_amount).toLocaleString()} CHIPS)
                                                                        </Chip>
                                                                    );
                                                                }

                                                                return (
                                                                    <Button
                                                                        variant="primary"
                                                                        size="md"
                                                                        disabled={buyInSubmitting}
                                                                        onClick={handleJoinWarRoster}
                                                                    >
                                                                        {buyInSubmitting
                                                                            ? "Approving in Wallet..."
                                                                            : `Confirm & Lock ${warCall.member_fee.toLocaleString()} CHIPS`}
                                                                    </Button>
                                                                );
                                                            })()}
                                                        </div>
                                                    </div>
                                                </div>
                                            ) : (
                                                /* ACTIVE / PREP WAR PHASE */
                                                <div className="space-y-5">
                                                    <div className="p-4 rounded-2xl bg-white/[0.04] border border-cyan-500/40 flex flex-wrap items-center justify-between gap-2">
                                                        <div>
                                                            <Chip size="sm" status="ok">
                                                                {activeWar?.status === "prep_phase" ? "48H PREPARATION PHASE" : "ACTIVE WAR COMBAT"}
                                                            </Chip>
                                                            <div className="text-ludo-lg font-bold font-mono text-white mt-1.5">
                                                                {activeWar?.clan_a?.tag ? `[${activeWar.clan_a.tag}]` : "Clan A"}{" "}
                                                                {activeWar?.clan_a_score} – {activeWar?.clan_b_score}{" "}
                                                                {activeWar?.clan_b?.tag ? `[${activeWar.clan_b.tag}]` : "Clan B"}
                                                            </div>
                                                        </div>
                                                        <span className="font-mono text-ludo-xs text-white/50">
                                                            {(activeWar?.bracket || 10) * 3} Fixtures ({(activeWar?.bracket || 10) * 2}×1v1 + {activeWar?.bracket || 10}×2v2)
                                                        </span>
                                                    </div>

                                                    {/* Fixtures Matrix List */}
                                                    <div className="space-y-2">
                                                        <h4 className="text-ludo-xs font-mono font-bold text-white/60 uppercase">Scheduled Fixtures</h4>
                                                        <div className="grid grid-cols-1 gap-2.5 max-h-[350px] overflow-y-auto">
                                                            {fixtures.map((f) => {
                                                                const myAddr = address?.toLowerCase();
                                                                const inA = myAddr && (f.clan_a_seats || []).some((s: string) => s.toLowerCase() === myAddr);
                                                                const inB = myAddr && (f.clan_b_seats || []).some((s: string) => s.toLowerCase() === myAddr);
                                                                const isSeated = Boolean(inA || inB);
                                                                const mySide: "a" | "b" | null = inA
                                                                    ? "a"
                                                                    : inB
                                                                      ? "b"
                                                                      : activeWar?.clan_a_id === clan.id
                                                                        ? "a"
                                                                        : "b";
                                                                const isClanAHost = myAddr && f.clan_a_seats?.[0]?.toLowerCase() === myAddr;
                                                                const canPlay = activeWar?.status === "active_war" && f.status !== "completed" && isSeated;
                                                                const canConfirmProposal =
                                                                    f.status === "reschedule_pending" &&
                                                                    f.proposed_by &&
                                                                    mySide &&
                                                                    f.proposed_by !== mySide &&
                                                                    (isSeated || isOfficer);
                                                                const canPropose =
                                                                    !["completed", "walkover", "mutual_void"].includes(f.status) &&
                                                                    (isSeated || isOfficer);

                                                                return (
                                                                    <div
                                                                        key={f.id}
                                                                        className="p-3 rounded-xl bg-white/[0.04] border border-white/10 flex flex-col gap-2 text-ludo-xs font-mono"
                                                                    >
                                                                        <div className="flex items-center justify-between gap-2">
                                                                            <div className="flex items-center gap-2 min-w-0">
                                                                                <span className="px-1.5 py-0.5 rounded bg-white/5 text-white/40 shrink-0">
                                                                                    #{f.fixture_index}
                                                                                </span>
                                                                                <span className="font-bold text-cyan-400 shrink-0">{f.game_shape}</span>
                                                                                <span className="text-white/75 truncate">
                                                                                    {formatSeatLabel(f.clan_a_seats)} vs {formatSeatLabel(f.clan_b_seats)}
                                                                                </span>
                                                                            </div>

                                                                            <div className="flex items-center gap-1.5 shrink-0">
                                                                                {canPlay ? (
                                                                                    <Button
                                                                                        size="sm"
                                                                                        variant={isClanAHost ? "primary" : "secondary"}
                                                                                        onClick={() => handleDeployFixture(f)}
                                                                                    >
                                                                                        {isClanAHost ? "Deploy Battle" : "Join Battle"}
                                                                                    </Button>
                                                                                ) : (
                                                                                    <Chip size="sm" status={f.status === "completed" || f.status === "scheduled_agreed" ? "ok" : f.status === "reschedule_pending" ? "warn" : "off"}>
                                                                                        {f.status.replace("_", " ")}
                                                                                    </Chip>
                                                                                )}
                                                                            </div>
                                                                        </div>

                                                                        <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-white/5 text-white/50">
                                                                            <span>
                                                                                {f.scheduled_at
                                                                                    ? `Time: ${new Date(f.scheduled_at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}`
                                                                                    : "Unscheduled"}
                                                                            </span>
                                                                            <div className="flex items-center gap-2">
                                                                                {canConfirmProposal && (
                                                                                    <button
                                                                                        type="button"
                                                                                        onClick={() => void handleConfirmSchedule(f.id)}
                                                                                        className="px-2 py-1 rounded bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 font-bold"
                                                                                    >
                                                                                        Confirm Time
                                                                                    </button>
                                                                                )}
                                                                                {canPropose && (
                                                                                    <button
                                                                                        type="button"
                                                                                        onClick={() => {
                                                                                            setSchedulingFixture(f);
                                                                                            setScheduleTimeInput(
                                                                                                f.scheduled_at
                                                                                                    ? new Date(f.scheduled_at).toISOString().slice(0, 16)
                                                                                                    : new Date(Date.now() + 2 * 3600 * 1000).toISOString().slice(0, 16),
                                                                                            );
                                                                                        }}
                                                                                        className="px-2 py-1 rounded bg-white/5 hover:bg-white/10 text-cyan-300"
                                                                                    >
                                                                                        {f.scheduled_at ? "Reschedule" : "Propose Time"}
                                                                                    </button>
                                                                                )}
                                                                            </div>
                                                                        </div>
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {/* 3. MISSIONS TAB */}
                                    {activeTab === "missions" && (
                                        <div className="space-y-4 text-ludo-xs font-mono">
                                            <div className="p-4 rounded-2xl bg-white/[0.04] border border-white/10 space-y-3">
                                                <div className="flex flex-wrap items-center justify-between gap-2">
                                                    <div>
                                                        <div className="text-white font-bold text-ludo-sm">Sunday Weekly Vault</div>
                                                        <div className="text-white/50">
                                                            {weeklyVault
                                                                ? `Unlocks ${new Date(weeklyVault.unlocksAtUtc).toUTCString().slice(0, 22)}`
                                                                : "Unlocks every Sunday 23:59 UTC"}
                                                        </div>
                                                    </div>
                                                    <div className="text-ludo-lg font-bold text-amber-400">
                                                        {weeklyVault && weeklyVault.currentTier > 0
                                                            ? `T${weeklyVault.currentTier} · ${weeklyVault.rewardPerMemberChips} CHIPS/ea`
                                                            : "Tier 0 · Locked"}
                                                    </div>
                                                </div>

                                                {weeklyVault && (
                                                    <div className="space-y-2">
                                                        <div className="flex justify-between text-white/60">
                                                            <span>Weekly Clan CXP: {weeklyVault.weeklyClanCxp.toLocaleString()}</span>
                                                            <span>
                                                                {weeklyVault.nextTierTargetCxp
                                                                    ? `Next T${weeklyVault.nextTier}: ${weeklyVault.nextTierTargetCxp.toLocaleString()}`
                                                                    : "Max Tier Reached"}
                                                            </span>
                                                        </div>
                                                        <div className="grid grid-cols-5 gap-1.5">
                                                            {weeklyVault.tiers.map((t) => (
                                                                <div
                                                                    key={t.tier}
                                                                    className={`p-1.5 rounded-lg border text-center ${
                                                                        t.reached
                                                                            ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-300"
                                                                            : t.unlocked
                                                                              ? "bg-white/[0.04] border-white/10 text-white/60"
                                                                              : "bg-white/[0.02] border-white/5 text-white/25"
                                                                    }`}
                                                                >
                                                                    <div className="font-bold">T{t.tier}</div>
                                                                    <div>{t.chipsPerMember}</div>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}
                                            </div>

                                            <div className="space-y-3">
                                                <h4 className="font-bold text-white/60 uppercase">Clan Contracts &amp; Objectives</h4>
                                                {missions.length === 0 ? (
                                                    <div className="p-4 rounded-xl bg-white/[0.04] border border-white/10 text-white/40 text-center">
                                                        Play online matches or clan war fixtures to progress daily contracts.
                                                    </div>
                                                ) : (
                                                    missions.map((m) => {
                                                        const pct = Math.min(100, Math.round((m.progress / Math.max(1, m.target)) * 100));
                                                        return (
                                                            <div key={m.key} className="p-3 rounded-xl bg-white/[0.04] border border-white/10 space-y-2">
                                                                <div className="flex items-center justify-between gap-2">
                                                                    <div>
                                                                        <div className="font-bold text-white">{m.title}</div>
                                                                        <div className="text-cyan-400">
                                                                            +{m.rewardCxp} CXP · {m.scope.toUpperCase()}
                                                                        </div>
                                                                    </div>
                                                                    <Chip size="sm" status={m.completed ? "ok" : "off"}>
                                                                        {m.completed ? "COMPLETE" : `${m.progress}/${m.target}`}
                                                                    </Chip>
                                                                </div>
                                                                <div className="w-full h-1.5 rounded-full bg-white/10 overflow-hidden">
                                                                    <div
                                                                        className="h-full bg-cyan-400 rounded-full transition-all"
                                                                        style={{ width: `${pct}%` }}
                                                                    />
                                                                </div>
                                                            </div>
                                                        );
                                                    })
                                                )}
                                            </div>
                                        </div>
                                    )}

                                    {/* 4. TREASURY TAB */}
                                    {activeTab === "treasury" && (
                                        <div className="space-y-4 text-ludo-xs font-mono">
                                            <div className="p-5 rounded-2xl bg-white/[0.04] border border-cyan-500/30 flex flex-wrap items-center justify-between gap-3">
                                                <div>
                                                    <div className="text-white/50">Clan Treasury Balance</div>
                                                    <div className="text-ludo-lg font-bold text-cyan-300 font-mono">
                                                        {Number(clan.treasury_balance).toLocaleString()} CHIPS
                                                    </div>
                                                </div>
                                                <Button
                                                    variant="secondary"
                                                    size="sm"
                                                    onClick={() => setIsFundingTreasury((v) => !v)}
                                                >
                                                    {isFundingTreasury ? "Close" : "+ Fund Treasury"}
                                                </Button>
                                            </div>

                                            {isFundingTreasury && (
                                                <form onSubmit={handleFundTreasurySubmit} className="p-4 rounded-2xl bg-white/[0.04] border border-cyan-500/20 space-y-3">
                                                    <div className="flex flex-wrap gap-1.5">
                                                        {TREASURY_PRESETS.map((preset) => (
                                                            <button
                                                                key={preset}
                                                                type="button"
                                                                onClick={() => setFundAmountInput(String(preset))}
                                                                className={`px-2.5 py-1 rounded-lg border font-bold ${
                                                                    Number(fundAmountInput) === preset
                                                                        ? "bg-cyan-500/20 border-cyan-400 text-cyan-300"
                                                                        : "bg-white/5 border-white/10 text-white/60"
                                                                }`}
                                                            >
                                                                {preset.toLocaleString()}
                                                            </button>
                                                        ))}
                                                    </div>
                                                    <div className="flex gap-2">
                                                        <input
                                                            type="number"
                                                            min={1}
                                                            step={1}
                                                            value={fundAmountInput}
                                                            onChange={(e) => setFundAmountInput(e.target.value)}
                                                            className="flex-1 min-w-0 px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-white focus:outline-none focus:border-cyan-400"
                                                        />
                                                        <Button type="submit" variant="primary" size="sm" disabled={fundSubmitting}>
                                                            {fundSubmitting ? "Depositing..." : "Deposit CHIPS"}
                                                        </Button>
                                                    </div>
                                                </form>
                                            )}

                                            <div className="space-y-2">
                                                <h4 className="font-bold text-white/60 uppercase">Treasury Ledger</h4>
                                                {treasuryLedger.length === 0 ? (
                                                    <div className="p-4 rounded-xl bg-white/[0.04] border border-white/10 text-white/40 text-center">
                                                        No treasury transactions recorded yet. Win clan wars or donate CHIPS to build your war chest.
                                                    </div>
                                                ) : (
                                                    <div className="space-y-2 max-h-[260px] overflow-y-auto">
                                                        {treasuryLedger.map((entry) => (
                                                            <div
                                                                key={entry.id}
                                                                className="p-3 rounded-xl bg-white/[0.04] border border-white/10 flex items-center justify-between gap-2"
                                                            >
                                                                <div className="min-w-0">
                                                                    <div className="font-bold text-white uppercase">{entry.reason.replace("_", " ")}</div>
                                                                    <div className="text-white/40 truncate">
                                                                        {new Date(entry.created_at).toLocaleDateString()} {entry.ref ? `· ${entry.ref.slice(0, 18)}` : ""}
                                                                    </div>
                                                                </div>
                                                                <span className={`font-bold shrink-0 ${Number(entry.amount) >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                                                                    {Number(entry.amount) >= 0 ? "+" : ""}
                                                                    {Number(entry.amount).toLocaleString()} CHIPS
                                                                </span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    )}

                                    {/* 5. MEMBERS TAB */}
                                    {activeTab === "members" && (
                                        <div className="space-y-4">
                                            <div className="flex items-center justify-between text-ludo-xs font-mono text-white/50">
                                                <span>Roster ({members.length || clan.member_count}/{levelConfig?.member_cap ?? 20})</span>
                                                <div className="flex items-center gap-3">
                                                    {isOfficer && (
                                                        <button
                                                            type="button"
                                                            onClick={openSettingsModal}
                                                            className="text-cyan-300 hover:underline flex items-center gap-1"
                                                        >
                                                            <SettingsGearIcon className="w-3.5 h-3.5" />
                                                            <span>Settings</span>
                                                        </button>
                                                    )}
                                                    <button
                                                        onClick={() => void leaveClan().catch((e) => showErr(e, "Failed to leave clan"))}
                                                        className="text-red-400 hover:underline"
                                                    >
                                                        Leave Clan
                                                    </button>
                                                </div>
                                            </div>

                                            {/* Pending Join Requests (Officers/Commander only) */}
                                            {isOfficer && joinRequests.length > 0 && (
                                                <div className="space-y-2 p-3 rounded-2xl bg-cyan-500/10 border border-cyan-500/30">
                                                    <div className="text-ludo-xs font-mono font-bold text-cyan-300 uppercase">
                                                        Pending Applications ({joinRequests.length})
                                                    </div>
                                                    {joinRequests.map((req) => (
                                                        <div
                                                            key={req.id}
                                                            className="p-2.5 rounded-xl bg-white/[0.04] border border-white/10 flex items-center justify-between gap-2 text-ludo-xs font-mono"
                                                        >
                                                            <div className="min-w-0">
                                                                <div className="font-bold text-white truncate">
                                                                    {req.player?.username || shortHex(req.wallet_address)}
                                                                </div>
                                                                <div className="text-white/40">{req.player?.rank_tier || "Unranked"}</div>
                                                            </div>
                                                            <div className="flex items-center gap-1.5 shrink-0">
                                                                <button
                                                                    type="button"
                                                                    onClick={() =>
                                                                        void reviewRequest(clan.id, req.wallet_address, "accept").catch((e) =>
                                                                            showErr(e, "Failed to accept"),
                                                                        )
                                                                    }
                                                                    className="px-2.5 py-1 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 font-bold"
                                                                >
                                                                    Accept
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    onClick={() =>
                                                                        void reviewRequest(clan.id, req.wallet_address, "reject").catch((e) =>
                                                                            showErr(e, "Failed to reject"),
                                                                        )
                                                                    }
                                                                    className="px-2.5 py-1 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400"
                                                                >
                                                                    Reject
                                                                </button>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}

                                            <div className="space-y-2 max-h-[360px] overflow-y-auto">
                                                {members.length === 0 ? (
                                                    <div className="p-3 rounded-xl bg-white/[0.04] border border-white/10 flex items-center justify-between text-ludo-xs font-mono">
                                                        <div className="flex items-center gap-3">
                                                            <div className="w-8 h-8 rounded-lg bg-cyan-500/20 text-cyan-400 flex items-center justify-center font-bold">
                                                                <CrownIcon className="w-4 h-4" />
                                                            </div>
                                                            <div>
                                                                <div className="font-bold text-white">{shortHex(clan.leader_wallet)}</div>
                                                                <div className="text-cyan-400 text-ludo-xs">COMMANDER</div>
                                                            </div>
                                                        </div>
                                                        <span className="text-white/40">Leader</span>
                                                    </div>
                                                ) : (
                                                    members.map((m) => (
                                                        <div
                                                            key={m.id}
                                                            className="p-3 rounded-xl bg-white/[0.04] border border-white/10 flex items-center justify-between text-ludo-xs font-mono gap-2"
                                                        >
                                                            <div className="flex items-center gap-3 min-w-0">
                                                                <div className="w-8 h-8 rounded-lg bg-cyan-500/10 text-cyan-400 flex items-center justify-center font-bold shrink-0">
                                                                    {m.role === "commander" ? (
                                                                        <CrownIcon className="w-4 h-4" />
                                                                    ) : m.role === "officer" ? (
                                                                        <StarIcon className="w-4 h-4" />
                                                                    ) : (
                                                                        <ShieldIcon className="w-4 h-4" />
                                                                    )}
                                                                </div>
                                                                <div className="min-w-0">
                                                                    <div className="font-bold text-white truncate">
                                                                        {m.player?.username || shortHex(m.wallet_address)}
                                                                    </div>
                                                                    <div className="text-cyan-400 text-ludo-xs uppercase">
                                                                        {m.role} · {m.war_points} WP · {m.weekly_cxp} wCXP
                                                                    </div>
                                                                </div>
                                                            </div>

                                                            <div className="flex items-center gap-1.5 shrink-0">
                                                                {isCommander && m.wallet_address.toLowerCase() !== clan.leader_wallet.toLowerCase() && (
                                                                    <>
                                                                        <button
                                                                            onClick={() =>
                                                                                void updateRole(
                                                                                    m.wallet_address,
                                                                                    m.role === "officer" ? "member" : "officer",
                                                                                ).catch((e) => showErr(e, "Failed to update role"))
                                                                            }
                                                                            className="px-2 py-1 rounded bg-white/5 hover:bg-white/10 text-white/70 hover:text-white"
                                                                        >
                                                                            {m.role === "officer" ? "Demote" : "Promote"}
                                                                        </button>
                                                                        <button
                                                                            onClick={() =>
                                                                                void kickMember(m.wallet_address).catch((e) =>
                                                                                    showErr(e, "Failed to kick member"),
                                                                                )
                                                                            }
                                                                            className="px-2 py-1 rounded bg-red-500/10 hover:bg-red-500/20 text-red-400"
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
                    </div>
                </div>
            </div>

            {/* ── Modal: Create Clan ──────────────────────────────────────── */}
            {isCreatingClan && (
                <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/50 backdrop-blur-md">
                    <div
                        className="ludo-clan-scope panel-shell-3077 relative w-full max-w-md p-6 rounded-[28px] border border-white/10 shadow-2xl space-y-4 text-white font-sans overflow-hidden"
                        style={{
                            background: "var(--panel-bg-image, var(--ludo-bg-cosmic))",
                            backgroundColor: "var(--panel-bg, rgba(13, 13, 13, 0.96))",
                        }}
                    >
                        <h3 className="text-ludo-lg font-bold text-white">Create Tactical Clan</h3>
                        <div className="p-3 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-ludo-xs font-mono text-cyan-300">
                            Clan creation fee: <strong>10,000 CHIPS</strong>, verified pre-flight before transferring to the protocol treasury on Base Sepolia.
                        </div>

                        {createError && (
                            <div className="p-2.5 rounded-xl bg-red-500/10 border border-red-500/20 text-ludo-xs font-mono text-red-400">
                                {createError}
                            </div>
                        )}

                        <form onSubmit={handleCreateClanSubmit} className="space-y-3 font-mono text-ludo-xs">
                            <div className="flex items-center gap-3 p-2.5 rounded-xl bg-white/[0.04] border border-white/10">
                                <ClanCrestBadge
                                    crest={{
                                        emblem: createEmblem,
                                        primary: CREST_PALETTES[createPaletteIdx].primary,
                                        secondary: CREST_PALETTES[createPaletteIdx].secondary,
                                    }}
                                    tag={createTag || "TAG"}
                                    size="lg"
                                />
                                <div className="flex-1 space-y-1.5">
                                    <div className="flex gap-1.5">
                                        {CREST_EMBLEMS.map((em) => (
                                            <button
                                                key={em}
                                                type="button"
                                                onClick={() => setCreateEmblem(em)}
                                                className={`px-2 py-1 rounded border capitalize ${
                                                    createEmblem === em
                                                        ? "border-cyan-400 bg-cyan-500/20 text-cyan-300"
                                                        : "border-white/10 bg-white/5 text-white/50"
                                                }`}
                                            >
                                                {em}
                                            </button>
                                        ))}
                                    </div>
                                    <div className="flex gap-2">
                                        {CREST_PALETTES.map((pal, idx) => (
                                            <button
                                                key={pal.label}
                                                type="button"
                                                onClick={() => setCreatePaletteIdx(idx)}
                                                className={`w-5 h-5 rounded-full border-2 ${
                                                    createPaletteIdx === idx ? "border-white scale-110" : "border-transparent opacity-70"
                                                }`}
                                                style={{ backgroundColor: pal.primary }}
                                                aria-label={pal.label}
                                            />
                                        ))}
                                    </div>
                                </div>
                            </div>

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
                                    autoComplete="off"
                                    autoCorrect="off"
                                    autoCapitalize="none"
                                    spellCheck={false}
                                    className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-white placeholder:text-white/25 focus:outline-none focus:border-cyan-400"
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
                                    autoComplete="off"
                                    autoCorrect="off"
                                    autoCapitalize="none"
                                    spellCheck={false}
                                    className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-white placeholder:text-white/25 focus:outline-none focus:border-cyan-400 uppercase"
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
                                    autoComplete="off"
                                    autoCorrect="off"
                                    autoCapitalize="none"
                                    spellCheck={false}
                                    className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-white placeholder:text-white/25 focus:outline-none focus:border-cyan-400"
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
                                    {createSubmitting ? "Checking & Approving..." : "Forge Clan (10,000)"}
                                </Button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* ── Modal: Post War Notice ─────────────────────────────────── */}
            {isPostingNotice && (
                <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/50 backdrop-blur-md">
                    <div
                        className="ludo-clan-scope panel-shell-3077 relative w-full max-w-md p-6 rounded-[28px] border border-amber-500/40 shadow-2xl space-y-4 text-white font-sans overflow-hidden"
                        style={{
                            background: "var(--panel-bg-image, var(--ludo-bg-cosmic))",
                            backgroundColor: "var(--panel-bg, rgba(13, 13, 13, 0.96))",
                        }}
                    >
                        <h3 className="text-ludo-lg font-bold text-white">Call to Arms: Post War Notice</h3>
                        <form onSubmit={handlePostNoticeSubmit} className="space-y-4 font-mono text-ludo-xs">
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

                            <div className="grid grid-cols-2 gap-2">
                                <div>
                                    <label className="text-white/60 block mb-1">Member Entry Fee</label>
                                    <input
                                        type="number"
                                        min={500}
                                        step={500}
                                        value={noticeFee}
                                        onChange={(e) => setNoticeFee(Number(e.target.value))}
                                        className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-white focus:outline-none focus:border-amber-400"
                                    />
                                </div>
                                <div>
                                    <label className="text-white/60 block mb-1">Treasury Subsidy</label>
                                    <input
                                        type="number"
                                        min={0}
                                        max={Number(clan?.treasury_balance || 0)}
                                        step={100}
                                        value={noticeSubsidy}
                                        onChange={(e) => setNoticeSubsidy(Number(e.target.value))}
                                        className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-white focus:outline-none focus:border-amber-400"
                                    />
                                </div>
                            </div>

                            <div className="text-white/60">
                                Target War Pot: <strong className="text-amber-300">{(noticeBracket * noticeFee).toLocaleString()} CHIPS</strong> ({noticeBracket * 3} fixtures)
                            </div>

                            <div className="p-3 rounded-xl bg-white/[0.04] border border-white/10 space-y-2">
                                <div className="flex items-center justify-between">
                                    <span className="text-white/40 font-bold">20% Governance Split</span>
                                    <span className={isSplitValid ? "text-emerald-400 font-bold" : "text-red-400 font-bold"}>
                                        Sum: {splitSum}% {isSplitValid ? "OK" : "(Must equal 100%)"}
                                    </span>
                                </div>
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
                                        <label className="text-white/60 block">Leader (max 50%): {splitLeader}%</label>
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
                                        <label className="text-white/60 block">Officers (max 50%): {splitOfficers}%</label>
                                        <input
                                            type="range"
                                            min={0}
                                            max={50}
                                            value={splitOfficers}
                                            onChange={(e) => setSplitOfficers(Number(e.target.value))}
                                            className="w-full accent-cyan-400"
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
                                    disabled={noticeSubmitting || !isSplitValid}
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
                <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/50 backdrop-blur-md">
                    <div
                        className="ludo-clan-scope panel-shell-3077 relative w-full max-w-lg max-h-[80vh] flex flex-col p-6 rounded-[28px] border border-white/10 shadow-2xl space-y-4 text-white font-sans overflow-hidden"
                        style={{
                            background: "var(--panel-bg-image, var(--ludo-bg-cosmic))",
                            backgroundColor: "var(--panel-bg, rgba(13, 13, 13, 0.96))",
                        }}
                    >
                        <div className="flex items-center justify-between gap-2">
                            <h3 className="text-ludo-lg font-bold text-white">Open War Board</h3>
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => setShowWarBoard(false)}
                                aria-label="Close Open War Board"
                                className="bg-surface-recessed border border-line-soft shrink-0"
                            >
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                                    <line x1="18" y1="6" x2="6" y2="18" />
                                    <line x1="6" y1="6" x2="18" y2="18" />
                                </svg>
                            </Button>
                        </div>

                        <div className="panel-body-3077 flex-1 overflow-y-auto space-y-3">
                            {warBoard.filter((c) => c.clan_id !== clan?.id).length === 0 ? (
                                <div className="py-12 text-center text-white/40 font-mono text-ludo-xs">
                                    No other clans currently searching in this bracket. Your notice is listed for other clans to match!
                                </div>
                            ) : (
                                warBoard
                                    .filter((c) => c.clan_id !== clan?.id)
                                    .map((c) => (
                                        <div
                                            key={c.id}
                                            className="p-3.5 rounded-xl bg-white/[0.04] border border-white/10 flex flex-wrap items-center justify-between gap-3 text-ludo-xs font-mono"
                                        >
                                            <div className="flex items-center gap-3">
                                                <ClanCrestBadge crest={c.clan?.crest} tag={c.clan?.tag} size="md" />
                                                <div>
                                                    <div className="font-bold text-white text-ludo-sm">
                                                        {c.clan?.name} <span className="text-cyan-400">[{c.clan?.tag}]</span>
                                                    </div>
                                                    <div className="text-white/50">
                                                        {c.bracket}v{c.bracket} • Stake: {Number(c.total_stake).toLocaleString()} CHIPS • CWR: {c.clan?.cwr}
                                                    </div>
                                                </div>
                                            </div>

                                            <button
                                                disabled={matchingCallId === c.id}
                                                onClick={() => void handleMatchOpponent(c.id)}
                                                className="px-4 py-2 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-300 font-bold transition-all"
                                            >
                                                {matchingCallId === c.id ? "Matching..." : "Match Clan"}
                                            </button>
                                        </div>
                                    ))
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* ── Modal: Propose Fixture Time ───────────────────────────── */}
            {schedulingFixture && (
                <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/50 backdrop-blur-md">
                    <div
                        className="ludo-clan-scope panel-shell-3077 relative w-full max-w-sm p-6 rounded-[28px] border border-white/10 shadow-2xl space-y-4 text-white font-sans overflow-hidden"
                        style={{
                            background: "var(--panel-bg-image, var(--ludo-bg-cosmic))",
                            backgroundColor: "var(--panel-bg, rgba(13, 13, 13, 0.96))",
                        }}
                    >
                        <h3 className="text-ludo-lg font-bold text-white">
                            Schedule Fixture #{schedulingFixture.fixture_index}
                        </h3>
                        <form onSubmit={handleProposeSchedule} className="space-y-3 font-mono text-ludo-xs">
                            <div>
                                <label className="text-white/60 block mb-1">Proposed Match Time (Local)</label>
                                <input
                                    type="datetime-local"
                                    required
                                    value={scheduleTimeInput}
                                    onChange={(e) => setScheduleTimeInput(e.target.value)}
                                    className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-white focus:outline-none focus:border-cyan-400"
                                />
                            </div>
                            <div className="flex gap-2 pt-2">
                                <Button type="button" variant="secondary" size="md" onClick={() => setSchedulingFixture(null)} className="flex-1">
                                    Cancel
                                </Button>
                                <Button type="submit" variant="primary" size="md" disabled={scheduleSubmitting} className="flex-1">
                                    {scheduleSubmitting ? "Sending..." : "Send Proposal"}
                                </Button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* ── Modal: Clan Settings ───────────────────────────────────── */}
            {isEditingSettings && (
                <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/50 backdrop-blur-md">
                    <div
                        className="ludo-clan-scope panel-shell-3077 relative w-full max-w-md p-6 rounded-[28px] border border-white/10 shadow-2xl space-y-4 text-white font-sans overflow-hidden"
                        style={{
                            background: "var(--panel-bg-image, var(--ludo-bg-cosmic))",
                            backgroundColor: "var(--panel-bg, rgba(13, 13, 13, 0.96))",
                        }}
                    >
                        <h3 className="text-ludo-lg font-bold text-white">Clan Settings</h3>
                        <form onSubmit={handleSaveSettings} className="space-y-3 font-mono text-ludo-xs">
                            <div>
                                <label className="text-white/60 block mb-1">Join Policy</label>
                                <div className="grid grid-cols-3 gap-2">
                                    {(["open", "request", "invite_only"] as ClanJoinPolicy[]).map((p) => (
                                        <button
                                            key={p}
                                            type="button"
                                            onClick={() => setSettingsPolicy(p)}
                                            className={`py-2 rounded-xl border uppercase font-bold ${
                                                settingsPolicy === p
                                                    ? "border-cyan-400 bg-cyan-500/20 text-cyan-300"
                                                    : "border-white/10 bg-white/5 text-white/50"
                                            }`}
                                        >
                                            {p.replace("_", " ")}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div>
                                <label className="text-white/60 block mb-1">Motto / Bio</label>
                                <input
                                    type="text"
                                    maxLength={200}
                                    value={settingsBio}
                                    onChange={(e) => setSettingsBio(e.target.value)}
                                    className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-white focus:outline-none focus:border-cyan-400"
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                                <div>
                                    <label className="text-white/60 block mb-1">Min Player Level</label>
                                    <input
                                        type="number"
                                        min={1}
                                        value={settingsMinLevel}
                                        onChange={(e) => setSettingsMinLevel(Number(e.target.value))}
                                        className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-white focus:outline-none focus:border-cyan-400"
                                    />
                                </div>
                                <div>
                                    <label className="text-white/60 block mb-1">Farcaster Channel</label>
                                    <input
                                        type="text"
                                        maxLength={64}
                                        placeholder="/ludo-clan"
                                        value={settingsChannel}
                                        onChange={(e) => setSettingsChannel(e.target.value)}
                                        className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-white focus:outline-none focus:border-cyan-400"
                                    />
                                </div>
                            </div>
                            <div className="flex gap-2 pt-2">
                                <Button type="button" variant="secondary" size="md" onClick={() => setIsEditingSettings(false)} className="flex-1">
                                    Cancel
                                </Button>
                                <Button type="submit" variant="primary" size="md" disabled={settingsSubmitting} className="flex-1">
                                    {settingsSubmitting ? "Saving..." : "Save Settings"}
                                </Button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </>
    );
}
