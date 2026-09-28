"use client";

import { usePlayerSigner } from "@/hooks/usePlayerSigner";
import { resolvePlayerIdentity } from "@/lib/playerIdentity";
import { useCurrentUser } from "@coinbase/cdp-hooks";

/**
 * R2 — wallet-details sheet (WALLET_PLAN).
 * Explains in-game smart vs owner EOA vs Base app so users never confuse ids.
 */
export default function WalletDetailsSheet() {
    const player = usePlayerSigner();
    const { currentUser } = useCurrentUser();
    const id = resolvePlayerIdentity(currentUser);

    return (
        <div className="space-y-3">
            <h4 className="text-[11px] font-black uppercase tracking-[0.25em] text-white/70">
                Wallet details
            </h4>
            <div className="space-y-2 text-[11px] text-white/65 leading-relaxed">
                <div className="rounded-xl border border-white/10 p-3">
                    <div className="text-[10px] uppercase text-white/40">Active player address</div>
                    <div className="font-mono text-white/85 break-all">{player.address || "—"}</div>
                    <div className="mt-1 text-white/45">
                        Mode: <span className="uppercase">{player.mode}</span>
                        {player.needsReconnect && " · session expired — reconnect"}
                    </div>
                </div>
                {player.mode === "ingame" && (
                    <>
                        <div className="rounded-xl border border-white/10 p-3">
                            <div className="text-[10px] uppercase text-white/40">Owner key (export only)</div>
                            <div className="font-mono text-white/70 break-all">{id.cdpOwnerEoa || "—"}</div>
                            <p className="mt-1 text-white/45">
                                MetaMask shows this address after export — <strong>not</strong> the in-game
                                profile address above. CHIPS sit on the smart account.
                            </p>
                        </div>
                        <p className="text-white/45">
                            In-game wallet is a <strong>CDP Smart Account</strong> for Ludo. It is not your
                            Base app / keys.coinbase.com wallet unless you used Sign in with Base (external
                            mode).
                        </p>
                    </>
                )}
                {player.mode === "external" && (
                    <p className="text-white/45">
                        External wallet (Base / MetaMask / Phantom). This address matches what that wallet
                        app shows.
                    </p>
                )}
            </div>
        </div>
    );
}
