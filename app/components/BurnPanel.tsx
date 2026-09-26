"use client";

import React from "react";
import { BurnFeed } from "./BurnFeed";

/** In-app burn / explorer panel (not a full desktop route). */
export function BurnPanel({ onClose }: { onClose: () => void }) {
    return (
        <div
            className="fixed inset-0 z-[320] flex items-end sm:items-center justify-center p-3 sm:p-6"
            style={{ background: "rgba(0,0,0,0.55)" }}
            onClick={onClose}
        >
            <div
                onClick={(e) => e.stopPropagation()}
                className="w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-2xl border border-white/12 p-5"
                style={{
                    background: "var(--panel-bg, rgba(13,13,13,0.96))",
                    backdropFilter: "blur(28px)",
                }}
            >
                <div className="flex items-center justify-between mb-3">
                    <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white/50">
                        Feed · burn & explorer
                    </span>
                    <button
                        type="button"
                        onClick={onClose}
                        className="w-8 h-8 rounded-full border border-white/15 text-white/70 hover:text-white"
                        aria-label="Close feed"
                    >
                        ×
                    </button>
                </div>
                <BurnFeed />
            </div>
        </div>
    );
}

export default BurnPanel;
