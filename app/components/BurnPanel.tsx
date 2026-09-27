"use client";

import React from "react";
import { GamePanelShell, useIsDaybreak } from "./GamePanelShell";
import { BurnFeed } from "./BurnFeed";

/** In-app burn / explorer — GamePanelShell + dual-theme BurnFeed. */
export function BurnPanel({ onClose }: { onClose: () => void }) {
    const daybreak = useIsDaybreak();
    const ink = daybreak ? "#0A0B0D" : "#F5F7FA";
    const muted = daybreak ? "#5B616E" : "#9AA3B2";
    const blue = daybreak ? "#0052FF" : "#3B82F6";

    return (
        <GamePanelShell
            scopeClass="chips-burn-panel"
            maxWidthPx={500}
            hideOrbs
            title={<span style={{ color: ink }}>Burn & Explorer</span>}
            subtitle={
                <>
                    <span
                        className="text-[11px] font-black tracking-wide uppercase"
                        style={{ color: blue }}
                    >
                        CHIPS supply
                    </span>
                    <span className="w-0.5 h-0.5 rounded-full" style={{ background: muted }} />
                    <span
                        className="text-[11px] font-black tracking-wide uppercase"
                        style={{ color: muted }}
                    >
                        Live chain data
                    </span>
                </>
            }
            onClose={onClose}
        >
            <BurnFeed />
        </GamePanelShell>
    );
}

export default BurnPanel;
