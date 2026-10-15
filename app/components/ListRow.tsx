"use client";

import React from "react";

/**
 * The shared row rhythm (UI_COMPONENT_AUDIT §4.5 / A.4): 36px icon tile +
 * 13px label + 10px hint + `p-3.5` + a `divide` hairline. Promoted from
 * SettingsPanel's `PrefRow` / `NavRow` so Friends, Messages, Wallet activity,
 * Marketplace and Leaderboard stop inventing their own row.
 *
 * Classnames are deliberately carried over UNCHANGED from those two helpers.
 * Phase A must be visually inert (A.6), and the legacy classes here are already
 * remapped per-theme by the Daybreak patch layer — swapping them for tokens is
 * Phase B/C work, where the diff is expected and verified rather than smuggled
 * into an extraction.
 *
 * `trailing` takes the control (a Switch, a Chevron, a Chip); with `onClick`
 * the row is a button, otherwise a plain container — same markup either way.
 */
export interface ListRowProps {
  icon?: React.ReactNode;
  /** Background classes for the icon tile, e.g. `bg-cyan-500/15 text-cyan-300`. */
  tint?: string;
  label: string;
  hint?: string;
  trailing?: React.ReactNode;
  onClick?: () => void;
  last?: boolean;
}

export function ListRow({ icon, tint, label, hint, trailing, onClick, last = false }: ListRowProps) {
  const inner = (
    <>
      {icon && (
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${tint ?? ""}`}>
          {icon}
        </div>
      )}
      <div className="flex-1 flex flex-col min-w-0 text-left">
        <span className="text-[13px] font-bold text-white truncate">{label}</span>
        {hint && <span className="text-[10px] font-bold text-white/35 truncate">{hint}</span>}
      </div>
      {trailing}
    </>
  );

  const divider = last ? "" : "border-b border-white/5";

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`w-full flex items-center gap-3 p-3.5 hover:bg-white/5 active:bg-white/10 transition-colors text-left ${divider}`}
      >
        {inner}
      </button>
    );
  }

  return <div className={`flex items-center gap-3 p-3.5 ${divider}`}>{inner}</div>;
}

export default ListRow;
