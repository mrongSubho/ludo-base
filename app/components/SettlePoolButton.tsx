"use client";

import { useSettlePool } from "@/hooks/useSettlePool";
import { formatChips, shortHex } from "@/lib/chips";

/**
 * Host post-match CTA: Edge propose → host signTypedData → MatchPool.settlePool.
 * After settle, winners use Claim CHIPS (usePoolClaim).
 */
export function SettlePoolButton({
    poolId,
    plan,
    authority,
    disabled,
}: {
    poolId: `0x${string}`;
    plan: { addr: `0x${string}`; amount: bigint }[];
    authority: `0x${string}`;
    disabled?: boolean;
}) {
    const { settle, step, isPending, error, configured } = useSettlePool();

    if (!configured) {
        return (
            <div className="text-[10px] font-bold text-white/35 text-center">
                MatchPool not configured
            </div>
        );
    }

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

    const total = plan.reduce((a, p) => a + p.amount, BigInt(0));

    return (
        <div className="flex flex-col gap-1 w-full">
            <button
                type="button"
                onClick={() =>
                    void settle({
                        poolId,
                        plan,
                        authority,
                        winnerAddresses: plan.map((p) => p.addr),
                    })
                }
                disabled={disabled || isPending || step === "done"}
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
            </p>
            {error && <p className="text-[10px] font-bold text-red-300 text-center">{error}</p>}
        </div>
    );
}

export default SettlePoolButton;
