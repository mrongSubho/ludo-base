"use client";

import { useState } from "react";
import { formatUnits } from "viem";
import { useSendNative } from "@/hooks/useSendNative";
import { useWalletAssets } from "@/hooks/useWalletAssets";
import { useMfaStepUp } from "@/hooks/useMfaStepUp";

/** R0 — Send ETH (SMART_WALLET_PLANNING §3.2). Max branches by gas path. */
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
        return <p className="text-ludo-sm text-warn">Session expired — reconnect your wallet.</p>;
    }

    return (
        <div className="space-y-3">
            <h4 className="text-ludo-sm font-bold label-chrome uppercase tracking-[0.25em] text-ink-muted">Send ETH</h4>
            <p className="text-ludo-sm text-ink-faint">
                Balance: <span className="font-mono">{formatUnits(balance, 18)}</span> ETH · mode:{" "}
                <span className="uppercase">{mode}</span>
            </p>
            <label className="block text-ludo-xs text-ink-muted uppercase tracking-wider">
                To
                <textarea
                    className="mt-1 w-full resize-none overflow-hidden rounded-full border border-line-strong bg-surface-recessed text-ink-strong px-3 py-2 font-mono text-ludo-sm focus:outline-none focus:border-accent"
                    rows={1}
                    placeholder="0x…"
                    value={to}
                    onChange={(e) => setTo(e.target.value)}
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    enterKeyHint="next"
                />
            </label>
            <label className="block text-ludo-xs text-ink-muted uppercase tracking-wider">
                Amount (ETH)
                <textarea
                    className="mt-1 w-full resize-none overflow-hidden rounded-full border border-line-strong bg-surface-recessed text-ink-strong px-3 py-2 font-mono text-ludo-sm focus:outline-none focus:border-accent"
                    rows={1}
                    inputMode="decimal"
                    placeholder="0.01"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    enterKeyHint="done"
                />
            </label>
            <div className="flex gap-2">
                <button
                    type="button"
                    className="rounded-lg border border-line-soft bg-surface-recessed hover:bg-surface-hover text-ink-muted px-3 py-1.5 text-ludo-sm uppercase"
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
                    className="flex-1 rounded-lg bg-accent-soft border border-accent/40 text-accent px-3 py-2 text-ludo-sm font-bold uppercase"
                    disabled={status === "pending" || !to || !amount}
                    onClick={() => setConfirming(true)}
                >
                    Review
                </button>
            </div>

            {confirming && status === "idle" && (
                <div className="rounded-xl border border-warn/35 bg-warn/10 p-3 text-ludo-sm space-y-2 text-ink-strong">
                    <div>
                        Send <strong>{amount} ETH</strong> to
                        <div className="font-mono break-all text-ink-muted">{to}</div>
                    </div>
                    <p className="text-ink-faint">
                        This action moves real value. You will sign in your wallet.
                    </p>
                    <div className="flex gap-2">
                        <button
                            type="button"
                            className="rounded-lg bg-accent text-accent-ink border border-accent px-3 py-1.5 uppercase font-bold"
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
                            className="rounded-lg border border-line-soft text-ink-muted hover:text-ink-strong px-3 py-1.5 uppercase"
                            onClick={() => setConfirming(false)}
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            )}

            {status === "pending" && <p className="text-ludo-sm text-ink-muted">Sending…</p>}
            {status === "success" && (
                <p className="text-ludo-sm text-positive break-all">
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
            {error && <p className="text-ludo-sm text-negative">{error}</p>}
        </div>
    );
}
