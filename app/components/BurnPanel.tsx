"use client";

import React from "react";
import { GamePanelShell, useIsDaybreak } from "./GamePanelShell";
import { BurnFeed } from "./BurnFeed";

/** In-app burn / explorer panel — same GamePanelShell as other game panels. */
export function BurnPanel({ onClose }: { onClose: () => void }) {
    const daybreak = useIsDaybreak();
    const ink = daybreak ? "#0A0B0D" : "#F5F7FA";
    return (
        <GamePanelShell
            scopeClass="chips-burn-panel"
            maxWidthPx={500}
            hideOrbs
            title={<>Feed · Burn & Explorer</>}
            subtitle={
                <>
                    <span className="text-[11px] font-black text-cyan-300 tracking-wide uppercase">
                        CHIPS supply
                    </span>
                    <span className="w-0.5 h-0.5 rounded-full bg-white/25" />
                    <span className="text-[11px] font-black text-white/50 tracking-wide uppercase">
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
