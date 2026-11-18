/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useAccount } from "wagmi";
import {
    LuArrowDownLeft,
    LuArrowUpRight,
    LuCalendar,
    LuCheck,
    LuChevronRight,
    LuClock,
    LuCoins,
    LuCrown,
    LuEye,
    LuFlame,
    LuLandmark,
    LuLock,
    LuMessageSquare,
    LuPlay,
    LuPlus,
    LuRadio,
    LuSearch,
    LuSend,
    LuSettings,
    LuShield,
    LuSparkles,
    LuStar,
    LuSwords,
    LuTarget,
    LuTrophy,
    LuUsers,
    LuX,
} from "react-icons/lu";
import { useIsMobileView } from "@/hooks/useIsMobileView";
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
    type CrestEmblem,
} from "./ClanCrestBadge";
import type { Clan, ClanJoinPolicy, ClanWarFixture } from "@/lib/clan/types";
import { ClanDossierContent } from "./clan/ClanDossierContent";
import ClanProfileModal from "./ClanProfileModal";

interface ClanPanelProps {
    isOpen: boolean;
    onClose: () => void;
    onOpenProfile?: (wallet: string) => void;
}

type ClanTab = "profile" | "hall" | "war" | "missions" | "treasury" | "members";

const DIVISIONS = ["All", "Bronze", "Silver", "Gold", "Platinum", "Diamond", "Master"] as const;
const TREASURY_PRESETS = [500, 1000, 5000, 10000] as const;

const DIVISION_BEAM: Record<string, string> = {
    Master: "bg-orange-400 shadow-[0_0_12px_rgba(251,146,60,0.85)]",
    Diamond: "bg-cyan-300 shadow-[0_0_12px_rgba(103,232,249,0.85)]",
    Platinum: "bg-blue-400 shadow-[0_0_12px_rgba(96,165,250,0.85)]",
    Gold: "bg-yellow-400 shadow-[0_0_12px_rgba(250,204,21,0.85)]",
    Silver: "bg-slate-300 shadow-[0_0_12px_rgba(203,213,225,0.85)]",
    Bronze: "bg-amber-600 shadow-[0_0_12px_rgba(217,119,6,0.85)]",
};

