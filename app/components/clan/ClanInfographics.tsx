"use client";

import React, { useMemo, useState } from "react";
import {
    LuLock,
    LuEye,
    LuTrendingUp,
    LuTrendingDown,
    LuFlame,
    LuShield,
    LuCoins,
    LuLayers,
    LuUsers,
    LuCheck,
} from "react-icons/lu";
import type {
    ClanCwrPoint,
    ClanProfileDossier,
    ClanContributorStat,
    ClanLevelConfig,
} from "@/lib/clan/types";

function formatShortChips(n: number): string {
    const abs = Math.abs(n);
    const sign = n < 0 ? "-" : "";
    if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(2)}M`;
    if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(1)}k`;
    return `${sign}${abs.toLocaleString()}`;
}

/* ── 1. CWR Elo Trajectory Sparkline ────────────────────────────────────────── */
export function ClanCwrSparkline({
    points,
    currentCwr,
    division,
    accentColor = "#00E5FF",
}: {
    points: ClanCwrPoint[];
    currentCwr: number;
    division: string;
    accentColor?: string;
}) {
    const [range, setRange] = useState<"all" | "10" | "5">("all");

    const sliced = useMemo(() => {
        if (points.length <= 1) return points;
        if (range === "5") return points.slice(-6);
        if (range === "10") return points.slice(-11);
        return points;
    }, [points, range]);

    const chart = useMemo(() => {
        const w = 320;
        const h = 92;
        const padX = 10;
        const padY = 12;
        const vals = sliced.map((p) => p.cwr);
        const min = Math.min(...vals, currentCwr) - 25;
        const max = Math.max(...vals, currentCwr) + 25;
        const span = Math.max(10, max - min);

        const coords = sliced.map((p, idx) => {
            const x =
                sliced.length === 1
                    ? w - padX
                    : padX + (idx / Math.max(1, sliced.length - 1)) * (w - padX * 2);
            const y = h - padY - ((p.cwr - min) / span) * (h - padY * 2);
            return { x, y, point: p };
        });

        const pathD =
            coords.length === 1
                ? `M ${padX} ${coords[0].y} L ${coords[0].x} ${coords[0].y}`
                : coords.map((c, i) => `${i === 0 ? "M" : "L"} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`).join(" ");

        const areaD = `${pathD} L ${coords[coords.length - 1].x.toFixed(1)} ${h} L ${
            coords.length === 1 ? padX : coords[0].x.toFixed(1)
        } ${h} Z`;

        const last = coords[coords.length - 1];
        const first = coords[0];
        const netDelta = last.point.cwr - first.point.cwr;
        return { w, h, coords, pathD, areaD, last, netDelta };
    }, [sliced, currentCwr]);

    const isPositive = chart.netDelta >= 0;

    return (
        <div className="rounded-xl border border-line bg-surface-elevated p-3.5 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
                <div>
                    <div className="text-ludo-xs uppercase tracking-wider text-ink-soft font-bold">
                        CWR Elo Trajectory
                    </div>
                    <div className="flex items-baseline gap-2 mt-0.5">
                        <span className="text-ludo-xl font-bold font-mono text-ink">
                            {currentCwr.toLocaleString()}
                        </span>
                        <span
                            className={`inline-flex items-center gap-1 text-ludo-xs font-mono font-bold px-1.5 py-0.5 rounded border ${
                                isPositive
                                    ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                                    : "bg-rose-500/10 text-rose-400 border-rose-500/30"
                            }`}
                        >
                            {isPositive ? (
                                <LuTrendingUp className="w-3 h-3" />
                            ) : (
                                <LuTrendingDown className="w-3 h-3" />
                            )}
                            {isPositive ? "+" : ""}
                            {chart.netDelta} ({division})
                        </span>
                    </div>
                </div>
                <div className="flex items-center gap-1 bg-surface rounded-lg p-0.5 border border-line">
                    {(["all", "10", "5"] as const).map((r) => (
                        <button
                            key={r}
                            type="button"
                            onClick={() => setRange(r)}
                            className={`px-2 py-0.5 rounded text-ludo-xs font-mono uppercase font-bold transition-colors ${
                                range === r
                                    ? "bg-accent-soft text-accent"
                                    : "text-ink-soft hover:text-ink"
                            }`}
                        >
                            {r === "all" ? "All" : `${r}W`}
                        </button>
                    ))}
                </div>
            </div>

            <div className="w-full overflow-hidden rounded-lg bg-surface/60 border border-line/60 px-1 pt-1">
                <svg
                    viewBox={`0 0 ${chart.w} ${chart.h}`}
                    className="w-full h-24 overflow-visible"
                    aria-label="Clan War Rating trajectory chart"
                >
                    <defs>
                        <linearGradient id="clanCwrAreaGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={accentColor} stopOpacity="0.32" />
                            <stop offset="100%" stopColor={accentColor} stopOpacity="0.02" />
                        </linearGradient>
                    </defs>
                    <line
                        x1="8"
                        y1={chart.h * 0.25}
                        x2={chart.w - 8}
                        y2={chart.h * 0.25}
                        stroke="currentColor"
                        strokeOpacity="0.08"
                        strokeDasharray="3 3"
                    />
                    <line
                        x1="8"
                        y1={chart.h * 0.5}
                        x2={chart.w - 8}
                        y2={chart.h * 0.5}
                        stroke="currentColor"
                        strokeOpacity="0.08"
                        strokeDasharray="3 3"
                    />
                    <line
                        x1="8"
                        y1={chart.h * 0.75}
                        x2={chart.w - 8}
                        y2={chart.h * 0.75}
                        stroke="currentColor"
                        strokeOpacity="0.08"
                        strokeDasharray="3 3"
                    />
                    <path d={chart.areaD} fill="url(#clanCwrAreaGrad)" />
                    <path
                        d={chart.pathD}
                        fill="none"
                        stroke={accentColor}
                        strokeWidth="2.2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    />
                    {chart.coords.map((c, idx) => {
                        const isLast = idx === chart.coords.length - 1;
                        return (
                            <g key={`${c.point.label}-${idx}`}>
                                <circle
                                    cx={c.x}
                                    cy={c.y}
                                    r={isLast ? 4 : 2.2}
                                    fill={
                                        c.point.outcome === "L"
                                            ? "#f43f5e"
                                            : c.point.outcome === "W"
                                              ? "#34d399"
                                              : accentColor
                                    }
                                    stroke="#07111a"
                                    strokeWidth={isLast ? "1.5" : "0.75"}
                                />
                            </g>
                        );
                    })}
                </svg>
            </div>

            <div className="flex items-center justify-between text-ludo-xs text-ink-soft font-mono">
                <span>{sliced[0]?.label || "Base"}</span>
                <span>{Math.max(0, points.length - 1)} recorded wars</span>
                <span className="text-accent font-bold">Live {currentCwr}</span>
            </div>
        </div>
    );
}

