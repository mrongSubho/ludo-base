"use client";

import React from "react";

export type AccountStatus = "online" | "pending" | "offline";

const STATUS_COLOR: Record<AccountStatus, string> = {
    online: "var(--sig-ok, #22C55E)",
    pending: "var(--sig-warn, #F59E0B)",
    offline: "var(--ink-faint, #6B7685)",
};

const STATUS_TEXT: Record<AccountStatus, string> = {
    online: "Online",
    pending: "Pending",
    offline: "Offline",
};

export function StatusBadge({
    status,
    label,
    size = 10,
    className = "",
}: {
    status: AccountStatus;
    label?: string;
    size?: number;
    className?: string;
}) {
    return (
        <span className={`inline-flex items-center gap-1.5 ${className}`}>
            <span
                aria-hidden
                className="inline-block rounded-full shrink-0"
                style={{
                    width: `${size}px`,
                    height: `${size}px`,
                    backgroundColor: STATUS_COLOR[status],
                    boxShadow: "0 0 0 2px var(--surface-1, #0A0E14)",
                }}
            />
            {label !== undefined ? (
                <span className="font-mono text-[11px] uppercase tracking-wider text-ink-muted">
                    {label}
                </span>
            ) : (
                <span className="sr-only">{STATUS_TEXT[status]}</span>
            )}
        </span>
    );
}

export default StatusBadge;
