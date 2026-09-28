"use client";

/**
 * R0/R1 — Send ETH · USDC · CHIPS (SMART_WALLET_PLANNING §3.2).
 * Max branches by gas path (M). CHIPS is Base-only + unpriced (H2).
 */

import { useState } from "react";
import { formatUnits, isAddress } from "viem";
import { useSendNative } from "@/hooks/useSendNative";
import { useSendToken, type SendTokenKey } from "@/hooks/useSendToken";
import { useWalletAssets } from "@/hooks/useWalletAssets";
import { recordWalletActivity } from "@/hooks/useWalletActivity";
import { useMfaStepUp } from "@/hooks/useMfaStepUp";

export type SendAsset = "eth" | SendTokenKey;

const ASSETS: { key: SendAsset; label: string; decimals: number; unpriced?: boolean }[] = [
    { key: "eth", label: "ETH", decimals: 18 },
    { key: "usdc", label: "USDC", decimals: 6 },
    { key: "chips", label: "CHIPS", decimals: 18, unpriced: true },
];

export default function SendTokenSheet({ onDone }: { onDone?: () => void }) {
    const { tokens, eth, refresh, needsReconnect, address } = useWalletAssets();
    const native = useSendNative();
    const erc20 = useSendToken();
    const mfa = useMfaStepUp();
    const [asset, setAsset] = useState<SendAsset>("eth");
    const [to, setTo] = useState("");
    const [amount, setAmount] = useState("");
    const [confirming, setConfirming] = useState(false);

    const meta = ASSETS.find((a) => a.key === asset) ?? ASSETS[0];
    const bal =
        asset === "eth"
            ? eth ?? BigInt(0)
            : (tokens.find((t) => t.key === asset)?.raw ?? BigInt(0));
    const mode = native.mode;
    const maxAmt =
        asset !== "eth"
            ? formatUnits(bal, meta.decimals)
            : mode === "ingame"
              ? formatUnits(bal, meta.decimals)
              : formatUnits(native.maxSelfPay(eth ?? BigInt(0)), meta.decimals);

    const status = asset === "eth" ? native.status : erc20.status;
    const error = asset === "eth" ? native.error : erc20.error;
    const txHash = asset === "eth" ? native.txHash : erc20.txHash;

    if (needsReconnect) {
        return <p className="text-[11px] text-amber-200">Session expired — reconnect your wallet.</p>;
    }

    return (
        <div className="space-y-3">
            <h4 className="text-[11px] font-black uppercase tracking-[0.25em] text-white/70">Send</h4>
            <div className="flex gap-2 flex-wrap">
                {ASSETS.map((a) => (
                    <button
                        key={a.key}
                        type="button"
                        className={`rounded-lg px-3 py-1.5 text-[11px] font-bold uppercase border ${
                            asset === a.key ? "bg-cyan-500/25 border-cyan-400/50" : "border-white/15 text-white/70"
                        }`}
                        onClick={() => {
                            setAsset(a.key);
                            setConfirming(false);
                            native.reset();
                            erc20.reset();
                        }}
                    >
                        {a.label}
                    </button>
                ))}
            </div>
            <p className="text-[11px] text-white/45">
                Balance: <span className="font-mono">{formatUnits(bal, meta.decimals)}</span> {meta.label}
                {meta.unpriced && (
                    <span className="ml-2 rounded-full border border-white/20 px-1.5 py-0.5 text-[9px] uppercase">
                        unpriced · Base only
                    </span>
                )}
                <span className="block mt-0.5 text-[10px] text-white/35 uppercase">mode: {mode}</span>
            </p>
            <input
                className="w-full rounded-lg border border-white/20 bg-black/40 px-2 py-2 font-mono text-[11px] text-white"
                placeholder="0x recipient"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                autoComplete="off"
                spellCheck={false}
            />
            <input
                className="w-full rounded-lg border border-white/20 bg-black/40 px-2 py-2 font-mono text-[11px] text-white"
                inputMode="decimal"
                placeholder={`Amount (${meta.label})`}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
            />
            <div className="flex gap-2">
                <button
                    type="button"
                    className="rounded-lg border border-white/15 px-3 py-1.5 text-[11px] uppercase"
                    onClick={() => setAmount(maxAmt)}
                >
                    Max
                </button>
                <button
                    type="button"
                    className="flex-1 rounded-lg bg-cyan-500/20 border border-cyan-400/40 px-3 py-2 text-[11px] font-bold uppercase"
                    disabled={status === "pending" || !to || !amount || !isAddress(to.trim()) || Number(amount) <= 0}
                    onClick={() => setConfirming(true)}
                >
                    Review
                </button>
            </div>
            {confirming && status === "idle" && (
                <div className="rounded-xl border border-amber-400/30 bg-amber-500/10 p-3 text-[11px] space-y-2">
                    <div>
                        Send <strong>{amount} {meta.label}</strong> to
                        <div className="font-mono break-all">{to}</div>
                    </div>
                    <p className="text-white/50">This action moves real value. You will sign in your wallet.</p>
                    <div className="flex gap-2">
                        <button
                            type="button"
                            className="rounded-lg bg-cyan-500/25 border border-cyan-400/50 px-3 py-1.5 uppercase font-bold"
                            onClick={async () => {
                                const ok = await mfa.stepUp();
                                if (!ok) return;
                                const hash =
                                    asset === "eth"
                                        ? await native.send({ to, amountEth: amount })
                                        : await erc20.send({ token: asset, to, amount });
                                if (address) {
                                    recordWalletActivity(address, {
                                        id: hash || `local-${Date.now()}`,
                                        kind: "send",
                                        status: "pending",
                                        token: meta.label as "ETH" | "USDC" | "CHIPS",
                                        amount,
                                        counterparty: to,
                                        hash: hash ?? undefined,
                                        at: Date.now(),
                                    });
                                }
                                setConfirming(false);
                                void refresh();
                            }}
                        >
                            Confirm
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
            {status === "pending" && <p className="text-[11px] text-white/60">Sending… mode: {mode}</p>}
            {status === "success" && (
                <div className="rounded-xl border border-emerald-400/30 bg-emerald-500/10 p-3 text-[11px] space-y-1">
                    <div className="font-bold text-emerald-200">Sent.</div>
                    {txHash && <div className="font-mono text-[10px] break-all text-white/70">{txHash}</div>}
                    {onDone && (
                        <button type="button" className="text-[10px] underline text-white/60" onClick={onDone}>
                            View activity
                        </button>
                    )}
                </div>
            )}
            {error && <p className="text-[11px] text-red-300">{error}</p>}
        </div>
    );
}