/* ── 2. Combat Win-Rate Ring & 1v1 / 2v2 Breakdown ─────────────────────────── */
export function ClanCombatGauge({
    warRecord,
    shapeStats,
}: {
    warRecord: ClanProfileDossier["warRecord"];
    shapeStats: ClanProfileDossier["shapeStats"];
}) {
    const total = Math.max(1, warRecord.played);
    const radius = 36;
    const circumference = 2 * Math.PI * radius;
    const winArc = (warRecord.wins / total) * circumference;
    const drawArc = (warRecord.draws / total) * circumference;
    const lossArc = (warRecord.losses / total) * circumference;

    return (
        <div className="rounded-xl border border-line bg-surface-elevated p-3.5 space-y-3">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-ludo-xs uppercase tracking-wider text-ink-soft font-bold">
                    <LuShield className="w-3.5 h-3.5 text-accent" />
                    Combat Telemetry
                </div>
                <span className="inline-flex items-center gap-1 text-ludo-xs font-mono font-bold text-amber-400">
                    <LuFlame className="w-3.5 h-3.5" />
                    Streak {warRecord.currentStreak} (Best {warRecord.bestStreak})
                </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-5 gap-3 items-center">
                {/* Donut Ring */}
                <div className="sm:col-span-2 flex items-center gap-3">
                    <div className="relative w-24 h-24 shrink-0 flex items-center justify-center">
                        <svg viewBox="0 0 96 96" className="w-24 h-24 -rotate-90">
                            <circle
                                cx="48"
                                cy="48"
                                r={radius}
                                fill="none"
                                stroke="currentColor"
                                strokeOpacity="0.1"
                                strokeWidth="9"
                            />
                            {warRecord.played > 0 && (
                                <>
                                    <circle
                                        cx="48"
                                        cy="48"
                                        r={radius}
                                        fill="none"
                                        stroke="#34d399"
                                        strokeWidth="9"
                                        strokeDasharray={`${winArc} ${circumference}`}
                                        strokeDashoffset={0}
                                        strokeLinecap="butt"
                                    />
                                    <circle
                                        cx="48"
                                        cy="48"
                                        r={radius}
                                        fill="none"
                                        stroke="#94a3b8"
                                        strokeWidth="9"
                                        strokeDasharray={`${drawArc} ${circumference}`}
                                        strokeDashoffset={-winArc}
                                        strokeLinecap="butt"
                                    />
                                    <circle
                                        cx="48"
                                        cy="48"
                                        r={radius}
                                        fill="none"
                                        stroke="#f43f5e"
                                        strokeWidth="9"
                                        strokeDasharray={`${lossArc} ${circumference}`}
                                        strokeDashoffset={-(winArc + drawArc)}
                                        strokeLinecap="butt"
                                    />
                                </>
                            )}
                        </svg>
                        <div className="absolute inset-0 flex flex-col items-center justify-center">
                            <span className="text-ludo-lg font-bold font-mono text-ink leading-none">
                                {warRecord.winRate}%
                            </span>
                            <span className="text-ludo-xs uppercase text-ink-soft font-mono mt-0.5">
                                WIN RATE
                            </span>
                        </div>
                    </div>

                    <div className="space-y-1 text-ludo-xs font-mono">
                        <div className="flex items-center gap-1.5 text-emerald-400 font-bold">
                            <span className="w-2 h-2 rounded-full bg-emerald-400" />
                            {warRecord.wins}W Wins
                        </div>
                        <div className="flex items-center gap-1.5 text-rose-400 font-bold">
                            <span className="w-2 h-2 rounded-full bg-rose-400" />
                            {warRecord.losses}L Losses
                        </div>
                        <div className="flex items-center gap-1.5 text-ink-soft">
                            <span className="w-2 h-2 rounded-full bg-slate-400" />
                            {warRecord.draws}D Draws
                        </div>
                    </div>
                </div>

                {/* Shape Bars + Recent Form */}
                <div className="sm:col-span-3 space-y-2.5">
                    <div className="space-y-1">
                        <div className="flex items-center justify-between text-ludo-xs font-mono">
                            <span className="text-ink-soft">1v1 Duel Fixtures</span>
                            <span className="font-bold text-ink">
                                {shapeStats.shape1v1.wins}/{shapeStats.shape1v1.played} ({shapeStats.shape1v1.winRate}%)
                            </span>
                        </div>
                        <div className="h-2 rounded-full bg-surface overflow-hidden border border-line/60">
                            <div
                                className="h-full rounded-full bg-accent transition-all duration-300"
                                style={{ width: `${Math.min(100, shapeStats.shape1v1.winRate)}%` }}
                            />
                        </div>
                    </div>

                    <div className="space-y-1">
                        <div className="flex items-center justify-between text-ludo-xs font-mono">
                            <span className="text-ink-soft">2v2 Squad Fixtures</span>
                            <span className="font-bold text-ink">
                                {shapeStats.shape2v2.wins}/{shapeStats.shape2v2.played} ({shapeStats.shape2v2.winRate}%)
                            </span>
                        </div>
                        <div className="h-2 rounded-full bg-surface overflow-hidden border border-line/60">
                            <div
                                className="h-full rounded-full bg-emerald-400 transition-all duration-300"
                                style={{ width: `${Math.min(100, shapeStats.shape2v2.winRate)}%` }}
                            />
                        </div>
                    </div>

                    <div className="flex items-center justify-between pt-0.5">
                        <span className="text-ludo-xs uppercase tracking-wider text-ink-soft font-mono">
                            Recent Form
                        </span>
                        <div className="flex items-center gap-1">
                            {warRecord.recentForm.length === 0 ? (
                                <span className="text-ludo-xs font-mono text-ink-soft">No wars yet</span>
                            ) : (
                                warRecord.recentForm.map((f, idx) => (
                                    <span
                                        key={`${f}-${idx}`}
                                        className={`w-5 h-5 rounded flex items-center justify-center text-ludo-xs font-mono font-bold border ${
                                            f === "W"
                                                ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/40"
                                                : f === "L"
                                                  ? "bg-rose-500/15 text-rose-400 border-rose-500/40"
                                                  : "bg-slate-500/15 text-ink-soft border-line"
                                        }`}
                                    >
                                        {f}
                                    </span>
                                ))
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

/* ── 3. Top Contributors Roster Velocity Chart ─────────────────────────────── */
export function ClanVelocityChart({ contributors }: { contributors: ClanContributorStat[] }) {
    const maxScore = Math.max(
        1,
        ...contributors.map((c) => c.wp_earned * 10 + c.cxp_contributed),
    );

    return (
        <div className="rounded-xl border border-line bg-surface-elevated p-3.5 space-y-2.5">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-ludo-xs uppercase tracking-wider text-ink-soft font-bold">
                    <LuUsers className="w-3.5 h-3.5 text-accent" />
                    Roster Contribution Leaders
                </div>
                <span className="text-ludo-xs font-mono text-ink-soft">WP & CXP Velocity</span>
            </div>

            {contributors.length === 0 ? (
                <div className="text-ludo-xs text-ink-soft py-4 text-center font-mono">
                    No operative telemetry recorded yet.
                </div>
            ) : (
                <div className="space-y-2">
                    {contributors.map((c, idx) => {
                        const score = c.wp_earned * 10 + c.cxp_contributed;
                        const pct = Math.max(6, Math.round((score / maxScore) * 100));
                        const displayName =
                            c.username || `${c.wallet_address.slice(0, 6)}...${c.wallet_address.slice(-4)}`;

                        return (
                            <div key={c.wallet_address} className="space-y-1">
                                <div className="flex items-center justify-between text-ludo-xs">
                                    <div className="flex items-center gap-2 min-w-0">
                                        <span className="font-mono text-ink-soft w-4">#{idx + 1}</span>
                                        <span className="font-bold text-ink truncate">{displayName}</span>
                                        <span className="px-1.5 py-0.5 rounded bg-surface border border-line font-mono text-ludo-xs uppercase text-ink-soft">
                                            {c.role}
                                        </span>
                                    </div>
                                    <span className="font-mono font-bold text-accent shrink-0">
                                        {c.wp_earned} WP · {c.cxp_contributed.toLocaleString()} CXP
                                    </span>
                                </div>
                                <div className="h-1.5 rounded-full bg-surface overflow-hidden border border-line/60">
                                    <div
                                        className="h-full rounded-full bg-accent transition-all duration-300"
                                        style={{ width: `${pct}%` }}
                                    />
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

/* ── 4. Treasury Inflow / Outflow Donut & P&L Guarded Vault ────────────────── */
export function ClanTreasuryDonut({
    breakdown,
    canViewTreasury,
    isCommander,
    onToggleVisibility,
}: {
    breakdown: ClanProfileDossier["treasuryBreakdown"];
    canViewTreasury: boolean;
    isCommander?: boolean;
    onToggleVisibility?: () => void;
}) {
    if (!canViewTreasury || !breakdown) {
        return (
            <div className="rounded-xl border border-line bg-surface-elevated p-5 text-center space-y-2.5">
                <div className="w-11 h-11 rounded-full bg-surface border border-line mx-auto flex items-center justify-center text-ink-soft">
                    <LuLock className="w-5 h-5" />
                </div>
                <div className="text-ludo-sm font-bold text-ink uppercase tracking-wide">
                    Treasury &amp; P&amp;L Classified
                </div>
                <p className="text-ludo-xs text-ink-soft max-w-xs mx-auto leading-relaxed">
                    Vault balance, inflow/outflow telemetry, and war P&amp;L are restricted to syndicate members by the commander.
                </p>
            </div>
        );
    }

    const segments = [
        { label: "War Income", value: breakdown.warIncome, color: "#34d399" },
        { label: "Donations", value: breakdown.donations, color: "#00E5FF" },
        { label: "Vault Grants", value: breakdown.vaultGrants, color: "#fbbf24" },
        { label: "Subsidies & Spend", value: breakdown.expenses, color: "#f43f5e" },
    ];
    const totalVol = Math.max(1, segments.reduce((acc, s) => acc + s.value, 0));
    const radius = 34;
    const circ = 2 * Math.PI * radius;

    let offsetAcc = 0;
    const arcs = segments.map((s) => {
        const len = (s.value / totalVol) * circ;
        const offset = -offsetAcc;
        offsetAcc += len;
        return { ...s, len, offset };
    });

    const pnlPos = breakdown.warPnL >= 0;

    return (
        <div className="rounded-xl border border-line bg-surface-elevated p-3.5 space-y-3">
            <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-ludo-xs uppercase tracking-wider text-ink-soft font-bold">
                    <LuCoins className="w-3.5 h-3.5 text-amber-400" />
                    Treasury Flows &amp; War P&amp;L
                </div>
                {isCommander && onToggleVisibility && (
                    <button
                        type="button"
                        onClick={onToggleVisibility}
                        className="inline-flex items-center gap-1 text-ludo-xs font-mono font-bold px-2 py-0.5 rounded border border-line bg-surface text-ink-soft hover:text-ink transition-colors"
                    >
                        <LuEye className="w-3 h-3" />
                        Change Privacy
                    </button>
                )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-5 gap-3 items-center">
                <div className="sm:col-span-2 flex items-center justify-center">
                    <div className="relative w-24 h-24 flex items-center justify-center">
                        <svg viewBox="0 0 92 92" className="w-24 h-24 -rotate-90">
                            <circle
                                cx="46"
                                cy="46"
                                r={radius}
                                fill="none"
                                stroke="currentColor"
                                strokeOpacity="0.1"
                                strokeWidth="9"
                            />
                            {arcs.map((a) =>
                                a.value > 0 ? (
                                    <circle
                                        key={a.label}
                                        cx="46"
                                        cy="46"
                                        r={radius}
                                        fill="none"
                                        stroke={a.color}
                                        strokeWidth="9"
                                        strokeDasharray={`${a.len} ${circ}`}
                                        strokeDashoffset={a.offset}
                                    />
                                ) : null,
                            )}
                        </svg>
                        <div className="absolute inset-0 flex flex-col items-center justify-center">
                            <span className="text-ludo-sm font-bold font-mono text-amber-400 leading-none">
                                {formatShortChips(breakdown.balance)}
                            </span>
                            <span className="text-ludo-xs font-mono text-ink-soft uppercase mt-0.5">
                                CHIPS
                            </span>
                        </div>
                    </div>
                </div>

                <div className="sm:col-span-3 space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                        <div className="rounded-lg bg-surface border border-line/70 px-2.5 py-2">
                            <div className="text-ludo-xs text-ink-soft font-mono uppercase">War Net P&amp;L</div>
                            <div
                                className={`text-ludo-sm font-bold font-mono ${
                                    pnlPos ? "text-emerald-400" : "text-rose-400"
                                }`}
                            >
                                {pnlPos ? "+" : ""}
                                {formatShortChips(breakdown.warPnL)}
                            </div>
                        </div>
                        <div className="rounded-lg bg-surface border border-line/70 px-2.5 py-2">
                            <div className="text-ludo-xs text-ink-soft font-mono uppercase">Total Inflow</div>
                            <div className="text-ludo-sm font-bold font-mono text-accent">
                                +{formatShortChips(breakdown.totalInflows)}
                            </div>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-1.5 text-ludo-xs font-mono">
                        {segments.map((s) => (
                            <div key={s.label} className="flex items-center justify-between gap-1 text-ink-soft">
                                <span className="inline-flex items-center gap-1.5 truncate">
                                    <span
                                        className="w-2 h-2 rounded-full shrink-0"
                                        style={{ backgroundColor: s.color }}
                                    />
                                    {s.label}
                                </span>
                                <span className="text-ink font-bold">{formatShortChips(s.value)}</span>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}

/* ── 5. Clan Level & Perks Roadmap Track ───────────────────────────────────── */
export function ClanLevelRoadmap({
    currentLevel,
    currentCxp,
    levels,
}: {
    currentLevel: number;
    currentCxp: number;
    levels: ClanLevelConfig[];
}) {
    const visibleTiers = useMemo(() => {
        if (levels.length <= 6) return levels;
        const startIdx = Math.max(0, Math.min(levels.length - 6, currentLevel - 2));
        return levels.slice(startIdx, startIdx + 6);
    }, [levels, currentLevel]);

    return (
        <div className="rounded-xl border border-line bg-surface-elevated p-3.5 space-y-2.5">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-ludo-xs uppercase tracking-wider text-ink-soft font-bold">
                    <LuLayers className="w-3.5 h-3.5 text-accent" />
                    Citadel Progression Roadmap
                </div>
                <span className="text-ludo-xs font-mono text-ink-soft">
                    Lvl {currentLevel}/20 · {currentCxp.toLocaleString()} CXP
                </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {visibleTiers.map((lvl) => {
                    const unlocked = lvl.level <= currentLevel;
                    const isCurrent = lvl.level === currentLevel;
                    return (
                        <div
                            key={lvl.level}
                            className={`rounded-lg border px-2.5 py-2 space-y-1 ${
                                isCurrent
                                    ? "bg-accent-soft border-accent-line"
                                    : unlocked
                                      ? "bg-emerald-500/10 border-emerald-500/30"
                                      : "bg-surface border-line opacity-75"
                            }`}
                        >
                            <div className="flex items-center justify-between">
                                <span className="text-ludo-xs font-mono font-bold text-ink">
                                    LVL {lvl.level}
                                </span>
                                {unlocked ? (
                                    <LuCheck className="w-3.5 h-3.5 text-emerald-400" />
                                ) : (
                                    <span className="text-ludo-xs font-mono text-ink-soft">
                                        {formatShortChips(lvl.cxp_required)} CXP
                                    </span>
                                )}
                            </div>
                            <div className="text-ludo-xs font-mono text-ink-soft space-y-0.5">
                                <div>Cap: {lvl.member_cap} seats</div>
                                <div>Officers: {lvl.officer_slots} slots</div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
