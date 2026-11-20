"use client";

import { usePoolJoin } from "@/hooks/useChipsPool";
import { formatChips, isChipsConfigured, shortHex } from "@/lib/chips";

/**
 * Paid-lobby CTA: approve CHIPS + joinPool (MatchPool).
 * Renders only when contracts + poolId exist; otherwise a quiet status row.
 */
export function PaidPoolJoinButton({
    poolId,
    entryFee,
    disabled,
}: {
    poolId: `0x${string}` | null | undefined;
    /** Entry fee in whole CHIPS (UI units). */
    entryFee: number;
    disabled?: boolean;
}) {
    const { join, step, isPending, error, configured } = usePoolJoin(poolId, String(entryFee));
    const live = isChipsConfigured() && configured;

    if (!live) {
        return (
            <div className="text-ludo-xs font-bold text-ink-faint text-center">
                CHIPS pool not live on this env yet
            </div>
        );
    }

    const label =
        step === "approve"
            ? "Approve CHIPS…"
            : step === "join"
              ? "Joining pool…"
              : step === "done"
                ? "In pool"
                : `Approve & Join · ${formatChips(entryFee)}`;

    return (
        <div className="flex flex-col gap-1 w-full">
            <button
                type="button"
                onClick={() => void join()}
                disabled={disabled || isPending || step === "done"}
                className={`w-full min-h-[44px] rounded-2xl text-ludo-sm font-bold label-chrome uppercase tracking-[0.18em] transition-all active:scale-[0.99] ${
                    step === "done"
                        ? "bg-positive/20 text-positive border border-positive/40"
                        : "bg-accent text-accent-ink hover:opacity-90"
                }`}
            >
                {label}
            </button>
            <p className="text-ludo-xs font-mono text-ink-faint text-center">
                Pool {shortHex(poolId)}
            </p>
            {error && (
                <p className="text-ludo-xs font-bold text-negative text-center">{error}</p>
            )}
        </div>
    );
}

export default PaidPoolJoinButton;
