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
import { HudProgressGauge } from "@/app/components/HudPrimitives";

function formatShortChips(n: number): string {
    const abs = Math.abs(n);
    const sign = n < 0 ? "-" : "";
    if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(2)}M`;
    if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(1)}k`;
    return `${sign}${abs.toLocaleString()}`;
}

/* ── 1. CWR Elo Trajectory Area Chart ───────────────────────────────────────── */
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
        const w = 360;
        const h = 110;
        const padL = 36;
        const padR = 12;
        const padT = 14;
        const padB = 18;
        const vals = sliced.map((p) => p.cwr);
        const rawMin = Math.min(...vals, currentCwr);
        const rawMax = Math.max(...vals, currentCwr);
        const min = Math.max(0, Math.floor((rawMin - 30) / 10) * 10);
        const max = Math.ceil((rawMax + 30) / 10) * 10;
        const span = Math.max(20, max - min);
        const mid = Math.round((min + max) / 2);

        const coords = sliced.map((p, idx) => {
            const x =
                sliced.length === 1
                    ? w - padR
                    : padL + (idx / Math.max(1, sliced.length - 1)) * (w - padL - padR);
            const y = h - padB - ((p.cwr - min) / span) * (h - padT - padB);
            return { x, y, point: p };
        });

        const pathD =
            coords.length === 1
                ? `M ${padL} ${coords[0].y.toFixed(1)} L ${coords[0].x.toFixed(1)} ${coords[0].y.toFixed(1)}`
                : coords.map((c, i) => `${i === 0 ? "M" : "L"} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`).join(" ");

        const baseBottom = h - padB;
        const firstX = coords.length === 1 ? padL : coords[0].x;
        const lastX = coords[coords.length - 1].x;
        const areaD = `${pathD} L ${lastX.toFixed(1)} ${baseBottom} L ${firstX.toFixed(1)} ${baseBottom} Z`;

        const last = coords[coords.length - 1];
        const first = coords[0];
        const netDelta = last.point.cwr - first.point.cwr;
        return { w, h, padL, padR, padT, padB, min, mid, max, coords, pathD, areaD, netDelta };
    }, [sliced, currentCwr]);

    const isPositive = chart.netDelta >= 0;

    return (
        <div className="rounded-2xl border border-line-soft bg-surface-panel p-3.5 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
                <div>
                    <div className="text-ludo-xs uppercase tracking-wider text-ink-faint font-mono font-bold">
                        CWR Rating Graph
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-ludo-xl font-bold font-mono text-ink-strong">
                            {currentCwr.toLocaleString()}
                        </span>
                        <span
                            className={`inline-flex items-center gap-1 text-ludo-xs font-mono font-bold px-1.5 py-0.5 rounded-md border ${
                                isPositive
                                    ? "bg-positive/15 text-positive border-positive/35"
                                    : "bg-negative/15 text-negative border-negative/35"
                            }`}
                        >
                            {isPositive ? (
                                <LuTrendingUp className="w-3 h-3" />
                            ) : (
                                <LuTrendingDown className="w-3 h-3" />
                            )}
                            {isPositive ? "+" : ""}
                            {chart.netDelta} · {division}
                        </span>
                    </div>
                </div>
                <div className="flex items-center gap-1 bg-surface-recessed rounded-lg p-0.5 border border-line-soft">
                    {(["all", "10", "5"] as const).map((r) => (
                        <button
                            key={r}
                            type="button"
                            onClick={() => setRange(r)}
                            className={`px-2 py-0.5 rounded-md text-ludo-xs font-mono uppercase font-bold transition-colors ${
                                range === r
                                    ? "bg-accent-soft text-accent"
                                    : "text-ink-muted hover:text-ink-strong"
                            }`}
                        >
                            {r === "all" ? "All" : `${r}W`}
                        </button>
                    ))}
                </div>
            </div>

            <div className="w-full rounded-xl bg-surface-recessed border border-line-soft p-1.5">
                <svg
                    viewBox={`0 0 ${chart.w} ${chart.h}`}
                    className="w-full h-28 overflow-visible"
                    aria-label="Clan War Rating trajectory chart"
                >
                    <defs>
                        <linearGradient id="clanCwrAreaGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={accentColor} stopOpacity="0.35" />
                            <stop offset="100%" stopColor={accentColor} stopOpacity="0.02" />
                        </linearGradient>
                    </defs>

                    {[
                        { val: chart.max, y: chart.padT },
                        { val: chart.mid, y: (chart.padT + (chart.h - chart.padB)) / 2 },
                        { val: chart.min, y: chart.h - chart.padB },
                    ].map((tick) => (
                        <g key={tick.val}>
                            <text
                                x={chart.padL - 5}
                                y={tick.y + 3}
                                textAnchor="end"
                                className="fill-ink-faint font-mono"
                                style={{ fontSize: "9px" }}
                            >
                                {tick.val}
                            </text>
                            <line
                                x1={chart.padL}
                                y1={tick.y}
                                x2={chart.w - chart.padR}
                                y2={tick.y}
                                stroke="currentColor"
                                className="text-line-soft"
                                strokeDasharray="3 3"
                            />
                        </g>
                    ))}

                    <path d={chart.areaD} fill="url(#clanCwrAreaGrad)" />
                    <path
                        d={chart.pathD}
                        fill="none"
                        stroke={accentColor}
                        strokeWidth="2.4"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    />
                    {chart.coords.map((c, idx) => {
                        const isLast = idx === chart.coords.length - 1;
                        return (
                            <circle
                                key={`${c.point.label}-${idx}`}
                                cx={c.x}
                                cy={c.y}
                                r={isLast ? 4.2 : 2.5}
                                fill={
                                    c.point.outcome === "L"
                                        ? "#fb7185"
                                        : c.point.outcome === "W"
                                          ? "#34d399"
                                          : accentColor
                                }
                                stroke="currentColor"
                                className="text-surface-panel"
                                strokeWidth="1.5"
                            />
                        );
                    })}
                </svg>
            </div>

            <div className="flex items-center justify-between text-ludo-xs text-ink-muted font-mono px-0.5">
                <span>Start: {sliced[0]?.label || "Base"}</span>
                <span>{Math.max(0, points.length - 1)} wars tracked</span>
                <span className="text-accent font-bold">Live {currentCwr}</span>
            </div>
        </div>
    );
}

