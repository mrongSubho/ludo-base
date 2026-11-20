'use client';

import React from 'react';
import { WALL_COPY, WallAction } from '@/lib/guest';
import { HudCornerTicks } from './HudPrimitives';
import { CloseReticleIcon } from './icons';
import Button from './Button';

// ─── Theme-agnostic contract (holds for current + future themes) ───────────
// Semantic token vocabulary + shared panel-shell-3077 across retro and daybreak.

const WallTile = () => (
    <div className="w-12 h-12 rounded-2xl bg-warn/15 border border-warn/40 flex items-center justify-center shadow-[0_0_24px_rgba(251,191,36,0.2)] shrink-0">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6 text-warn">
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
                className="fixed inset-0 z-[300] bg-surface-page/80 backdrop-blur-md flex items-center justify-center p-5"
                onClick={onClose}
            >
                <div
                    className="ludo-wall-scope panel-shell-3077 relative border border-line-soft rounded-[28px] shadow-2xl max-w-sm w-full p-5 flex flex-col gap-3"
                    onClick={(e) => e.stopPropagation()}
                >
                    <HudCornerTicks />
                    <div className="flex items-start gap-3">
                        <WallTile />
                        <div className="flex-1 min-w-0 pt-0.5">
                            <div className="flex items-center gap-2">
                                <h2 className="text-base font-bold text-ink-strong leading-tight">{copy.title}</h2>
                            </div>
                            <span className="inline-flex items-center gap-1.5 mt-1 px-2 py-0.5 rounded-full bg-warn/15 border border-warn/40 text-ludo-xs font-bold label-chrome text-warn uppercase tracking-widest">
                                <span className="w-1 h-1 rounded-full bg-warn animate-pulse" />
                                Guest Pass limit
                            </span>
                        </div>
                        <button
                            onClick={onClose}
                            aria-label="Close"
                            className="w-11 h-11 flex items-center justify-center rounded-full bg-surface-recessed hover:bg-surface-hover text-ink-muted hover:text-ink-strong transition-all border border-line-soft shadow-sm shrink-0"
                        >
                            <CloseReticleIcon className="w-4 h-4" />
                        </button>
                    </div>

                    <p className="text-ink-muted text-sm font-medium leading-relaxed">
                        {copy.body}
                    </p>

                    <div className="flex items-center gap-2 rounded-2xl bg-surface-recessed border border-line-soft px-2.5 py-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-accent shadow-[0_0_8px_rgba(34,211,238,0.65)] shrink-0" />
                        <span className="text-ludo-sm font-bold text-ink-muted">{copy.unlock}</span>
                    </div>

                    <div className="flex flex-col gap-2 mt-1">
                        <Button
                            variant="primary"
                            size="lg"
                            fullWidth
                            onClick={onConnect}
                            className="label-chrome uppercase tracking-[0.2em]"
                        >
                            Connect wallet
                        </Button>
                        <Button
                            variant="ghost"
                            size="sm"
                            fullWidth
                            onClick={onClose}
                            className="label-chrome text-ludo-xs uppercase tracking-[0.2em]"
                        >
                            Keep exploring
                        </Button>
                    </div>
                </div>
            </div>
        </>
    );
}
