"use client";

import React, { ReactNode, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { Button } from "./Button";
import { HudCornerTicks } from "./HudPrimitives";
import { CloseReticleIcon } from "./icons";
import { getSoundEngine } from "@/lib/audio/SoundEngine";

type Props = {
    scopeClass?: string;
    title: ReactNode;
    subtitle?: ReactNode;
    kicker?: string;
    onClose: () => void;
    children: ReactNode;
    maxWClass?: string;
    maxWidthPx?: number;
    hideOrbs?: boolean;
    /** Full-screen modal-level overlay (used above pre-login cards/modals where no header/footer exists). */
    overlay?: boolean;
    /** Tightens the panel header spacing for dense directories such as Live Arena. */
    compactHeader?: boolean;
    /** Set false when a child view owns its own single scroller + pinned footer. */
    bodyScroll?: boolean;
};

/* The panel paints itself from CSS custom properties (--panel-bg,
   --panel-border, --panel-shadow, --ink-*, --line-*) instead of branching on
   the theme in JS. Each theme block owns those values, so a theme switch
   repaints the shell through the cascade — no MutationObserver, no second
   render, and chrome/content drift is structurally impossible. */

export function GamePanelShell({
    scopeClass = "",
    title,
    subtitle,
    kicker,
    onClose,
    children,
    maxWidthPx = 500,
    hideOrbs = false,
    overlay = false,
    compactHeader = false,
    bodyScroll = true,
}: Props) {
    const [mounted, setMounted] = useState(false);
    useEffect(() => {
        setMounted(true);
        const engine = getSoundEngine();
        engine.play("ui_sheet_open");
        engine.pushModalDuck();
        return () => {
            engine.popModalDuck();
        };
    }, []);
    if (!mounted) return null;

    const handleClose = () => {
        getSoundEngine().play("ui_sheet_close");
        onClose();
    };

    return createPortal(
        <>
            {overlay ? (
                <div
                    onClick={handleClose}
                    className="fixed inset-0 z-[1090] bg-surface-page/75 backdrop-blur-sm"
                    aria-hidden="true"
                />
            ) : (
                <div className="fixed top-[64px] bottom-[80px] left-0 right-0 z-40 bg-transparent" />
            )}
            <div
                className={`fixed inset-0 ${overlay ? 'z-[1100]' : 'z-[110]'} flex justify-center pointer-events-none`}
                style={{ alignItems: "stretch" }}
            >
                <div
                    className="relative h-full"
                    style={{ width: "100%", maxWidth: maxWidthPx }}
                >
                    <motion.div
                        initial={{ opacity: 0, y: 12, scale: 0.99 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        transition={{ duration: 0.18, ease: [0.2, 0, 0, 1] }}
                        className={`${scopeClass} panel-shell-3077 pointer-events-auto absolute ${overlay ? 'top-4 bottom-4 sm:top-7 sm:bottom-7' : 'top-[64px] bottom-[80px]'} left-[8px] right-[8px] rounded-[32px] flex flex-col overflow-hidden`}
                        style={{
                            background: "var(--panel-bg)",
                            border: "1px solid var(--panel-border)",
                            boxShadow: "var(--panel-shadow)",
                            color: "var(--ink-strong)",
                            backdropFilter: "blur(32px)",
                            WebkitBackdropFilter: "blur(32px)",
                        }}
                    >
                        <HudCornerTicks />

                        {!hideOrbs && (
                            <>
                                <div className="absolute top-[-20%] left-[-20%] w-full h-full cosmic-orb cosmic-orb-1 opacity-20 scale-150 pointer-events-none" />
                                <div className="absolute bottom-[-20%] right-[-20%] w-full h-full cosmic-orb cosmic-orb-2 opacity-15 scale-150 pointer-events-none" />
                            </>
                        )}

                        <div className={`w-full flex justify-center ${compactHeader ? 'pt-1.5 pb-0.5' : 'pt-2 pb-1'} relative z-10`}>
                            <div
                                className="panel-handle-bar w-12 h-1.5 rounded-full"
                                style={{ background: "var(--line-strong)" }}
                            />
                        </div>

                        <div
                            className={`${compactHeader ? 'px-4 pb-2' : 'px-5 pb-3'} relative z-10`}
                            style={{ borderBottom: "1px solid var(--line-soft)" }}
                        >
                            <div className={`flex items-center justify-between ${compactHeader ? 'mb-0.5 mt-0.5' : 'mb-1 mt-1'} gap-2`}>
                                <div className="min-w-0 flex flex-col">
                                    {kicker && (
                                        <p className="text-ludo-xs font-mono uppercase tracking-[0.22em] text-accent mb-0.5 truncate">
                                            {kicker}
                                        </p>
                                    )}
                                    <h2
                                        className="text-xl font-bold flex items-center gap-2"
                                        style={{ color: "var(--ink-strong)" }}
                                    >
                                        {title}
                                    </h2>
                                </div>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    sound="none"
                                    onClick={handleClose}
                                    aria-label="Close panel"
                                    className="panel-close-3077 bg-surface-recessed border border-line-soft shrink-0"
                                >
                                    <CloseReticleIcon className="icon-md" />
                                </Button>
                            </div>
                            {subtitle && (
                                <div className="flex items-center gap-2 px-0.5" style={{ color: "var(--ink-muted)" }}>
                                    {subtitle}
                                </div>
                            )}
                        </div>

                        <div
                            className={`panel-body-3077 flex-1 min-h-0 relative z-10 flex flex-col ${
                                bodyScroll
                                    ? 'overflow-y-auto no-scrollbar px-5 pt-3 pb-4 gap-4'
                                    : 'overflow-hidden px-0 pt-0 pb-0 gap-0'
                            }`}
                        >
                            {children}
                        </div>
                    </motion.div>
                </div>
            </div>
        </>,
        document.body,
    );
}

export default GamePanelShell;