/* ── 2. Combat Win-Rate Donut & 1v1 / 2v2 Comparison Chart ─────────────────── */
export function ClanCombatGauge({
    warRecord,
    shapeStats,
}: {
    warRecord: ClanProfileDossier["warRecord"];
    shapeStats: ClanProfileDossier["shapeStats"];
}) {
    const total = Math.max(1, warRecord.played);
    const radius = 34;
    const circumference = 2 * Math.PI * radius;
    const winArc = (warRecord.wins / total) * circumference;
    const drawArc = (warRecord.draws / total) * circumference;
    const lossArc = (warRecord.losses / total) * circumference;

    return (
        <div className="rounded-2xl border border-line-soft bg-surface-panel p-3.5 space-y-3">
            <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-ludo-xs uppercase tracking-wider text-ink-muted font-mono font-bold">
                    <LuShield className="w-3.5 h-3.5 text-accent" />
                    <span>Combat Split &amp; Win Rate</span>
                </div>
                <span className="inline-flex items-center gap-1 text-ludo-xs font-mono font-bold text-warn">
                    <LuFlame className="w-3.5 h-3.5" />
                    Streak {warRecord.currentStreak} (Best {warRecord.bestStreak})
                </span>
            </div>

            <div className="flex items-center gap-4">
                {/* Left Donut Ring */}
                <div className="relative w-24 h-24 shrink-0 flex items-center justify-center">
                    <svg viewBox="0 0 92 92" className="w-24 h-24 -rotate-90">
                        <circle
                            cx="46"
                            cy="46"
                            r={radius}
                            fill="none"
                            stroke="currentColor"
                            className="text-line-soft"
                            strokeWidth="8.5"
                        />
                        {warRecord.played > 0 && (
                            <>
                                <circle
                                    cx="46"
                                    cy="46"
                                    r={radius}
                                    fill="none"
                                    stroke="#34d399"
                                    strokeWidth="8.5"
                                    strokeDasharray={`${winArc} ${circumference}`}
                                    strokeDashoffset={0}
                                />
                                <circle
                                    cx="46"
                                    cy="46"
                                    r={radius}
                                    fill="none"
                                    stroke="#94a3b8"
                                    strokeWidth="8.5"
                                    strokeDasharray={`${drawArc} ${circumference}`}
                                    strokeDashoffset={-winArc}
                                />
                                <circle
                                    cx="46"
                                    cy="46"
                                    r={radius}
                                    fill="none"
                                    stroke="#fb7185"
                                    strokeWidth="8.5"
                                    strokeDasharray={`${lossArc} ${circumference}`}
                                    strokeDashoffset={-(winArc + drawArc)}
                                />
                            </>
                        )}
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                        <span className="text-ludo-lg font-bold font-mono text-ink-strong leading-none">
                            {warRecord.winRate}%
                        </span>
                        <span className="text-ludo-xs uppercase text-ink-faint font-mono mt-0.5">
                            WIN
                        </span>
                    </div>
                </div>

                {/* Right Bars & Outcome Counts */}
                <div className="flex-1 min-w-0 space-y-2">
                    <div className="flex items-center justify-between text-ludo-xs font-mono">
                        <span className="inline-flex items-center gap-1 text-positive font-bold">
                            <span className="w-2 h-2 rounded-full bg-positive" />
                            {warRecord.wins}W
                        </span>
                        <span className="inline-flex items-center gap-1 text-negative font-bold">
                            <span className="w-2 h-2 rounded-full bg-negative" />
                            {warRecord.losses}L
                        </span>
                        <span className="inline-flex items-center gap-1 text-ink-muted">
                            <span className="w-2 h-2 rounded-full bg-line-strong" />
                            {warRecord.draws}D
                        </span>
                    </div>

                    <div className="space-y-1">
                        <div className="flex items-center justify-between text-ludo-xs font-mono">
                            <span className="text-ink-muted">1v1 Duel</span>
                            <span className="font-bold text-ink-strong">
                                {shapeStats.shape1v1.wins}/{shapeStats.shape1v1.played} ({shapeStats.shape1v1.winRate}%)
                            </span>
                        </div>
                        <HudProgressGauge percent={Math.min(100, shapeStats.shape1v1.winRate)} tone="accent" />
                    </div>

                    <div className="space-y-1">
                        <div className="flex items-center justify-between text-ludo-xs font-mono">
                            <span className="text-ink-muted">2v2 Squad</span>
                            <span className="font-bold text-ink-strong">
                                {shapeStats.shape2v2.wins}/{shapeStats.shape2v2.played} ({shapeStats.shape2v2.winRate}%)
                            </span>
                        </div>
                        <HudProgressGauge percent={Math.min(100, shapeStats.shape2v2.winRate)} tone="positive" />
                    </div>
                </div>
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-line-soft">
                <span className="text-ludo-xs uppercase tracking-wider text-ink-faint font-mono">
                    Recent Form
                </span>
                <div className="flex items-center gap-1">
                    {warRecord.recentForm.length === 0 ? (
                        <span className="text-ludo-xs font-mono text-ink-faint">No resolved wars yet</span>
                    ) : (
                        warRecord.recentForm.map((f, idx) => (
                            <span
                                key={`${f}-${idx}`}
                                className={`w-5 h-5 rounded-md flex items-center justify-center text-ludo-xs font-mono font-bold border ${
                                    f === "W"
                                        ? "bg-positive/20 text-positive border-positive/40"
                                        : f === "L"
                                          ? "bg-negative/20 text-negative border-negative/40"
                                          : "bg-surface-recessed text-ink-muted border-line-soft"
                                }`}
                            >
                                {f}
                            </span>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
}

/* ── 3. Top Contributors Bar Chart ──────────────────────────────────────────── */
export function ClanVelocityChart({ contributors }: { contributors: ClanContributorStat[] }) {
    const maxScore = Math.max(
        1,
        ...contributors.map((c) => c.wp_earned * 10 + c.cxp_contributed),
    );

    return (
        <div className="rounded-2xl border border-line-soft bg-surface-panel p-3.5 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-ludo-xs uppercase tracking-wider text-ink-muted font-mono font-bold">
                    <LuUsers className="w-3.5 h-3.5 text-accent" />
                    <span>Top Contributor Chart</span>
                </div>
                <span className="text-ludo-xs font-mono text-ink-faint">WP &amp; CXP Share</span>
            </div>

            {contributors.length === 0 ? (
                <div className="text-ludo-xs text-ink-faint py-4 text-center font-mono">
                    No operative telemetry recorded yet.
                </div>
            ) : (
                <div className="space-y-2.5">
                    {contributors.map((c, idx) => {
                        const score = c.wp_earned * 10 + c.cxp_contributed;
                        const pct = Math.max(8, Math.round((score / maxScore) * 100));
                        const displayName =
                            c.username || `${c.wallet_address.slice(0, 6)}...${c.wallet_address.slice(-4)}`;

                        return (
                            <div key={c.wallet_address} className="space-y-1">
                                <div className="flex items-center justify-between gap-2 text-ludo-xs">
                                    <div className="flex items-center gap-2 min-w-0">
                                        <span className="font-mono text-ink-faint shrink-0">#{idx + 1}</span>
                                        <span className="font-bold text-ink-strong truncate">{displayName}</span>
                                        <span className="px-1.5 py-0.5 rounded bg-surface-recessed border border-line-soft font-mono text-ludo-xs uppercase text-ink-muted shrink-0">
                                            {c.role}
                                        </span>
                                    </div>
                                    <span className="font-mono font-bold text-accent shrink-0">
                                        {c.wp_earned} WP · {c.cxp_contributed.toLocaleString()} CXP
                                    </span>
                                </div>
                                <HudProgressGauge percent={pct} tone="accent" />
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

/* ── 4. Treasury Inflow / Outflow Donut & P&L Guarded Chart ────────────────── */
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
            <div className="rounded-2xl border border-line-soft bg-surface-panel p-5 text-center space-y-2.5">
                <div className="w-11 h-11 rounded-full bg-surface-recessed border border-line-soft mx-auto flex items-center justify-center text-warn">
                    <LuLock className="w-5 h-5" />
                </div>
                <div className="text-ludo-sm font-bold text-ink-strong uppercase tracking-wide">
                    Treasury &amp; P&amp;L Classified
                </div>
                <p className="text-ludo-xs text-ink-muted max-w-xs mx-auto leading-relaxed">
                    Vault balance, inflow/outflow graphs, and war P&amp;L are restricted to syndicate members by the commander.
                </p>
            </div>
        );
    }

    const segments = [
        { label: "War Income", value: breakdown.warIncome, color: "#34d399" },
        { label: "Donations", value: breakdown.donations, color: "#22d3ee" },
        { label: "Vault Grants", value: breakdown.vaultGrants, color: "#fbbf24" },
        { label: "Subsidies & Spend", value: breakdown.expenses, color: "#fb7185" },
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
        <div className="rounded-2xl border border-line-soft bg-surface-panel p-3.5 space-y-3">
            <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-ludo-xs uppercase tracking-wider text-ink-muted font-mono font-bold">
                    <LuCoins className="w-3.5 h-3.5 text-warn" />
                    <span>Treasury Flow &amp; P&amp;L</span>
                </div>
                {isCommander && onToggleVisibility && (
                    <button
                        type="button"
                        onClick={onToggleVisibility}
                        className="inline-flex items-center gap-1 text-ludo-xs font-mono font-bold px-2 py-0.5 rounded-lg border border-line-soft bg-surface-recessed text-ink-muted hover:text-ink-strong transition-colors"
                    >
                        <LuEye className="w-3 h-3" />
                        <span>Toggle Privacy</span>
                    </button>
                )}
            </div>

            <div className="flex items-center gap-4">
                <div className="relative w-24 h-24 shrink-0 flex items-center justify-center">
                    <svg viewBox="0 0 92 92" className="w-24 h-24 -rotate-90">
                        <circle
                            cx="46"
                            cy="46"
                            r={radius}
                            fill="none"
                            stroke="currentColor"
                            className="text-line-soft"
                            strokeWidth="8.5"
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
                                    strokeWidth="8.5"
                                    strokeDasharray={`${a.len} ${circ}`}
                                    strokeDashoffset={a.offset}
                                />
                            ) : null,
                        )}
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                        <span className="text-ludo-sm font-bold font-mono text-warn leading-none">
                            {formatShortChips(breakdown.balance)}
                        </span>
                        <span className="text-ludo-xs font-mono text-ink-faint uppercase mt-0.5">
                            CHIPS
                        </span>
                    </div>
                </div>

                <div className="flex-1 min-w-0 space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                        <div className="rounded-xl bg-surface-recessed border border-line-soft px-2.5 py-1.5">
                            <div className="text-ludo-xs text-ink-faint font-mono uppercase">War P&amp;L</div>
                            <div
                                className={`text-ludo-sm font-bold font-mono ${
                                    pnlPos ? "text-positive" : "text-negative"
                                }`}
                            >
                                {pnlPos ? "+" : ""}
                                {formatShortChips(breakdown.warPnL)}
                            </div>
                        </div>
                        <div className="rounded-xl bg-surface-recessed border border-line-soft px-2.5 py-1.5">
                            <div className="text-ludo-xs text-ink-faint font-mono uppercase">Inflows</div>
                            <div className="text-ludo-sm font-bold font-mono text-accent">
                                +{formatShortChips(breakdown.totalInflows)}
                            </div>
                        </div>
                    </div>

                    <div className="space-y-1 text-ludo-xs font-mono">
                        {segments.map((s) => (
                            <div key={s.label} className="flex items-center justify-between gap-2 text-ink-muted">
                                <span className="inline-flex items-center gap-1.5 truncate">
                                    <span
                                        className="w-2 h-2 rounded-full shrink-0"
                                        style={{ backgroundColor: s.color }}
                                    />
                                    {s.label}
                                </span>
                                <span className="text-ink-strong font-bold shrink-0">{formatShortChips(s.value)}</span>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}

/* ── 5. Clan Citadel Progression Step Bar Chart ─────────────────────────────── */
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

    const maxCap = Math.max(20, ...visibleTiers.map((l) => l.member_cap));

    return (
        <div className="rounded-2xl border border-line-soft bg-surface-panel p-3.5 space-y-3">
            <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-ludo-xs uppercase tracking-wider text-ink-muted font-mono font-bold">
                    <LuLayers className="w-3.5 h-3.5 text-accent" />
                    <span>Citadel Capacity &amp; Tier Chart</span>
                </div>
                <span className="text-ludo-xs font-mono text-ink-faint">
                    Lvl {currentLevel}/20 · {currentCxp.toLocaleString()} CXP
                </span>
            </div>

            {/* Vertical Bar Chart comparing Member Cap per Level */}
            <div className="grid grid-cols-6 gap-2 items-end h-28 pt-3 px-2 rounded-xl bg-surface-recessed border border-line-soft pb-2">
                {visibleTiers.map((lvl) => {
                    const unlocked = lvl.level <= currentLevel;
                    const isCurrent = lvl.level === currentLevel;
                    const barHeightPct = Math.max(20, Math.round((lvl.member_cap / maxCap) * 100));
                    return (
                        <div key={lvl.level} className="flex flex-col items-center gap-1 h-full justify-end">
                            <span className="text-ludo-xs font-mono font-bold text-ink-strong">
                                {lvl.member_cap}
                            </span>
                            <div className="w-full flex-1 flex items-end justify-center">
                                <div
                                    className={`w-full max-w-[24px] rounded-t-md transition-all ${
                                        isCurrent
                                            ? "bg-accent shadow-[0_0_12px_rgba(0,229,255,0.45)]"
                                            : unlocked
                                              ? "bg-positive/80"
                                              : "bg-line-soft"
                                    }`}
                                    style={{ height: `${barHeightPct}%` }}
                                    title={`LVL ${lvl.level}: ${lvl.member_cap} seats, ${lvl.officer_slots} officers`}
                                />
                            </div>
                            <span
                                className={`text-ludo-xs font-mono font-bold flex items-center gap-0.5 ${
                                    isCurrent ? "text-accent" : unlocked ? "text-positive" : "text-ink-faint"
                                }`}
                            >
                                L{lvl.level}
                                {unlocked && <LuCheck className="w-2.5 h-2.5" />}
                            </span>
                        </div>
                    );
                })}
            </div>

            <div className="grid grid-cols-2 gap-2 text-ludo-xs font-mono">
                {visibleTiers.slice(0, 4).map((lvl) => (
                    <div
                        key={lvl.level}
                        className="rounded-lg bg-surface-recessed border border-line-soft px-2.5 py-1.5 flex items-center justify-between text-ink-muted"
                    >
                        <span className="font-bold text-ink-strong">LVL {lvl.level}</span>
                        <span>{lvl.member_cap} seats · {lvl.officer_slots} off</span>
                    </div>
                ))}
            </div>
        </div>
    );
}