function SectionLabel({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
    return (
        <div className="flex items-center gap-2.5">
            <span className="px-2 py-0.5 rounded-md bg-white/[0.07] border border-white/10 text-ludo-xs font-bold tracking-[0.16em] text-white/60 font-mono uppercase">
                {children}
            </span>
            <div className="flex-1 h-px bg-gradient-to-r from-white/15 to-transparent" />
            {right}
        </div>
    );
}

export function ClanPanel({ isOpen, onClose, onOpenProfile }: ClanPanelProps) {
    const isMobile = useIsMobileView();
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
        dossier,
        chatMessages,
        error: clanDataError,
        sendChatMessage,
        createClan,
        fundTreasury,
        renameClan,
        updateCrest,
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

    const [activeTab, setActiveTab] = useState<ClanTab>("profile");
    const [scoutClanTarget, setScoutClanTarget] = useState<string | null>(null);
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
    const [settingsTreasuryPublic, setSettingsTreasuryPublic] = useState(false);
    const [settingsSubmitting, setSettingsSubmitting] = useState(false);

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

    useEffect(() => {
        if (activeTab === "hall" && chatEndRef.current) {
            chatEndRef.current.scrollIntoView({ behavior: "smooth" });
        }
    }, [chatMessages.length, activeTab]);

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

    const isCommander = member?.role === "commander";
    const isOfficer = member?.role === "officer" || isCommander;

    const splitSum = splitStakers + splitTreasury + splitLeader + splitOfficers;
    const isSplitValid = splitSum === 100 && splitLeader <= 50 && splitOfficers <= 50;

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
        setSettingsTreasuryPublic(Boolean(clan.treasury_public));
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
                ...(member?.role === "commander" ? { treasury_public: settingsTreasuryPublic } : {}),
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

    const tabConfig: Array<{
        id: ClanTab;
        label: string;
        icon: React.ReactNode;
        dot?: "amber" | "cyan";
    }> = [
        { id: "profile", label: "Profile", icon: <LuShield className="w-3.5 h-3.5" /> },
        { id: "hall", label: "Hall", icon: <LuMessageSquare className="w-3.5 h-3.5" /> },
        {
            id: "war",
            label: "War",
            icon: <LuSwords className="w-3.5 h-3.5" />,
            dot: warCall || activeWar ? "amber" : undefined,
        },
        { id: "missions", label: "Missions", icon: <LuTarget className="w-3.5 h-3.5" /> },
        { id: "treasury", label: "Vault", icon: <LuCoins className="w-3.5 h-3.5" /> },
        {
            id: "members",
            label: "Roster",
            icon: <LuUsers className="w-3.5 h-3.5" />,
            dot: isOfficer && joinRequests.length > 0 ? "cyan" : undefined,
        },
    ];

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
                            exit={isMobile ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, y: 20 }}
                            transition={
                                isMobile
                                    ? { duration: 0 }
                                    : { type: "tween", duration: 0.22, ease: [0.22, 1, 0.36, 1] }
                            }
                            className="w-full max-w-[500px] relative h-full pointer-events-auto panel-motion-host"
                        >
                            <div
                                className="ludo-arena-scope ludo-clan-scope absolute top-[64px] bottom-[80px] left-[8px] right-[8px] border border-white/10 rounded-[32px] flex flex-col shadow-2xl overflow-hidden text-white font-sans"
                                style={{
                                    backgroundImage: "var(--panel-bg-image, var(--ludo-bg-cosmic))",
                                    backgroundColor: "var(--panel-bg, rgba(11, 15, 23, 0.96))",
                                    backdropFilter: "blur(32px)",
                                }}
                            >
                                {/* Authentic Subdued Cosmic Orbs */}
                                <div className="absolute top-[-20%] left-[-20%] w-full h-full cosmic-orb cosmic-orb-1 opacity-20 scale-150 pointer-events-none" />
                                <div className="absolute bottom-[-20%] right-[-20%] w-full h-full cosmic-orb cosmic-orb-2 opacity-15 scale-150 pointer-events-none" />

                                {/* Drag Handle */}
                                <div className="w-full flex justify-center pt-2 pb-1 relative z-10 shrink-0">
                                    <div className="w-12 h-1.5 bg-white/20 rounded-full" />
                                </div>

                                {/* ── Top Syndicate Header ──────────────────────────────────── */}
                                <div className="px-5 pb-3 pt-1 border-b border-white/10 relative z-10 shrink-0 space-y-2.5">
                                    <div className="flex items-center justify-between gap-2">
                                        <div className="flex items-center gap-3 min-w-0">
                                            {clan ? (
                                                <ClanCrestBadge crest={clan.crest} tag={clan.tag} size="md" />
                                            ) : (
                                                <div className="w-10 h-10 rounded-xl bg-accent-soft border border-cyan-400/40 flex items-center justify-center text-cyan-300 shrink-0 shadow-[0_0_16px_rgba(34,211,238,0.25)]">
                                                    <LuShield className="w-5 h-5" />
                                                </div>
                                            )}
                                            <div className="min-w-0">
                                                <div className="flex items-center gap-2 min-w-0">
                                                    <h2 className="text-ludo-lg font-bold tracking-wide text-white truncate">
                                                        {clan ? clan.name : "Tactical Clans"}
                                                    </h2>
                                                    {clan && (
                                                        <span className="px-2 py-0.5 rounded-md bg-accent-soft text-cyan-300 font-mono text-ludo-xs font-bold border border-cyan-400/35 shrink-0">
                                                            [{clan.tag}]
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="flex items-center gap-2 text-ludo-xs font-mono text-white/60 mt-0.5">
                                                    {clan ? (
                                                        <>
                                                            <span className="inline-flex items-center gap-1 text-cyan-300 font-bold">
                                                                <LuStar className="w-3 h-3" />
                                                                LVL {clan.level}
                                                            </span>
                                                            <span className="text-white/25">•</span>
                                                            <span className="inline-flex items-center gap-1">
                                                                <LuTrophy className="w-3 h-3 text-amber-400" />
                                                                {clan.division}
                                                            </span>
                                                            <span className="text-white/25">•</span>
                                                            <span className="inline-flex items-center gap-1">
                                                                <LuUsers className="w-3 h-3 text-white/50" />
                                                                {clan.member_count}/{levelConfig?.member_cap ?? 20}
                                                            </span>
                                                        </>
                                                    ) : (
                                                        <span className="truncate">On-chain syndicates, 2v2 squads &amp; wars</span>
                                                    )}
                                                </div>
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-2 shrink-0">
                                            {totalClaimableChips > 0 && (
                                                <button
                                                    onClick={() => void claimAll().catch((e) => showErr(e, "Claim failed"))}
                                                    disabled={isClaimingAll}
                                                    className="px-2.5 py-1.5 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-400/40 text-emerald-300 font-mono text-ludo-xs font-bold flex items-center gap-1.5 transition-all"
                                                >
                                                    <LuCoins className="w-3.5 h-3.5 text-emerald-300" />
                                                    <span>{totalClaimableChips.toLocaleString()}</span>
                                                </button>
                                            )}

                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                onClick={onClose}
                                                aria-label="Close Tactical Clans panel"
                                                className="bg-surface-hover border border-line-soft shrink-0"
                                            >
                                                <LuX className="icon-md" />
                                            </Button>
                                        </div>
                                    </div>

                                    {/* Dedicated CXP Progress Row (zero overlap) */}
                                    {clan && (
                                        <div className="flex items-center gap-2.5">
                                            <span className="text-ludo-xs font-mono font-bold text-cyan-300 uppercase tracking-wider shrink-0">
                                                CXP
                                            </span>
                                            <div className="flex-1 h-1.5 rounded-full bg-black/50 border border-white/10 overflow-hidden">
                                                <div
                                                    className="h-full rounded-full transition-all"
                                                    style={{
                                                        width: `${cxpPct}%`,
                                                        backgroundColor: clan.crest?.primary || "#22d3ee",
                                                    }}
                                                />
                                            </div>
                                            <span className="text-ludo-xs font-mono text-white/60 tabular-nums shrink-0">
                                                {nextLevelTarget
                                                    ? `${clan.cxp.toLocaleString()} / ${nextLevelTarget.toLocaleString()}`
                                                    : `${clan.cxp.toLocaleString()} MAX`}
                                            </span>
                                        </div>
                                    )}
                                </div>

                                {/* Inline Feedback Banner */}
                                {(bannerError || actionSuccess) && (
                                    <div className="px-5 pt-3 relative z-10 shrink-0">
                                        <div
                                            className={`px-3 py-2 rounded-xl border text-ludo-xs font-mono flex items-center justify-between gap-2 ${
                                                bannerError
                                                    ? "bg-red-500/15 border-red-500/35 text-red-200"
                                                    : "bg-emerald-500/15 border-emerald-500/35 text-emerald-200"
                                            }`}
                                        >
                                            <span className="break-words">{bannerError || actionSuccess}</span>
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setActionError(null);
                                                    setActionSuccess(null);
                                                }}
                                                className="text-white/60 hover:text-white shrink-0"
                                                aria-label="Dismiss message"
                                            >
                                                <LuX className="w-3.5 h-3.5" />
                                            </button>
                                        </div>
                                    </div>
                                )}

                                {/* ── Main Body ──────────────────────────────────────────────── */}
                                {!clan ? (
                                    /* ── NOT IN A CLAN: Syndicate Directory & Forge ─────────── */
                                    <div className="flex-1 overflow-y-auto no-scrollbar p-5 space-y-4 relative z-10">
                                        {/* Forge Hero Card */}
                                        <div className="p-4 rounded-2xl bg-white/[0.04] border border-cyan-400/30 flex items-center justify-between gap-3 shadow-[0_0_24px_rgba(34,211,238,0.1)]">
                                            <div className="flex items-center gap-3 min-w-0">
                                                <div className="w-11 h-11 rounded-2xl bg-accent-soft border border-cyan-400/40 flex items-center justify-center text-cyan-300 shrink-0">
                                                    <LuSparkles className="w-5 h-5" />
                                                </div>
                                                <div className="min-w-0">
                                                    <div className="text-ludo-sm font-bold text-white truncate">
                                                        Launch Your Syndicate
                                                    </div>
                                                    <div className="text-ludo-xs font-mono text-white/55 truncate">
                                                        10,000 CHIPS · Wars, Vaults &amp; 50 Seats
                                                    </div>
                                                </div>
                                            </div>
                                            <Button
                                                variant="primary"
                                                size="sm"
                                                onClick={() => {
                                                    setCreateError(null);
                                                    setIsCreatingClan(true);
                                                }}
                                                className="shrink-0 font-bold tracking-wider"
                                            >
                                                <LuPlus className="w-4 h-4 mr-1" />
                                                Forge
                                            </Button>
                                        </div>

                                        {/* Search + Division Filters */}
                                        <div className="space-y-2.5">
                                            <div className="flex items-center gap-2 bg-black/45 border border-white/10 rounded-xl px-3 h-10 focus-within:border-cyan-400/60 transition-colors">
                                                <LuSearch className="w-4 h-4 text-white/40 shrink-0" />
                                                <input
                                                    type="text"
                                                    placeholder="Search syndicates by name or tag..."
                                                    value={searchQuery}
                                                    onChange={(e) => setSearchQuery(e.target.value)}
                                                    autoComplete="off"
                                                    autoCorrect="off"
                                                    autoCapitalize="none"
                                                    spellCheck={false}
                                                    className="flex-1 min-w-0 bg-transparent border-0 text-white placeholder:text-white/30 text-ludo-sm focus:outline-none font-mono"
                                                />
                                                {searchQuery && (
                                                    <button
                                                        type="button"
                                                        onClick={() => setSearchQuery("")}
                                                        className="text-white/40 hover:text-white"
                                                        aria-label="Clear search"
                                                    >
                                                        <LuX className="w-3.5 h-3.5" />
                                                    </button>
                                                )}
                                            </div>

                                            <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
                                                {DIVISIONS.map((div) => (
                                                    <button
                                                        key={div}
                                                        type="button"
                                                        onClick={() => setDivisionFilter(div)}
                                                        className={`px-2.5 py-1 rounded-lg font-mono text-ludo-xs font-bold border shrink-0 transition-colors ${
                                                            divisionFilter === div
                                                                ? "bg-accent-soft border-cyan-400/60 text-cyan-300"
                                                                : "bg-white/[0.04] border-white/10 text-white/50 hover:text-white"
                                                        }`}
                                                    >
                                                        {div}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>

                                        <SectionLabel right={<span className="text-ludo-xs font-mono text-white/40">{discoveredClans.length} found</span>}>
                                            Active Syndicates
                                        </SectionLabel>

                                        <div className="grid grid-cols-1 gap-3">
                                            {isSearching ? (
                                                <div className="py-12 flex flex-col items-center justify-center text-white/40 gap-3">
                                                    <ThinkingOrb state="solving" size={32} />
                                                    <span className="font-mono text-ludo-xs">Scanning On-Chain Syndicates...</span>
                                                </div>
                                            ) : discoveredClans.length === 0 ? (
                                                <div className="py-10 text-center text-white/45 font-mono text-ludo-sm rounded-2xl bg-white/[0.03] border border-white/10">
                                                    No clans match your filter. Forge the first one!
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
                                                    const beamClass = DIVISION_BEAM[c.division] ?? DIVISION_BEAM.Bronze;
                                                    return (
                                                        <div
                                                            key={c.id}
                                                            className="relative pl-4 pr-3.5 py-3.5 rounded-2xl bg-white/[0.04] border border-white/10 hover:border-cyan-400/40 transition-all flex flex-col gap-2.5 overflow-hidden"
                                                        >
                                                            <div className={`absolute left-0 top-3 bottom-3 w-[3px] rounded-full ${beamClass}`} />

                                                            <div className="flex items-start justify-between gap-2">
                                                                <button
                                                                    type="button"
                                                                    onClick={() => setScoutClanTarget(c.id)}
                                                                    className="flex items-center gap-3 min-w-0 text-left group"
                                                                >
                                                                    <ClanCrestBadge crest={c.crest} tag={c.tag} size="md" />
                                                                    <div className="min-w-0">
                                                                        <div className="flex items-center gap-2">
                                                                            <span className="font-bold text-white text-ludo-md truncate group-hover:text-cyan-300 transition-colors">{c.name}</span>
                                                                            <span className="text-ludo-xs font-mono text-cyan-300 shrink-0">[{c.tag}]</span>
                                                                        </div>
                                                                        <div className="flex items-center gap-2 text-ludo-xs text-white/55 font-mono mt-0.5">
                                                                            <span>LVL {c.level}</span>
                                                                            <span>•</span>
                                                                            <span>{c.division}</span>
                                                                            <span>•</span>
                                                                            <span className="inline-flex items-center gap-1">
                                                                                <LuUsers className="w-3 h-3" />
                                                                                {c.member_count}
                                                                            </span>
                                                                        </div>
                                                                    </div>
                                                                </button>
                                                                <Chip size="sm" status={policyStatus}>
                                                                    {policyLabel}
                                                                </Chip>
                                                            </div>

                                                            {c.bio && (
                                                                <p className="text-ludo-xs text-white/60 line-clamp-2 italic">
                                                                    &ldquo;{c.bio}&rdquo;
                                                                </p>
                                                            )}

                                                            <div className="flex items-center justify-between pt-2 border-t border-white/10 gap-2">
                                                                <span className="inline-flex items-center gap-1.5 text-ludo-xs font-mono text-amber-300 font-bold">
                                                                    <LuTrophy className="w-3.5 h-3.5" />
                                                                    {c.cwr} CWR
                                                                </span>
                                                                <div className="flex items-center gap-1.5">
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => setScoutClanTarget(c.id)}
                                                                        className="px-2.5 py-1.5 rounded-xl border border-white/15 bg-white/5 hover:bg-white/10 text-white/80 font-mono text-ludo-xs font-bold uppercase inline-flex items-center gap-1 transition-all"
                                                                    >
                                                                        <LuEye className="w-3 h-3" />
                                                                        <span>Scout</span>
                                                                    </button>
                                                                    <button
                                                                        disabled={isInviteOnly || joiningClanId === c.id}
                                                                        onClick={() => void handleJoinClan(c.id)}
                                                                        className={`px-3.5 py-1.5 rounded-xl border font-mono text-ludo-xs font-bold uppercase inline-flex items-center gap-1.5 transition-all ${
                                                                            isInviteOnly
                                                                                ? "bg-white/5 border-white/10 text-white/30 cursor-not-allowed"
                                                                                : "bg-accent-soft hover:bg-cyan-400/25 border-cyan-400/45 text-cyan-200"
                                                                        }`}
                                                                    >
                                                                    {isInviteOnly ? (
                                                                        <>
                                                                            <LuLock className="w-3 h-3" />
                                                                            <span>Invite Only</span>
                                                                        </>
                                                                    ) : (
                                                                        <>
                                                                            <span>
                                                                                {joiningClanId === c.id
                                                                                    ? "Joining..."
                                                                                    : c.join_policy === "open"
                                                                                      ? "Join Clan"
                                                                                      : "Apply"}
                                                                            </span>
                                                                            <LuChevronRight className="w-3.5 h-3.5" />
                                                                        </>
                                                                    )}
                                                                </button>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    );
                                                })
                                            )}
                                        </div>
                                    </div>
                                ) : (
                                    /* ── IN A CLAN: Tactical HUD 5-Tab Layout ───────────────── */
                                    <div className="flex-1 flex flex-col min-h-0 relative z-10">
                                        {/* Segmented Icon Tab Bar */}
                                        <div className="px-4 pt-3 pb-2 shrink-0">
                                            <div className="grid grid-cols-6 gap-1 p-1 rounded-2xl bg-black/50 border border-white/10">
                                                {tabConfig.map((t) => {
                                                    const active = activeTab === t.id;
                                                    return (
                                                        <button
                                                            key={t.id}
                                                            type="button"
                                                            onClick={() => setActiveTab(t.id)}
                                                            className={`relative flex flex-col items-center justify-center gap-1 py-2 px-1 rounded-xl text-ludo-xs font-bold uppercase tracking-wider transition-all ${
                                                                active
                                                                    ? "bg-accent-soft text-white shadow-[inset_0_0_0_1px_rgba(34,211,238,0.5)]"
                                                                    : "text-white/45 hover:text-white/80"
                                                            }`}
                                                        >
                                                            <span className={active ? "text-cyan-300" : ""}>{t.icon}</span>
                                                            <span className="truncate max-w-full">{t.label}</span>
                                                            {t.dot && (
                                                                <span
                                                                    className={`absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full ${
                                                                        t.dot === "amber" ? "bg-amber-400" : "bg-cyan-400"
                                                                    }`}
                                                                />
                                                            )}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </div>

                                        {/* Sub-Tab Viewport */}
                                        <div className="flex-1 overflow-y-auto no-scrollbar px-5 pb-4 pt-1">
                                            {/* 0. PROFILE / DOSSIER DEFAULT TAB */}
                                            {activeTab === "profile" && (
                                                dossier ? (
                                                    <ClanDossierContent
                                                        dossier={dossier}
                                                        mode="account"
                                                        onEditCrest={(crest) => updateCrest(crest)}
                                                        onRenameClan={(p) => renameClan(p)}
                                                        onToggleTreasuryPrivacy={async (nextPublic) => {
                                                            await updateSettings({ treasury_public: nextPublic });
                                                        }}
                                                        onOpenSettings={openSettingsModal}
                                                        onInspectMember={onOpenProfile}
                                                        onInspectClan={(target) => setScoutClanTarget(target)}
                                                        onRefresh={refreshClan}
                                                    />
                                                ) : (
                                                    <div className="py-12 text-center space-y-2">
                                                        <div className="w-7 h-7 rounded-full border-2 border-cyan-400 border-t-transparent animate-spin mx-auto" />
                                                        <div className="text-ludo-xs font-mono text-white/50 uppercase tracking-wider">
                                                            Loading Syndicate Dossier...
                                                        </div>
                                                    </div>
                                                )
                                            )}

                                            {/* 1. HALL TAB */}
                                            {activeTab === "hall" && (
                                                <div className="h-full flex flex-col space-y-3">
                                                    {/* 3-Card Quick Stat HUD */}
                                                    <div className="grid grid-cols-3 gap-2 shrink-0">
                                                        <button
                                                            type="button"
                                                            onClick={() => setActiveTab("war")}
                                                            className="p-2.5 rounded-2xl bg-white/[0.04] border border-white/10 hover:border-amber-400/40 text-left transition-colors"
                                                        >
                                                            <div className="flex items-center gap-1.5 text-ludo-xs font-mono text-amber-300">
                                                                <LuTrophy className="w-3.5 h-3.5" />
                                                                <span>CWR</span>
                                                            </div>
                                                            <div className="text-ludo-md font-bold font-mono text-white mt-0.5 tabular-nums">
                                                                {clan.cwr.toLocaleString()}
                                                            </div>
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => setActiveTab("treasury")}
                                                            className="p-2.5 rounded-2xl bg-white/[0.04] border border-white/10 hover:border-cyan-400/40 text-left transition-colors"
                                                        >
                                                            <div className="flex items-center gap-1.5 text-ludo-xs font-mono text-cyan-300">
                                                                <LuCoins className="w-3.5 h-3.5" />
                                                                <span>VAULT</span>
                                                            </div>
                                                            <div className="text-ludo-md font-bold font-mono text-white mt-0.5 tabular-nums truncate">
                                                                {Number(clan.treasury_balance).toLocaleString()}
                                                            </div>
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => setActiveTab("members")}
                                                            className="p-2.5 rounded-2xl bg-white/[0.04] border border-white/10 hover:border-emerald-400/40 text-left transition-colors"
                                                        >
                                                            <div className="flex items-center gap-1.5 text-ludo-xs font-mono text-emerald-300">
                                                                <LuUsers className="w-3.5 h-3.5" />
                                                                <span>SQUAD</span>
                                                            </div>
                                                            <div className="text-ludo-md font-bold font-mono text-white mt-0.5 tabular-nums">
                                                                {clan.member_count}/{levelConfig?.member_cap ?? 20}
                                                            </div>
                                                        </button>
                                                    </div>

                                                    {/* Active War Banner */}
                                                    {(warCall || activeWar) && (
                                                        <div className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-400/35 flex items-center justify-between gap-3 shrink-0">
                                                            <div className="flex items-center gap-3 min-w-0">
                                                                <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-400/40 flex items-center justify-center text-amber-300 shrink-0">
                                                                    <LuSwords className="w-5 h-5" />
                                                                </div>
                                                                <div className="min-w-0">
                                                                    <div className="text-ludo-sm font-bold text-amber-300 truncate">
                                                                        {activeWar
                                                                            ? `ACTIVE WAR: ${activeWar.clan_a_score} – ${activeWar.clan_b_score}`
                                                                            : `WAR CALL: ${warCall!.bracket}v${warCall!.bracket} BRACKET`}
                                                                    </div>
                                                                    <div className="text-ludo-xs font-mono text-white/65 truncate">
                                                                        {activeWar
                                                                            ? `${activeWar.bracket}v${activeWar.bracket} · ${activeWar.status.replace("_", " ").toUpperCase()}`
                                                                            : `${warCall!.member_fee.toLocaleString()} CHIPS · ${stakes.length}/${warCall!.bracket} Locked`}
                                                                    </div>
                                                                </div>
                                                            </div>
                                                            <Button
                                                                variant="secondary"
                                                                size="sm"
                                                                onClick={() => setActiveTab("war")}
                                                                className="text-ludo-xs font-mono uppercase shrink-0"
                                                            >
                                                                War Room
                                                            </Button>
                                                        </div>
                                                    )}

                                                    {/* Live Plaintext Clan Comms */}
                                                    <div className="flex-1 flex flex-col justify-between rounded-2xl bg-black/35 border border-white/10 p-3.5 min-h-[240px]">
                                                        <div className="flex items-center justify-between pb-2 mb-2 border-b border-white/10 shrink-0">
                                                            <span className="inline-flex items-center gap-1.5 text-ludo-xs font-mono font-bold text-cyan-300 uppercase tracking-wider">
                                                                <LuRadio className="w-3.5 h-3.5" />
                                                                Live Syndicate Comms
                                                            </span>
                                                            <span className="text-ludo-xs font-mono text-white/40">
                                                                {chatMessages.length} msgs
                                                            </span>
                                                        </div>

                                                        <div className="chat-thread-scroll flex-1 overflow-y-auto space-y-2.5 pr-1">
                                                            {chatMessages.length === 0 ? (
                                                                <div className="h-full flex flex-col items-center justify-center text-white/35 font-mono text-ludo-xs text-center gap-2 py-8">
                                                                    <LuMessageSquare className="w-6 h-6 text-white/20" />
                                                                    <span>Channel open. Coordinate matches &amp; war tactics here.</span>
                                                                </div>
                                                            ) : (
                                                                chatMessages.map((msg) => {
                                                                    const isMine =
                                                                        address &&
                                                                        msg.wallet_address.toLowerCase() === address.toLowerCase();
                                                                    return (
                                                                        <div
                                                                            key={msg.id}
                                                                            className={`flex flex-col ${isMine ? "items-end" : "items-start"}`}
                                                                        >
                                                                            <div className="flex items-center gap-1.5 text-ludo-xs font-mono mb-0.5 px-1">
                                                                                <span className={isMine ? "text-cyan-300 font-bold" : "text-amber-300 font-bold"}>
                                                                                    {msg.sender_name}
                                                                                </span>
                                                                                <span className="text-white/30">
                                                                                    {new Date(msg.created_at).toLocaleTimeString([], {
                                                                                        hour: "2-digit",
                                                                                        minute: "2-digit",
                                                                                    })}
                                                                                </span>
                                                                            </div>
                                                                            <div
                                                                                className={`max-w-[85%] px-3 py-2 rounded-2xl text-ludo-xs font-mono leading-relaxed break-words border ${
                                                                                    isMine
                                                                                        ? "bg-accent-soft border-cyan-400/35 text-white rounded-tr-sm"
                                                                                        : "bg-white/[0.06] border-white/10 text-white/90 rounded-tl-sm"
                                                                                }`}
                                                                            >
                                                                                {msg.content}
                                                                            </div>
                                                                        </div>
                                                                    );
                                                                })
                                                            )}
                                                            <div ref={chatEndRef} />
                                                        </div>

                                                        <form onSubmit={handleSendMessage} className="mt-3 flex gap-2 pt-2.5 border-t border-white/10 shrink-0">
                                                            <input
                                                                type="text"
                                                                placeholder="Transmit tactical message..."
                                                                value={chatInput}
                                                                onChange={(e) => setChatInput(e.target.value)}
                                                                maxLength={280}
                                                                autoComplete="off"
                                                                autoCorrect="off"
                                                                autoCapitalize="none"
                                                                spellCheck={false}
                                                                className="flex-1 min-w-0 px-3.5 py-2 rounded-xl bg-white/[0.05] border border-white/10 text-white placeholder:text-white/30 text-ludo-xs font-mono focus:outline-none focus:border-cyan-400"
                                                            />
                                                            <Button
                                                                variant="primary"
                                                                size="sm"
                                                                type="submit"
                                                                disabled={sendingChat || !chatInput.trim()}
                                                                className="shrink-0 inline-flex items-center gap-1.5"
                                                            >
                                                                <LuSend className="w-3.5 h-3.5" />
                                                                <span>{sendingChat ? "..." : "Send"}</span>
                                                            </Button>
                                                        </form>
                                                    </div>
                                                </div>
                                            )}

                                            {/* 2. WAR TAB */}
                                            {activeTab === "war" && (
                                                <div className="space-y-4">
                                                    {!warCall && !activeWar ? (
                                                        <div className="py-10 px-4 rounded-2xl bg-white/[0.03] border border-white/10 flex flex-col items-center justify-center text-center space-y-4">
                                                            <div className="w-16 h-16 rounded-2xl bg-amber-500/15 border border-amber-400/35 flex items-center justify-center text-amber-300 shadow-[0_0_24px_rgba(245,158,11,0.2)]">
                                                                <LuSwords className="w-8 h-8" />
                                                            </div>
                                                            <div>
                                                                <h3 className="text-ludo-lg font-bold text-white">War Room Ready</h3>
                                                                <p className="text-ludo-xs font-mono text-white/55 max-w-xs mt-1">
                                                                    Commanders and officers can rally the roster with a stake-backed Call-to-Arms for 1v1 &amp; 2v2 syndicate combat.
                                                                </p>
                                                            </div>
                                                            {isOfficer && (
                                                                <Button
                                                                    variant="primary"
                                                                    size="md"
                                                                    onClick={() => setIsPostingNotice(true)}
                                                                    className="font-bold tracking-wider inline-flex items-center gap-1.5"
                                                                >
                                                                    <LuPlus className="w-4 h-4" />
                                                                    <span>Post War Notice</span>
                                                                </Button>
                                                            )}
                                                        </div>
                                                    ) : warCall && !activeWar ? (
                                                        /* NOTICE / SEARCHING PHASE */
                                                        <div className="space-y-4">
                                                            <div className="p-4 rounded-2xl bg-white/[0.04] border border-amber-400/35 space-y-4">
                                                                <div className="flex flex-wrap items-center justify-between gap-3">
                                                                    <div>
                                                                        <div className="flex items-center gap-2">
                                                                            <Chip size="sm" status={warCall.status === "searching" ? "ok" : "warn"}>
                                                                                {warCall.status === "searching" ? "SEARCHING" : "CALL TO ARMS"}
                                                                            </Chip>
                                                                            <span className="font-mono text-ludo-xs text-white/55">
                                                                                {warCall.bracket}v{warCall.bracket} Bracket
                                                                            </span>
                                                                        </div>
                                                                        <div className="text-ludo-lg font-bold font-mono text-white mt-1.5 flex items-center gap-1.5">
                                                                            <LuCoins className="w-4 h-4 text-amber-300" />
                                                                            <span>
                                                                                {totalCommitted.toLocaleString()} / {(warCall.bracket * warCall.member_fee).toLocaleString()} CHIPS
                                                                            </span>
                                                                        </div>
                                                                    </div>

                                                                    <div className="flex flex-wrap items-center gap-2">
                                                                        {isOfficer && warCall.status === "searching" && (
                                                                            <button
                                                                                onClick={() => {
                                                                                    void fetchWarBoard(warCall.bracket);
                                                                                    setShowWarBoard(true);
                                                                                }}
                                                                                className="px-3 py-2 rounded-xl bg-accent-soft hover:bg-cyan-400/25 border border-cyan-400/40 text-cyan-300 font-mono text-ludo-xs font-bold inline-flex items-center gap-1.5"
                                                                            >
                                                                                <LuSearch className="w-3.5 h-3.5" />
                                                                                <span>War Board</span>
                                                                            </button>
                                                                        )}
                                                                        {isOfficer && (
                                                                            <button
                                                                                onClick={() => void cancelNotice().catch((e) => showErr(e, "Failed to cancel notice"))}
                                                                                className="px-3 py-2 rounded-xl bg-red-500/15 hover:bg-red-500/25 border border-red-400/35 text-red-300 font-mono text-ludo-xs font-bold inline-flex items-center gap-1"
                                                                            >
                                                                                <LuX className="w-3.5 h-3.5" />
                                                                                <span>Cancel</span>
                                                                            </button>
                                                                        )}
                                                                    </div>
                                                                </div>

                                                                {/* Roster Fill Bar */}
                                                                <div className="space-y-1.5">
                                                                    <div className="flex justify-between text-ludo-xs font-mono text-white/60">
                                                                        <span className="inline-flex items-center gap-1">
                                                                            <LuUsers className="w-3.5 h-3.5 text-cyan-300" />
                                                                            Mobilized Roster
                                                                        </span>
                                                                        <span className="font-bold text-white">
                                                                            {stakes.length}/{warCall.bracket} Locked
                                                                        </span>
                                                                    </div>
                                                                    <div className="h-2 rounded-full bg-black/50 border border-white/10 overflow-hidden">
                                                                        <div
                                                                            className="h-full bg-amber-400 rounded-full transition-all"
                                                                            style={{ width: `${Math.min(100, Math.round((stakes.length / warCall.bracket) * 100))}%` }}
                                                                        />
                                                                    </div>
                                                                </div>

                                                                {/* Governance Split Breakdown */}
                                                                <div className="p-3 rounded-xl bg-black/35 border border-white/10 space-y-2.5 text-ludo-xs font-mono">
                                                                    <div className="flex items-center justify-between">
                                                                        <span className="text-white/50">Profit Split (80% Merit / 20% Gov)</span>
                                                                        <span className="text-cyan-300 font-bold">5% Protocol Rake</span>
                                                                    </div>
                                                                    <div className="h-2 rounded-full overflow-hidden flex bg-white/10">
                                                                        <div className="bg-amber-400 h-full" style={{ width: `${warCall.stakers_pct}%` }} />
                                                                        <div className="bg-emerald-400 h-full" style={{ width: `${warCall.treasury_pct}%` }} />
                                                                        <div className="bg-cyan-400 h-full" style={{ width: `${warCall.leader_pct}%` }} />
                                                                        <div className="bg-slate-300 h-full" style={{ width: `${warCall.officers_pct}%` }} />
                                                                    </div>
                                                                    <div className="grid grid-cols-2 gap-2">
                                                                        <div className="flex items-center justify-between">
                                                                            <span className="text-amber-300">Stakers</span>
                                                                            <span className="font-bold text-white">{warCall.stakers_pct}%</span>
                                                                        </div>
                                                                        <div className="flex items-center justify-between">
                                                                            <span className="text-emerald-300">Treasury</span>
                                                                            <span className="font-bold text-white">{warCall.treasury_pct}%</span>
                                                                        </div>
                                                                        <div className="flex items-center justify-between">
                                                                            <span className="text-cyan-300">Leader</span>
                                                                            <span className="font-bold text-white">{warCall.leader_pct}%</span>
                                                                        </div>
                                                                        <div className="flex items-center justify-between">
                                                                            <span className="text-slate-300">Officers</span>
                                                                            <span className="font-bold text-white">{warCall.officers_pct}%</span>
                                                                        </div>
                                                                    </div>
                                                                </div>

                                                                {buyInError && (
                                                                    <div className="p-2.5 rounded-xl bg-red-500/15 border border-red-500/25 text-ludo-xs font-mono text-red-300">
                                                                        {buyInError}
                                                                    </div>
                                                                )}

                                                                <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                                                                    <span className="text-ludo-xs font-mono text-white/65">
                                                                        Entry: <strong className="text-white">{warCall.member_fee.toLocaleString()} CHIPS</strong>
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
                                                                                <Chip size="sm" status="ok">Searching Opponent</Chip>
                                                                            );
                                                                        }

                                                                        if (myStake) {
                                                                            return (
                                                                                <Chip size="sm" status="ok">
                                                                                    Locked ({Number(myStake.stake_amount).toLocaleString()} CHIPS)
                                                                                </Chip>
                                                                            );
                                                                        }

                                                                        return (
                                                                            <Button
                                                                                variant="primary"
                                                                                size="md"
                                                                                disabled={buyInSubmitting}
                                                                                onClick={handleJoinWarRoster}
                                                                                className="inline-flex items-center gap-1.5"
                                                                            >
                                                                                <LuLock className="w-3.5 h-3.5" />
                                                                                <span>
                                                                                    {buyInSubmitting
                                                                                        ? "Approving in Wallet..."
                                                                                        : `Lock ${warCall.member_fee.toLocaleString()} CHIPS`}
                                                                                </span>
                                                                            </Button>
                                                                        );
                                                                    })()}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        /* ACTIVE / PREP WAR PHASE */
                                                        <div className="space-y-4">
                                                            <div className="p-4 rounded-2xl bg-white/[0.04] border border-cyan-400/40 space-y-3">
                                                                <div className="flex items-center justify-between gap-2">
                                                                    <Chip size="sm" status="ok">
                                                                        {activeWar?.status === "prep_phase" ? "48H PREP PHASE" : "ACTIVE COMBAT"}
                                                                    </Chip>
                                                                    <span className="font-mono text-ludo-xs text-white/55">
                                                                        {(activeWar?.bracket || 10) * 3} Fixtures ({(activeWar?.bracket || 10) * 2}×1v1 + {activeWar?.bracket || 10}×2v2)
                                                                    </span>
                                                                </div>

                                                                <div className="flex items-center justify-between gap-3 py-1">
                                                                    <div className="flex items-center gap-2 min-w-0">
                                                                        <ClanCrestBadge crest={activeWar?.clan_a?.crest} tag={activeWar?.clan_a?.tag} size="sm" />
                                                                        <span className="font-mono font-bold text-white truncate">
                                                                            [{activeWar?.clan_a?.tag || "CLAN A"}]
                                                                        </span>
                                                                    </div>
                                                                    <div className="px-3 py-1 rounded-xl bg-black/50 border border-white/10 font-mono text-ludo-lg font-bold text-cyan-300 shrink-0 tabular-nums">
                                                                        {activeWar?.clan_a_score} – {activeWar?.clan_b_score}
                                                                    </div>
                                                                    <div className="flex items-center gap-2 min-w-0">
                                                                        <span className="font-mono font-bold text-white truncate">
                                                                            [{activeWar?.clan_b?.tag || "CLAN B"}]
                                                                        </span>
                                                                        <ClanCrestBadge crest={activeWar?.clan_b?.crest} tag={activeWar?.clan_b?.tag} size="sm" />
                                                                    </div>
                                                                </div>
                                                            </div>

                                                            <SectionLabel right={<span className="text-ludo-xs font-mono text-white/40">{fixtures.length} battles</span>}>
                                                                Fixtures Matrix
                                                            </SectionLabel>

                                                            <div className="grid grid-cols-1 gap-2.5 max-h-[340px] overflow-y-auto no-scrollbar">
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
                                                                            className="p-3 rounded-2xl bg-white/[0.04] border border-white/10 flex flex-col gap-2 text-ludo-xs font-mono"
                                                                        >
                                                                            <div className="flex items-center justify-between gap-2">
                                                                                <div className="flex items-center gap-2 min-w-0">
                                                                                    <span className="px-2 py-0.5 rounded-md bg-black/40 border border-white/10 text-white/55 shrink-0">
                                                                                        #{f.fixture_index}
                                                                                    </span>
                                                                                    <span className="px-2 py-0.5 rounded-md bg-accent-soft text-cyan-300 font-bold shrink-0">
                                                                                        {f.game_shape}
                                                                                    </span>
                                                                                    <span className="text-white/85 truncate">
                                                                                        {formatSeatLabel(f.clan_a_seats)} vs {formatSeatLabel(f.clan_b_seats)}
                                                                                    </span>
                                                                                </div>

                                                                                <div className="flex items-center gap-1.5 shrink-0">
                                                                                    {canPlay ? (
                                                                                        <Button
                                                                                            size="sm"
                                                                                            variant={isClanAHost ? "primary" : "secondary"}
                                                                                            onClick={() => handleDeployFixture(f)}
                                                                                            className="inline-flex items-center gap-1"
                                                                                        >
                                                                                            <LuPlay className="w-3 h-3" />
                                                                                            <span>{isClanAHost ? "Deploy" : "Join"}</span>
                                                                                        </Button>
                                                                                    ) : (
                                                                                        <Chip
                                                                                            size="sm"
                                                                                            status={
                                                                                                f.status === "completed" || f.status === "scheduled_agreed"
                                                                                                    ? "ok"
                                                                                                    : f.status === "reschedule_pending"
                                                                                                      ? "warn"
                                                                                                      : "off"
                                                                                            }
                                                                                        >
                                                                                            {f.status.replace("_", " ")}
                                                                                        </Chip>
                                                                                    )}
                                                                                </div>
                                                                            </div>

                                                                            <div className="flex flex-wrap items-center justify-between gap-2 pt-1.5 border-t border-white/10 text-white/50">
                                                                                <span className="inline-flex items-center gap-1">
                                                                                    <LuCalendar className="w-3 h-3 text-cyan-300" />
                                                                                    {f.scheduled_at
                                                                                        ? new Date(f.scheduled_at).toLocaleString([], {
                                                                                              month: "short",
                                                                                              day: "numeric",
                                                                                              hour: "2-digit",
                                                                                              minute: "2-digit",
                                                                                          })
                                                                                        : "Unscheduled"}
                                                                                </span>
                                                                                <div className="flex items-center gap-2">
                                                                                    {canConfirmProposal && (
                                                                                        <button
                                                                                            type="button"
                                                                                            onClick={() => void handleConfirmSchedule(f.id)}
                                                                                            className="px-2 py-1 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 font-bold inline-flex items-center gap-1"
                                                                                        >
                                                                                            <LuCheck className="w-3 h-3" />
                                                                                            <span>Confirm</span>
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
                                                                                            className="px-2 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-cyan-300 inline-flex items-center gap-1"
                                                                                        >
                                                                                            <LuClock className="w-3 h-3" />
                                                                                            <span>{f.scheduled_at ? "Reschedule" : "Propose"}</span>
                                                                                        </button>
                                                                                    )}
                                                                                </div>
                                                                            </div>
                                                                        </div>
                                                                    );
                                                                })}
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            )}

                                            {/* 3. MISSIONS TAB */}
                                            {activeTab === "missions" && (
                                                <div className="space-y-4 text-ludo-xs font-mono">
                                                    <div className="p-4 rounded-2xl bg-white/[0.04] border border-amber-400/30 space-y-3">
                                                        <div className="flex items-center justify-between gap-2">
                                                            <div className="flex items-center gap-2.5 min-w-0">
                                                                <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-400/40 flex items-center justify-center text-amber-300 shrink-0">
                                                                    <LuTrophy className="w-5 h-5" />
                                                                </div>
                                                                <div className="min-w-0">
                                                                    <div className="text-white font-bold text-ludo-sm truncate">Sunday Weekly Vault</div>
                                                                    <div className="text-white/50 inline-flex items-center gap-1">
                                                                        <LuClock className="w-3 h-3 text-amber-300" />
                                                                        <span>
                                                                            {weeklyVault
                                                                                ? new Date(weeklyVault.unlocksAtUtc).toUTCString().slice(0, 22)
                                                                                : "Sunday 23:59 UTC"}
                                                                        </span>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                            <Chip size="sm" status={weeklyVault && weeklyVault.currentTier > 0 ? "ok" : "warn"}>
                                                                {weeklyVault && weeklyVault.currentTier > 0
                                                                    ? `T${weeklyVault.currentTier} · ${weeklyVault.rewardPerMemberChips}`
                                                                    : "Tier 0"}
                                                            </Chip>
                                                        </div>

                                                        {weeklyVault && (
                                                            <div className="space-y-2">
                                                                <div className="flex justify-between text-white/60">
                                                                    <span>Weekly CXP: {weeklyVault.weeklyClanCxp.toLocaleString()}</span>
                                                                    <span>
                                                                        {weeklyVault.nextTierTargetCxp
                                                                            ? `T${weeklyVault.nextTier}: ${weeklyVault.nextTierTargetCxp.toLocaleString()}`
                                                                            : "Max Tier"}
                                                                    </span>
                                                                </div>
                                                                <div className="grid grid-cols-5 gap-1.5">
                                                                    {weeklyVault.tiers.map((t) => (
                                                                        <div
                                                                            key={t.tier}
                                                                            className={`p-2 rounded-xl border text-center space-y-0.5 ${
                                                                                t.reached
                                                                                    ? "bg-emerald-500/20 border-emerald-400/45 text-emerald-200"
                                                                                    : t.unlocked
                                                                                      ? "bg-white/[0.04] border-white/10 text-white/65"
                                                                                      : "bg-black/30 border-white/5 text-white/25"
                                                                            }`}
                                                                        >
                                                                            <div className="font-bold flex items-center justify-center gap-1">
                                                                                {t.reached ? (
                                                                                    <LuCheck className="w-3 h-3" />
                                                                                ) : !t.unlocked ? (
                                                                                    <LuLock className="w-3 h-3" />
                                                                                ) : null}
                                                                                <span>T{t.tier}</span>
                                                                            </div>
                                                                            <div>{t.chipsPerMember}</div>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>

                                                    <SectionLabel>Clan Contracts &amp; Objectives</SectionLabel>

                                                    {missions.length === 0 ? (
                                                        <div className="p-6 rounded-2xl bg-white/[0.03] border border-white/10 text-white/45 text-center">
                                                            Play online matches or clan war fixtures to progress syndicate contracts.
                                                        </div>
                                                    ) : (
                                                        <div className="space-y-2.5">
                                                            {missions.map((m) => {
                                                                const pct = Math.min(100, Math.round((m.progress / Math.max(1, m.target)) * 100));
                                                                return (
                                                                    <div key={m.key} className="p-3.5 rounded-2xl bg-white/[0.04] border border-white/10 space-y-2">
                                                                        <div className="flex items-center justify-between gap-2.5">
                                                                            <div className="flex items-center gap-2.5 min-w-0">
                                                                                <div className="w-9 h-9 rounded-xl bg-accent-soft border border-cyan-400/35 flex items-center justify-center text-cyan-300 shrink-0">
                                                                                    {m.scope === "weekly" ? (
                                                                                        <LuFlame className="w-4 h-4" />
                                                                                    ) : (
                                                                                        <LuTarget className="w-4 h-4" />
                                                                                    )}
                                                                                </div>
                                                                                <div className="min-w-0">
                                                                                    <div className="font-bold text-white truncate">{m.title}</div>
                                                                                    <div className="text-cyan-300">
                                                                                        +{m.rewardCxp} CXP · {m.scope.toUpperCase()}
                                                                                    </div>
                                                                                </div>
                                                                            </div>
                                                                            <Chip size="sm" status={m.completed ? "ok" : "off"}>
                                                                                {m.completed ? "DONE" : `${m.progress}/${m.target}`}
                                                                            </Chip>
                                                                        </div>
                                                                        <div className="w-full h-1.5 rounded-full bg-black/50 border border-white/10 overflow-hidden">
                                                                            <div
                                                                                className="h-full bg-cyan-400 rounded-full transition-all"
                                                                                style={{ width: `${pct}%` }}
                                                                            />
                                                                        </div>
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                    )}
                                                </div>
                                            )}

                                            {/* 4. TREASURY TAB */}
                                            {activeTab === "treasury" && (
                                                <div className="space-y-4 text-ludo-xs font-mono">
                                                    <div className="p-4 rounded-2xl bg-white/[0.04] border border-cyan-400/35 flex flex-wrap items-center justify-between gap-3">
                                                        <div className="flex items-center gap-3">
                                                            <div className="w-11 h-11 rounded-2xl bg-accent-soft border border-cyan-400/40 flex items-center justify-center text-cyan-300 shrink-0">
                                                                <LuLandmark className="w-5 h-5" />
                                                            </div>
                                                            <div>
                                                                <div className="text-white/55">Clan War Chest</div>
                                                                <div className="text-ludo-lg font-bold text-cyan-300 tabular-nums">
                                                                    {Number(clan.treasury_balance).toLocaleString()} CHIPS
                                                                </div>
                                                            </div>
                                                        </div>
                                                        <Button
                                                            variant="primary"
                                                            size="sm"
                                                            onClick={() => setIsFundingTreasury((v) => !v)}
                                                            className="inline-flex items-center gap-1"
                                                        >
                                                            <LuPlus className="w-3.5 h-3.5" />
                                                            <span>{isFundingTreasury ? "Close" : "Fund"}</span>
                                                        </Button>
                                                    </div>

                                                    {isFundingTreasury && (
                                                        <form onSubmit={handleFundTreasurySubmit} className="p-4 rounded-2xl bg-black/40 border border-cyan-400/25 space-y-3">
                                                            <div className="flex flex-wrap gap-1.5">
                                                                {TREASURY_PRESETS.map((preset) => (
                                                                    <button
                                                                        key={preset}
                                                                        type="button"
                                                                        onClick={() => setFundAmountInput(String(preset))}
                                                                        className={`px-2.5 py-1 rounded-lg border font-bold ${
                                                                            Number(fundAmountInput) === preset
                                                                                ? "bg-accent-soft border-cyan-400 text-cyan-300"
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
                                                                    {fundSubmitting ? "Depositing..." : "Deposit"}
                                                                </Button>
                                                            </div>
                                                        </form>
                                                    )}

                                                    <SectionLabel right={<span className="text-ludo-xs font-mono text-white/40">{treasuryLedger.length} entries</span>}>
                                                        Treasury Ledger
                                                    </SectionLabel>

                                                    {treasuryLedger.length === 0 ? (
                                                        <div className="p-6 rounded-2xl bg-white/[0.03] border border-white/10 text-white/45 text-center">
                                                            No treasury transactions yet. Win clan wars or donate CHIPS to build your war chest.
                                                        </div>
                                                    ) : (
                                                        <div className="space-y-2 max-h-[260px] overflow-y-auto no-scrollbar">
                                                            {treasuryLedger.map((entry) => {
                                                                const positive = Number(entry.amount) >= 0;
                                                                return (
                                                                    <div
                                                                        key={entry.id}
                                                                        className="p-3 rounded-2xl bg-white/[0.04] border border-white/10 flex items-center justify-between gap-2.5"
                                                                    >
                                                                        <div className="flex items-center gap-2.5 min-w-0">
                                                                            <div
                                                                                className={`w-8 h-8 rounded-xl flex items-center justify-center border shrink-0 ${
                                                                                    positive
                                                                                        ? "bg-emerald-500/15 border-emerald-400/35 text-emerald-300"
                                                                                        : "bg-red-500/15 border-red-400/35 text-red-300"
                                                                                }`}
                                                                            >
                                                                                {positive ? (
                                                                                    <LuArrowDownLeft className="w-4 h-4" />
                                                                                ) : (
                                                                                    <LuArrowUpRight className="w-4 h-4" />
                                                                                )}
                                                                            </div>
                                                                            <div className="min-w-0">
                                                                                <div className="font-bold text-white uppercase truncate">
                                                                                    {entry.reason.replace("_", " ")}
                                                                                </div>
                                                                                <div className="text-white/45 truncate">
                                                                                    {new Date(entry.created_at).toLocaleDateString()}{" "}
                                                                                    {entry.ref ? `· ${entry.ref.slice(0, 16)}` : ""}
                                                                                </div>
                                                                            </div>
                                                                        </div>
                                                                        <span className={`font-bold shrink-0 tabular-nums ${positive ? "text-emerald-300" : "text-red-300"}`}>
                                                                            {positive ? "+" : ""}
                                                                            {Number(entry.amount).toLocaleString()} CHIPS
                                                                        </span>
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                    )}
                                                </div>
                                            )}

                                            {/* 5. MEMBERS TAB */}
                                            {activeTab === "members" && (
                                                <div className="space-y-4">
                                                    <div className="flex items-center justify-between text-ludo-xs font-mono text-white/60">
                                                        <span className="inline-flex items-center gap-1.5">
                                                            <LuUsers className="w-3.5 h-3.5 text-cyan-300" />
                                                            Roster ({members.length || clan.member_count}/{levelConfig?.member_cap ?? 20})
                                                        </span>
                                                        <div className="flex items-center gap-3">
                                                            {isOfficer && (
                                                                <button
                                                                    type="button"
                                                                    onClick={openSettingsModal}
                                                                    className="px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-cyan-300 inline-flex items-center gap-1"
                                                                >
                                                                    <LuSettings className="w-3.5 h-3.5" />
                                                                    <span>Settings</span>
                                                                </button>
                                                            )}
                                                            <button
                                                                onClick={() => void leaveClan().catch((e) => showErr(e, "Failed to leave clan"))}
                                                                className="px-2.5 py-1 rounded-lg bg-red-500/10 hover:bg-red-500/20 border border-red-400/25 text-red-300"
                                                            >
                                                                Leave
                                                            </button>
                                                        </div>
                                                    </div>

                                                    {/* Pending Join Requests */}
                                                    {isOfficer && joinRequests.length > 0 && (
                                                        <div className="space-y-2 p-3 rounded-2xl bg-accent-soft border border-cyan-400/35">
                                                            <div className="text-ludo-xs font-mono font-bold text-cyan-200 uppercase flex items-center gap-1.5">
                                                                <LuPlus className="w-3.5 h-3.5" />
                                                                <span>Pending Applications ({joinRequests.length})</span>
                                                            </div>
                                                            {joinRequests.map((req) => (
                                                                <div
                                                                    key={req.id}
                                                                    className="p-2.5 rounded-xl bg-black/40 border border-white/10 flex items-center justify-between gap-2 text-ludo-xs font-mono"
                                                                >
                                                                    <div className="min-w-0">
                                                                        <div className="font-bold text-white truncate">
                                                                            {req.player?.username || shortHex(req.wallet_address)}
                                                                        </div>
                                                                        <div className="text-white/45">{req.player?.rank_tier || "Unranked"}</div>
                                                                    </div>
                                                                    <div className="flex items-center gap-1.5 shrink-0">
                                                                        <button
                                                                            type="button"
                                                                            onClick={() =>
                                                                                void reviewRequest(clan.id, req.wallet_address, "accept").catch((e) =>
                                                                                    showErr(e, "Failed to accept"),
                                                                                )
                                                                            }
                                                                            className="px-2.5 py-1 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 font-bold inline-flex items-center gap-1"
                                                                        >
                                                                            <LuCheck className="w-3.5 h-3.5" />
                                                                            <span>Accept</span>
                                                                        </button>
                                                                        <button
                                                                            type="button"
                                                                            onClick={() =>
                                                                                void reviewRequest(clan.id, req.wallet_address, "reject").catch((e) =>
                                                                                    showErr(e, "Failed to reject"),
                                                                                )
                                                                            }
                                                                            className="px-2 py-1 rounded-lg bg-red-500/15 hover:bg-red-500/25 text-red-300 inline-flex items-center"
                                                                            aria-label="Reject"
                                                                        >
                                                                            <LuX className="w-3.5 h-3.5" />
                                                                        </button>
                                                                    </div>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    )}

                                                    <div className="space-y-2 max-h-[360px] overflow-y-auto no-scrollbar">
                                                        {members.length === 0 ? (
                                                            <div className="p-3.5 rounded-2xl bg-white/[0.04] border border-white/10 flex items-center justify-between text-ludo-xs font-mono">
                                                                <div className="flex items-center gap-3">
                                                                    <div className="w-9 h-9 rounded-xl bg-amber-500/20 border border-amber-400/35 text-amber-300 flex items-center justify-center">
                                                                        <LuCrown className="w-4 h-4" />
                                                                    </div>
                                                                    <div>
                                                                        <div className="font-bold text-white">{shortHex(clan.leader_wallet)}</div>
                                                                        <div className="text-amber-300 text-ludo-xs">COMMANDER</div>
                                                                    </div>
                                                                </div>
                                                                <span className="text-white/45">Leader</span>
                                                            </div>
                                                        ) : (
                                                            members.map((m) => (
                                                                <div
                                                                    key={m.id}
                                                                    className="p-3 rounded-2xl bg-white/[0.04] border border-white/10 flex items-center justify-between text-ludo-xs font-mono gap-2"
                                                                >
                                                                    <div className="flex items-center gap-3 min-w-0">
                                                                        <div
                                                                            className={`w-9 h-9 rounded-xl border flex items-center justify-center shrink-0 ${
                                                                                m.role === "commander"
                                                                                    ? "bg-amber-500/15 border-amber-400/35 text-amber-300"
                                                                                    : m.role === "officer"
                                                                                      ? "bg-accent-soft border-cyan-400/35 text-cyan-300"
                                                                                      : "bg-white/5 border-white/10 text-white/65"
                                                                            }`}
                                                                        >
                                                                            {m.role === "commander" ? (
                                                                                <LuCrown className="w-4 h-4" />
                                                                            ) : m.role === "officer" ? (
                                                                                <LuStar className="w-4 h-4" />
                                                                            ) : (
                                                                                <LuShield className="w-4 h-4" />
                                                                            )}
                                                                        </div>
                                                                        <div className="min-w-0">
                                                                            <div className="font-bold text-white truncate">
                                                                                {m.player?.username || shortHex(m.wallet_address)}
                                                                            </div>
                                                                            <div className="text-cyan-300 text-ludo-xs uppercase truncate">
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
                                                                                    className="px-2 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-white/75 hover:text-white"
                                                                                >
                                                                                    {m.role === "officer" ? "Demote" : "Promote"}
                                                                                </button>
                                                                                <button
                                                                                    onClick={() =>
                                                                                        void kickMember(m.wallet_address).catch((e) =>
                                                                                            showErr(e, "Failed to kick member"),
                                                                                        )
                                                                                    }
                                                                                    className="px-2 py-1 rounded-lg bg-red-500/15 hover:bg-red-500/25 text-red-300"
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
                        </motion.div>
                    </div>

                    {/* ── Modal: Create Clan ──────────────────────────────────────── */}
                    {isCreatingClan && (
                        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md">
                            <div
                                className="ludo-arena-scope ludo-clan-scope relative w-full max-w-md p-6 rounded-[28px] border border-white/15 shadow-2xl space-y-4 text-white font-sans overflow-hidden"
                                style={{
                                    backgroundImage: "var(--panel-bg-image, var(--ludo-bg-cosmic))",
                                    backgroundColor: "var(--panel-bg, rgba(11, 15, 23, 0.98))",
                                    backdropFilter: "blur(32px)",
                                }}
                            >
                                <h3 className="text-ludo-lg font-bold text-white flex items-center gap-2">
                                    <LuSparkles className="w-5 h-5 text-cyan-300" />
                                    <span>Forge Tactical Clan</span>
                                </h3>
                                <div className="p-3 rounded-xl bg-accent-soft border border-cyan-400/25 text-ludo-xs font-mono text-cyan-200">
                                    Clan creation fee: <strong>10,000 CHIPS</strong>, verified pre-flight before transferring to the protocol treasury on Base Sepolia.
                                </div>

                                {createError && (
                                    <div className="p-2.5 rounded-xl bg-red-500/15 border border-red-500/25 text-ludo-xs font-mono text-red-300">
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
                                                                ? "border-cyan-400 bg-accent-soft text-cyan-300"
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
                        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md">
                            <div
                                className="ludo-arena-scope ludo-clan-scope relative w-full max-w-md p-6 rounded-[28px] border border-amber-400/40 shadow-2xl space-y-4 text-white font-sans overflow-hidden"
                                style={{
                                    backgroundImage: "var(--panel-bg-image, var(--ludo-bg-cosmic))",
                                    backgroundColor: "var(--panel-bg, rgba(11, 15, 23, 0.98))",
                                    backdropFilter: "blur(32px)",
                                }}
                            >
                                <h3 className="text-ludo-lg font-bold text-white flex items-center gap-2">
                                    <LuSwords className="w-5 h-5 text-amber-300" />
                                    <span>Call to Arms: Post War Notice</span>
                                </h3>
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
                                            <span className="text-white/45 font-bold">20% Governance Split</span>
                                            <span className={isSplitValid ? "text-emerald-300 font-bold" : "text-red-300 font-bold"}>
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
                        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md">
                            <div
                                className="ludo-arena-scope ludo-clan-scope relative w-full max-w-lg max-h-[80vh] flex flex-col p-6 rounded-[28px] border border-white/15 shadow-2xl space-y-4 text-white font-sans overflow-hidden"
                                style={{
                                    backgroundImage: "var(--panel-bg-image, var(--ludo-bg-cosmic))",
                                    backgroundColor: "var(--panel-bg, rgba(11, 15, 23, 0.98))",
                                    backdropFilter: "blur(32px)",
                                }}
                            >
                                <div className="flex items-center justify-between gap-2">
                                    <h3 className="text-ludo-lg font-bold text-white flex items-center gap-2">
                                        <LuSwords className="w-5 h-5 text-amber-300" />
                                        <span>Open War Board</span>
                                    </h3>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        onClick={() => setShowWarBoard(false)}
                                        aria-label="Close Open War Board"
                                        className="bg-surface-hover border border-line-soft shrink-0"
                                    >
                                        <LuX className="icon-md" />
                                    </Button>
                                </div>

                                <div className="flex-1 overflow-y-auto no-scrollbar space-y-3">
                                    {warBoard.filter((c) => c.clan_id !== clan?.id).length === 0 ? (
                                        <div className="py-12 text-center text-white/45 font-mono text-ludo-xs">
                                            No other clans currently searching in this bracket. Your notice is listed for other clans to match!
                                        </div>
                                    ) : (
                                        warBoard
                                            .filter((c) => c.clan_id !== clan?.id)
                                            .map((c) => (
                                                <div
                                                    key={c.id}
                                                    className="p-3.5 rounded-2xl bg-white/[0.04] border border-white/10 flex flex-wrap items-center justify-between gap-3 text-ludo-xs font-mono"
                                                >
                                                    <div className="flex items-center gap-3">
                                                        <ClanCrestBadge crest={c.clan?.crest} tag={c.clan?.tag} size="md" />
                                                        <div>
                                                            <div className="font-bold text-white text-ludo-sm">
                                                                {c.clan?.name} <span className="text-cyan-300">[{c.clan?.tag}]</span>
                                                            </div>
                                                            <div className="text-white/55">
                                                                {c.bracket}v{c.bracket} • Stake: {Number(c.total_stake).toLocaleString()} CHIPS • CWR: {c.clan?.cwr}
                                                            </div>
                                                        </div>
                                                    </div>

                                                    <button
                                                        disabled={matchingCallId === c.id}
                                                        onClick={() => void handleMatchOpponent(c.id)}
                                                        className="px-4 py-2 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 border border-amber-400/40 text-amber-300 font-bold transition-all"
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
                        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md">
                            <div
                                className="ludo-arena-scope ludo-clan-scope relative w-full max-w-sm p-6 rounded-[28px] border border-white/15 shadow-2xl space-y-4 text-white font-sans overflow-hidden"
                                style={{
                                    backgroundImage: "var(--panel-bg-image, var(--ludo-bg-cosmic))",
                                    backgroundColor: "var(--panel-bg, rgba(11, 15, 23, 0.98))",
                                    backdropFilter: "blur(32px)",
                                }}
                            >
                                <h3 className="text-ludo-lg font-bold text-white flex items-center gap-2">
                                    <LuCalendar className="w-5 h-5 text-cyan-300" />
                                    <span>Schedule Fixture #{schedulingFixture.fixture_index}</span>
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
                        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md">
                            <div
                                className="ludo-arena-scope ludo-clan-scope relative w-full max-w-md p-6 rounded-[28px] border border-white/15 shadow-2xl space-y-4 text-white font-sans overflow-hidden"
                                style={{
                                    backgroundImage: "var(--panel-bg-image, var(--ludo-bg-cosmic))",
                                    backgroundColor: "var(--panel-bg, rgba(11, 15, 23, 0.98))",
                                    backdropFilter: "blur(32px)",
                                }}
                            >
                                <h3 className="text-ludo-lg font-bold text-white flex items-center gap-2">
                                    <LuSettings className="w-5 h-5 text-cyan-300" />
                                    <span>Clan Settings</span>
                                </h3>
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
                                                            ? "border-cyan-400 bg-accent-soft text-cyan-300"
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
                                    {member?.role === "commander" && (
                                        <div className="pt-1">
                                            <label className="text-white/60 block mb-1">
                                                Treasury Balance &amp; P&amp;L Visibility (Commander)
                                            </label>
                                            <div className="grid grid-cols-2 gap-2">
                                                <button
                                                    type="button"
                                                    onClick={() => setSettingsTreasuryPublic(false)}
                                                    className={`py-2 px-2 rounded-xl border uppercase font-bold inline-flex items-center justify-center gap-1.5 ${
                                                        !settingsTreasuryPublic
                                                            ? "border-amber-400 bg-amber-500/15 text-amber-300"
                                                            : "border-white/10 bg-white/5 text-white/50"
                                                    }`}
                                                >
                                                    <LuLock className="w-3.5 h-3.5" />
                                                    <span>Members Only</span>
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => setSettingsTreasuryPublic(true)}
                                                    className={`py-2 px-2 rounded-xl border uppercase font-bold inline-flex items-center justify-center gap-1.5 ${
                                                        settingsTreasuryPublic
                                                            ? "border-emerald-400 bg-emerald-500/15 text-emerald-300"
                                                            : "border-white/10 bg-white/5 text-white/50"
                                                    }`}
                                                >
                                                    <LuEye className="w-3.5 h-3.5" />
                                                    <span>Public</span>
                                                </button>
                                            </div>
                                        </div>
                                    )}
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

                    {/* ── Modal: Public Clan Profile Scout ──────────────────────── */}
                    <ClanProfileModal
                        isOpen={Boolean(scoutClanTarget)}
                        clanIdOrTag={scoutClanTarget}
                        onClose={() => setScoutClanTarget(null)}
                        onJoined={() => void refreshClan()}
                        onInspectMember={onOpenProfile}
                    />
                </>
            )}
        </AnimatePresence>
    );
}
