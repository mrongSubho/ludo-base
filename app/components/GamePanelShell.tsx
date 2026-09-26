"use client";

import React, { ReactNode } from "react";

type Props = {
    scopeClass: string;
    title: ReactNode;
    subtitle?: ReactNode;
    onClose: () => void;
    children: ReactNode;
    /** Wrapper width — wallet is narrower than full panels. */
    maxWClass?: string;
    /** Soft orbs wash out daybreak; wallet/burn can opt out. */
    hideOrbs?: boolean;
};

/**
 * Unified global panel layout used by Settings / Messages / Market, etc.
 * top-64 · bottom-80 · max-w-500 · rounded-32 · panel-bg-image.
 */
export function GamePanelShell({ scopeClass, title, subtitle, onClose, children, maxWClass = "max-w-[500px]", hideOrbs = false }: Props) {
    return (
        <>
            <div className="fixed top-[64px] bottom-[80px] left-0 right-0 z-40 bg-transparent" />
            <div className="fixed inset-0 z-[110] flex justify-center pointer-events-none">
                <div className={`w-full ${maxWClass} relative h-full`}>
                    <div
                        className={`${scopeClass} pointer-events-auto absolute top-[64px] bottom-[80px] left-[8px] right-[8px] border border-white/10 rounded-[32px] flex flex-col shadow-2xl overflow-hidden`}
                        style={{
                            background: "var(--panel-bg-image, var(--ludo-bg-cosmic))",
                            backgroundColor: "var(--panel-bg, rgba(13,13,13,0.92))",
                            backdropFilter: "blur(32px)",
                        }}
                    >
                        {!hideOrbs && (
                            <>
                                <div className="absolute top-[-20%] left-[-20%] w-full h-full cosmic-orb cosmic-orb-1 opacity-20 scale-150 pointer-events-none" />
                                <div className="absolute bottom-[-20%] right-[-20%] w-full h-full cosmic-orb cosmic-orb-2 opacity-15 scale-150 pointer-events-none" />
                            </>
                        )}

                        <div className="w-full flex justify-center pt-2 pb-1 relative z-10">
                            <div className="w-12 h-1.5 bg-white/20 rounded-full" />
                        </div>

                        <div className="px-5 pb-3 border-b border-white/10 relative z-10">
                            <div className="flex items-center justify-between mb-1 mt-1">
                                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                                    {title}
                                </h2>
                                <button
                                    onClick={onClose}
                                    aria-label="Close panel"
                                    className="w-11 h-11 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white/70 hover:text-white transition-all ring-1 ring-white/10 shadow-sm"
                                >
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                                        <line x1="18" y1="6" x2="6" y2="18"></line>
                                        <line x1="6" y1="6" x2="18" y2="18"></line>
                                    </svg>
                                </button>
                            </div>
                            {subtitle && (
                                <div className="flex items-center gap-2 px-0.5">{subtitle}</div>
                            )}
                        </div>

                        <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar px-5 pt-3 pb-4 relative z-10 flex flex-col gap-4">
                            {children}
                        </div>
                    </div>
                </div>
            </div>
        </>
    );
}

export default GamePanelShell;
