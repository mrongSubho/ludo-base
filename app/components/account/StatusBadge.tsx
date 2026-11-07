"use client";

import React from "react";

export type StatusBadgeState = "online" | "pending" | "offline" | "in-match";

export interface StatusBadgeProps {
  status: StatusBadgeState;
  className?: string;
  size?: number;
}

/**
 * §5.2 / §5.5 Static Status Badge for avatars
 * 10px dot in the avatar's bottom-right corner with a 2px --surface-1 ring.
 * --sig-ok online / --sig-warn pending or in-match / --ink-faint offline.
 * Static, never blinks.
 */
export const StatusBadge: React.FC<StatusBadgeProps> = ({
  status,
  className = "",
  size = 10,
}) => {
  const colorClass =
    status === "online"
      ? "bg-sig-ok"
      : status === "pending" || status === "in-match"
      ? "bg-sig-warn"
      : "bg-ink-faint";

  const label =
    status === "online"
      ? "Online"
      : status === "in-match"
      ? "In Match"
      : status === "pending"
      ? "Pending"
      : "Offline";

  return (
    <span
      className={`absolute bottom-0 right-0 rounded-full ring-2 ring-surface-1 ${colorClass} ${className}`}
      style={{ width: `${size}px`, height: `${size}px` }}
      role="status"
      aria-label={label}
      title={label}
    />
  );
};

export default StatusBadge;
