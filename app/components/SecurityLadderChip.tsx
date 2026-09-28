"use client";

/**
 * Lobby security ladder chip: Wallet → Protect → Play.
 * Cheap local progress; no extra network.
 */

import { useCurrentUser } from "@coinbase/cdp-hooks";
import { resolvePlayerIdentity } from "@/lib/playerIdentity";
import { useListPasskeys } from "@coinbase/cdp-hooks";
import { hasSeenWalletReady } from "@/lib/walletOnboarding";

export default function SecurityLadderChip() {
    const { currentUser } = useCurrentUser();
    const id = resolvePlayerIdentity(currentUser);
    const { data: passkeys } = useListPasskeys();
    const address = id.address;

    if (!address) return null;

    const wallet = hasSeenWalletReady(address);
    const protect = Boolean((passkeys || []).length || currentUser?.mfaMethods?.passkey?.length);
    const play = wallet; // reached lobby after ready

    const cls = (on: boolean, now: boolean) => (on ? "done" : now ? "now" : "todo");

    return (
        <div className="security-ladder" title="Wallet setup">
            <span className={cls(wallet, true)}>Wallet</span>
            <span className="sep">·</span>
            <span className={cls(protect, wallet && !protect)}>Protect</span>
            <span className="sep">·</span>
            <span className={cls(play, wallet && protect)}>Play</span>
        </div>
    );
}
