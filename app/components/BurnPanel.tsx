"use client";

import React from "react";
import { GamePanelShell } from "./GamePanelShell";
import { BurnFeed } from "./BurnFeed";

/** In-app burn / explorer — GamePanelShell + dual-theme BurnFeed.
 *  Paint comes from the semantic tokens (--ink-*, --accent) so both themes
 *  resolve through CSS; no JS theme branch (UI_DESIGN_AUDIT Phase 3). */
export function BurnPanel({ onClose }: { onClose: () => void }) {
    return (
        <GamePanelShell
            scopeClass="chips-burn-panel"
            maxWidthPx={500}
            hideOrbs
            title={<span style={{ color: "var(--ink-strong)" }}>Burn &amp; Explorer</span>}
            subtitle={
                <>
                    <span
                        className="text-[11px] font-black tracking-wide uppercase"
                        style={{ color: "var(--accent)" }}
                    >
                        CHIPS supply
                    </span>
                    <span className="w-0.5 h-0.5 rounded-full" style={{ background: "var(--ink-muted)" }} />
                    <span
                        className="text-[11px] font-black tracking-wide uppercase"
                        style={{ color: "var(--ink-muted)" }}
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
