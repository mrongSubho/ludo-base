"use client";

import React, { forwardRef, ButtonHTMLAttributes, ReactNode } from "react";

/**
 * The one button (UI_COMPONENT_AUDIT §4.1).
 *
 * Replaces ~30 legacy families (`btn-main`, `cb-btn`, `wl-btn`, `pp-btn`,
 * `play-now-btn`, `ingame-cta`, …) that each re-implemented hover/active/
 * focus/disabled. Every value here is a semantic token, so both themes are
 * correct with zero patch rules, and every state is handled once:
 *
 *  - hover: one step of fill (`primary` dims, others step up a surface token)
 *  - active: `scale-[0.98]` — one shared press feel
 *  - focus-visible: the global ring only (no per-component ring classes)
 *  - disabled: opacity + not-allowed, ALWAYS (the audit counted 47 buttons
 *    with no visible disabled treatment)
 *  - loading: `aria-busy`, spinner in the icon slot, label stays put — so a
 *    double-submit is visible instead of silent
 *
 * Brand blue (#0052FF) is retired as a CTA fill: `variant="primary"` is the
 * accent, and `brand` swaps only the fill for the one case where Base branding
 * is mandatory.
 */

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg" | "icon";

const VARIANT: Record<Variant, string> = {
  // text-accent-ink is white on the daybreak accent and near-black on retro's.
  primary: "bg-accent text-accent-ink hover:brightness-95 active:brightness-90",
  secondary:
    "bg-surface-hover text-ink-strong border border-line-soft hover:bg-surface-active",
  ghost: "bg-transparent text-ink-muted hover:text-ink-strong hover:bg-surface-hover",
  danger: "bg-negative text-white hover:brightness-95 active:brightness-90",
};

const SIZE: Record<Size, string> = {
  sm: "h-8 px-3 text-ludo-sm font-bold rounded-[10px] gap-1.5",
  md: "h-10 px-4 text-ludo-md font-bold rounded-xl gap-2",
  lg: "h-12 px-5 text-ludo-md font-bold rounded-[14px] gap-2",
  // 44×44 — the audit's icon target; keeps the existing close-button look.
  icon: "h-11 w-11 p-0 rounded-full justify-center",
};

const ICON_SIZE: Record<Size, string> = {
  sm: "icon-sm",
  md: "icon-md",
  lg: "icon-lg",
  icon: "icon-md",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  fullWidth?: boolean;
  loading?: boolean;
  /** Base-branded fill (#0052FF). Documented exception — prefer `primary`. */
  brand?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
}

function Spinner({ className }: { className: string }) {
  return (
    <svg
      className={`${className} animate-spin`}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "secondary",
    size = "md",
    fullWidth = false,
    loading = false,
    brand = false,
    leftIcon,
    rightIcon,
    disabled,
    className = "",
    children,
    type = "button",
    ...rest
  },
  ref
) {
  const brandFill =
    brand && variant === "primary" ? "bg-[#0052FF] text-white hover:brightness-95" : VARIANT[variant];

  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={[
        "inline-flex items-center font-sans select-none",
        "transition-[background-color,color,opacity,transform] duration-[var(--motion-control)] ease-[var(--ease-standard)]",
        "active:scale-[0.98]",
        "disabled:opacity-45 disabled:cursor-not-allowed disabled:active:scale-100",
        SIZE[size],
        brandFill,
        fullWidth ? "w-full justify-center" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...rest}
    >
      {loading ? (
        <Spinner className={ICON_SIZE[size]} />
      ) : (
        leftIcon && <span className={ICON_SIZE[size]}>{leftIcon}</span>
      )}
      {/* `size="icon"` renders bare children — THEY are the icon. Wrapping them
          in the truncating span would size the glyph to the label rhythm, and
          suppressing them (an earlier bug) produced a 44×44 button with nothing
          inside: every close button in the app silently lost its × glyph. */}
      {size === "icon" ? (
        children
      ) : (
        children != null && <span className="truncate">{children}</span>
      )}
      {!loading && rightIcon && <span className={ICON_SIZE[size]}>{rightIcon}</span>}
    </button>
  );
});

export default Button;
