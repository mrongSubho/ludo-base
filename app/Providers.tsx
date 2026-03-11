"use client";

import "@coinbase/onchainkit/styles.css";
import { OnchainKitProvider } from "@coinbase/onchainkit";
import { WagmiProvider, createConfig, http } from "wagmi";
import { base, baseSepolia } from "wagmi/chains";
import { coinbaseWallet, injected } from "wagmi/connectors";
import { QueryClientProvider, QueryClient } from "@tanstack/react-query";
import { ReactNode } from "react";
import ProfileSyncer from "./components/ProfileSyncer";
import FrameProvider from "./components/FrameProvider";
import { MultiplayerProvider } from "@/hooks/MultiplayerContext";
import { GameDataProvider } from "@/hooks/GameDataContext";

const config = createConfig({
    chains: [base, baseSepolia],
    connectors: [
        coinbaseWallet({
            appName: "Ludo Base",
            preference: {
                options: 'smartWalletOnly',
                // @ts-ignore - disabling telemetry to fix inlined script error
                telemetry: false
            } as any,
        }),
        injected(),
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
                    config={{ analytics: false }}
                >
                    <FrameProvider>
                        <GameDataProvider>
                            <MultiplayerProvider>
                                <ProfileSyncer />
                                {children}
                            </MultiplayerProvider>
                        </GameDataProvider>
                    </FrameProvider>
                </OnchainKitProvider>
            </QueryClientProvider>
        </WagmiProvider>
    );
}
