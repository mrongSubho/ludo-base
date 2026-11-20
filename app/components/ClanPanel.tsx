"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
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
    LuZap,
} from "react-icons/lu";
import { useTeamUpContext } from "@/hooks/TeamUpContext";
import { useClanData } from "@/hooks/useClanData";
import { useClanWar } from "@/hooks/useClanWar";
import { useClanClaims } from "@/hooks/useClanClaims";
import { shortHex } from "@/lib/chips";
import { GamePanelShell } from "./GamePanelShell";
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
import { MissionCard } from "./MissionCard";
import { HudCornerTicks, HudProgressGauge, HudSectionLabel } from "./HudPrimitives";
import { CloseReticleIcon, SyndicateShieldIcon } from "./icons";

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
    Diamond: "bg-accent shadow-[0_0_12px_rgba(0,229,255,0.85)]",
    Platinum: "bg-sky-400 shadow-[0_0_12px_rgba(96,165,250,0.85)]",
    Gold: "bg-warn shadow-[0_0_12px_rgba(250,204,21,0.85)]",
    Silver: "bg-slate-300 shadow-[0_0_12px_rgba(203,213,225,0.85)]",
    Bronze: "bg-orange-700 shadow-[0_0_12px_rgba(217,119,6,0.75)]",
};

const SectionLabel = HudSectionLabel;

