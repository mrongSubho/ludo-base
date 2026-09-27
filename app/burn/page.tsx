"use client";

import React from "react";
import { BurnFeed } from "../components/BurnFeed";

/** Standalone route for deep links. In-app Feed uses BurnPanel (GamePanelShell). */
export default function BurnDashboardPage() {
    return (
        <main className="min-h-screen bg-[#0a0b12] text-white p-6">
            <div className="w-full max-w-[500px] mx-auto flex flex-col gap-4">
                <BurnFeed />
            </div>
        </main>
    );
}
