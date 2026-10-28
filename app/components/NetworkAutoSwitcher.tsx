"use client";

import { useEffect, useRef } from "react";
import { useAccount, useSwitchChain } from "wagmi";
import { baseSepolia } from "wagmi/chains";
import { useWalletMode } from "@/hooks/useWalletMode";

/**
 * NetworkAutoSwitcher
 *
 * Automatically detects when an external wallet (MetaMask, Base Account, etc.)
 * connects on a chain other than Base Sepolia (84532) and requests an immediate
 * network switch.
 */
export default function NetworkAutoSwitcher() {
    const { isConnected, chainId, connector } = useAccount();
    const { switchChain } = useSwitchChain();
    const walletMode = useWalletMode();
    const lastAttemptedChainRef = useRef<number | null>(null);

    useEffect(() => {
        // CDP in-game smart wallets operate via backend bundler and do not use browser network
        if (walletMode === "ingame") return;
        if (!isConnected || !chainId) return;

        // Target chain is Base Sepolia (84532)
        if (chainId !== baseSepolia.id) {
            if (lastAttemptedChainRef.current === chainId) return;

            lastAttemptedChainRef.current = chainId;
            console.log(
                `[NetworkAutoSwitcher] Active chain (${chainId}) does not match target (${baseSepolia.id}). Prompting switch to Base Sepolia...`
            );

            try {
                switchChain(
                    { chainId: baseSepolia.id, connector },
                    {
                        onSuccess: () => {
                            console.log("[NetworkAutoSwitcher] Successfully switched to Base Sepolia (84532).");
                            lastAttemptedChainRef.current = null;
                        },
                        onError: (err) => {
                            console.warn("[NetworkAutoSwitcher] Chain switch rejected or deferred by user:", err);
                        },
                    }
                );
            } catch (err) {
                console.warn("[NetworkAutoSwitcher] Failed to initiate chain switch:", err);
            }
        } else {
            lastAttemptedChainRef.current = null;
        }
    }, [isConnected, chainId, connector, walletMode, switchChain]);

    return null;
}
