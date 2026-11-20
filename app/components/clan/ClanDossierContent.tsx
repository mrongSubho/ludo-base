"use client";

import React, { useState } from "react";
import { motion } from "framer-motion";
import {
    LuAward,
    LuCalendar,
    LuCheck,
    LuCoins,
    LuCrown,
    LuEye,
    LuFlame,
    LuLock,
    LuPencil,
    LuRefreshCw,
    LuShare2,
    LuShield,
    LuSlidersHorizontal,
    LuSwords,
    LuTrophy,
    LuUserPlus,
    LuUsers,
    LuZap,
} from "react-icons/lu";
import type {
    ClanCrest,
    ClanHonorMedal,
    ClanProfileDossier,
} from "@/lib/clan/types";
import {
    ClanCrestBadge,
    CREST_EMBLEMS,
    CREST_PALETTES,
} from "@/app/components/ClanCrestBadge";
import { HudProgressGauge } from "@/app/components/HudPrimitives";
import {
    ClanCombatGauge,
    ClanCwrSparkline,
    ClanLevelRoadmap,
    ClanTreasuryDonut,
    ClanVelocityChart,
} from "./ClanInfographics";

type DossierSubTab = "overview" | "combat" | "economy" | "honors";

interface ClanDossierContentProps {
    dossier: ClanProfileDossier;
    mode: "account" | "public";
    onEditCrest?: (crest: Partial<ClanCrest>) => Promise<unknown>;
    onRenameClan?: (params: { newName?: string; newTag?: string; feeChips: number }) => Promise<unknown>;
    onToggleTreasuryPrivacy?: (nextPublic: boolean) => Promise<void>;
    onOpenSettings?: () => void;
    onJoinRequest?: (clanId: string) => Promise<unknown>;
    onInspectMember?: (wallet: string) => void;
    onInspectClan?: (idOrTag: string) => void;
    onRefresh?: () => Promise<unknown>;
}

function shortenWallet(wallet: string): string {
    if (!wallet || wallet.length < 10) return wallet;
    return `${wallet.slice(0, 6)}...${wallet.slice(-4)}`;
}

function formatDateShort(iso: string): string {
    try {
        return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
    } catch {
        return "—";
    }
}

function formatCompactNum(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
    return n.toLocaleString();
}

function renderHonorIcon(icon: ClanHonorMedal["icon"], className = "w-4 h-4") {
    switch (icon) {
        case "crown":
            return <LuCrown className={className} />;
        case "flame":
            return <LuFlame className={className} />;
        case "vault":
            return <LuTrophy className={className} />;
        case "shield":
            return <LuShield className={className} />;
        case "zap":
            return <LuZap className={className} />;
        default:
            return <LuAward className={className} />;
    }
}

