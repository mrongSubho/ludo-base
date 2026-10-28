"use client";

// NOTE: `@coinbase/onchainkit/styles.css` was deliberately removed. Nothing in
// the app renders an OnchainKit component — WalletConnectCard uses our own
// LudoWalletModal, and the only OnchainKit surface left is `useName` /
// `useAvatar` in ProfileSyncer (ENS/Base name lookup, the third fallback behind
// Farcaster SDK and Neynar). That stylesheet pulled in four extra Google Fonts
// `@import`s (Inter, Inter 700, Noto Sans Mono, Oxanium) — four render-blocking
// third-party requests Cloudflare flagged as the top opportunity. Re-add this
// import if an OnchainKit component is ever rendered.
import { OnchainKitProvider } from "@coinbase/onchainkit";
import { WagmiProvider, createConfig, http } from "wagmi";
import { baseSepolia } from "wagmi/chains";
import { baseAccount, coinbaseWallet, injected, walletConnect, metaMask, safe } from "wagmi/connectors";
import { QueryClientProvider, QueryClient } from "@tanstack/react-query";
import { MotionConfig } from "framer-motion";
import { ReactNode, useEffect } from "react";
import { DATA_SUFFIX } from "@/lib/builderCode";
import { initTelemetry } from "@/lib/telemetry";
import ProfileSyncer from "./components/ProfileSyncer";
import NetworkAutoSwitcher from "./components/NetworkAutoSwitcher";
import FrameProvider from "./components/FrameProvider";
import BootLock from "./components/BootLock";
import GlobalSignWaitModal from "./components/GlobalSignWaitModal";
import { ToastProvider } from "./components/Toast";
import { TeamUpProvider } from "@/hooks/TeamUpContext";
import { GameDataProvider } from "@/hooks/GameDataContext";
import { InviteNotification } from "./components/InviteNotification";
import { CdpAuthProvider } from "./components/CdpAuthProvider";
import { prefetchSiweNonce } from "@/hooks/useBaseAccountSigner";
import { installWagmiConnectorGuards, installBrowserWindowGuard } from "@/lib/walletGuard";

const config = createConfig({
    chains: [baseSepolia],
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
            projectId: process.env.NEXT_PUBLIC_WC_PROJECT_ID || '',
        }),
        metaMask(),
        safe(),
    ],
    transports: {
        [baseSepolia.id]: http(),
    },
    ssr: true,
    // ERC-8021 Builder Code attribution on every tx (see lib/builderCode.ts).
    // Undefined until NEXT_PUBLIC_BUILDER_CODE is set — then all
    // useSendTransaction / useWriteContract / useSendCalls flows are attributed.
    ...(DATA_SUFFIX ? { dataSuffix: DATA_SUFFIX } : {}),
});

installWagmiConnectorGuards(config);

const queryClient = new QueryClient();

export function Providers({ children }: { children: ReactNode }) {
    useEffect(() => {
        initTelemetry();
        installBrowserWindowGuard();
        // Warm Base SIWE nonce so "Continue with Base" can open the popup on click.
        prefetchSiweNonce();
    }, []);
    return (
        // CSS_LAYOUT_ANIMATION_PLAN §3.4: the CSS reduced-motion kill-switch does
        // not reach framer-motion; `reducedMotion="user"` makes every motion.*
        // component honor the OS setting (lib/motion.ts carries the same query
        // for the GSAP token timelines and canvas-confetti).
        <MotionConfig reducedMotion="user">
            <WagmiProvider config={config}>
            <QueryClientProvider client={queryClient}>
                <CdpAuthProvider>
                <OnchainKitProvider
                    apiKey={process.env.NEXT_PUBLIC_ONCHAINKIT_API_KEY || ''}
                    chain={baseSepolia}
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
                                <ToastProvider>
                                <ProfileSyncer />
                                <NetworkAutoSwitcher />
                                <InviteNotification />
                                <BootLock />
                                <GlobalSignWaitModal />
                                {children}
                                </ToastProvider>
                            </TeamUpProvider>
                        </GameDataProvider>
                    </FrameProvider>
                </OnchainKitProvider>
                </CdpAuthProvider>
            </QueryClientProvider>
            </WagmiProvider>
        </MotionConfig>
    );
}
