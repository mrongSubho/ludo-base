"use client";

import { ReactNode, useMemo } from "react";
import { CDPHooksProvider } from "@coinbase/cdp-hooks";

/**
 * Phase 0a spike mount for CDP non-custodial auth (SMART_WALLET_PLANNING).
 * Enabled when NEXT_PUBLIC_CDP_PROJECT_ID is set and NEXT_PUBLIC_CDP_AUTH is
 * not explicitly "0". (Deployments often omit the auth flag — don't hide CDP.)
 * createOnLogin "smart" provisions EOA + Smart Account — player identity is the
 * Smart Account (parent), never the EOA and never a sub-account (§1.1).
 * enableSpendPermissions stays OFF in 0a (0b/2 only).
 */
function cdpEnabled(): boolean {
    const projectId = process.env.NEXT_PUBLIC_CDP_PROJECT_ID || "";
    if (!projectId) return false;
    const flag = process.env.NEXT_PUBLIC_CDP_AUTH;
    return flag !== "0";
}

export function CdpAuthProvider({ children }: { children: ReactNode }) {
    const projectId = process.env.NEXT_PUBLIC_CDP_PROJECT_ID || "";
    const enabled = cdpEnabled();

    const config = useMemo(
        () =>
            enabled
                ? {
                      projectId,
                      appName: "Ludo Base",
                      disableAnalytics: true,
                      // Option A: do NOT mint a competing CDP embedded wallet.
                      // Player id = Base Account from siwe:base (see playerIdentity.ts).
                      // createOnLogin omitted on purpose.
                  }
                : null,
        [enabled, projectId],
    );

    if (!config) return <>{children}</>;
    return <CDPHooksProvider config={config}>{children}</CDPHooksProvider>;
}

export function isCdpAuthEnabled(): boolean {
    return cdpEnabled();
}
