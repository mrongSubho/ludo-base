"use client";

import dynamic from "next/dynamic";

/**
 * Phase 0a CDP spike console. Loads only when NEXT_PUBLIC_CDP_AUTH=1.
 * See docs/planning/PHASE_0A_SPIKE_CHECKLIST.md.
 */
const Phase0aSpikePanel = dynamic(() => import("@/app/components/Phase0aSpikePanel"), {
    ssr: false,
});

export default function CdpSpikePage() {
    const enabled =
        process.env.NEXT_PUBLIC_CDP_AUTH === "1" &&
        Boolean(process.env.NEXT_PUBLIC_CDP_PROJECT_ID);

    return (
        <main className="min-h-screen p-8 flex flex-col items-start gap-4">
            <h1 className="text-lg font-bold uppercase tracking-widest text-white/80">
                Phase 0a · CDP parent-sign spike
            </h1>
            {enabled ? (
                <Phase0aSpikePanel />
            ) : (
                <p className="text-white/60 text-sm max-w-lg">
                    Set <code>NEXT_PUBLIC_CDP_AUTH=1</code> and{" "}
                    <code>NEXT_PUBLIC_CDP_PROJECT_ID</code> in <code>.env.local</code>, then
                    restart <code>npm run dev</code>. Checklist:{" "}
                    <code>docs/planning/PHASE_0A_SPIKE_CHECKLIST.md</code>.
                </p>
            )}
        </main>
    );
}
