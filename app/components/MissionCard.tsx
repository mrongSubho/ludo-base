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
    iconContainerClassName = "bg-accent-soft text-accent border-accent/35",
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
        rewardTone === "amber" ? "text-warn" : "text-accent";

    return (
        <div
            className={`card-3077 flex flex-col gap-2.5 bg-surface-recessed border p-3.5 rounded-2xl hover:bg-surface-hover transition-colors relative overflow-hidden group ${
                doneVisual ? "border-positive/45" : "border-line-soft hover:border-line-strong"
            }`}
        >
            <HudCornerTicks />
            <ClaimingOverlay isClaiming={isClaiming} />

            {doneVisual && (
                <div className="absolute inset-0 bg-positive/10 opacity-40 pointer-events-none" />
            )}

            {/* Header: Icon Badge + Title + Reward Pill */}
            <div className="flex items-start gap-3 relative z-[1]">
                <div
                    className={`w-11 h-11 flex items-center justify-center rounded-xl shrink-0 border text-ludo-lg ${iconContainerClassName}`}
                >
                    {icon}
                </div>

                <div className="flex flex-col flex-1 min-w-0 pt-0.5">
                    <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                            <h3
                                className={`font-bold text-ludo-md truncate ${
                                    isClaimed
                                        ? "text-ink-muted"
                                        : isCompleted
                                          ? "text-positive"
                                          : "text-ink-strong"
                                }`}
                            >
                                {title}
                            </h3>
                            {scopeLabel && (
                                <span className="inline-block mt-0.5 px-1.5 py-0.5 rounded bg-surface-panel border border-line-soft font-mono text-ludo-xs uppercase tracking-wider text-ink-faint">
                                    {scopeLabel}
                                </span>
                            )}
                        </div>

                        <div className="flex items-center gap-1.5 bg-surface-panel px-2.5 py-1 rounded-lg border border-line-soft shrink-0">
                            {rewardIcon}
                            <span className={`text-ludo-xs font-extrabold font-mono leading-none ${rewardTextClass}`}>
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
                    <p className="text-ludo-xs font-medium text-ink-muted leading-snug tabular-nums truncate">
                        {description}
                    </p>
                )}

                <div className="flex items-center gap-3 mt-0.5">
                    <div className="flex-1 min-w-0">
                        <div className="flex items-end justify-between mb-1 px-0.5">
                            <span className="text-ludo-xs uppercase font-bold text-ink-faint tracking-wider font-mono">
                                Progress
                            </span>
                            <span
                                className={`text-ludo-xs font-extrabold font-mono tabular-nums ${
                                    isClaimed
                                        ? "text-ink-muted"
                                        : isCompleted
                                          ? "text-positive"
                                          : "text-ink-strong"
                                }`}
                            >
                                {progress}{" "}
                                <span className="text-ink-faint">
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
