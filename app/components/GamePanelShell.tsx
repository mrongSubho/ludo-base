"use client";

import React, { ReactNode, useEffect, useState } from "react";
import { createPortal } from "react-dom";

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

/** Detect body.theme-daybreak (and cookie fallback) for inline panel paint. */
export function useIsDaybreak(): boolean {
    const [daybreak, setDaybreak] = useState(false);
    useEffect(() => {
        const read = () => {
            const cls = document.body.classList.contains("theme-daybreak");
            const cookie = document.cookie.includes("ludo-theme=light") || document.cookie.includes("ludo-theme=porcelain");
            setDaybreak(cls || cookie);
        };
        read();
        const obs = new MutationObserver(read);
        obs.observe(document.body, { attributes: true, attributeFilter: ["class"] });
        return () => obs.disconnect();
    }, []);
    return daybreak;
}

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
    const daybreak = useIsDaybreak();
    useEffect(() => setMounted(true), []);
    if (!mounted) return null;

    const ink = daybreak ? "#0A0B0D" : "#E8EEF7";
    const muted = daybreak ? "rgba(10,11,13,0.68)" : "rgba(232,238,247,0.55)";
    const panelBg = daybreak ? "#F7F8FC" : "rgba(13,13,13,0.94)";
    const line = daybreak ? "rgba(10,11,13,0.12)" : "rgba(255,255,255,0.12)";
    const chipBg = daybreak ? "rgba(255,255,255,0.85)" : "rgba(255,255,255,0.06)";

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
                            background: panelBg,
                            border: `1px solid ${line}`,
                            boxShadow: daybreak
                                ? "0 24px 60px -12px rgba(15,23,42,0.22)"
                                : "0 24px 60px -12px rgba(0,0,0,0.55)",
                            color: ink,
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
                                style={{ background: daybreak ? "rgba(10,11,13,0.2)" : "rgba(255,255,255,0.22)" }}
                            />
                        </div>

                        <div
                            className="px-5 pb-3 relative z-10"
                            style={{ borderBottom: `1px solid ${line}` }}
                        >
                            <div className="flex items-center justify-between mb-1 mt-1">
                                <h2
                                    className="text-xl font-bold flex items-center gap-2"
                                    style={{ color: ink }}
                                >
                                    {title}
                                </h2>
                                <button
                                    onClick={onClose}
                                    aria-label="Close panel"
                                    className="w-11 h-11 flex items-center justify-center rounded-full transition-all"
                                    style={{
                                        background: chipBg,
                                        color: muted,
                                        border: `1px solid ${line}`,
                                    }}
                                >
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                                        <line x1="18" y1="6" x2="6" y2="18"></line>
                                        <line x1="6" y1="6" x2="18" y2="18"></line>
                                    </svg>
                                </button>
                            </div>
                            {subtitle && (
                                <div className="flex items-center gap-2 px-0.5" style={{ color: muted }}>
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
