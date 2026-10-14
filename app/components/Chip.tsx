"use client";

import React, { ButtonHTMLAttributes, HTMLAttributes } from "react";

/**
 * One chip, three types (UI_COMPONENT_AUDIT §4.2).
 *
 * Absorbs seven families that each invented their own pill: `bet-chip`,
 * `cb-filter-chip`, `tk-chip`, `dapp-chip`, `wl-addr-chip`, `match-status-*`,
 * `cb-status-pill`. All of them render on the shared `.chip` base in
 * globals.css (token-driven, so both themes are correct without patch rules).
 *
 *  - `filter`  — toggleable. Renders a <button> and wires `aria-pressed`.
 *  - `status`  — live/connected (`ok`), degraded/pending (`warn`), ended
 *                (`off`). Non-interactive: renders a <span>.
 *  - `info`    — neutral tag. Non-interactive: renders a <span>.
 *
 * `tone="address"` is the one modifier that is not about colour: it switches
 * to the monospace face (`wl-addr-chip` was a truncated address pill).
 */

type Type = "filter" | "status" | "info";
type Status = "ok" | "warn" | "off";

const STATUS_CLASS: Record<Status, string> = {
  ok: "chip-status-ok",
  warn: "chip-status-warn",
  off: "chip-status-off",
};

type CommonProps = {
  type?: Type;
  status?: Status;
  /** Monospace face for address/value pills. */
  tone?: "default" | "address";
  size?: "sm" | "md";
  active?: boolean;
  icon?: React.ReactNode;
  children?: React.ReactNode;
};

export type ChipProps = CommonProps &
  Omit<HTMLAttributes<HTMLSpanElement>, "children"> &
  Pick<ButtonHTMLAttributes<HTMLButtonElement>, "onClick" | "disabled" | "title" | "aria-label">;

export function Chip({
  type = "info",
  status,
  tone = "default",
  size = "md",
  active = false,
  icon,
  children,
  className = "",
  onClick,
  disabled,
  ...rest
}: ChipProps) {
  const classes = [
    "chip",
    size === "sm" ? "chip-sm" : "",
    status ? STATUS_CLASS[status] : "",
    tone === "address" ? "chip-address" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  const body = (
    <>
      {icon && <span className="icon-sm shrink-0">{icon}</span>}
      {children != null && <span className="truncate">{children}</span>}
    </>
  );

  // Filter chips are controls: a real button, with the pressed state exposed.
  if (type === "filter") {
    return (
      <button
        type="button"
        role="button"
        aria-pressed={active}
        disabled={disabled}
        onClick={onClick}
        className={`${classes} ${active ? "active" : ""} ${
          disabled ? "opacity-45 cursor-not-allowed" : "cursor-pointer"
        } transition-colors duration-[var(--motion-micro)]`}
        {...rest}
      >
        {body}
      </button>
    );
  }

  // Status / info chips are labels, not controls.
  return (
    <span className={classes} {...rest}>
      {body}
    </span>
  );
}

export default Chip;
