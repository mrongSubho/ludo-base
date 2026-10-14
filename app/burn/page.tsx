"use client";

import React from "react";
import { BurnFeed } from "../components/BurnFeed";

/**
 * Standalone route for deep links. In-app Feed uses BurnPanel (GamePanelShell).
 *
 * The page surface comes from the semantic tokens, not a hardcoded dark pair:
 * this wrapper used to be `bg-[#0a0b12] text-white`, which made the route
 * permanently dark. BurnFeed paints with the tokens, so under Daybreak that
 * combination was dark ink on a dark page — measured as a 43% frame diff when
 * the feed stopped theming itself in JS (UI_DESIGN_AUDIT Phase 3). The route is
 * now theme-aware like every other surface: Daybreak porcelain, Retro night.
 */
export default function BurnDashboardPage() {
    return (
        <main className="min-h-screen bg-surface-page text-ink-strong p-6">
            <div className="w-full max-w-[500px] mx-auto flex flex-col gap-4">
                <BurnFeed />
            </div>
        </main>
    );
}
