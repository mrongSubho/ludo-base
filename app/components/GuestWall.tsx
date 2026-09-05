'use client';

import React from 'react';
import { WALL_COPY, WallAction } from '@/lib/guest';

// ─── Theme-agnostic contract (holds for current + future themes) ───────────
// Same vocabulary as the synced modals: white-ink + white-opacity surfaces +
// cyan accents on the shared dark-glass surface. No font-family is set
// (inherits the active theme's display font). Spacing inside
// `.ludo-wall-scope` is re-asserted in globals.css (the global unlayered
// reset zeroes Tailwind utilities).

const WallTile = () => (
    <div className="w-12 h-12 rounded-2xl bg-amber-500/15 border border-amber-400/40 flex items-center justify-center shadow-[0_0_24px_rgba(251,191,36,0.25)] shrink-0">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6 text-amber-300">
            <rect x="3" y="11" width="18" height="11" rx="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
    </div>
);

interface GuestWallProps {
    action: WallAction;
    onClose: () => void;
    onConnect: () => void;
}

export default function GuestWall({ action, onClose, onConnect }: GuestWallProps) {
    const copy = WALL_COPY[action];
    return (
        <>
            <div
                className="fixed inset-0 z-[300] bg-black/60 backdrop-blur-md flex items-center justify-center p-5"
                onClick={onClose}
            >
                <div
                    className="ludo-wall-scope border border-white/10 rounded-[32px] shadow-2xl max-w-sm w-full p-5 flex flex-col gap-3"
                    style={{ background: 'var(--panel-bg-image, var(--ludo-bg-cosmic))', backgroundColor: 'var(--panel-bg, rgba(13,13,13,0.95))', backdropFilter: 'blur(32px)' }}
                    onClick={(e) => e.stopPropagation()}
                >
                    <div className="flex items-start gap-3">
                        <WallTile />
                        <div className="flex-1 min-w-0 pt-0.5">
                            <div className="flex items-center gap-2">
                                <h2 className="text-base font-bold text-white leading-tight">{copy.title}</h2>
                            </div>
                            <span className="inline-flex items-center gap-1.5 mt-1 px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/40 text-[9px] font-black text-amber-300 uppercase tracking-widest">
                                <span className="w-1 h-1 rounded-full bg-amber-400 animate-pulse" />
                                Guest Pass limit
                            </span>
                        </div>
                        <button
                            onClick={onClose}
                            aria-label="Close"
                            className="w-8 h-8 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white/70 hover:text-white transition-all ring-1 ring-white/10 shadow-sm shrink-0"
                        >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                        </button>
                    </div>

                    <p className="text-white/60 text-sm font-medium leading-relaxed">
                        {copy.body}
                    </p>

                    <div className="flex items-center gap-2 rounded-2xl bg-white/[0.04] border border-white/10 px-2.5 py-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.8)] shrink-0" />
                        <span className="text-[11px] font-bold text-white/70">{copy.unlock}</span>
                    </div>

                    <div className="flex flex-col gap-2 mt-1">
                        <button
                            onClick={onConnect}
                            className="w-full py-3 rounded-2xl bg-white text-black text-sm font-black uppercase tracking-[0.2em] shadow-[0_0_30px_rgba(255,255,255,0.2)] hover:shadow-[0_0_50px_rgba(255,255,255,0.4)] transition-all active:scale-95"
                        >
                            Connect wallet
                        </button>
                        <button
                            onClick={onClose}
                            className="w-full py-2 text-[10px] font-black uppercase tracking-[0.2em] text-white/40 hover:text-white/70 transition-colors"
                        >
                            Keep exploring
                        </button>
                    </div>
                </div>
            </div>
        </>
    );
}
