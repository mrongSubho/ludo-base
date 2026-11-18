"use client";

import React, { useState } from "react";
import { motion } from "framer-motion";
import {
    LuAward,
    LuCalendar,
    LuCheck,
    LuChevronRight,
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

    // Inline Rebrand / Rename Panel
    const [editingRebrand, setEditingRebrand] = useState(false);
    const [newName, setNewName] = useState(clan.name);
    const [newTag, setNewTag] = useState(clan.tag);
    const [savingRebrand, setSavingRebrand] = useState(false);

    // Action states
    const [privacyBusy, setPrivacyBusy] = useState(false);
    const [joinBusy, setJoinBusy] = useState(false);
    const [feedback, setFeedback] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

    const accentColor = clan.crest?.primary || "#00E5FF";
    const cap = dossier.levelConfig?.member_cap ?? 20;
    const nextCxp = dossier.nextLevelConfig?.cxp_required ?? Math.max(1000, clan.cxp + 500);
    const cxpPct = dossier.nextLevelConfig
        ? Math.min(100, Math.round((clan.cxp / Math.max(1, nextCxp)) * 100))
        : 100;

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
            setFeedback({ kind: "ok", text: `Syndicate rebranded for ${dossier.renameFeeChips.toLocaleString()} CHIPS.` });
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
        { id: "honors", label: "Honors & Roster", icon: <LuAward className="w-3.5 h-3.5" /> },
    ];

    return (
        <div className="space-y-3.5">
            {feedback && (
                <div
                    className={`rounded-xl border px-3 py-2 text-ludo-xs font-medium flex items-center justify-between gap-2 ${
                        feedback.kind === "ok"
                            ? "bg-emerald-500/10 border-emerald-500/35 text-emerald-300"
                            : "bg-rose-500/10 border-rose-500/35 text-rose-300"
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

            {/* ── Hero Syndicate Dossier Banner ───────────────────────────────────────── */}
            <div
                className="rounded-2xl border border-line bg-surface-elevated p-4 relative overflow-hidden"
                style={{
                    backgroundImage: `radial-gradient(circle at top right, ${accentColor}1E, transparent 60%)`,
                }}
            >
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                    <div className="flex items-start gap-3.5 min-w-0">
                        <ClanCrestBadge crest={clan.crest} tag={clan.tag} size="lg" />
                        <div className="min-w-0 flex-1 space-y-1">
                            <div className="flex flex-wrap items-center gap-1.5">
                                <h2 className="text-ludo-lg font-bold text-ink truncate">
                                    {clan.name}
                                </h2>
                                <span className="px-2 py-0.5 rounded-md bg-accent-soft border border-accent-line font-mono text-ludo-xs font-bold text-accent">
                                    [{clan.tag}]
                                </span>
                                <span className="px-2 py-0.5 rounded-md bg-surface border border-line font-mono text-ludo-xs uppercase text-ink-soft">
                                    {clan.division}
                                </span>
                            </div>

                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-ludo-xs text-ink-soft font-mono">
                                <span className="inline-flex items-center gap-1">
                                    <LuCrown className="w-3.5 h-3.5 text-amber-400" />
                                    {dossier.leaderProfile?.username ||
                                        shortenWallet(clan.leader_wallet)}
                                </span>
                                <span className="inline-flex items-center gap-1">
                                    <LuCalendar className="w-3.5 h-3.5" />
                                    Founded {formatDateShort(clan.created_at)}
                                </span>
                                <span className="inline-flex items-center gap-1">
                                    {clan.treasury_public ? (
                                        <>
                                            <LuEye className="w-3.5 h-3.5 text-emerald-400" />
                                            Public Treasury
                                        </>
                                    ) : (
                                        <>
                                            <LuLock className="w-3.5 h-3.5 text-amber-400" />
                                            Members-Only Treasury
                                        </>
                                    )}
                                </span>
                            </div>

                            {clan.bio && (
                                <p className="text-ludo-xs text-ink-soft leading-relaxed pt-0.5">
                                    {clan.bio}
                                </p>
                            )}
                        </div>
                    </div>

                    {/* Action Toolbar */}
                    <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                        <button
                            type="button"
                            onClick={handleShareTag}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-line bg-surface text-ink-soft hover:text-ink text-ludo-xs font-mono font-bold transition-colors"
                            title="Copy Syndicate Dossier summary"
                        >
                            {copiedTag ? (
                                <>
                                    <LuCheck className="w-3.5 h-3.5 text-emerald-400" />
                                    Copied
                                </>
                            ) : (
                                <>
                                    <LuShare2 className="w-3.5 h-3.5" />
                                    Share
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
                                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-ludo-xs font-mono font-bold transition-colors ${
                                    editingCrest
                                        ? "bg-accent-soft border-accent-line text-accent"
                                        : "border-line bg-surface text-ink-soft hover:text-ink"
                                }`}
                            >
                                <LuPencil className="w-3.5 h-3.5" />
                                Crest
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
                                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-ludo-xs font-mono font-bold transition-colors ${
                                    editingRebrand
                                        ? "bg-amber-500/15 border-amber-500/40 text-amber-300"
                                        : "border-line bg-surface text-ink-soft hover:text-ink"
                                }`}
                            >
                                <LuRefreshCw className="w-3.5 h-3.5" />
                                Rebrand ({dossier.renameFeeChips >= 1000
                                    ? `${(dossier.renameFeeChips / 1000).toFixed(dossier.renameFeeChips % 1000 === 0 ? 0 : 1)}k`
                                    : dossier.renameFeeChips})
                            </button>
                        )}

                        {mode === "account" && isCommander && onToggleTreasuryPrivacy && (
                            <button
                                type="button"
                                disabled={privacyBusy}
                                onClick={handleTogglePrivacy}
                                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-ludo-xs font-mono font-bold transition-colors ${
                                    clan.treasury_public
                                        ? "bg-emerald-500/10 border-emerald-500/35 text-emerald-300"
                                        : "bg-amber-500/10 border-amber-500/35 text-amber-300"
                                }`}
                                title="Toggle whether non-members can see Treasury Balance & P&L"
                            >
                                {clan.treasury_public ? (
                                    <LuEye className="w-3.5 h-3.5" />
                                ) : (
                                    <LuLock className="w-3.5 h-3.5" />
                                )}
                                {clan.treasury_public ? "Public P&L" : "Private P&L"}
                            </button>
                        )}

                        {mode === "account" && isOfficerOrCommander && onOpenSettings && (
                            <button
                                type="button"
                                onClick={onOpenSettings}
                                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-line bg-surface text-ink-soft hover:text-ink text-ludo-xs font-mono font-bold transition-colors"
                            >
                                <LuSlidersHorizontal className="w-3.5 h-3.5" />
                                Settings
                            </button>
                        )}

                        {mode === "public" && !viewerIsMember && onJoinRequest && (
                            <button
                                type="button"
                                disabled={joinBusy || clan.join_policy === "invite_only"}
                                onClick={handleJoin}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-slate-950 font-bold text-ludo-xs uppercase tracking-wider disabled:opacity-50 transition-opacity"
                            >
                                <LuUserPlus className="w-3.5 h-3.5" />
                                {clan.join_policy === "invite_only"
                                    ? "Invite Only"
                                    : clan.join_policy === "open"
                                      ? joinBusy
                                          ? "Joining..."
                                          : "Join Syndicate"
                                      : joinBusy
                                        ? "Sending..."
                                        : "Request Join"}
                            </button>
                        )}

                        {onRefresh && (
                            <button
                                type="button"
                                onClick={() => void onRefresh()}
                                className="p-1.5 rounded-lg border border-line bg-surface text-ink-soft hover:text-ink transition-colors"
                                title="Refresh Dossier"
                            >
                                <LuRefreshCw className="w-3.5 h-3.5" />
                            </button>
                        )}
                    </div>
                </div>

                {/* CXP Level Progress Bar */}
                <div className="mt-3 pt-2.5 border-t border-line/70 space-y-1">
                    <div className="flex items-center justify-between text-ludo-xs font-mono">
                        <span className="text-ink font-bold">
                            Level {clan.level} / 20 Syndicate Rank
                        </span>
                        <span className="text-ink-soft">
                            {clan.cxp.toLocaleString()} / {nextCxp.toLocaleString()} CXP ({cxpPct}%)
                        </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-surface overflow-hidden border border-line/60">
                        <div
                            className="h-full rounded-full bg-accent transition-all duration-300"
                            style={{ width: `${cxpPct}%` }}
                        />
                    </div>
                </div>

                {/* ── Inline Crest Editor ─────────────────────────────────────────────── */}
                {editingCrest && (
                    <motion.div
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="mt-3 pt-3 border-t border-line space-y-2.5"
                    >
                        <div className="flex items-center justify-between">
                            <span className="text-ludo-xs uppercase tracking-wider font-bold text-accent">
                                Customize Syndicate Crest (Free for Officers &amp; Commander)
                            </span>
                            <ClanCrestBadge
                                crest={{ emblem: crestEmblem, primary: crestPrimary, secondary: crestSecondary }}
                                size="sm"
                            />
                        </div>
                        <div className="flex flex-wrap gap-2">
                            {CREST_EMBLEMS.map((emb) => (
                                <button
                                    key={emb}
                                    type="button"
                                    onClick={() => setCrestEmblem(emb)}
                                    className={`px-2.5 py-1 rounded-lg border text-ludo-xs font-mono uppercase font-bold ${
                                        crestEmblem === emb
                                            ? "bg-accent-soft border-accent-line text-accent"
                                            : "bg-surface border-line text-ink-soft hover:text-ink"
                                    }`}
                                >
                                    {emb}
                                </button>
                            ))}
                        </div>
                        <div className="flex flex-wrap gap-2">
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
                                            ? "border-accent-line bg-accent-soft text-ink font-bold"
                                            : "border-line bg-surface text-ink-soft"
                                    }`}
                                >
                                    <span
                                        className="w-3 h-3 rounded-full border border-white/20"
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
                                className="px-3 py-1.5 rounded-lg border border-line bg-surface text-ink-soft text-ludo-xs font-bold"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                disabled={savingCrest}
                                onClick={handleSaveCrest}
                                className="px-3.5 py-1.5 rounded-lg bg-accent text-slate-950 font-bold text-ludo-xs uppercase tracking-wider disabled:opacity-50"
                            >
                                {savingCrest ? "Saving..." : "Apply Crest"}
                            </button>
                        </div>
                    </motion.div>
                )}

                {/* ── Inline Rebrand / Rename Form (Escalating CHIPS Fee) ─────────────── */}
                {editingRebrand && (
                    <motion.form
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        onSubmit={handleSaveRebrand}
                        className="mt-3 pt-3 border-t border-line space-y-2.5"
                    >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                                <div className="text-ludo-xs uppercase tracking-wider font-bold text-amber-300">
                                    Rebrand Syndicate Name &amp; Tag (Commander Only)
                                </div>
                                <div className="text-ludo-xs text-ink-soft font-mono">
                                    Current Fee:{" "}
                                    <strong className="text-amber-300">
                                        {dossier.renameFeeChips.toLocaleString()} CHIPS
                                    </strong>{" "}
                                    · Next Fee After:{" "}
                                    <strong className="text-ink">
                                        {dossier.nextRenameFeeChips.toLocaleString()} CHIPS
                                    </strong>{" "}
                                    (2k → 3k → 5k escalation)
                                </div>
                            </div>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                            <input
                                type="text"
                                value={newName}
                                onChange={(e) => setNewName(e.target.value)}
                                minLength={3}
                                maxLength={24}
                                placeholder="New Clan Name (3–24)"
                                className="sm:col-span-2 rounded-lg border border-line bg-surface px-3 py-1.5 text-ludo-sm text-ink focus:outline-none focus:border-accent-line"
                            />
                            <input
                                type="text"
                                value={newTag}
                                onChange={(e) => setNewTag(e.target.value.toUpperCase())}
                                minLength={2}
                                maxLength={5}
                                placeholder="TAG"
                                className="rounded-lg border border-line bg-surface px-3 py-1.5 text-ludo-sm font-mono uppercase text-ink focus:outline-none focus:border-accent-line"
                            />
                        </div>
                        <div className="flex items-center justify-end gap-2">
                            <button
                                type="button"
                                onClick={() => setEditingRebrand(false)}
                                className="px-3 py-1.5 rounded-lg border border-line bg-surface text-ink-soft text-ludo-xs font-bold"
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                disabled={
                                    savingRebrand ||
                                    (newName.trim() === clan.name && newTag.trim().toUpperCase() === clan.tag)
                                }
                                className="px-3.5 py-1.5 rounded-lg bg-amber-400 text-slate-950 font-bold text-ludo-xs uppercase tracking-wider disabled:opacity-50"
                            >
                                {savingRebrand
                                    ? "Confirming On-Chain..."
                                    : `Pay ${dossier.renameFeeChips.toLocaleString()} CHIPS & Rebrand`}
                            </button>
                        </div>
                    </motion.form>
                )}
            </div>

            {/* ── 4-Cell Core Telemetry Strip ─────────────────────────────────────────── */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div className="rounded-xl border border-line bg-surface-elevated px-3 py-2.5">
                    <div className="text-ludo-xs uppercase tracking-wider text-ink-soft font-mono">
                        War Rating (CWR)
                    </div>
                    <div className="text-ludo-md font-bold font-mono text-accent mt-0.5">
                        {clan.cwr.toLocaleString()}
                    </div>
                </div>
                <div className="rounded-xl border border-line bg-surface-elevated px-3 py-2.5">
                    <div className="text-ludo-xs uppercase tracking-wider text-ink-soft font-mono">
                        War Record
                    </div>
                    <div className="text-ludo-md font-bold font-mono text-emerald-400 mt-0.5">
                        {dossier.warRecord.winRate}% ({dossier.warRecord.wins}W-{dossier.warRecord.losses}L)
                    </div>
                </div>
                <div className="rounded-xl border border-line bg-surface-elevated px-3 py-2.5">
                    <div className="text-ludo-xs uppercase tracking-wider text-ink-soft font-mono">
                        Garrison Seats
                    </div>
                    <div className="text-ludo-md font-bold font-mono text-ink mt-0.5">
                        {clan.member_count} / {cap}
                    </div>
                </div>
                <div className="rounded-xl border border-line bg-surface-elevated px-3 py-2.5">
                    <div className="text-ludo-xs uppercase tracking-wider text-ink-soft font-mono">
                        Vault Balance
                    </div>
                    <div className="text-ludo-md font-bold font-mono text-amber-400 mt-0.5 flex items-center gap-1">
                        {canViewTreasury ? (
                            <>{Number(clan.treasury_balance || 0).toLocaleString()} CHIPS</>
                        ) : (
                            <span className="text-ink-soft inline-flex items-center gap-1 text-ludo-xs">
                                <LuLock className="w-3.5 h-3.5" /> Members Only
                            </span>
                        )}
                    </div>
                </div>
            </div>

            {/* ── Sub-Navigation Pills ─────────────────────────────────────────────────── */}
            <div className="grid grid-cols-4 gap-1.5 rounded-xl border border-line bg-surface p-1">
                {subTabs.map((t) => {
                    const active = subTab === t.id;
                    return (
                        <button
                            key={t.id}
                            type="button"
                            onClick={() => setSubTab(t.id)}
                            className={`flex items-center justify-center gap-1.5 py-2 px-2 rounded-lg text-ludo-xs font-bold uppercase tracking-wide transition-colors ${
                                active
                                    ? "bg-accent-soft text-accent border border-accent-line"
                                    : "text-ink-soft hover:text-ink border border-transparent"
                            }`}
                        >
                            {t.icon}
                            <span className="truncate">{t.label}</span>
                        </button>
                    );
                })}
            </div>

            {/* ── Tab Content ─────────────────────────────────────────────────────────── */}
            {subTab === "overview" && (
                <div className="space-y-3">
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
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
                    </div>

                    {/* Recruitment & Entry Directives */}
                    <div className="rounded-xl border border-line bg-surface-elevated p-3.5 flex flex-wrap items-center justify-between gap-2 text-ludo-xs font-mono">
                        <div className="flex flex-wrap items-center gap-3">
                            <span>
                                Policy:{" "}
                                <strong className="text-ink uppercase">{clan.join_policy.replace("_", " ")}</strong>
                            </span>
                            <span>
                                Min RXP: <strong className="text-ink">{clan.min_rxp.toLocaleString()}</strong>
                            </span>
                            <span>
                                Min Level: <strong className="text-ink">{clan.min_level}</strong>
                            </span>
                            {clan.farcaster_channel && (
                                <span>
                                    Channel: <strong className="text-accent">/{clan.farcaster_channel}</strong>
                                </span>
                            )}
                        </div>
                        <span className="text-ink-soft">Total CXP: {clan.cxp.toLocaleString()}</span>
                    </div>

                    {/* Honors Quick Showcase */}
                    <div className="rounded-xl border border-line bg-surface-elevated p-3.5 space-y-2.5">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5 text-ludo-xs uppercase tracking-wider text-ink-soft font-bold">
                                <LuAward className="w-3.5 h-3.5 text-amber-400" />
                                Syndicate Honors (
                                {dossier.honors.filter((h) => h.unlocked).length}/{dossier.honors.length})
                            </div>
                            <button
                                type="button"
                                onClick={() => setSubTab("honors")}
                                className="inline-flex items-center gap-0.5 text-ludo-xs font-mono text-accent hover:underline"
                            >
                                Roadmap &amp; Roster <LuChevronRight className="w-3.5 h-3.5" />
                            </button>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                            {dossier.honors.map((h) => (
                                <div
                                    key={h.id}
                                    className={`rounded-lg border px-2.5 py-2 flex items-center gap-2 ${
                                        h.unlocked
                                            ? "bg-amber-500/10 border-amber-500/35 text-ink"
                                            : "bg-surface border-line text-ink-soft opacity-60"
                                    }`}
                                >
                                    <span className={h.unlocked ? "text-amber-400" : "text-ink-soft"}>
                                        {renderHonorIcon(h.icon, "w-4 h-4")}
                                    </span>
                                    <div className="min-w-0">
                                        <div className="text-ludo-xs font-bold truncate">{h.title}</div>
                                        <div className="text-ludo-xs text-ink-soft truncate">{h.subtitle}</div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {subTab === "combat" && (
                <div className="space-y-3">
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                        <ClanCombatGauge
                            warRecord={dossier.warRecord}
                            shapeStats={dossier.shapeStats}
                        />
                        <ClanVelocityChart contributors={dossier.topContributors} />
                    </div>

                    {/* Completed War Match Log */}
                    <div className="rounded-xl border border-line bg-surface-elevated p-3.5 space-y-2.5">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5 text-ludo-xs uppercase tracking-wider text-ink-soft font-bold">
                                <LuSwords className="w-3.5 h-3.5 text-accent" />
                                War Ledger &amp; Match History
                            </div>
                            <span className="text-ludo-xs font-mono text-ink-soft">
                                {dossier.warHistory.length} resolved engagements
                            </span>
                        </div>

                        {dossier.warHistory.length === 0 ? (
                            <div className="py-5 text-center text-ludo-xs font-mono text-ink-soft">
                                No completed clan wars logged yet.
                            </div>
                        ) : (
                            <div className="space-y-2">
                                {dossier.warHistory.map((war) => (
                                    <div
                                        key={war.id}
                                        className="rounded-xl border border-line bg-surface px-3 py-2.5 flex items-center justify-between gap-2"
                                    >
                                        <div className="flex items-center gap-2.5 min-w-0">
                                            <ClanCrestBadge crest={war.opponentCrest} tag={war.opponentTag} size="sm" />
                                            <div className="min-w-0">
                                                <div className="flex items-center gap-1.5">
                                                    <span className="text-ludo-xs font-bold text-ink truncate">
                                                        vs {war.opponentName}
                                                    </span>
                                                    {onInspectClan ? (
                                                        <button
                                                            type="button"
                                                            onClick={() => onInspectClan(war.opponentTag)}
                                                            className="px-1.5 py-0.5 rounded bg-accent-soft border border-accent-line font-mono text-ludo-xs text-accent font-bold hover:opacity-80"
                                                        >
                                                            [{war.opponentTag}]
                                                        </button>
                                                    ) : (
                                                        <span className="px-1.5 py-0.5 rounded bg-surface-elevated border border-line font-mono text-ludo-xs text-ink-soft">
                                                            [{war.opponentTag}]
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="text-ludo-xs font-mono text-ink-soft">
                                                    {formatDateShort(war.resolvedAt)} · Score {war.ourPoints} : {war.opponentPoints}
                                                </div>
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-2 shrink-0 font-mono text-ludo-xs">
                                            <span
                                                className={`px-2 py-0.5 rounded font-bold uppercase border ${
                                                    war.outcome === "win"
                                                        ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/35"
                                                        : war.outcome === "loss"
                                                          ? "bg-rose-500/15 text-rose-400 border-rose-500/35"
                                                          : "bg-slate-500/15 text-ink-soft border-line"
                                                }`}
                                            >
                                                {war.outcome}
                                            </span>
                                            <span
                                                className={`font-bold ${
                                                    war.cwrDelta >= 0 ? "text-emerald-400" : "text-rose-400"
                                                }`}
                                            >
                                                {war.cwrDelta >= 0 ? "+" : ""}
                                                {war.cwrDelta} CWR
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
                        <div className="rounded-xl border border-line bg-surface-elevated p-3.5 space-y-2">
                            <div className="flex items-center justify-between">
                                <span className="text-ludo-xs uppercase tracking-wider text-ink-soft font-bold">
                                    Recent Treasury Audit Log
                                </span>
                                <span className="text-ludo-xs font-mono text-ink-soft">
                                    {dossier.treasuryBreakdown.recentLedger.length} entries
                                </span>
                            </div>
                            {dossier.treasuryBreakdown.recentLedger.length === 0 ? (
                                <div className="py-4 text-center text-ludo-xs font-mono text-ink-soft">
                                    No treasury movements recorded yet.
                                </div>
                            ) : (
                                <div className="space-y-1.5">
                                    {dossier.treasuryBreakdown.recentLedger.map((entry) => {
                                        const pos = Number(entry.amount) >= 0;
                                        return (
                                            <div
                                                key={entry.id}
                                                className="rounded-lg border border-line bg-surface px-3 py-2 flex items-center justify-between text-ludo-xs font-mono"
                                            >
                                                <div className="min-w-0">
                                                    <div className="font-bold text-ink uppercase">
                                                        {entry.reason.replace(/_/g, " ")}
                                                    </div>
                                                    <div className="text-ink-soft">
                                                        {formatDateShort(entry.created_at)}
                                                    </div>
                                                </div>
                                                <span
                                                    className={`font-bold shrink-0 ${
                                                        pos ? "text-emerald-400" : "text-rose-400"
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
                        <div className="rounded-xl border border-line bg-surface-elevated p-3.5 flex flex-wrap items-center justify-between gap-2">
                            <div className="space-y-0.5">
                                <div className="text-ludo-xs uppercase font-bold text-ink">
                                    Syndicate Rebrand Schedule
                                </div>
                                <div className="text-ludo-xs font-mono text-ink-soft">
                                    Completed Rebrands: {clan.rename_count || 0} · Next Fee:{" "}
                                    <span className="text-amber-400 font-bold">
                                        {dossier.renameFeeChips.toLocaleString()} CHIPS
                                    </span>{" "}
                                    (escalates 2k → 3k → 5k → 8k...)
                                </div>
                            </div>
                            {onRenameClan && (
                                <button
                                    type="button"
                                    onClick={() => {
                                        setSubTab("overview");
                                        setEditingRebrand(true);
                                    }}
                                    className="px-3 py-1.5 rounded-lg border border-amber-500/35 bg-amber-500/10 text-amber-300 text-ludo-xs font-mono font-bold"
                                >
                                    Open Rebrand
                                </button>
                            )}
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

                    {/* Active Roster Table */}
                    <div className="rounded-xl border border-line bg-surface-elevated p-3.5 space-y-2.5">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5 text-ludo-xs uppercase tracking-wider text-ink-soft font-bold">
                                <LuUsers className="w-3.5 h-3.5 text-accent" />
                                Syndicate Roster ({dossier.members.length})
                            </div>
                            <span className="text-ludo-xs font-mono text-ink-soft">Sorted by WP &amp; CXP</span>
                        </div>
                        <div className="space-y-1.5">
                            {dossier.members.map((m) => {
                                const name = m.player?.username || shortenWallet(m.wallet_address);
                                return (
                                    <div
                                        key={m.id}
                                        className="rounded-lg border border-line bg-surface px-3 py-2 flex items-center justify-between gap-2"
                                    >
                                        <div className="flex items-center gap-2 min-w-0">
                                            <span className="px-1.5 py-0.5 rounded bg-surface-elevated border border-line font-mono text-ludo-xs uppercase text-ink-soft">
                                                {m.role}
                                            </span>
                                            {onInspectMember ? (
                                                <button
                                                    type="button"
                                                    onClick={() => onInspectMember(m.wallet_address)}
                                                    className="text-ludo-xs font-bold text-ink hover:text-accent truncate transition-colors"
                                                >
                                                    {name}
                                                </button>
                                            ) : (
                                                <span className="text-ludo-xs font-bold text-ink truncate">
                                                    {name}
                                                </span>
                                            )}
                                        </div>
                                        <div className="text-ludo-xs font-mono text-ink-soft shrink-0">
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
