"use client";

import "@coinbase/onchainkit/styles.css";
import { OnchainKitProvider } from "@coinbase/onchainkit";
import { WagmiProvider, createConfig, http } from "wagmi";
import { base, baseSepolia } from "wagmi/chains";
import { baseAccount, coinbaseWallet, injected, walletConnect, metaMask, safe } from "wagmi/connectors";
import { QueryClientProvider, QueryClient } from "@tanstack/react-query";
import { ReactNode, useEffect } from "react";
import { DATA_SUFFIX } from "@/lib/builderCode";
import { initTelemetry } from "@/lib/telemetry";
import ProfileSyncer from "./components/ProfileSyncer";
import FrameProvider from "./components/FrameProvider";
import { TeamUpProvider } from "@/hooks/TeamUpContext";
import { GameDataProvider } from "@/hooks/GameDataContext";
import { InviteNotification } from "./components/InviteNotification";
import { CdpAuthProvider } from "./components/CdpAuthProvider";
import { prefetchSiweNonce } from "@/hooks/useBaseAccountSigner";

const config = createConfig({
    chains: [base, baseSepolia],
    connectors: [
        // Primary — Sign in with Base (keys.coinbase.com popup).
        // appName + appLogoUrl show on connect, sign, and tx approve screens.
        baseAccount({
            appName: "Ludo Base",
            appLogoUrl:
                typeof window !== "undefined"
                    ? `${window.location.origin}/ludo-base-logo.svg`
                    : "/ludo-base-logo.svg",
        }),
        coinbaseWallet({
            appName: "Ludo Base",
            preference: "smartWalletOnly",
            appLogoUrl:
                typeof window !== "undefined"
                    ? `${window.location.origin}/ludo-base-logo.svg`
                    : "/ludo-base-logo.svg",
        }),
        injected(),
        walletConnect({
            projectId: process.env.NEXT_PUBLIC_WC_PROJECT_ID || '673e0d259a5dc10d64b0fec83f6e8eca',
        }),
        metaMask(),
        safe(),
    ],
    transports: {
        [base.id]: http(),
        [baseSepolia.id]: http(),
    },
    ssr: true,
    // ERC-8021 Builder Code attribution on every tx (see lib/builderCode.ts).
    // Undefined until NEXT_PUBLIC_BUILDER_CODE is set — then all
    // useSendTransaction / useWriteContract / useSendCalls flows are attributed.
    ...(DATA_SUFFIX ? { dataSuffix: DATA_SUFFIX } : {}),
});

const queryClient = new QueryClient();

export function Providers({ children }: { children: ReactNode }) {
    useEffect(() => {
        initTelemetry();
        // Warm Base SIWE nonce so "Continue with Base" can open the popup on click.
        prefetchSiweNonce();
    }, []);
    return (
        <WagmiProvider config={config}>
            <QueryClientProvider client={queryClient}>
                <CdpAuthProvider>
                <OnchainKitProvider
                    apiKey="YxhGPF4gkkpnfqWoNqrTDfqxUX1kKWdU"
                    chain={base}
                    config={{
                        analytics: false,
                        wallet: {
                            display: 'modal',
                        },
                    }}
                >
                    <FrameProvider>
                        <GameDataProvider>
                            <TeamUpProvider>
                                <ProfileSyncer />
                                <InviteNotification />
                                {children}
                            </TeamUpProvider>
                        </GameDataProvider>
                    </FrameProvider>
                </OnchainKitProvider>
                </CdpAuthProvider>
            </QueryClientProvider>
        </WagmiProvider>
    );
}
