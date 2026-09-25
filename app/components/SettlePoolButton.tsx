"use client";

import { useSettlePool } from "@/hooks/useSettlePool";
import { buildPayoutPlan, type MatchShape, type RankedWinner } from "@/lib/payoutPlan";
import { formatChips, shortHex } from "@/lib/chips";

/**
 * Host post-match CTA: Edge propose → host signTypedData → MatchPool.settlePool.
 * Supports 1v1 / 2v2 50-50 / 4P 75-25 via lib/payoutPlan.
 */
export function SettlePoolButton({
    poolId,
    plan,
    authority,
    shape,
    prizeFund,
    winners,
    disabled,
}: {
    poolId: `0x${string}`;
    /** Explicit plan (single-winner) OR winners + prizeFund for shape-aware split. */
    plan?: { addr: `0x${string}`; amount: bigint }[];
    authority: `0x${string}`;
    shape?: MatchShape;
    prizeFund?: bigint;
    winners?: RankedWinner[];
    disabled?: boolean;
}) {
    const { settle, settleFromWinners, step, isPending, error, configured } = useSettlePool();

    if (!configured) {
        return (
            <div className="text-[10px] font-bold text-white/35 text-center">
                MatchPool not configured
            </div>
        );
    }

    const resolvedPlan =
        plan ??
        (shape && prizeFund != null && winners?.length
            ? buildPayoutPlan({ shape, prizeFund, winners })
            : []);

    const label =
        step === "propose"
            ? "Edge co-sign…"
            : step === "sign"
              ? "Sign settle…"
              : step === "submit"
                ? "Submitting…"
                : step === "done"
                  ? "Pot settled"
                  : "Settle pot";

    const total = resolvedPlan.reduce((a, p) => a + p.amount, BigInt(0));

    return (
        <div className="flex flex-col gap-1 w-full">
            <button
                type="button"
                onClick={() => {
                    if (shape && prizeFund != null && winners?.length) {
                        void settleFromWinners({
                            poolId,
                            shape,
                            prizeFund,
                            winners,
                            authority,
                        });
                    } else if (resolvedPlan.length) {
                        void settle({
                            poolId,
                            plan: resolvedPlan,
                            authority,
                            winnerAddresses: resolvedPlan.map((p) => p.addr),
                        });
                    }
                }}
                disabled={disabled || isPending || step === "done" || total === BigInt(0)}
                className={`w-full min-h-[44px] rounded-2xl text-[11px] font-black uppercase tracking-[0.18em] transition-all active:scale-[0.99] ${
                    step === "done"
                        ? "bg-green-500/20 text-green-300 border border-green-500/40"
                        : "bg-cyan-400/90 text-black hover:bg-cyan-300"
                }`}
            >
                {label}
                {step === "idle" && total > BigInt(0) ? ` · ${formatChips(total)}` : ""}
            </button>
            <p className="text-[9px] font-mono text-white/30 text-center">
                Pool {shortHex(poolId)}
                {resolvedPlan.length > 1 ? ` · ${resolvedPlan.length} winners` : ""}
            </p>
            {error && <p className="text-[10px] font-bold text-red-300 text-center">{error}</p>}
        </div>
    );
}

export default SettlePoolButton;