export function ClanDossierContent({
    dossier,
    mode,
    onEditCrest,
    onRenameClan,
    onToggleTreasuryPrivacy,
    onOpenSettings,
    onJoinRequest,
    onInspectMember,
    onInspectClan,
    onRefresh,
}: ClanDossierContentProps) {
    const { clan, viewerRole, viewerIsMember, canViewTreasury } = dossier;
    const isCommander = viewerRole === "commander";
    const isOfficerOrCommander = viewerRole === "commander" || viewerRole === "officer";

    const [subTab, setSubTab] = useState<DossierSubTab>("overview");
    const [copiedTag, setCopiedTag] = useState(false);

    // Inline Crest Editor
    const [editingCrest, setEditingCrest] = useState(false);
    const [crestEmblem, setCrestEmblem] = useState<string>(clan.crest?.emblem || "shield");
    const [crestPrimary, setCrestPrimary] = useState<string>(clan.crest?.primary || "#00E5FF");
    const [crestSecondary, setCrestSecondary] = useState<string>(clan.crest?.secondary || "#0D1117");
    const [savingCrest, setSavingCrest] = useState(false);

    // Inline Rebrand / Rename Form
    const [editingRebrand, setEditingRebrand] = useState(false);
    const [newName, setNewName] = useState(clan.name);
    const [newTag, setNewTag] = useState(clan.tag);
    const [savingRebrand, setSavingRebrand] = useState(false);

    const [privacyBusy, setPrivacyBusy] = useState(false);
    const [joinBusy, setJoinBusy] = useState(false);
    const [feedback, setFeedback] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

    const accentColor = clan.crest?.primary || "#00E5FF";
    const cap = dossier.levelConfig?.member_cap ?? 20;
    const nextCxp = dossier.nextLevelConfig?.cxp_required ?? Math.max(1000, clan.cxp + 500);
    const cxpPct = dossier.nextLevelConfig
        ? Math.min(100, Math.round((clan.cxp / Math.max(1, nextCxp)) * 100))
        : 100;
    const seatPct = Math.min(100, Math.round((clan.member_count / Math.max(1, cap)) * 100));
    const unlockedHonors = dossier.honors.filter((h) => h.unlocked).length;
    const honorPct = Math.round((unlockedHonors / Math.max(1, dossier.honors.length)) * 100);

    const handleShareTag = async () => {
        try {
            const shareText = `[${clan.tag}] ${clan.name} — Lvl ${clan.level} ${clan.division} Syndicate (CWR ${clan.cwr})`;
            await navigator.clipboard.writeText(shareText);
            setCopiedTag(true);
            setTimeout(() => setCopiedTag(false), 1800);
        } catch {
            setCopiedTag(false);
        }
    };

    const handleSaveCrest = async () => {
        if (!onEditCrest) return;
        setSavingCrest(true);
        setFeedback(null);
        try {
            await onEditCrest({
                emblem: crestEmblem,
                primary: crestPrimary,
                secondary: crestSecondary,
            });
            setEditingCrest(false);
            setFeedback({ kind: "ok", text: "Clan crest updated." });
        } catch (err) {
            setFeedback({ kind: "err", text: err instanceof Error ? err.message : "Failed to update crest" });
        } finally {
            setSavingCrest(false);
        }
    };

    const handleSaveRebrand = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!onRenameClan) return;
        setSavingRebrand(true);
        setFeedback(null);
        try {
            await onRenameClan({
                newName: newName.trim(),
                newTag: newTag.trim().toUpperCase(),
                feeChips: dossier.renameFeeChips,
            });
            setEditingRebrand(false);
            setFeedback({
                kind: "ok",
                text: `Syndicate rebranded for ${dossier.renameFeeChips.toLocaleString()} CHIPS.`,
            });
        } catch (err) {
            setFeedback({ kind: "err", text: err instanceof Error ? err.message : "Rebrand failed" });
        } finally {
            setSavingRebrand(false);
        }
    };

    const handleTogglePrivacy = async () => {
        if (!onToggleTreasuryPrivacy) return;
        setPrivacyBusy(true);
        setFeedback(null);
        try {
            const next = !Boolean(clan.treasury_public);
            await onToggleTreasuryPrivacy(next);
            setFeedback({
                kind: "ok",
                text: next
                    ? "Treasury Balance & P&L are now visible to public scouts."
                    : "Treasury Balance & P&L locked to Clan Members only.",
            });
        } catch (err) {
            setFeedback({ kind: "err", text: err instanceof Error ? err.message : "Failed to update visibility" });
        } finally {
            setPrivacyBusy(false);
        }
    };

    const handleJoin = async () => {
        if (!onJoinRequest) return;
        setJoinBusy(true);
        setFeedback(null);
        try {
            await onJoinRequest(clan.id);
            setFeedback({
                kind: "ok",
                text:
                    clan.join_policy === "open"
                        ? `Joined [${clan.tag}] ${clan.name}!`
                        : `Application transmitted to [${clan.tag}] officers.`,
            });
        } catch (err) {
            setFeedback({ kind: "err", text: err instanceof Error ? err.message : "Could not process join" });
        } finally {
            setJoinBusy(false);
        }
    };

    const subTabs: Array<{ id: DossierSubTab; label: string; icon: React.ReactNode }> = [
        { id: "overview", label: "Overview", icon: <LuShield className="w-3.5 h-3.5" /> },
        { id: "combat", label: "Combat", icon: <LuSwords className="w-3.5 h-3.5" /> },
        { id: "economy", label: "Economy", icon: <LuCoins className="w-3.5 h-3.5" /> },
        { id: "honors", label: "Honors", icon: <LuAward className="w-3.5 h-3.5" /> },
    ];

    return (
        <div className="space-y-3">
            {feedback && (
                <div
                    className={`rounded-xl border px-3 py-2 text-ludo-xs font-medium flex items-center justify-between gap-2 ${
                        feedback.kind === "ok"
                            ? "bg-positive/15 border-positive/35 text-positive"
                            : "bg-negative/15 border-negative/35 text-negative"
                    }`}
                >
                    <span>{feedback.text}</span>
                    <button
                        type="button"
                        onClick={() => setFeedback(null)}
                        className="text-ludo-xs font-mono uppercase opacity-80 hover:opacity-100"
                    >
                        Dismiss
                    </button>
                </div>
            )}

            {/* ── Top Summary & Controls Card ────────────────────────────────────────── */}
            <div
                className="rounded-2xl border border-line-soft bg-surface-panel p-3.5 space-y-2.5"
                style={{
                    backgroundImage: `radial-gradient(circle at top right, ${accentColor}1A, transparent 60%)`,
                }}
            >
                {mode === "public" && (
                    <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                            <ClanCrestBadge crest={clan.crest} tag={clan.tag} size="lg" />
                            <div className="min-w-0 space-y-0.5">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                    <h2 className="text-ludo-lg font-bold text-ink-strong truncate">{clan.name}</h2>
                                    <span className="px-2 py-0.5 rounded-md bg-accent-soft border border-accent/35 font-mono text-ludo-xs font-bold text-accent">
                                        [{clan.tag}]
                                    </span>
                                </div>
                                <div className="text-ludo-xs font-mono text-ink-muted">
                                    LVL {clan.level} · {clan.division} · {clan.member_count}/{cap} Operatives
                                </div>
                            </div>
                        </div>
                        {!viewerIsMember && onJoinRequest && (
                            <button
                                type="button"
                                disabled={joinBusy || clan.join_policy === "invite_only"}
                                onClick={handleJoin}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-accent text-accent-ink font-bold text-ludo-xs uppercase tracking-wider disabled:opacity-50 shrink-0"
                            >
                                <LuUserPlus className="w-3.5 h-3.5" />
                                <span>
                                    {clan.join_policy === "invite_only"
                                        ? "Invite Only"
                                        : clan.join_policy === "open"
                                          ? joinBusy
                                              ? "Joining..."
                                              : "Join"
                                          : joinBusy
                                            ? "Sending..."
                                            : "Apply"}
                                </span>
                            </button>
                        )}
                    </div>
                )}

                {/* Meta & Motto Row */}
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-ludo-xs font-mono text-ink-muted">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 min-w-0">
                        <span className="inline-flex items-center gap-1 text-ink-strong">
                            <LuCrown className="w-3.5 h-3.5 text-warn shrink-0" />
                            <span className="truncate">
                                {dossier.leaderProfile?.username || shortenWallet(clan.leader_wallet)}
                            </span>
                        </span>
                        <span className="inline-flex items-center gap-1 shrink-0">
                            <LuCalendar className="w-3.5 h-3.5" />
                            {formatDateShort(clan.created_at)}
                        </span>
                        <span className="uppercase px-1.5 py-0.5 rounded bg-surface-recessed border border-line-soft text-ink-muted">
                            {clan.join_policy.replace("_", " ")}
                        </span>
                    </div>

                    <span className="inline-flex items-center gap-1 shrink-0">
                        {clan.treasury_public ? (
                            <>
                                <LuEye className="w-3.5 h-3.5 text-positive" />
                                <span className="text-positive">Public Vault</span>
                            </>
                        ) : (
                            <>
                                <LuLock className="w-3.5 h-3.5 text-warn" />
                                <span className="text-warn">Members Only</span>
                            </>
                        )}
                    </span>
                </div>

                {clan.bio && (
                    <p className="text-ludo-xs text-ink-muted italic leading-snug">
                        &ldquo;{clan.bio}&rdquo;
                    </p>
                )}

                {/* Action Strip */}
                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    <button
                        type="button"
                        onClick={handleShareTag}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-line-soft bg-surface-recessed text-ink-muted hover:text-ink-strong text-ludo-xs font-mono font-bold transition-colors"
                    >
                        {copiedTag ? (
                            <>
                                <LuCheck className="w-3 h-3 text-positive" />
                                <span>Copied</span>
                            </>
                        ) : (
                            <>
                                <LuShare2 className="w-3 h-3" />
                                <span>Share</span>
                            </>
                        )}
                    </button>

                    {mode === "account" && isOfficerOrCommander && onEditCrest && (
                        <button
                            type="button"
                            onClick={() => {
                                setEditingCrest((v) => !v);
                                setEditingRebrand(false);
                            }}
                            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border text-ludo-xs font-mono font-bold transition-colors ${
                                editingCrest
                                    ? "bg-accent-soft border-accent/45 text-accent"
                                    : "border-line-soft bg-surface-recessed text-ink-muted hover:text-ink-strong"
                            }`}
                        >
                            <LuPencil className="w-3 h-3" />
                            <span>Crest</span>
                        </button>
                    )}

                    {mode === "account" && isCommander && onRenameClan && (
                        <button
                            type="button"
                            onClick={() => {
                                setEditingRebrand((v) => !v);
                                setEditingCrest(false);
                                setNewName(clan.name);
                                setNewTag(clan.tag);
                            }}
                            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border text-ludo-xs font-mono font-bold transition-colors ${
                                editingRebrand
                                    ? "bg-warn/20 border-warn/50 text-warn"
                                    : "border-line-soft bg-surface-recessed text-ink-muted hover:text-ink-strong"
                            }`}
                        >
                            <LuRefreshCw className="w-3 h-3" />
                            <span>Rebrand ({formatCompactNum(dossier.renameFeeChips)})</span>
                        </button>
                    )}

                    {mode === "account" && isCommander && onToggleTreasuryPrivacy && (
                        <button
                            type="button"
                            disabled={privacyBusy}
                            onClick={handleTogglePrivacy}
                            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border text-ludo-xs font-mono font-bold transition-colors ${
                                clan.treasury_public
                                    ? "bg-positive/15 border-positive/40 text-positive"
                                    : "bg-warn/15 border-warn/40 text-warn"
                            }`}
                        >
                            {clan.treasury_public ? (
                                <LuEye className="w-3 h-3" />
                            ) : (
                                <LuLock className="w-3 h-3" />
                            )}
                            <span>{clan.treasury_public ? "Public P&L" : "Private P&L"}</span>
                        </button>
                    )}

                    {mode === "account" && isOfficerOrCommander && onOpenSettings && (
                        <button
                            type="button"
                            onClick={onOpenSettings}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-line-soft bg-surface-recessed text-ink-muted hover:text-ink-strong text-ludo-xs font-mono font-bold transition-colors"
                        >
                            <LuSlidersHorizontal className="w-3 h-3" />
                            <span>Settings</span>
                        </button>
                    )}

                    {onRefresh && (
                        <button
                            type="button"
                            onClick={() => void onRefresh()}
                            className="ml-auto p-1.5 rounded-lg border border-line-soft bg-surface-recessed text-ink-muted hover:text-ink-strong transition-colors"
                            title="Refresh Dossier"
                        >
                            <LuRefreshCw className="w-3.5 h-3.5" />
                        </button>
                    )}
                </div>

                {/* Inline Crest Editor */}
                {editingCrest && (
                    <motion.div
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="pt-2.5 border-t border-line-soft space-y-2.5"
                    >
                        <div className="flex items-center justify-between">
                            <span className="text-ludo-xs uppercase tracking-wider font-bold text-accent">
                                Customize Crest (Free)
                            </span>
                            <ClanCrestBadge
                                crest={{ emblem: crestEmblem, primary: crestPrimary, secondary: crestSecondary }}
                                size="sm"
                            />
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                            {CREST_EMBLEMS.map((emb) => (
                                <button
                                    key={emb}
                                    type="button"
                                    onClick={() => setCrestEmblem(emb)}
                                    className={`px-2.5 py-1 rounded-lg border text-ludo-xs font-mono uppercase font-bold ${
                                        crestEmblem === emb
                                            ? "bg-accent-soft border-accent/50 text-accent"
                                            : "bg-surface-recessed border-line-soft text-ink-muted hover:text-ink-strong"
                                    }`}
                                >
                                    {emb}
                                </button>
                            ))}
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                            {CREST_PALETTES.map((pal) => (
                                <button
                                    key={pal.label}
                                    type="button"
                                    onClick={() => {
                                        setCrestPrimary(pal.primary);
                                        setCrestSecondary(pal.secondary);
                                    }}
                                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-ludo-xs font-mono ${
                                        crestPrimary.toLowerCase() === pal.primary.toLowerCase()
                                            ? "border-accent/50 bg-accent-soft text-ink-strong font-bold"
                                            : "border-line-soft bg-surface-recessed text-ink-muted"
                                    }`}
                                >
                                    <span
                                        className="w-2.5 h-2.5 rounded-full border border-line-strong"
                                        style={{ backgroundColor: pal.primary }}
                                    />
                                    {pal.label}
                                </button>
                            ))}
                        </div>
                        <div className="flex items-center justify-end gap-2">
                            <button
                                type="button"
                                onClick={() => setEditingCrest(false)}
                                className="px-3 py-1 rounded-lg border border-line-soft bg-surface-recessed text-ink-muted hover:text-ink-strong text-ludo-xs font-bold"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                disabled={savingCrest}
                                onClick={handleSaveCrest}
                                className="px-3.5 py-1 rounded-lg bg-accent text-accent-ink font-bold text-ludo-xs uppercase tracking-wider disabled:opacity-50"
                            >
                                {savingCrest ? "Saving..." : "Apply Crest"}
                            </button>
                        </div>
                    </motion.div>
                )}

                {/* Inline Rebrand / Rename Form */}
                {editingRebrand && (
                    <motion.form
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        onSubmit={handleSaveRebrand}
                        className="pt-2.5 border-t border-line-soft space-y-2.5"
                    >
                        <div className="text-ludo-xs font-mono text-ink-muted">
                            Fee:{" "}
                            <strong className="text-warn">
                                {dossier.renameFeeChips.toLocaleString()} CHIPS
                            </strong>{" "}
                            → Next:{" "}
                            <strong className="text-ink-strong">
                                {dossier.nextRenameFeeChips.toLocaleString()} CHIPS
                            </strong>{" "}
                            (2k → 3k → 5k...)
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                            <input
                                type="text"
                                value={newName}
                                onChange={(e) => setNewName(e.target.value)}
                                minLength={3}
                                maxLength={24}
                                placeholder="Clan Name"
                                autoComplete="off"
                                autoCorrect="off"
                                autoCapitalize="none"
                                spellCheck={false}
                                enterKeyHint="next"
                                className="col-span-2 rounded-lg border border-line-soft bg-surface-recessed px-2.5 py-1.5 text-ludo-sm text-ink-strong placeholder:text-ink-faint focus:outline-none focus:border-accent/60"
                            />
                            <input
                                type="text"
                                value={newTag}
                                onChange={(e) => setNewTag(e.target.value.toUpperCase())}
                                minLength={2}
                                maxLength={5}
                                placeholder="TAG"
                                autoComplete="off"
                                autoCorrect="off"
                                autoCapitalize="none"
                                spellCheck={false}
                                enterKeyHint="done"
                                className="rounded-lg border border-line-soft bg-surface-recessed px-2.5 py-1.5 text-ludo-sm font-mono uppercase text-ink-strong placeholder:text-ink-faint focus:outline-none focus:border-accent/60"
                            />
                        </div>
                        <div className="flex items-center justify-end gap-2">
                            <button
                                type="button"
                                onClick={() => setEditingRebrand(false)}
                                className="px-3 py-1 rounded-lg border border-line-soft bg-surface-recessed text-ink-muted hover:text-ink-strong text-ludo-xs font-bold"
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                disabled={
                                    savingRebrand ||
                                    (newName.trim() === clan.name && newTag.trim().toUpperCase() === clan.tag)
                                }
                                className="px-3 py-1 rounded-lg bg-warn text-accent-ink font-bold text-ludo-xs uppercase tracking-wider disabled:opacity-50"
                            >
                                {savingRebrand
                                    ? "Confirming..."
                                    : `Pay ${formatCompactNum(dossier.renameFeeChips)} & Rebrand`}
                            </button>
                        </div>
                    </motion.form>
                )}
            </div>

            {/* ── Sleek 4-Metric Ribbon ───────────────────────────────────────────────── */}
            <div className="grid grid-cols-4 gap-1.5">
                <div className="rounded-xl border border-line-soft bg-surface-panel px-2.5 py-2 text-center">
                    <div className="text-ludo-xs font-mono uppercase text-ink-faint">CWR</div>
                    <div className="text-ludo-sm font-bold font-mono text-accent mt-0.5">
                        {clan.cwr.toLocaleString()}
                    </div>
                </div>
                <div className="rounded-xl border border-line-soft bg-surface-panel px-2.5 py-2 text-center">
                    <div className="text-ludo-xs font-mono uppercase text-ink-faint">Win Rate</div>
                    <div className="text-ludo-sm font-bold font-mono text-positive mt-0.5">
                        {dossier.warRecord.winRate}%
                    </div>
                </div>
                <div className="rounded-xl border border-line-soft bg-surface-panel px-2.5 py-2 text-center">
                    <div className="text-ludo-xs font-mono uppercase text-ink-faint">Seats</div>
                    <div className="text-ludo-sm font-bold font-mono text-ink-strong mt-0.5">
                        {clan.member_count}/{cap}
                    </div>
                </div>
                <div className="rounded-xl border border-line-soft bg-surface-panel px-2.5 py-2 text-center">
                    <div className="text-ludo-xs font-mono uppercase text-ink-faint">Vault</div>
                    <div className="text-ludo-sm font-bold font-mono text-warn mt-0.5 truncate">
                        {canViewTreasury ? formatCompactNum(Number(clan.treasury_balance || 0)) : "Locked"}
                    </div>
                </div>
            </div>

            {/* ── Sub-Navigation Pills ─────────────────────────────────────────────────── */}
            <div className="grid grid-cols-4 gap-1 rounded-xl border border-line-soft bg-surface-recessed p-1">
                {subTabs.map((t) => {
                    const active = subTab === t.id;
                    return (
                        <button
                            key={t.id}
                            type="button"
                            onClick={() => setSubTab(t.id)}
                            className={`flex items-center justify-center gap-1.5 py-1.5 px-1.5 rounded-lg text-ludo-xs font-bold uppercase tracking-wide transition-colors ${
                                active
                                    ? "bg-accent-soft text-accent border border-accent/40"
                                    : "text-ink-muted hover:text-ink-strong border border-transparent"
                            }`}
                        >
                            <span className={active ? "text-accent" : ""}>{t.icon}</span>
                            <span>{t.label}</span>
                        </button>
                    );
                })}
            </div>

            {/* ── Tab Content (Graph-First, Single-Column Flow for Crisp Clarity) ──── */}
            {subTab === "overview" && (
                <div className="space-y-3">
                    <ClanCwrSparkline
                        points={dossier.cwrHistory}
                        currentCwr={clan.cwr}
                        division={clan.division}
                        accentColor={accentColor}
                    />

                    <ClanCombatGauge
                        warRecord={dossier.warRecord}
                        shapeStats={dossier.shapeStats}
                    />

                    {/* Visual Utilization Meters */}
                    <div className="rounded-2xl border border-line-soft bg-surface-panel p-3.5 space-y-2.5">
                        <div className="flex items-center justify-between text-ludo-xs font-mono uppercase tracking-wider text-ink-muted font-bold">
                            <span>Syndicate Vitals</span>
                            <span>Min Lvl {clan.min_level} · RXP {clan.min_rxp.toLocaleString()}</span>
                        </div>
                        <div className="space-y-2">
                            <div className="space-y-1">
                                <div className="flex items-center justify-between text-ludo-xs font-mono">
                                    <span className="text-ink-muted">Level {clan.level} CXP Progress</span>
                                    <span className="text-accent font-bold">{cxpPct}%</span>
                                </div>
                                <HudProgressGauge percent={cxpPct} tone="accent" />
                            </div>
                            <div className="space-y-1">
                                <div className="flex items-center justify-between text-ludo-xs font-mono">
                                    <span className="text-ink-muted">Garrison Capacity</span>
                                    <span className="text-positive font-bold">
                                        {clan.member_count}/{cap} ({seatPct}%)
                                    </span>
                                </div>
                                <HudProgressGauge percent={seatPct} tone="positive" />
                            </div>
                            <div className="space-y-1">
                                <div className="flex items-center justify-between text-ludo-xs font-mono">
                                    <span className="text-ink-muted">Honors Earned</span>
                                    <span className="text-warn font-bold">
                                        {unlockedHonors}/{dossier.honors.length} ({honorPct}%)
                                    </span>
                                </div>
                                <HudProgressGauge percent={honorPct} tone="warn" />
                            </div>
                        </div>
                    </div>

                    <ClanVelocityChart contributors={dossier.topContributors} />
                </div>
            )}

            {subTab === "combat" && (
                <div className="space-y-3">
                    <ClanCombatGauge
                        warRecord={dossier.warRecord}
                        shapeStats={dossier.shapeStats}
                    />
                    <ClanVelocityChart contributors={dossier.topContributors} />

                    <div className="rounded-2xl border border-line-soft bg-surface-panel p-3.5 space-y-2.5">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5 text-ludo-xs uppercase tracking-wider text-ink-muted font-mono font-bold">
                                <LuSwords className="w-3.5 h-3.5 text-accent" />
                                <span>War Ledger</span>
                            </div>
                            <span className="text-ludo-xs font-mono text-ink-faint">
                                {dossier.warHistory.length} wars
                            </span>
                        </div>

                        {dossier.warHistory.length === 0 ? (
                            <div className="py-5 text-center text-ludo-xs font-mono text-ink-faint">
                                No completed clan wars logged yet.
                            </div>
                        ) : (
                            <div className="space-y-2">
                                {dossier.warHistory.map((war) => (
                                    <div
                                        key={war.id}
                                        className="rounded-xl border border-line-soft bg-surface-recessed px-3 py-2.5 flex items-center justify-between gap-2"
                                    >
                                        <div className="flex items-center gap-2.5 min-w-0">
                                            <ClanCrestBadge crest={war.opponentCrest} tag={war.opponentTag} size="sm" />
                                            <div className="min-w-0">
                                                <div className="flex items-center gap-1.5">
                                                    <span className="text-ludo-xs font-bold text-ink-strong truncate">
                                                        vs {war.opponentName}
                                                    </span>
                                                    {onInspectClan ? (
                                                        <button
                                                            type="button"
                                                            onClick={() => onInspectClan(war.opponentTag)}
                                                            className="px-1.5 py-0.5 rounded bg-accent-soft border border-accent/35 font-mono text-ludo-xs text-accent font-bold"
                                                        >
                                                            [{war.opponentTag}]
                                                        </button>
                                                    ) : (
                                                        <span className="px-1.5 py-0.5 rounded bg-surface-panel border border-line-soft font-mono text-ludo-xs text-ink-muted">
                                                            [{war.opponentTag}]
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="text-ludo-xs font-mono text-ink-faint">
                                                    {formatDateShort(war.resolvedAt)} · {war.ourPoints} : {war.opponentPoints}
                                                </div>
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-2 shrink-0 font-mono text-ludo-xs">
                                            <span
                                                className={`px-2 py-0.5 rounded font-bold uppercase border ${
                                                    war.outcome === "win"
                                                        ? "bg-positive/15 text-positive border-positive/35"
                                                        : war.outcome === "loss"
                                                          ? "bg-negative/15 text-negative border-negative/35"
                                                          : "bg-surface-panel text-ink-muted border-line-soft"
                                                }`}
                                            >
                                                {war.outcome}
                                            </span>
                                            <span
                                                className={`font-bold ${
                                                    war.cwrDelta >= 0 ? "text-positive" : "text-negative"
                                                }`}
                                            >
                                                {war.cwrDelta >= 0 ? "+" : ""}
                                                {war.cwrDelta}
                                            </span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {subTab === "economy" && (
                <div className="space-y-3">
                    <ClanTreasuryDonut
                        breakdown={dossier.treasuryBreakdown}
                        canViewTreasury={canViewTreasury}
                        isCommander={mode === "account" && isCommander}
                        onToggleVisibility={onToggleTreasuryPrivacy ? handleTogglePrivacy : undefined}
                    />

                    {canViewTreasury && dossier.treasuryBreakdown && (
                        <div className="rounded-2xl border border-line-soft bg-surface-panel p-3.5 space-y-2">
                            <div className="flex items-center justify-between">
                                <span className="text-ludo-xs uppercase tracking-wider text-ink-muted font-mono font-bold">
                                    Treasury Audit Log
                                </span>
                                <span className="text-ludo-xs font-mono text-ink-faint">
                                    {dossier.treasuryBreakdown.recentLedger.length} entries
                                </span>
                            </div>
                            {dossier.treasuryBreakdown.recentLedger.length === 0 ? (
                                <div className="py-4 text-center text-ludo-xs font-mono text-ink-faint">
                                    No treasury movements recorded yet.
                                </div>
                            ) : (
                                <div className="space-y-1.5">
                                    {dossier.treasuryBreakdown.recentLedger.map((entry) => {
                                        const pos = Number(entry.amount) >= 0;
                                        return (
                                            <div
                                                key={entry.id}
                                                className="rounded-xl border border-line-soft bg-surface-recessed px-3 py-2 flex items-center justify-between text-ludo-xs font-mono"
                                            >
                                                <div className="min-w-0">
                                                    <div className="font-bold text-ink-strong uppercase">
                                                        {entry.reason.replace(/_/g, " ")}
                                                    </div>
                                                    <div className="text-ink-faint">
                                                        {formatDateShort(entry.created_at)}
                                                    </div>
                                                </div>
                                                <span
                                                    className={`font-bold shrink-0 ${
                                                        pos ? "text-positive" : "text-negative"
                                                    }`}
                                                >
                                                    {pos ? "+" : ""}
                                                    {Number(entry.amount).toLocaleString()} CHIPS
                                                </span>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    )}

                    {mode === "account" && isCommander && (
                        <div className="rounded-2xl border border-line-soft bg-surface-panel p-3.5 space-y-2">
                            <div className="flex items-center justify-between gap-2">
                                <div className="text-ludo-xs uppercase font-mono font-bold text-ink-strong">
                                    Rebrand Fee Escalation
                                </div>
                                {onRenameClan && (
                                    <button
                                        type="button"
                                        onClick={() => setEditingRebrand(true)}
                                        className="px-2.5 py-1 rounded-lg border border-warn/40 bg-warn/15 text-warn text-ludo-xs font-mono font-bold"
                                    >
                                        Rebrand Now
                                    </button>
                                )}
                            </div>
                            <div className="grid grid-cols-4 gap-1.5 text-center font-mono text-ludo-xs">
                                {[2000, 3000, 5000, 8000].map((fee, idx) => {
                                    const completed = Number(clan.rename_count || 0) > idx;
                                    const isNext = Number(clan.rename_count || 0) === idx;
                                    return (
                                        <div
                                            key={fee}
                                            className={`rounded-lg border py-1.5 px-1 ${
                                                isNext
                                                    ? "bg-warn/20 border-warn/50 text-warn font-bold"
                                                    : completed
                                                      ? "bg-positive/10 border-positive/30 text-positive"
                                                      : "bg-surface-recessed border-line-soft text-ink-muted"
                                            }`}
                                        >
                                            <div>#{idx + 1}</div>
                                            <div>{formatCompactNum(fee)}</div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {subTab === "honors" && (
                <div className="space-y-3">
                    <ClanLevelRoadmap
                        currentLevel={clan.level}
                        currentCxp={clan.cxp}
                        levels={dossier.levelRoadmap}
                    />

                    {/* Honors Medals Grid */}
                    <div className="rounded-2xl border border-line-soft bg-surface-panel p-3.5 space-y-2.5">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5 text-ludo-xs uppercase tracking-wider text-ink-muted font-mono font-bold">
                                <LuAward className="w-3.5 h-3.5 text-warn" />
                                <span>Syndicate Honors ({unlockedHonors}/{dossier.honors.length})</span>
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                            {dossier.honors.map((h) => (
                                <div
                                    key={h.id}
                                    className={`rounded-xl border px-2.5 py-2 flex items-center gap-2 ${
                                        h.unlocked
                                            ? "bg-warn/15 border-warn/40 text-ink-strong"
                                            : "bg-surface-recessed border-line-soft text-ink-muted opacity-65"
                                    }`}
                                >
                                    <span className={h.unlocked ? "text-warn shrink-0" : "text-ink-faint shrink-0"}>
                                        {renderHonorIcon(h.icon, "w-4 h-4")}
                                    </span>
                                    <div className="min-w-0">
                                        <div className="text-ludo-xs font-bold truncate">{h.title}</div>
                                        <div className="text-ludo-xs text-ink-faint truncate">{h.subtitle}</div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Active Roster List */}
                    <div className="rounded-2xl border border-line-soft bg-surface-panel p-3.5 space-y-2">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5 text-ludo-xs uppercase tracking-wider text-ink-muted font-mono font-bold">
                                <LuUsers className="w-3.5 h-3.5 text-accent" />
                                <span>Roster ({dossier.members.length})</span>
                            </div>
                        </div>
                        <div className="space-y-1.5">
                            {dossier.members.map((m) => {
                                const name = m.player?.username || shortenWallet(m.wallet_address);
                                return (
                                    <div
                                        key={m.id}
                                        className="rounded-xl border border-line-soft bg-surface-recessed px-3 py-2 flex items-center justify-between gap-2"
                                    >
                                        <div className="flex items-center gap-2 min-w-0">
                                            <span className="px-1.5 py-0.5 rounded bg-surface-panel border border-line-soft font-mono text-ludo-xs uppercase text-ink-muted shrink-0">
                                                {m.role}
                                            </span>
                                            {onInspectMember ? (
                                                <button
                                                    type="button"
                                                    onClick={() => onInspectMember(m.wallet_address)}
                                                    className="text-ludo-xs font-bold text-ink-strong hover:text-accent truncate transition-colors"
                                                >
                                                    {name}
                                                </button>
                                            ) : (
                                                <span className="text-ludo-xs font-bold text-ink-strong truncate">
                                                    {name}
                                                </span>
                                            )}
                                        </div>
                                        <div className="text-ludo-xs font-mono text-ink-muted shrink-0">
                                            <strong className="text-accent">{m.war_points} WP</strong> ·{" "}
                                            {m.total_cxp.toLocaleString()} CXP
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
