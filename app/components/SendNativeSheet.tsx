"use client";

import { useState } from "react";
import { formatUnits } from "viem";
import { useSendNative } from "@/hooks/useSendNative";
import { useWalletAssets } from "@/hooks/useWalletAssets";
import { useMfaStepUp } from "@/hooks/useMfaStepUp";

/** R0 — Send ETH (REAL_WALLET_PLAN §3.2). Max branches by gas path. */
export default function SendNativeSheet() {
    const { eth, refresh, needsReconnect } = useWalletAssets();
    const { send, status, error, txHash, maxSelfPay, mode } = useSendNative();
    const mfa = useMfaStepUp();
    const [to, setTo] = useState("");
    const [amount, setAmount] = useState("");
    const [confirming, setConfirming] = useState(false);

    const balance = eth ?? BigInt(0);
    const selfPayMax = maxSelfPay(balance);

    if (needsReconnect) {
        return <p className="text-[11px] text-amber-200">Session expired — reconnect your wallet.</p>;
    }

    return (
        <div className="space-y-3">
            <h4 className="text-[11px] font-black uppercase tracking-[0.25em] text-white/70">Send ETH</h4>
            <p className="text-[11px] text-white/45">
                Balance: <span className="font-mono">{formatUnits(balance, 18)}</span> ETH · mode:{" "}
                <span className="uppercase">{mode}</span>
            </p>
            <label className="block text-[10px] text-white/50 uppercase tracking-wider">
                To
                <input
                    className="mt-1 w-full rounded-lg border border-white/20 bg-black/40 px-2 py-2 font-mono text-[11px]"
                    placeholder="0x…"
                    value={to}
                    onChange={(e) => setTo(e.target.value)}
                />
            </label>
            <label className="block text-[10px] text-white/50 uppercase tracking-wider">
                Amount (ETH)
                <input
                    className="mt-1 w-full rounded-lg border border-white/20 bg-black/40 px-2 py-2 font-mono text-[11px]"
                    inputMode="decimal"
                    placeholder="0.01"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                />
            </label>
            <div className="flex gap-2">
                <button
                    type="button"
                    className="rounded-lg border border-white/15 px-3 py-1.5 text-[11px] uppercase"
                    onClick={() => {
                        // M: max branches by gas path
                        if (mode === "ingame") {
                            setAmount(formatUnits(balance, 18));
                        } else {
                            setAmount(formatUnits(selfPayMax, 18));
                        }
                    }}
                >
                    Max
                </button>
                <button
                    type="button"
                    className="flex-1 rounded-lg bg-cyan-500/20 border border-cyan-400/40 px-3 py-2 text-[11px] font-bold uppercase"
                    disabled={status === "pending" || !to || !amount}
                    onClick={() => setConfirming(true)}
                >
                    Review
                </button>
            </div>

            {confirming && status === "idle" && (
                <div className="rounded-xl border border-amber-400/30 bg-amber-500/10 p-3 text-[11px] space-y-2">
                    <div>
                        Send <strong>{amount} ETH</strong> to
                        <div className="font-mono break-all text-white/80">{to}</div>
                    </div>
                    <p className="text-white/50">
                        This action moves real value. You will sign in your wallet.
                    </p>
                    <div className="flex gap-2">
                        <button
                            type="button"
                            className="rounded-lg bg-cyan-500/25 border border-cyan-400/50 px-3 py-1.5 uppercase font-bold"
                            onClick={async () => {
                                const ok = await mfa.stepUp();
                                if (!ok) return;
                                await send({ to, amountEth: amount });
                                setConfirming(false);
                                void refresh();
                            }}
                        >
                            Confirm send
                        </button>
                        <button
                            type="button"
                            className="rounded-lg border border-white/15 px-3 py-1.5 uppercase"
                            onClick={() => setConfirming(false)}
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            )}

            {status === "pending" && <p className="text-[11px] text-white/60">Sending…</p>}
            {status === "success" && (
                <p className="text-[11px] text-emerald-300 break-all">
                    Sent.{" "}
                    {txHash && (
                        <a
                            className="underline"
                            href={`https://sepolia.basescan.org/tx/${txHash}`}
                            target="_blank"
                            rel="noreferrer"
                        >
                            View
                        </a>
                    )}
                </p>
            )}
            {error && <p className="text-[11px] text-red-300">{error}</p>}
        </div>
    );
}
