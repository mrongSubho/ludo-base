"use client";

import React from "react";
import { motion } from "framer-motion";

/**
 * iOS-style switch — promoted verbatim from SettingsPanel (UI_COMPONENT_AUDIT
 * A.3) so every toggle in the app has one implementation and one meaning:
 * `role="switch"` + `aria-checked`, a spring-driven knob, and a track that is
 * the theme's accent (token) rather than a hardcoded cyan — §4.3. The
 * per-component `focus-visible:ring-*` is gone on purpose: the app has one
 * global focus ring and per-component rings fight it.
 */
export interface SwitchProps {
  on: boolean;
  onToggle: () => void;
  /** Accessible name — the row's label, not the state. */
  label: string;
  disabled?: boolean;
}

export function Switch({ on, onToggle, label, disabled = false }: SwitchProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      className={`w-11 h-6 rounded-full p-0.5 transition-colors shrink-0 focus:outline-none ${
        on ? "bg-accent" : "bg-surface-hover"
      } ${disabled ? "opacity-45 cursor-not-allowed" : ""}`}
    >
      <motion.div
        layout
        className="w-[18px] h-[18px] bg-white rounded-full shadow"
        animate={{ x: on ? 20 : 0 }}
        transition={{ type: "spring", stiffness: 500, damping: 32 }}
      />
    </button>
  );
}

export default Switch;
