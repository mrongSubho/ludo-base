"use client";

import "@coinbase/onchainkit/styles.css";
import { OnchainKitProvider } from "@coinbase/onchainkit";
import { WagmiProvider, createConfig, http } from "wagmi";
import { base, baseSepolia } from "wagmi/chains";
import { coinbaseWallet, injected, walletConnect, metaMask, safe } from "wagmi/connectors";
import { QueryClientProvider, QueryClient } from "@tanstack/react-query";
import { ReactNode } from "react";
import ProfileSyncer from "./components/ProfileSyncer";
import FrameProvider from "./components/FrameProvider";
import { TeamUpProvider } from "@/hooks/TeamUpContext";
import { GameDataProvider } from "@/hooks/GameDataContext";
import { InviteNotification } from "./components/InviteNotification";

const config = createConfig({
    chains: [base, baseSepolia],
    connectors: [
        coinbaseWallet({
            appName: "Ludo Base",
            preference: "smartWalletOnly",
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
});

const queryClient = new QueryClient();

export function Providers({ children }: { children: ReactNode }) {
    return (
        <WagmiProvider config={config}>
            <QueryClientProvider client={queryClient}>
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
            </QueryClientProvider>
        </WagmiProvider>
    );
}
