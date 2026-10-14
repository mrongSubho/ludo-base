"use client";

import React, { ReactNode, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "./Button";

type Props = {
    scopeClass?: string;
    title: ReactNode;
    subtitle?: ReactNode;
    onClose: () => void;
    children: ReactNode;
    maxWClass?: string;
    maxWidthPx?: number;
    hideOrbs?: boolean;
};

/* The panel paints itself from CSS custom properties (--panel-bg,
   --panel-border, --panel-shadow, --ink-*, --line-*) instead of branching on
   the theme in JS. Each theme block owns those values, so a theme switch
   repaints the shell through the cascade — no MutationObserver, no second
   render, and chrome/content drift is structurally impossible.
   (UI_DESIGN_AUDIT Phase 3: this used to be `useIsDaybreak()` + a
   body.classList MutationObserver feeding inline ternaries whose hexes had
   already drifted from the CSS tokens.) */

export function GamePanelShell({
    scopeClass = "",
    title,
    subtitle,
    onClose,
    children,
    maxWidthPx = 500,
    hideOrbs = false,
}: Props) {
    const [mounted, setMounted] = useState(false);
    useEffect(() => setMounted(true), []);
    if (!mounted) return null;

    return createPortal(
        <>
            <div className="fixed top-[64px] bottom-[80px] left-0 right-0 z-40 bg-transparent" />
            <div
                className="fixed inset-0 z-[110] flex justify-center pointer-events-none"
                style={{ alignItems: "stretch" }}
            >
                <div
                    className="relative h-full"
                    style={{ width: "100%", maxWidth: maxWidthPx }}
                >
                    <div
                        className={`${scopeClass} pointer-events-auto absolute top-[64px] bottom-[80px] left-[8px] right-[8px] rounded-[32px] flex flex-col overflow-hidden`}
                        style={{
                            background: "var(--panel-bg)",
                            border: "1px solid var(--panel-border)",
                            boxShadow: "var(--panel-shadow)",
                            color: "var(--ink-strong)",
                            backdropFilter: "blur(32px)",
                            WebkitBackdropFilter: "blur(32px)",
                        }}
                    >
                        {!hideOrbs && (
                            <>
                                <div className="absolute top-[-20%] left-[-20%] w-full h-full cosmic-orb cosmic-orb-1 opacity-20 scale-150 pointer-events-none" />
                                <div className="absolute bottom-[-20%] right-[-20%] w-full h-full cosmic-orb cosmic-orb-2 opacity-15 scale-150 pointer-events-none" />
                            </>
                        )}

                        <div className="w-full flex justify-center pt-2 pb-1 relative z-10">
                            <div
                                className="w-12 h-1.5 rounded-full"
                                style={{ background: "var(--line-strong)" }}
                            />
                        </div>

                        <div
                            className="px-5 pb-3 relative z-10"
                            style={{ borderBottom: "1px solid var(--line-soft)" }}
                        >
                            <div className="flex items-center justify-between mb-1 mt-1">
                                <h2
                                    className="text-xl font-bold flex items-center gap-2"
                                    style={{ color: "var(--ink-strong)" }}
                                >
                                    {title}
                                </h2>
                                {/* The panel's close control is the shared Button
                                    (UI_COMPONENT_AUDIT B.1): size="icon" is the
                                    44×44 target, and the recessed fill + hairline
                                    come from tokens so both themes are correct
                                    without a patch rule. */}
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={onClose}
                                    aria-label="Close panel"
                                    className="bg-surface-recessed border border-line-soft"
                                >
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="icon-md">
                                        <line x1="18" y1="6" x2="6" y2="18"></line>
                                        <line x1="6" y1="6" x2="18" y2="18"></line>
                                    </svg>
                                </Button>
                            </div>
                            {subtitle && (
                                <div className="flex items-center gap-2 px-0.5" style={{ color: "var(--ink-muted)" }}>
                                    {subtitle}
                                </div>
                            )}
                        </div>

                        <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar px-5 pt-3 pb-4 relative z-10 flex flex-col gap-4">
                            {children}
                        </div>
                    </div>
                </div>
            </div>
        </>,
        document.body,
    );
}

export default GamePanelShell;
