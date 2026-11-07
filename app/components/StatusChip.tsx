"use client";

import React from "react";

export type StatusChipTone = "ok" | "warn" | "danger" | "info" | "neutral";

export interface StatusChipProps {
  tone?: StatusChipTone;
  label: string;
  dot?: boolean;
  className?: string;
  size?: "sm" | "md";
}

const TONE_STYLES: Record<StatusChipTone, { bg: string; border: string; text: string; dot: string }> = {
  ok: {
    bg: "bg-sig-ok/10",
    border: "border-sig-ok/30",
    text: "text-sig-ok",
    dot: "bg-sig-ok",
  },
  warn: {
    bg: "bg-sig-warn/10",
    border: "border-sig-warn/30",
    text: "text-sig-warn",
    dot: "bg-sig-warn",
  },
  danger: {
    bg: "bg-sig-danger/10",
    border: "border-sig-danger/30",
    text: "text-sig-danger",
    dot: "bg-sig-danger",
  },
  info: {
    bg: "bg-sig-info/10",
    border: "border-sig-info/30",
    text: "text-sig-info",
    dot: "bg-sig-info",
  },
  neutral: {
    bg: "bg-surface-2",
    border: "border-line-soft",
    text: "text-ink-muted",
    dot: "bg-ink-faint",
  },
};

/**
 * §1.1 & §4.4 Semantic Status Chip.
 * Always renders a text label alongside the static semantic dot.
 * Static, never pulses or pings.
 */
export const StatusChip: React.FC<StatusChipProps> = ({
  tone = "info",
  label,
  dot = true,
  className = "",
  size = "md",
}) => {
  const styles = TONE_STYLES[tone] ?? TONE_STYLES.neutral;
  const paddingClass = size === "sm" ? "px-2 py-0.5 text-ludo-xs" : "px-2.5 py-1 text-ludo-xs";

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border font-mono font-bold uppercase tracking-wider ${styles.bg} ${styles.border} ${styles.text} ${paddingClass} ${className}`}
      role="status"
    >
      {dot && <span className={`w-1.5 h-1.5 rounded-full ${styles.dot} shrink-0`} />}
      <span>{label}</span>
    </span>
  );
};

export default StatusChip;
