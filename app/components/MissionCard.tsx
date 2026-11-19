"use client";

import React from "react";
import { ClaimingOverlay } from "./ClaimingOverlay";
import { HudCornerTicks, HudProgressGauge } from "./HudPrimitives";

export interface MissionCardProps {
    title: string;
    description?: string;
    icon: React.ReactNode;
    iconContainerClassName?: string;
    rewardAmount: string | number;
    rewardUnit?: string;
    rewardIcon?: React.ReactNode;
    rewardTone?: "chips" | "cxp" | "amber";
    progress: number;
    target: number;
    isCompleted?: boolean;
    isClaimed?: boolean;
    isClaiming?: boolean;
    scopeLabel?: string;
    actionSlot?: React.ReactNode;
}

export function MissionCard({
    title,
    description,
    icon,
    iconContainerClassName = "bg-accent-soft text-cyan-300 border-cyan-400/35",
    rewardAmount,
    rewardUnit,
    rewardIcon,
    rewardTone = "chips",
    progress,
    target,
    isCompleted = false,
    isClaimed = false,
    isClaiming = false,
    scopeLabel,
    actionSlot,
}: MissionCardProps) {
    const safeTarget = target <= 0 ? 0 : target;
    const progressPercent =
        safeTarget <= 0
            ? isClaimed
                ? 100
                : 0
            : Math.min(100, Math.round((progress / safeTarget) * 100));

    const doneVisual = isCompleted && !isClaimed;
    const rewardTextClass =
        rewardTone === "amber"
            ? "text-amber-300"
            : rewardTone === "cxp"
              ? "text-cyan-300"
              : "text-cyan-400";

    return (
        <div
            className={`card-3077 flex flex-col gap-3 bg-white/[0.04] border p-4 rounded-2xl hover:bg-white/[0.07] hover:border-white/25 transition-colors relative overflow-hidden group ${
                doneVisual ? "border-emerald-400/35" : "border-white/10"
            }`}
        >
            <HudCornerTicks />
            <ClaimingOverlay isClaiming={isClaiming} />

            {doneVisual && (
                <div className="absolute inset-0 bg-emerald-500/5 opacity-50 blur-xl pointer-events-none" />
            )}

            {/* Header: Icon Badge + Title + Reward Pill */}
            <div className="flex items-start gap-3.5 relative z-[1]">
                <div
                    className={`w-12 h-12 flex items-center justify-center rounded-2xl shrink-0 border shadow-inner text-ludo-xl ${iconContainerClassName}`}
                >
                    {icon}
                </div>

                <div className="flex flex-col flex-1 min-w-0 pt-0.5">
                    <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                            <h3
                                className={`font-bold text-ludo-lg truncate ${
                                    isClaimed
                                        ? "text-white/60"
                                        : isCompleted
                                          ? "text-emerald-300"
                                          : "text-white"
                                }`}
                            >
                                {title}
                            </h3>
                            {scopeLabel && (
                                <span className="inline-block mt-0.5 px-1.5 py-0.5 rounded bg-black/30 border border-white/10 font-mono text-ludo-xs uppercase tracking-wider text-white/55">
                                    {scopeLabel}
                                </span>
                            )}
                        </div>

                        <div className="flex items-center gap-1.5 bg-black/40 px-2.5 py-1.5 rounded-lg border border-white/10 shrink-0">
                            {rewardIcon}
                            <span className={`text-ludo-sm font-extrabold font-mono leading-none ${rewardTextClass}`}>
                                {rewardAmount}
                                {rewardUnit ? ` ${rewardUnit}` : ""}
                            </span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Subtitle + Unified Progress Bar + Action CTA */}
            <div className="flex flex-col gap-2 relative z-[1]">
                {description && (
                    <p className="text-ludo-sm font-medium text-white/60 leading-snug tabular-nums truncate">
                        {description}
                    </p>
                )}

                <div className="flex items-center gap-3.5 mt-0.5">
                    <div className="flex-1 min-w-0">
                        <div className="flex items-end justify-between mb-1.5 px-0.5">
                            <span className="text-ludo-xs uppercase font-bold text-white/45 tracking-wider font-mono">
                                Progress
                            </span>
                            <span
                                className={`text-ludo-sm font-extrabold font-mono tabular-nums ${
                                    isClaimed
                                        ? "text-white/40"
                                        : isCompleted
                                          ? "text-emerald-300"
                                          : "text-white"
                                }`}
                            >
                                {progress}{" "}
                                <span className="text-white/35 text-ludo-xs">
                                    / {target}
                                </span>
                            </span>
                        </div>
                        <HudProgressGauge
                            percent={progressPercent}
                            tone={isClaimed ? "muted" : isCompleted ? "positive" : "accent"}
                        />
                    </div>

                    {actionSlot && <div className="shrink-0">{actionSlot}</div>}
                </div>
            </div>
        </div>
    );
}