export function ClanPanel({ isOpen, onClose, onOpenProfile }: ClanPanelProps) {
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
    const chatThreadRef = useRef<HTMLDivElement | null>(null);

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
        if (activeTab === "hall" && chatThreadRef.current) {
            chatThreadRef.current.scrollTop = chatThreadRef.current.scrollHeight;
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
        } catch (err: unknown) {
            setCreateError(err instanceof Error ? err.message : "Failed to create clan");
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
        } catch (err: unknown) {
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
        } catch (err: unknown) {
            setBuyInError(err instanceof Error ? err.message : "War stake transaction failed");
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
        } catch (err: unknown) {
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
        dot?: "warn" | "accent";
    }> = [
        { id: "profile", label: "Profile", icon: <LuShield className="w-3.5 h-3.5" /> },
        { id: "hall", label: "Hall", icon: <LuMessageSquare className="w-3.5 h-3.5" /> },
        {
            id: "war",
            label: "War",
            icon: <LuSwords className="w-3.5 h-3.5" />,
            dot: warCall || activeWar ? "warn" : undefined,
        },
        { id: "missions", label: "Missions", icon: <LuTarget className="w-3.5 h-3.5" /> },
        { id: "treasury", label: "Vault", icon: <LuCoins className="w-3.5 h-3.5" /> },
        {
            id: "members",
            label: "Roster",
            icon: <LuUsers className="w-3.5 h-3.5" />,
            dot: isOfficer && joinRequests.length > 0 ? "accent" : undefined,
        },
    ];

    if (!isOpen) return null;

    return (
        <>
            <GamePanelShell
                scopeClass="ludo-arena-scope ludo-clan-scope"
                kicker="// SYNDICATE OPS"
                title={(
                    <span className="inline-flex items-center gap-2.5 min-w-0">
                        {clan ? (
                            <ClanCrestBadge crest={clan.crest} tag={clan.tag} size="md" />
                        ) : (
                            <span className="hud-chamfer-sm w-7 h-7 rounded-lg bg-accent-soft border border-accent/35 flex items-center justify-center text-accent shrink-0">
                                <SyndicateShieldIcon className="w-4 h-4" active />
                            </span>
                        )}
                        <span className="truncate">{clan ? clan.name : "Tactical Clans"}</span>
                        {clan && (
                            <span className="px-2 py-0.5 rounded-md bg-accent-soft text-accent font-mono text-ludo-xs font-bold border border-accent/35 shrink-0">
                                [{clan.tag}]
                            </span>
                        )}
                    </span>
                )}
                subtitle={
                    clan ? (
                        <span className="inline-flex items-center gap-2 font-mono">
                            <span className="inline-flex items-center gap-1 text-accent font-bold">
                                <LuStar className="w-3 h-3" />
                                LVL {clan.level}
                            </span>
                            <span className="text-ink-faint">•</span>
                            <span className="inline-flex items-center gap-1">
                                <LuTrophy className="w-3 h-3 text-warn" />
                                {clan.division}
                            </span>
                            <span className="text-ink-faint">•</span>
                            <span className="inline-flex items-center gap-1">
                                <LuUsers className="w-3 h-3 text-ink-muted" />
                                {clan.member_count}/{levelConfig?.member_cap ?? 20}
                            </span>
                        </span>
                    ) : (
                        <span>On-chain syndicates, 2v2 squads &amp; wars</span>
                    )
                }
                onClose={onClose}
                hideOrbs
            >
                {/* Dedicated CXP Progress + Claimable Chips Strip */}
                {(clan || totalClaimableChips > 0) && (
                    <div className="px-5 py-2.5 border-b border-line-soft bg-surface-recessed/60 relative z-10 shrink-0 flex items-center gap-3">
                        {clan && (
                            <div className="flex items-center gap-2.5 flex-1 min-w-0">
                                <span className="text-ludo-xs font-mono font-bold text-accent uppercase tracking-wider shrink-0">
                                    CXP
                                </span>
                                <HudProgressGauge percent={cxpPct} tone="accent" className="flex-1 min-w-0" />
                                <span className="text-ludo-xs font-mono text-ink-muted tabular-nums shrink-0">
                                    {nextLevelTarget
                                        ? `${clan.cxp.toLocaleString()} / ${nextLevelTarget.toLocaleString()}`
                                        : `${clan.cxp.toLocaleString()} MAX`}
                                </span>
                            </div>
                        )}
                        {totalClaimableChips > 0 && (
                            <button
                                type="button"
                                onClick={() => void claimAll().catch((e) => showErr(e, "Claim failed"))}
                                disabled={isClaimingAll}
                                className="px-2.5 py-1 rounded-xl bg-positive/20 hover:bg-positive/30 border border-positive/40 text-positive font-mono text-ludo-xs font-bold flex items-center gap-1.5 transition-all shrink-0"
                            >
                                <LuCoins className="w-3.5 h-3.5 text-positive" />
                                <span>{totalClaimableChips.toLocaleString()}</span>
                            </button>
                        )}
                    </div>
                )}

                {/* Inline Feedback Banner */}
                {(bannerError || actionSuccess) && (
                    <div className="px-5 pt-3 relative z-10 shrink-0">
                        <div
                            className={`px-3 py-2 rounded-xl border text-ludo-xs font-mono flex items-center justify-between gap-2 ${
                                bannerError
                                    ? "bg-negative/15 border-negative/35 text-negative"
                                    : "bg-positive/15 border-positive/35 text-positive"
                            }`}
                        >
                            <span className="break-words">{bannerError || actionSuccess}</span>
                            <button
                                type="button"
                                onClick={() => {
                                    setActionError(null);
                                    setActionSuccess(null);
                                }}
                                className="text-ink-muted hover:text-ink-strong shrink-0"
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
                        <div className="p-4 rounded-2xl bg-surface-panel border border-accent/35 flex items-center justify-between gap-3 shadow-[0_0_24px_rgba(0,229,255,0.08)]">
                            <div className="flex items-center gap-3 min-w-0">
                                <div className="w-11 h-11 rounded-2xl bg-accent-soft border border-accent/40 flex items-center justify-center text-accent shrink-0">
                                    <LuSparkles className="w-5 h-5" />
                                </div>
                                <div className="min-w-0">
                                    <div className="text-ludo-sm font-bold text-ink-strong truncate">
                                        Launch Your Syndicate
                                    </div>
                                    <div className="text-ludo-xs font-mono text-ink-muted truncate">
                                        10,000 CHIPS · Wars, Vaults &amp; 50 Seats
                                    </div>
                                </div>
                            </div>
                            <Button
                                variant="primary"
                                size="sm"
                                leftIcon={<LuPlus className="w-4 h-4" />}
                                onClick={() => {
                                    setCreateError(null);
                                    setIsCreatingClan(true);
                                }}
                                className="shrink-0 font-bold tracking-wider whitespace-nowrap"
                            >
                                Forge
                            </Button>
                        </div>

                        {/* Search + Division Filters */}
                        <div className="space-y-2.5">
                            <div className="flex items-center gap-2 bg-surface-recessed border border-line-soft rounded-xl px-3 h-10 focus-within:border-accent/60 transition-colors">
                                <LuSearch className="w-4 h-4 text-ink-faint shrink-0" />
                                <input
                                    type="text"
                                    placeholder="Search syndicates by name or tag..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    autoComplete="off"
                                    autoCorrect="off"
                                    autoCapitalize="none"
                                    spellCheck={false}
                                    enterKeyHint="search"
                                    className="flex-1 min-w-0 bg-transparent border-0 text-ink-strong placeholder:text-ink-faint text-ludo-sm focus:outline-none font-mono"
                                />
                                {searchQuery && (
                                    <button
                                        type="button"
                                        onClick={() => setSearchQuery("")}
                                        className="text-ink-muted hover:text-ink-strong"
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
                                                ? "bg-accent-soft border-accent/60 text-accent"
                                                : "bg-surface-panel border-line-soft text-ink-muted hover:text-ink-strong"
                                        }`}
                                    >
                                        {div}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <SectionLabel right={<span className="text-ludo-xs font-mono text-ink-faint">{discoveredClans.length} found</span>}>
                            Active Syndicates
                        </SectionLabel>

                        <div className="grid grid-cols-1 gap-3">
                            {isSearching ? (
                                <div className="py-12 flex flex-col items-center justify-center text-ink-muted gap-3">
                                    <ThinkingOrb state="solving" size={32} tone="accent" label="Scanning on-chain syndicates" />
                                    <span className="font-mono text-ludo-xs">Scanning On-Chain Syndicates...</span>
                                </div>
                            ) : discoveredClans.length === 0 ? (
                                <div className="py-10 text-center text-ink-faint font-mono text-ludo-sm rounded-2xl bg-surface-panel border border-line-soft">
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
                                            className="relative pl-4 pr-3.5 py-3.5 rounded-2xl bg-surface-panel border border-line-soft hover:border-accent/45 transition-all flex flex-col gap-2.5 overflow-hidden"
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
                                                            <span className="font-bold text-ink-strong text-ludo-md truncate group-hover:text-accent transition-colors">{c.name}</span>
                                                            <span className="text-ludo-xs font-mono text-accent shrink-0">[{c.tag}]</span>
                                                        </div>
                                                        <div className="flex items-center gap-2 text-ludo-xs text-ink-muted font-mono mt-0.5">
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
                                                <p className="text-ludo-xs text-ink-muted line-clamp-2 italic">
                                                    &ldquo;{c.bio}&rdquo;
                                                </p>
                                            )}

                                            <div className="flex items-center justify-between pt-2 border-t border-line-soft gap-2">
                                                <span className="inline-flex items-center gap-1.5 text-ludo-xs font-mono text-warn font-bold">
                                                    <LuTrophy className="w-3.5 h-3.5" />
                                                    {c.cwr} CWR
                                                </span>
                                                <div className="flex items-center gap-1.5">
                                                    <button
                                                        type="button"
                                                        onClick={() => setScoutClanTarget(c.id)}
                                                        className="px-2.5 py-1.5 rounded-xl border border-line-soft bg-surface-recessed hover:bg-surface-hover text-ink-strong font-mono text-ludo-xs font-bold uppercase inline-flex items-center gap-1 transition-all"
                                                    >
                                                        <LuEye className="w-3 h-3" />
                                                        <span>Scout</span>
                                                    </button>
                                                    <button
                                                        disabled={isInviteOnly || joiningClanId === c.id}
                                                        onClick={() => void handleJoinClan(c.id)}
                                                        className={`px-3.5 py-1.5 rounded-xl border font-mono text-ludo-xs font-bold uppercase inline-flex items-center gap-1.5 transition-all ${
                                                            isInviteOnly
                                                                ? "bg-surface-recessed border-line-soft text-ink-faint cursor-not-allowed"
                                                                : "bg-accent-soft hover:bg-accent/20 border-accent/45 text-accent"
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
                    /* ── IN A CLAN: Tactical HUD 6-Tab Layout ───────────────── */
                    <div className="flex-1 flex flex-col min-h-0 relative z-10">
                        {/* Segmented Icon Tab Bar */}
                        <div className="px-4 pt-3 pb-2 shrink-0">
                            <div className="grid grid-cols-6 gap-1 p-1 rounded-2xl bg-surface-recessed border border-line-soft">
                                {tabConfig.map((t) => {
                                    const active = activeTab === t.id;
                                    return (
                                        <button
                                            key={t.id}
                                            type="button"
                                            onClick={() => setActiveTab(t.id)}
                                            className={`relative flex flex-col items-center justify-center gap-1 py-2 px-1 rounded-xl text-ludo-xs font-bold uppercase tracking-wider transition-all border ${
                                                active
                                                    ? "bg-accent-soft text-accent border-accent/45"
                                                    : "text-ink-muted hover:text-ink-strong border-transparent"
                                            }`}
                                        >
                                            <span className={active ? "text-accent" : ""}>{t.icon}</span>
                                            <span className="truncate max-w-full">{t.label}</span>
                                            {t.dot && (
                                                <span
                                                    className={`absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full ${
                                                        t.dot === "warn" ? "bg-warn" : "bg-accent"
                                                    }`}
                                                />
                                            )}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Sub-Tab Viewport */}
                        <div
                            className={`flex-1 min-h-0 px-5 pb-4 pt-1 ${
                                activeTab === "hall"
                                    ? "flex flex-col overflow-hidden"
                                    : "overflow-y-auto no-scrollbar"
                            }`}
                        >
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
                                    <div className="py-12 flex flex-col items-center justify-center gap-2.5 text-center">
                                        <ThinkingOrb state="searching" size={32} tone="accent" label="Loading syndicate dossier" />
                                        <div className="text-ludo-xs font-mono text-ink-faint uppercase tracking-wider">
                                            Loading Syndicate Dossier...
                                        </div>
                                    </div>
                                )
                            )}

                            {/* 1. HALL TAB */}
                            {activeTab === "hall" && (
                                <div className="flex-1 min-h-0 flex flex-col space-y-3">
                                    {/* 3-Card Quick Stat HUD */}
                                    <div className="grid grid-cols-3 gap-2 shrink-0">
                                        <button
                                            type="button"
                                            onClick={() => setActiveTab("war")}
                                            className="p-2.5 rounded-2xl bg-surface-panel border border-line-soft hover:border-warn/45 text-left transition-colors"
                                        >
                                            <div className="flex items-center gap-1.5 text-ludo-xs font-mono text-warn">
                                                <LuTrophy className="w-3.5 h-3.5" />
                                                <span>CWR</span>
                                            </div>
                                            <div className="text-ludo-md font-bold font-mono text-ink-strong mt-0.5 tabular-nums">
                                                {clan.cwr.toLocaleString()}
                                            </div>
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setActiveTab("treasury")}
                                            className="p-2.5 rounded-2xl bg-surface-panel border border-line-soft hover:border-accent/45 text-left transition-colors"
                                        >
                                            <div className="flex items-center gap-1.5 text-ludo-xs font-mono text-accent">
                                                <LuCoins className="w-3.5 h-3.5" />
                                                <span>VAULT</span>
                                            </div>
                                            <div className="text-ludo-md font-bold font-mono text-ink-strong mt-0.5 tabular-nums truncate">
                                                {Number(clan.treasury_balance).toLocaleString()}
                                            </div>
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setActiveTab("members")}
                                            className="p-2.5 rounded-2xl bg-surface-panel border border-line-soft hover:border-positive/45 text-left transition-colors"
                                        >
                                            <div className="flex items-center gap-1.5 text-ludo-xs font-mono text-positive">
                                                <LuUsers className="w-3.5 h-3.5" />
                                                <span>SQUAD</span>
                                            </div>
                                            <div className="text-ludo-md font-bold font-mono text-ink-strong mt-0.5 tabular-nums">
                                                {clan.member_count}/{levelConfig?.member_cap ?? 20}
                                            </div>
                                        </button>
                                    </div>

                                    {/* Active War Banner */}
                                    {(warCall || activeWar) && (
                                        <div className="p-3.5 rounded-2xl bg-warn/10 border border-warn/35 flex items-center justify-between gap-3 shrink-0">
                                            <div className="flex items-center gap-3 min-w-0">
                                                <div className="w-10 h-10 rounded-xl bg-warn/20 border border-warn/40 flex items-center justify-center text-warn shrink-0">
                                                    <LuSwords className="w-5 h-5" />
                                                </div>
                                                <div className="min-w-0">
                                                    <div className="text-ludo-sm font-bold text-warn truncate">
                                                        {activeWar
                                                            ? `ACTIVE WAR: ${activeWar.clan_a_score} – ${activeWar.clan_b_score}`
                                                            : `WAR CALL: ${warCall!.bracket}v${warCall!.bracket} BRACKET`}
                                                    </div>
                                                    <div className="text-ludo-xs font-mono text-ink-muted truncate">
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
                                    <div className="flex-1 min-h-0 flex flex-col justify-between rounded-2xl bg-surface-recessed border border-line-soft p-3.5">
                                        <div className="flex items-center justify-between pb-2 mb-2 border-b border-line-soft shrink-0">
                                            <span className="inline-flex items-center gap-1.5 text-ludo-xs font-mono font-bold text-accent uppercase tracking-wider">
                                                <LuRadio className="w-3.5 h-3.5" />
                                                Live Syndicate Comms
                                            </span>
                                            <span className="text-ludo-xs font-mono text-ink-faint">
                                                {chatMessages.length} msgs
                                            </span>
                                        </div>

                                        <div ref={chatThreadRef} className="chat-thread-scroll flex-1 min-h-0 overflow-y-auto space-y-2.5 pr-1">
                                            {chatMessages.length === 0 ? (
                                                <div className="h-full flex flex-col items-center justify-center text-ink-faint font-mono text-ludo-xs text-center gap-2 py-8">
                                                    <LuMessageSquare className="w-6 h-6 text-ink-faint" />
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
                                                                <span className={isMine ? "text-accent font-bold" : "text-warn font-bold"}>
                                                                    {msg.sender_name}
                                                                </span>
                                                                <span className="text-ink-faint">
                                                                    {new Date(msg.created_at).toLocaleTimeString([], {
                                                                        hour: "2-digit",
                                                                        minute: "2-digit",
                                                                    })}
                                                                </span>
                                                            </div>
                                                            <div
                                                                className={`max-w-[85%] px-3 py-2 rounded-2xl text-ludo-xs font-mono leading-relaxed break-words border ${
                                                                    isMine
                                                                        ? "bg-accent-soft border-accent/35 text-ink-strong rounded-tr-sm"
                                                                        : "bg-surface-panel border-line-soft text-ink-strong rounded-tl-sm"
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

                                        <form onSubmit={handleSendMessage} className="mt-3 flex gap-2 pt-2.5 border-t border-line-soft shrink-0">
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
                                                enterKeyHint="send"
                                                className="flex-1 min-w-0 px-3.5 py-2 rounded-xl bg-surface-panel border border-line-soft text-ink-strong placeholder:text-ink-faint text-ludo-xs font-mono focus:outline-none focus:border-accent/60"
                                            />
                                            <Button
                                                variant="primary"
                                                size="sm"
                                                type="submit"
                                                disabled={sendingChat || !chatInput.trim()}
                                                leftIcon={<LuSend className="w-3.5 h-3.5" />}
                                                className="shrink-0 whitespace-nowrap"
                                            >
                                                {sendingChat ? "..." : "Send"}
                                            </Button>
                                        </form>
                                    </div>
                                </div>
                            )}

                            {/* 2. WAR TAB */}
                            {activeTab === "war" && (
                                <div className="space-y-4">
                                    {!warCall && !activeWar ? (
                                        <div className="py-10 px-4 rounded-2xl bg-surface-panel border border-line-soft flex flex-col items-center justify-center text-center space-y-4">
                                            <div className="w-16 h-16 rounded-2xl bg-warn/15 border border-warn/35 flex items-center justify-center text-warn shadow-[0_0_24px_rgba(245,158,11,0.2)]">
                                                <LuSwords className="w-8 h-8" />
                                            </div>
                                            <div>
                                                <h3 className="text-ludo-lg font-bold text-ink-strong">War Room Ready</h3>
                                                <p className="text-ludo-xs font-mono text-ink-muted max-w-xs mt-1">
                                                    Commanders and officers can rally the roster with a stake-backed Call-to-Arms for 1v1 &amp; 2v2 syndicate combat.
                                                </p>
                                            </div>
                                            {isOfficer && (
                                                <Button
                                                    variant="primary"
                                                    size="md"
                                                    leftIcon={<LuPlus className="w-4 h-4" />}
                                                    onClick={() => setIsPostingNotice(true)}
                                                    className="font-bold tracking-wider whitespace-nowrap"
                                                >
                                                    Post War Notice
                                                </Button>
                                            )}
                                        </div>
                                    ) : warCall && !activeWar ? (
                                        /* NOTICE / SEARCHING PHASE */
                                        <div className="space-y-4">
                                            <div className="p-4 rounded-2xl bg-surface-panel border border-warn/35 space-y-4">
                                                <div className="flex flex-wrap items-center justify-between gap-3">
                                                    <div>
                                                        <div className="flex items-center gap-2">
                                                            <Chip size="sm" status={warCall.status === "searching" ? "ok" : "warn"}>
                                                                {warCall.status === "searching" ? "SEARCHING" : "CALL TO ARMS"}
                                                            </Chip>
                                                            <span className="font-mono text-ludo-xs text-ink-muted">
                                                                {warCall.bracket}v{warCall.bracket} Bracket
                                                            </span>
                                                        </div>
                                                        <div className="text-ludo-lg font-bold font-mono text-ink-strong mt-1.5 flex items-center gap-1.5">
                                                            <LuCoins className="w-4 h-4 text-warn" />
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
                                                                className="px-3 py-2 rounded-xl bg-accent-soft hover:bg-accent/20 border border-accent/40 text-accent font-mono text-ludo-xs font-bold inline-flex items-center gap-1.5"
                                                            >
                                                                <LuSearch className="w-3.5 h-3.5" />
                                                                <span>War Board</span>
                                                            </button>
                                                        )}
                                                        {isOfficer && (
                                                            <button
                                                                onClick={() => void cancelNotice().catch((e) => showErr(e, "Failed to cancel notice"))}
                                                                className="px-3 py-2 rounded-xl bg-negative/15 hover:bg-negative/25 border border-negative/35 text-negative font-mono text-ludo-xs font-bold inline-flex items-center gap-1"
                                                            >
                                                                <LuX className="w-3.5 h-3.5" />
                                                                <span>Cancel</span>
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>

                                                {/* Roster Fill Bar */}
                                                <div className="space-y-1.5">
                                                    <div className="flex justify-between text-ludo-xs font-mono text-ink-muted">
                                                        <span className="inline-flex items-center gap-1">
                                                            <LuUsers className="w-3.5 h-3.5 text-accent" />
                                                            Mobilized Roster
                                                        </span>
                                                        <span className="font-bold text-ink-strong">
                                                            {stakes.length}/{warCall.bracket} Locked
                                                        </span>
                                                    </div>
                                                    <HudProgressGauge
                                                        percent={Math.min(100, Math.round((stakes.length / warCall.bracket) * 100))}
                                                        tone="warn"
                                                    />
                                                </div>

                                                {/* Governance Split Breakdown */}
                                                <div className="p-3 rounded-xl bg-surface-recessed border border-line-soft space-y-2.5 text-ludo-xs font-mono">
                                                    <div className="flex items-center justify-between">
                                                        <span className="text-ink-muted">Profit Split (80% Merit / 20% Gov)</span>
                                                        <span className="text-accent font-bold">5% Protocol Rake</span>
                                                    </div>
                                                    <div className="h-2 rounded-full overflow-hidden flex bg-line-soft">
                                                        {warCall.stakers_pct > 0 && <div className="bg-warn h-full min-w-0" style={{ flex: warCall.stakers_pct }} />}
                                                        {warCall.treasury_pct > 0 && <div className="bg-positive h-full min-w-0" style={{ flex: warCall.treasury_pct }} />}
                                                        {warCall.leader_pct > 0 && <div className="bg-accent h-full min-w-0" style={{ flex: warCall.leader_pct }} />}
                                                        {warCall.officers_pct > 0 && <div className="bg-ink-faint h-full min-w-0" style={{ flex: warCall.officers_pct }} />}
                                                    </div>
                                                    <div className="grid grid-cols-2 gap-2">
                                                        <div className="flex items-center justify-between">
                                                            <span className="text-warn">Stakers</span>
                                                            <span className="font-bold text-ink-strong">{warCall.stakers_pct}%</span>
                                                        </div>
                                                        <div className="flex items-center justify-between">
                                                            <span className="text-positive">Treasury</span>
                                                            <span className="font-bold text-ink-strong">{warCall.treasury_pct}%</span>
                                                        </div>
                                                        <div className="flex items-center justify-between">
                                                            <span className="text-accent">Leader</span>
                                                            <span className="font-bold text-ink-strong">{warCall.leader_pct}%</span>
                                                        </div>
                                                        <div className="flex items-center justify-between">
                                                            <span className="text-ink-muted">Officers</span>
                                                            <span className="font-bold text-ink-strong">{warCall.officers_pct}%</span>
                                                        </div>
                                                    </div>
                                                </div>

                                                {buyInError && (
                                                    <div className="p-2.5 rounded-xl bg-negative/15 border border-negative/25 text-ludo-xs font-mono text-negative">
                                                        {buyInError}
                                                    </div>
                                                )}

                                                <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                                                    <span className="text-ludo-xs font-mono text-ink-muted">
                                                        Entry: <strong className="text-ink-strong">{warCall.member_fee.toLocaleString()} CHIPS</strong>
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
                                                                leftIcon={<LuLock className="w-3.5 h-3.5" />}
                                                                onClick={handleJoinWarRoster}
                                                                className="whitespace-nowrap"
                                                            >
                                                                {buyInSubmitting
                                                                    ? "Approving in Wallet..."
                                                                    : `Lock ${warCall.member_fee.toLocaleString()} CHIPS`}
                                                            </Button>
                                                        );
                                                    })()}
                                                </div>
                                            </div>
                                        </div>
                                    ) : (
                                        /* ACTIVE / PREP WAR PHASE */
                                        <div className="space-y-4">
                                            <div className="p-4 rounded-2xl bg-surface-panel border border-accent/40 space-y-3">
                                                <div className="flex items-center justify-between gap-2">
                                                    <Chip size="sm" status="ok">
                                                        {activeWar?.status === "prep_phase" ? "48H PREP PHASE" : "ACTIVE COMBAT"}
                                                    </Chip>
                                                    <span className="font-mono text-ludo-xs text-ink-muted">
                                                        {(activeWar?.bracket || 10) * 3} Fixtures ({(activeWar?.bracket || 10) * 2}×1v1 + {activeWar?.bracket || 10}×2v2)
                                                    </span>
                                                </div>

                                                <div className="flex items-center justify-between gap-3 py-1">
                                                    <div className="flex items-center gap-2 min-w-0">
                                                        <ClanCrestBadge crest={activeWar?.clan_a?.crest} tag={activeWar?.clan_a?.tag} size="sm" />
                                                        <span className="font-mono font-bold text-ink-strong truncate">
                                                            [{activeWar?.clan_a?.tag || "CLAN A"}]
                                                        </span>
                                                    </div>
                                                    <div className="px-3 py-1 rounded-xl bg-surface-recessed border border-line-soft font-mono text-ludo-lg font-bold text-accent shrink-0 tabular-nums">
                                                        {activeWar?.clan_a_score} – {activeWar?.clan_b_score}
                                                    </div>
                                                    <div className="flex items-center gap-2 min-w-0">
                                                        <span className="font-mono font-bold text-ink-strong truncate">
                                                            [{activeWar?.clan_b?.tag || "CLAN B"}]
                                                        </span>
                                                        <ClanCrestBadge crest={activeWar?.clan_b?.crest} tag={activeWar?.clan_b?.tag} size="sm" />
                                                    </div>
                                                </div>
                                            </div>

                                            <SectionLabel right={<span className="text-ludo-xs font-mono text-ink-faint">{fixtures.length} battles</span>}>
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
                                                            className="p-3 rounded-2xl bg-surface-panel border border-line-soft flex flex-col gap-2 text-ludo-xs font-mono"
                                                        >
                                                            <div className="flex items-center justify-between gap-2">
                                                                <div className="flex items-center gap-2 min-w-0">
                                                                    <span className="px-2 py-0.5 rounded-md bg-surface-recessed border border-line-soft text-ink-muted shrink-0">
                                                                        #{f.fixture_index}
                                                                    </span>
                                                                    <span className="px-2 py-0.5 rounded-md bg-accent-soft text-accent font-bold shrink-0">
                                                                        {f.game_shape}
                                                                    </span>
                                                                    <span className="text-ink-strong truncate">
                                                                        {formatSeatLabel(f.clan_a_seats)} vs {formatSeatLabel(f.clan_b_seats)}
                                                                    </span>
                                                                </div>

                                                                <div className="flex items-center gap-1.5 shrink-0">
                                                                    {canPlay ? (
                                                                        <Button
                                                                            size="sm"
                                                                            variant={isClanAHost ? "primary" : "secondary"}
                                                                            leftIcon={<LuPlay className="w-3 h-3" />}
                                                                            onClick={() => handleDeployFixture(f)}
                                                                            className="whitespace-nowrap"
                                                                        >
                                                                            {isClanAHost ? "Deploy" : "Join"}
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

                                                            <div className="flex flex-wrap items-center justify-between gap-2 pt-1.5 border-t border-line-soft text-ink-muted">
                                                                <span className="inline-flex items-center gap-1">
                                                                    <LuCalendar className="w-3 h-3 text-accent" />
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
                                                                            className="px-2 py-1 rounded-lg bg-positive/20 hover:bg-positive/30 text-positive font-bold inline-flex items-center gap-1"
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
                                                                            className="px-2 py-1 rounded-lg bg-surface-recessed hover:bg-surface-hover text-accent inline-flex items-center gap-1"
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
                                    <div className="p-4 rounded-2xl bg-surface-panel border border-warn/35 space-y-3">
                                        <div className="flex items-center justify-between gap-2">
                                            <div className="flex items-center gap-2.5 min-w-0">
                                                <div className="w-10 h-10 rounded-xl bg-warn/15 border border-warn/40 flex items-center justify-center text-warn shrink-0">
                                                    <LuTrophy className="w-5 h-5" />
                                                </div>
                                                <div className="min-w-0">
                                                    <div className="text-ink-strong font-bold text-ludo-sm truncate">Sunday Weekly Vault</div>
                                                    <div className="text-ink-muted inline-flex items-center gap-1">
                                                        <LuClock className="w-3 h-3 text-warn" />
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
                                                <div className="flex justify-between text-ink-muted">
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
                                                                    ? "bg-positive/20 border-positive/45 text-positive"
                                                                    : t.unlocked
                                                                      ? "bg-surface-panel border-line-soft text-ink-strong"
                                                                      : "bg-surface-recessed border-line-soft text-ink-faint"
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
                                        <div className="p-6 rounded-2xl bg-surface-panel border border-line-soft text-ink-faint text-center">
                                            Play online matches or clan war fixtures to progress syndicate contracts.
                                        </div>
                                    ) : (
                                        <div className="space-y-2.5">
                                            {missions.map((m) => {
                                                const contractDesc =
                                                    m.key === "daily_online_matches_3"
                                                        ? "Complete online matches to add syndicate CXP."
                                                        : m.key === "daily_captures_5"
                                                          ? "Capture opponent tokens across live matches."
                                                          : m.key === "daily_clan_war_points"
                                                            ? "Earn War Points in active Clan War fixtures."
                                                            : "Collective syndicate members reaching weekly CXP tier.";
                                                return (
                                                    <MissionCard
                                                        key={m.key}
                                                        title={m.title}
                                                        description={contractDesc}
                                                        icon={
                                                            m.scope === "weekly" ? (
                                                                <LuFlame className="w-5 h-5" />
                                                            ) : (
                                                                <LuTarget className="w-5 h-5" />
                                                            )
                                                        }
                                                        iconContainerClassName={
                                                            m.scope === "weekly"
                                                                ? "bg-warn/15 text-warn border-warn/40"
                                                                : "bg-accent-soft text-accent border-accent/35"
                                                        }
                                                        rewardAmount={`+${m.rewardCxp}`}
                                                        rewardUnit="CXP"
                                                        rewardTone={m.scope === "weekly" ? "amber" : "cxp"}
                                                        rewardIcon={<LuZap className="w-3 h-3 text-accent" />}
                                                        scopeLabel={m.scope === "weekly" ? "WEEKLY SYNDICATE" : "DAILY CONTRACT"}
                                                        progress={m.progress}
                                                        target={m.target}
                                                        isCompleted={m.completed}
                                                        actionSlot={
                                                            m.completed ? (
                                                                <span className="min-w-[70px] px-2.5 py-1.5 rounded-xl border border-positive/40 bg-positive/15 text-positive font-mono text-ludo-xs font-bold inline-flex items-center justify-center gap-1">
                                                                    <LuCheck className="w-3 h-3" />
                                                                    <span>DONE</span>
                                                                </span>
                                                            ) : m.key === "daily_clan_war_points" ? (
                                                                <Button
                                                                    variant="secondary"
                                                                    size="sm"
                                                                    onClick={() => setActiveTab("war")}
                                                                    className="min-w-[70px] rounded-xl font-mono text-ludo-xs uppercase"
                                                                >
                                                                    WAR
                                                                </Button>
                                                            ) : (
                                                                <Button
                                                                    variant="secondary"
                                                                    size="sm"
                                                                    onClick={onClose}
                                                                    className="min-w-[70px] rounded-xl font-mono text-ludo-xs uppercase"
                                                                >
                                                                    GO
                                                                </Button>
                                                            )
                                                        }
                                                    />
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* 4. TREASURY TAB */}
                            {activeTab === "treasury" && (
                                <div className="space-y-4 text-ludo-xs font-mono">
                                    <div className="p-4 rounded-2xl bg-surface-panel border border-accent/35 flex flex-wrap items-center justify-between gap-3">
                                        <div className="flex items-center gap-3">
                                            <div className="w-11 h-11 rounded-2xl bg-accent-soft border border-accent/40 flex items-center justify-center text-accent shrink-0">
                                                <LuLandmark className="w-5 h-5" />
                                            </div>
                                            <div>
                                                <div className="text-ink-muted">Clan War Chest</div>
                                                <div className="text-ludo-lg font-bold text-accent tabular-nums">
                                                    {Number(clan.treasury_balance).toLocaleString()} CHIPS
                                                </div>
                                            </div>
                                        </div>
                                        <Button
                                            variant="primary"
                                            size="sm"
                                            leftIcon={<LuPlus className="w-3.5 h-3.5" />}
                                            onClick={() => setIsFundingTreasury((v) => !v)}
                                            className="whitespace-nowrap"
                                        >
                                            {isFundingTreasury ? "Close" : "Fund"}
                                        </Button>
                                    </div>

                                    {isFundingTreasury && (
                                        <form onSubmit={handleFundTreasurySubmit} className="p-4 rounded-2xl bg-surface-recessed border border-accent/30 space-y-3">
                                            <div className="flex flex-wrap gap-1.5">
                                                {TREASURY_PRESETS.map((preset) => (
                                                    <button
                                                        key={preset}
                                                        type="button"
                                                        onClick={() => setFundAmountInput(String(preset))}
                                                        className={`px-2.5 py-1 rounded-lg border font-bold ${
                                                            Number(fundAmountInput) === preset
                                                                ? "bg-accent-soft border-accent text-accent"
                                                                : "bg-surface-panel border-line-soft text-ink-muted hover:text-ink-strong"
                                                        }`}
                                                    >
                                                        {preset.toLocaleString()}
                                                    </button>
                                                ))}
                                            </div>
                                            <div className="flex gap-2">
                                                <input
                                                    type="text"
                                                    inputMode="numeric"
                                                    value={fundAmountInput}
                                                    onChange={(e) => setFundAmountInput(e.target.value.replace(/[^0-9]/g, ""))}
                                                    autoComplete="off"
                                                    autoCorrect="off"
                                                    autoCapitalize="none"
                                                    spellCheck={false}
                                                    enterKeyHint="done"
                                                    className="flex-1 min-w-0 px-3 py-2 rounded-xl bg-surface-panel border border-line-soft text-ink-strong focus:outline-none focus:border-accent/60"
                                                />
                                                <Button type="submit" variant="primary" size="sm" disabled={fundSubmitting}>
                                                    {fundSubmitting ? "Depositing..." : "Deposit"}
                                                </Button>
                                            </div>
                                        </form>
                                    )}

                                    <SectionLabel right={<span className="text-ludo-xs font-mono text-ink-faint">{treasuryLedger.length} entries</span>}>
                                        Treasury Ledger
                                    </SectionLabel>

                                    {treasuryLedger.length === 0 ? (
                                        <div className="p-6 rounded-2xl bg-surface-panel border border-line-soft text-ink-faint text-center">
                                            No treasury transactions yet. Win clan wars or donate CHIPS to build your war chest.
                                        </div>
                                    ) : (
                                        <div className="space-y-2 max-h-[260px] overflow-y-auto no-scrollbar">
                                            {treasuryLedger.map((entry) => {
                                                const positive = Number(entry.amount) >= 0;
                                                return (
                                                    <div
                                                        key={entry.id}
                                                        className="p-3 rounded-2xl bg-surface-panel border border-line-soft flex items-center justify-between gap-2.5"
                                                    >
                                                        <div className="flex items-center gap-2.5 min-w-0">
                                                            <div
                                                                className={`w-8 h-8 rounded-xl flex items-center justify-center border shrink-0 ${
                                                                    positive
                                                                        ? "bg-positive/15 border-positive/35 text-positive"
                                                                        : "bg-negative/15 border-negative/35 text-negative"
                                                                }`}
                                                            >
                                                                {positive ? (
                                                                    <LuArrowDownLeft className="w-4 h-4" />
                                                                ) : (
                                                                    <LuArrowUpRight className="w-4 h-4" />
                                                                )}
                                                            </div>
                                                            <div className="min-w-0">
                                                                <div className="font-bold text-ink-strong uppercase truncate">
                                                                    {entry.reason.replace("_", " ")}
                                                                </div>
                                                                <div className="text-ink-faint truncate">
                                                                    {new Date(entry.created_at).toLocaleDateString()}{" "}
                                                                    {entry.ref ? `· ${entry.ref.slice(0, 16)}` : ""}
                                                                </div>
                                                            </div>
                                                        </div>
                                                        <span className={`font-bold shrink-0 tabular-nums ${positive ? "text-positive" : "text-negative"}`}>
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
                                    <div className="flex items-center justify-between text-ludo-xs font-mono text-ink-muted">
                                        <span className="inline-flex items-center gap-1.5">
                                            <LuUsers className="w-3.5 h-3.5 text-accent" />
                                            Roster ({members.length || clan.member_count}/{levelConfig?.member_cap ?? 20})
                                        </span>
                                        <div className="flex items-center gap-3">
                                            {isOfficer && (
                                                <button
                                                    type="button"
                                                    onClick={openSettingsModal}
                                                    className="px-2.5 py-1 rounded-lg bg-surface-panel hover:bg-surface-hover border border-line-soft text-accent inline-flex items-center gap-1"
                                                >
                                                    <LuSettings className="w-3.5 h-3.5" />
                                                    <span>Settings</span>
                                                </button>
                                            )}
                                            <button
                                                onClick={() => void leaveClan().catch((e) => showErr(e, "Failed to leave clan"))}
                                                className="px-2.5 py-1 rounded-lg bg-negative/10 hover:bg-negative/20 border border-negative/30 text-negative"
                                            >
                                                Leave
                                            </button>
                                        </div>
                                    </div>

                                    {/* Pending Join Requests */}
                                    {isOfficer && joinRequests.length > 0 && (
                                        <div className="space-y-2 p-3 rounded-2xl bg-accent-soft border border-accent/35">
                                            <div className="text-ludo-xs font-mono font-bold text-accent uppercase flex items-center gap-1.5">
                                                <LuPlus className="w-3.5 h-3.5" />
                                                <span>Pending Applications ({joinRequests.length})</span>
                                            </div>
                                            {joinRequests.map((req) => (
                                                <div
                                                    key={req.id}
                                                    className="p-2.5 rounded-xl bg-surface-recessed border border-line-soft flex items-center justify-between gap-2 text-ludo-xs font-mono"
                                                >
                                                    <div className="min-w-0">
                                                        <div className="font-bold text-ink-strong truncate">
                                                            {req.player?.username || shortHex(req.wallet_address)}
                                                        </div>
                                                        <div className="text-ink-faint">{req.player?.rank_tier || "Unranked"}</div>
                                                    </div>
                                                    <div className="flex items-center gap-1.5 shrink-0">
                                                        <button
                                                            type="button"
                                                            onClick={() =>
                                                                void reviewRequest(clan.id, req.wallet_address, "accept").catch((e) =>
                                                                    showErr(e, "Failed to accept"),
                                                                )
                                                            }
                                                            className="px-2.5 py-1 rounded-lg bg-positive/20 hover:bg-positive/30 text-positive font-bold inline-flex items-center gap-1"
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
                                                            className="px-2 py-1 rounded-lg bg-negative/15 hover:bg-negative/25 text-negative inline-flex items-center"
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
                                            <div className="p-3.5 rounded-2xl bg-surface-panel border border-line-soft flex items-center justify-between text-ludo-xs font-mono">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-9 h-9 rounded-xl bg-warn/20 border border-warn/35 text-warn flex items-center justify-center">
                                                        <LuCrown className="w-4 h-4" />
                                                    </div>
                                                    <div>
                                                        <div className="font-bold text-ink-strong">{shortHex(clan.leader_wallet)}</div>
                                                        <div className="text-warn text-ludo-xs">COMMANDER</div>
                                                    </div>
                                                </div>
                                                <span className="text-ink-faint">Leader</span>
                                            </div>
                                        ) : (
                                            members.map((m) => (
                                                <div
                                                    key={m.id}
                                                    className="p-3 rounded-2xl bg-surface-panel border border-line-soft flex items-center justify-between text-ludo-xs font-mono gap-2"
                                                >
                                                    <div className="flex items-center gap-3 min-w-0">
                                                        <div
                                                            className={`w-9 h-9 rounded-xl border flex items-center justify-center shrink-0 ${
                                                                m.role === "commander"
                                                                    ? "bg-warn/15 border-warn/35 text-warn"
                                                                    : m.role === "officer"
                                                                      ? "bg-accent-soft border-accent/35 text-accent"
                                                                      : "bg-surface-recessed border-line-soft text-ink-muted"
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
                                                            <div className="font-bold text-ink-strong truncate">
                                                                {m.player?.username || shortHex(m.wallet_address)}
                                                            </div>
                                                            <div className="text-accent text-ludo-xs uppercase truncate">
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
                                                                    className="px-2 py-1 rounded-lg bg-surface-recessed hover:bg-surface-hover text-ink-muted hover:text-ink-strong"
                                                                >
                                                                    {m.role === "officer" ? "Demote" : "Promote"}
                                                                </button>
                                                                <button
                                                                    onClick={() =>
                                                                        void kickMember(m.wallet_address).catch((e) =>
                                                                            showErr(e, "Failed to kick member"),
                                                                        )
                                                                    }
                                                                    className="px-2 py-1 rounded-lg bg-negative/15 hover:bg-negative/25 text-negative"
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
            </GamePanelShell>

            {/* ── Modal: Create Clan ──────────────────────────────────────── */}
            {isCreatingClan && (
                <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-surface-page/75 backdrop-blur-md">
                    <div
                        className="ludo-arena-scope ludo-clan-scope panel-shell-3077 relative w-full max-w-md p-6 rounded-[28px] border border-line-strong shadow-2xl space-y-4 text-ink-strong font-sans overflow-hidden"
                        style={{
                            backgroundImage: "var(--panel-bg-image, var(--ludo-bg-cosmic))",
                            backgroundColor: "var(--panel-bg, rgba(11, 15, 23, 0.98))",
                            backdropFilter: "blur(32px)",
                        }}
                    >
                        <HudCornerTicks />
                        <h3 className="text-ludo-lg font-bold text-ink-strong flex items-center gap-2 relative z-10">
                            <LuSparkles className="w-5 h-5 text-accent" />
                            <span>Forge Tactical Clan</span>
                        </h3>
                        <div className="p-3 rounded-xl bg-accent-soft border border-accent/25 text-ludo-xs font-mono text-accent relative z-10">
                            Clan creation fee: <strong>10,000 CHIPS</strong>, verified pre-flight before transferring to the protocol treasury on Base Sepolia.
                        </div>

                        {createError && (
                            <div className="p-2.5 rounded-xl bg-negative/15 border border-negative/30 text-ludo-xs font-mono text-negative relative z-10">
                                {createError}
                            </div>
                        )}

                        <form onSubmit={handleCreateClanSubmit} className="space-y-3 font-mono text-ludo-xs relative z-10">
                            <div className="flex items-center gap-3 p-2.5 rounded-xl bg-surface-recessed border border-line-soft">
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
                                                        ? "border-accent bg-accent-soft text-accent"
                                                        : "border-line-soft bg-surface-panel text-ink-muted"
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
                                                    createPaletteIdx === idx ? "border-ink-strong scale-110" : "border-transparent opacity-70"
                                                }`}
                                                style={{ backgroundColor: pal.primary }}
                                                aria-label={pal.label}
                                            />
                                        ))}
                                    </div>
                                </div>
                            </div>

                            <div>
                                <label className="text-ink-muted block mb-1">Clan Name (3-24 chars)</label>
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
                                    className="w-full px-3 py-2 rounded-xl bg-surface-recessed border border-line-soft text-ink-strong placeholder:text-ink-faint focus:outline-none focus:border-accent/60"
                                />
                            </div>

                            <div>
                                <label className="text-ink-muted block mb-1">Clan Tag (2-5 uppercase chars)</label>
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
                                    className="w-full px-3 py-2 rounded-xl bg-surface-recessed border border-line-soft text-ink-strong placeholder:text-ink-faint focus:outline-none focus:border-accent/60 uppercase"
                                />
                            </div>

                            <div>
                                <label className="text-ink-muted block mb-1">Motto / Bio (optional)</label>
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
                                    className="w-full px-3 py-2 rounded-xl bg-surface-recessed border border-line-soft text-ink-strong placeholder:text-ink-faint focus:outline-none focus:border-accent/60"
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
                <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-surface-page/75 backdrop-blur-md">
                    <div
                        className="ludo-arena-scope ludo-clan-scope panel-shell-3077 relative w-full max-w-md p-6 rounded-[28px] border border-warn/45 shadow-2xl space-y-4 text-ink-strong font-sans overflow-hidden"
                        style={{
                            backgroundImage: "var(--panel-bg-image, var(--ludo-bg-cosmic))",
                            backgroundColor: "var(--panel-bg, rgba(11, 15, 23, 0.98))",
                            backdropFilter: "blur(32px)",
                        }}
                    >
                        <HudCornerTicks />
                        <h3 className="text-ludo-lg font-bold text-ink-strong flex items-center gap-2 relative z-10">
                            <LuSwords className="w-5 h-5 text-warn" />
                            <span>Call to Arms: Post War Notice</span>
                        </h3>
                        <form onSubmit={handlePostNoticeSubmit} className="space-y-4 font-mono text-ludo-xs relative z-10">
                            <div>
                                <label className="text-ink-muted block mb-1">Bracket Size</label>
                                <div className="grid grid-cols-4 gap-2">
                                    {([5, 10, 15, 20] as const).map((b) => (
                                        <button
                                            key={b}
                                            type="button"
                                            onClick={() => setNoticeBracket(b)}
                                            className={`py-2 rounded-xl border text-center font-bold ${
                                                noticeBracket === b
                                                    ? "border-warn bg-warn/20 text-warn"
                                                    : "border-line-soft bg-surface-recessed text-ink-muted"
                                            }`}
                                        >
                                            {b}v{b}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-2">
                                <div>
                                    <label className="text-ink-muted block mb-1">Member Entry Fee</label>
                                    <input
                                        type="text"
                                        inputMode="numeric"
                                        value={String(noticeFee || "")}
                                        onChange={(e) => {
                                            const digits = e.target.value.replace(/[^0-9]/g, "");
                                            setNoticeFee(digits ? Number(digits) : 0);
                                        }}
                                        autoComplete="off"
                                        autoCorrect="off"
                                        autoCapitalize="none"
                                        spellCheck={false}
                                        enterKeyHint="next"
                                        className="w-full px-3 py-2 rounded-xl bg-surface-recessed border border-line-soft text-ink-strong focus:outline-none focus:border-warn"
                                    />
                                </div>
                                <div>
                                    <label className="text-ink-muted block mb-1">Treasury Subsidy</label>
                                    <input
                                        type="text"
                                        inputMode="numeric"
                                        value={String(noticeSubsidy || 0)}
                                        onChange={(e) => {
                                            const digits = e.target.value.replace(/[^0-9]/g, "");
                                            const max = Number(clan?.treasury_balance || 0);
                                            const next = digits ? Number(digits) : 0;
                                            setNoticeSubsidy(Math.min(max, next));
                                        }}
                                        autoComplete="off"
                                        autoCorrect="off"
                                        autoCapitalize="none"
                                        spellCheck={false}
                                        enterKeyHint="done"
                                        className="w-full px-3 py-2 rounded-xl bg-surface-recessed border border-line-soft text-ink-strong focus:outline-none focus:border-warn"
                                    />
                                </div>
                            </div>

                            <div className="text-ink-muted">
                                Target War Pot: <strong className="text-warn">{(noticeBracket * noticeFee).toLocaleString()} CHIPS</strong> ({noticeBracket * 3} fixtures)
                            </div>

                            <div className="p-3 rounded-xl bg-surface-recessed border border-line-soft space-y-2">
                                <div className="flex items-center justify-between">
                                    <span className="text-ink-faint font-bold">20% Governance Split</span>
                                    <span className={isSplitValid ? "text-positive font-bold" : "text-negative font-bold"}>
                                        Sum: {splitSum}% {isSplitValid ? "OK" : "(Must equal 100%)"}
                                    </span>
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                    <div>
                                        <label className="text-ink-muted block">Stakers: {splitStakers}%</label>
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
                                        <label className="text-ink-muted block">Treasury: {splitTreasury}%</label>
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
                                        <label className="text-ink-muted block">Leader (max 50%): {splitLeader}%</label>
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
                                        <label className="text-ink-muted block">Officers (max 50%): {splitOfficers}%</label>
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
                <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-surface-page/75 backdrop-blur-md">
                    <div
                        className="ludo-arena-scope ludo-clan-scope panel-shell-3077 relative w-full max-w-lg max-h-[80vh] flex flex-col p-6 rounded-[28px] border border-line-strong shadow-2xl space-y-4 text-ink-strong font-sans overflow-hidden"
                        style={{
                            backgroundImage: "var(--panel-bg-image, var(--ludo-bg-cosmic))",
                            backgroundColor: "var(--panel-bg, rgba(11, 15, 23, 0.98))",
                            backdropFilter: "blur(32px)",
                        }}
                    >
                        <HudCornerTicks />
                        <div className="flex items-center justify-between gap-2 relative z-10">
                            <h3 className="text-ludo-lg font-bold text-ink-strong flex items-center gap-2">
                                <LuSwords className="w-5 h-5 text-warn" />
                                <span>Open War Board</span>
                            </h3>
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => setShowWarBoard(false)}
                                aria-label="Close Open War Board"
                                className="panel-close-3077 bg-surface-hover border border-line-soft shrink-0"
                            >
                                <CloseReticleIcon className="icon-md" />
                            </Button>
                        </div>

                        <div className="flex-1 overflow-y-auto no-scrollbar space-y-3 relative z-10">
                            {warBoard.filter((c) => c.clan_id !== clan?.id).length === 0 ? (
                                <div className="py-12 text-center text-ink-faint font-mono text-ludo-xs">
                                    No other clans currently searching in this bracket. Your notice is listed for other clans to match!
                                </div>
                            ) : (
                                warBoard
                                    .filter((c) => c.clan_id !== clan?.id)
                                    .map((c) => (
                                        <div
                                            key={c.id}
                                            className="p-3.5 rounded-2xl bg-surface-panel border border-line-soft flex flex-wrap items-center justify-between gap-3 text-ludo-xs font-mono"
                                        >
                                            <div className="flex items-center gap-3">
                                                <ClanCrestBadge crest={c.clan?.crest} tag={c.clan?.tag} size="md" />
                                                <div>
                                                    <div className="font-bold text-ink-strong text-ludo-sm">
                                                        {c.clan?.name} <span className="text-accent">[{c.clan?.tag}]</span>
                                                    </div>
                                                    <div className="text-ink-muted">
                                                        {c.bracket}v{c.bracket} • Stake: {Number(c.total_stake).toLocaleString()} CHIPS • CWR: {c.clan?.cwr}
                                                    </div>
                                                </div>
                                            </div>

                                            <button
                                                disabled={matchingCallId === c.id}
                                                onClick={() => void handleMatchOpponent(c.id)}
                                                className="px-4 py-2 rounded-xl bg-warn/20 hover:bg-warn/30 border border-warn/40 text-warn font-bold transition-all"
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
                <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-surface-page/75 backdrop-blur-md">
                    <div
                        className="ludo-arena-scope ludo-clan-scope panel-shell-3077 relative w-full max-w-sm p-6 rounded-[28px] border border-line-strong shadow-2xl space-y-4 text-ink-strong font-sans overflow-hidden"
                        style={{
                            backgroundImage: "var(--panel-bg-image, var(--ludo-bg-cosmic))",
                            backgroundColor: "var(--panel-bg, rgba(11, 15, 23, 0.98))",
                            backdropFilter: "blur(32px)",
                        }}
                    >
                        <HudCornerTicks />
                        <h3 className="text-ludo-lg font-bold text-ink-strong flex items-center gap-2 relative z-10">
                            <LuCalendar className="w-5 h-5 text-accent" />
                            <span>Schedule Fixture #{schedulingFixture.fixture_index}</span>
                        </h3>
                        <form onSubmit={handleProposeSchedule} className="space-y-3 font-mono text-ludo-xs relative z-10">
                            <div>
                                <label className="text-ink-muted block mb-1">Proposed Match Time (Local)</label>
                                <input
                                    type="datetime-local"
                                    required
                                    value={scheduleTimeInput}
                                    onChange={(e) => setScheduleTimeInput(e.target.value)}
                                    autoComplete="off"
                                    autoCorrect="off"
                                    autoCapitalize="none"
                                    spellCheck={false}
                                    className="w-full px-3 py-2 rounded-xl bg-surface-recessed border border-line-soft text-ink-strong focus:outline-none focus:border-accent/60"
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
                <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-surface-page/75 backdrop-blur-md">
                    <div
                        className="ludo-arena-scope ludo-clan-scope panel-shell-3077 relative w-full max-w-md p-6 rounded-[28px] border border-line-strong shadow-2xl space-y-4 text-ink-strong font-sans overflow-hidden"
                        style={{
                            backgroundImage: "var(--panel-bg-image, var(--ludo-bg-cosmic))",
                            backgroundColor: "var(--panel-bg, rgba(11, 15, 23, 0.98))",
                            backdropFilter: "blur(32px)",
                        }}
                    >
                        <HudCornerTicks />
                        <h3 className="text-ludo-lg font-bold text-ink-strong flex items-center gap-2 relative z-10">
                            <LuSettings className="w-5 h-5 text-accent" />
                            <span>Clan Settings</span>
                        </h3>
                        <form onSubmit={handleSaveSettings} className="space-y-3 font-mono text-ludo-xs relative z-10">
                            <div>
                                <label className="text-ink-muted block mb-1">Join Policy</label>
                                <div className="grid grid-cols-3 gap-2">
                                    {(["open", "request", "invite_only"] as ClanJoinPolicy[]).map((p) => (
                                        <button
                                            key={p}
                                            type="button"
                                            onClick={() => setSettingsPolicy(p)}
                                            className={`py-2 rounded-xl border uppercase font-bold ${
                                                settingsPolicy === p
                                                    ? "border-accent bg-accent-soft text-accent"
                                                    : "border-line-soft bg-surface-recessed text-ink-muted"
                                            }`}
                                        >
                                            {p.replace("_", " ")}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div>
                                <label className="text-ink-muted block mb-1">Motto / Bio</label>
                                <input
                                    type="text"
                                    maxLength={200}
                                    value={settingsBio}
                                    onChange={(e) => setSettingsBio(e.target.value)}
                                    autoComplete="off"
                                    autoCorrect="off"
                                    autoCapitalize="none"
                                    spellCheck={false}
                                    enterKeyHint="next"
                                    className="w-full px-3 py-2 rounded-xl bg-surface-recessed border border-line-soft text-ink-strong focus:outline-none focus:border-accent/60"
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                                <div>
                                    <label className="text-ink-muted block mb-1">Min Player Level</label>
                                    <input
                                        type="text"
                                        inputMode="numeric"
                                        value={String(settingsMinLevel || 1)}
                                        onChange={(e) => {
                                            const digits = e.target.value.replace(/[^0-9]/g, "");
                                            setSettingsMinLevel(digits ? Math.max(1, Number(digits)) : 1);
                                        }}
                                        autoComplete="off"
                                        autoCorrect="off"
                                        autoCapitalize="none"
                                        spellCheck={false}
                                        enterKeyHint="next"
                                        className="w-full px-3 py-2 rounded-xl bg-surface-recessed border border-line-soft text-ink-strong focus:outline-none focus:border-accent/60"
                                    />
                                </div>
                                <div>
                                    <label className="text-ink-muted block mb-1">Farcaster Channel</label>
                                    <input
                                        type="text"
                                        maxLength={64}
                                        placeholder="/ludo-clan"
                                        value={settingsChannel}
                                        onChange={(e) => setSettingsChannel(e.target.value)}
                                        autoComplete="off"
                                        autoCorrect="off"
                                        autoCapitalize="none"
                                        spellCheck={false}
                                        enterKeyHint="done"
                                        className="w-full px-3 py-2 rounded-xl bg-surface-recessed border border-line-soft text-ink-strong placeholder:text-ink-faint focus:outline-none focus:border-accent/60"
                                    />
                                </div>
                            </div>
                            {member?.role === "commander" && (
                                <div className="pt-1">
                                    <label className="text-ink-muted block mb-1">
                                        Treasury Balance &amp; P&amp;L Visibility (Commander)
                                    </label>
                                    <div className="grid grid-cols-2 gap-2">
                                        <button
                                            type="button"
                                            onClick={() => setSettingsTreasuryPublic(false)}
                                            className={`py-2 px-2 rounded-xl border uppercase font-bold inline-flex items-center justify-center gap-1.5 ${
                                                !settingsTreasuryPublic
                                                    ? "border-warn bg-warn/15 text-warn"
                                                    : "border-line-soft bg-surface-recessed text-ink-muted"
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
                                                    ? "border-positive bg-positive/15 text-positive"
                                                    : "border-line-soft bg-surface-recessed text-ink-muted"
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
    );
}
