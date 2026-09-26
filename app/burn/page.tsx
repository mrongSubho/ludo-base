"use client";

import React from "react";
import { BurnFeed } from "../components/BurnFeed";

/** Standalone route kept for deep links; in-app Feed uses BurnPanel. */
export default function BurnDashboardPage() {
    return (
        <main className="min-h-screen bg-[#0a0b12] p-6 max-w-2xl mx-auto">
            <BurnFeed />
        </main>
    );
}
