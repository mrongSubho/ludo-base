"use client";

import { usePlayerSigner } from "@/hooks/usePlayerSigner";
import { resolvePlayerIdentity } from "@/lib/playerIdentity";
import { useCurrentUser } from "@coinbase/cdp-hooks";

/**
 * R2 — wallet-details sheet (SMART_WALLET_PLANNING).
 * Explains in-game smart vs owner EOA vs Base app so users never confuse ids.
 */
export default function WalletDetailsSheet() {
    const player = usePlayerSigner();
    const { currentUser } = useCurrentUser();
    const id = resolvePlayerIdentity(currentUser);

    return (
        <div className="space-y-3">
            <h4 className="text-ludo-sm font-bold label-chrome uppercase tracking-[0.25em] text-ink-muted">
                Wallet details
            </h4>
            <div className="space-y-2 text-ludo-sm text-ink-muted leading-relaxed">
                <div className="rounded-xl border border-line-soft bg-surface-recessed p-3">
                    <div className="text-ludo-xs uppercase text-ink-faint">Active player address</div>
                    <div className="font-mono text-ink-strong break-all">{player.address || "—"}</div>
                    <div className="mt-1 text-ink-faint">
                        Mode: <span className="uppercase">{player.mode}</span>
                        {player.needsReconnect && " · session expired — reconnect"}
                    </div>
                </div>
                {player.mode === "ingame" && (
                    <>
                        <div className="rounded-xl border border-line-soft bg-surface-recessed p-3">
                            <div className="text-ludo-xs uppercase text-ink-faint">Owner key (export only)</div>
                            <div className="font-mono text-ink-muted break-all">{id.cdpOwnerEoa || "—"}</div>
                            <p className="mt-1 text-ink-faint">
                                MetaMask shows this address after export — <strong>not</strong> the in-game
                                profile address above. CHIPS sit on the smart account.
                            </p>
                        </div>
                        <p className="text-ink-faint">
                            In-game wallet is a <strong>CDP Smart Account</strong> for Ludo. It is not your
                            Base app / keys.coinbase.com wallet unless you used Sign in with Base (external
                            mode).
                        </p>
                    </>
                )}
                {player.mode === "external" && (
                    <p className="text-ink-faint">
                        External wallet (Base / MetaMask / Phantom). This address matches what that wallet
                        app shows.
                    </p>
                )}
            </div>
        </div>
    );
}
