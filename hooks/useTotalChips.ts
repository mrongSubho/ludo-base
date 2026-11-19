"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePublicClient } from "wagmi";
import { useAppSession } from "@/hooks/useAppSession";
import { useArenaVault } from "@/hooks/useArenaVault";
import { useChipsBalance } from "@/hooks/useChipsBalance";
import { useClanClaims } from "@/hooks/useClanClaims";
import {
    LEGACY_CLAIM_ABI,
    computeTotalChipsBreakdown,
    legacyClaimAddress,
    type TotalChipsBreakdown,
} from "@/lib/chips";

const CHIPS_E18 = BigInt("1000000000000000000");
const ZERO_BIGINT = BigInt(0);

function baseUnitsToWholeChips(v: unknown): number {
    try {
        const s = String(v ?? "0").split(".")[0].trim();
        if (!/^[-+]?\d+$/.test(s)) return 0;
        const wei = BigInt(s);
        if (wei <= ZERO_BIGINT) return 0;
        const whole = wei / CHIPS_E18;
        return whole <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(whole) : Number.MAX_SAFE_INTEGER;
    } catch {
        return 0;
    }
}

export interface TotalChipsState extends TotalChipsBreakdown {
    walletRaw: bigint | undefined;
    walletReady: boolean;
    vaultClaimsCount: number;
    clanClaimsCount: number;
    configured: boolean;
    isConnected: boolean;
    address: `0x${string}` | undefined;
    loading: boolean;
    refresh: () => Promise<void>;
}

/**
 * Unified read-only CHIPS balance aggregator across:
 * - On-chain wallet ERC-20 CHIPS (`useChipsBalance`)
 * - Arena Match Vault available + reserved (`useArenaVault`)
 * - Claim Hub unclaimed rewards: Arena prizes/withdrawals + Clan claims + Genesis legacy snapshot
 * - Marketplace CHIPS escrow (`chips_escrow_accounts`, passive session fetch)
 */
export function useTotalChips(): TotalChipsState {
    const bal = useChipsBalance();
    const vault = useArenaVault();
    const clanClaims = useClanClaims();
    const { sessionId, peekAppSession } = useAppSession();
    const publicClient = usePublicClient();

    const address = bal.address;
    const mountedRef = useRef(true);
    const [escrowChips, setEscrowChips] = useState<number>(0);
    const [legacyClaimableChips, setLegacyClaimableChips] = useState<number>(0);
    const [loadingExtras, setLoadingExtras] = useState<boolean>(false);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
        };
    }, []);

    const refreshExtras = useCallback(async () => {
        if (!address) {
            if (mountedRef.current) {
                setEscrowChips(0);
                setLegacyClaimableChips(0);
            }
            return;
        }

        const sid = sessionId || peekAppSession();
        const legacyContract = legacyClaimAddress();
        if (!sid && !legacyContract) {
            if (mountedRef.current) {
                setEscrowChips(0);
                setLegacyClaimableChips(0);
            }
            return;
        }

        if (mountedRef.current) setLoadingExtras(true);
        try {
            const escrowPromise = sid
                ? fetch(`/api/chips/escrow-balance?walletAddress=${encodeURIComponent(address)}`, {
                      headers: { Authorization: `Bearer ${sid}` },
                      cache: "no-store",
                  })
                      .then(async (res) => {
                          if (!res.ok) return 0;
                          const data = (await res.json().catch(() => null)) as { balance?: unknown } | null;
                          return baseUnitsToWholeChips(data?.balance);
                      })
                      .catch(() => 0)
                : Promise.resolve(0);

            const legacyPromise =
                legacyContract && publicClient
                    ? (async () => {
                          try {
                              const snapRes = await fetch("/legacy-snapshot.json", { cache: "no-store" });
                              if (!snapRes.ok) return 0;
                              const snap = (await snapRes.json()) as {
                                  entries?: { wallet: string; amount: string }[];
                              };
                              const hit = snap.entries?.find(
                                  (e) => e.wallet.toLowerCase() === address.toLowerCase(),
                              );
                              if (!hit) return 0;
                              const [done, root] = await Promise.all([
                                  publicClient.readContract({
                                      address: legacyContract,
                                      abi: LEGACY_CLAIM_ABI,
                                      functionName: "claimed",
                                      args: [address],
                                  }),
                                  publicClient.readContract({
                                      address: legacyContract,
                                      abi: LEGACY_CLAIM_ABI,
                                      functionName: "snapshotRoot",
                                  }),
                              ]);
                              if (done || !root || /^0x0+$/.test(String(root))) return 0;
                              return baseUnitsToWholeChips(hit.amount);
                          } catch {
                              return 0;
                          }
                      })()
                    : Promise.resolve(0);

            const [escrowVal, legacyVal] = await Promise.all([escrowPromise, legacyPromise]);
            if (mountedRef.current) {
                setEscrowChips(escrowVal);
                setLegacyClaimableChips(legacyVal);
            }
        } finally {
            if (mountedRef.current) setLoadingExtras(false);
        }
    }, [address, peekAppSession, publicClient, sessionId]);

    useEffect(() => {
        void refreshExtras();
    }, [refreshExtras]);

    useEffect(() => {
        if (typeof window === "undefined") return;
        const onRefresh = () => {
            void refreshExtras();
        };
        window.addEventListener("ludo-chips-refresh", onRefresh);
        window.addEventListener("ludo-arena-vault-updated", onRefresh);
        window.addEventListener("ludo-clan-claims-updated", onRefresh);
        return () => {
            window.removeEventListener("ludo-chips-refresh", onRefresh);
            window.removeEventListener("ludo-arena-vault-updated", onRefresh);
            window.removeEventListener("ludo-clan-claims-updated", onRefresh);
        };
    }, [refreshExtras]);

    const walletChips = useMemo(() => {
        if (bal.balance == null || bal.balance <= ZERO_BIGINT) return 0;
        const whole = bal.balance / CHIPS_E18;
        return whole <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(whole) : Number.MAX_SAFE_INTEGER;
    }, [bal.balance]);

    const breakdown = useMemo(
        () =>
            computeTotalChipsBreakdown({
                walletChips,
                vaultAvailableChips: vault.availableChips,
                vaultReservedChips: vault.reservedChips,
                vaultClaimableChips: vault.totalClaimableChips,
                clanClaimableChips: clanClaims.totalClaimableChips,
                legacyClaimableChips,
                escrowChips,
            }),
        [
            walletChips,
            vault.availableChips,
            vault.reservedChips,
            vault.totalClaimableChips,
            clanClaims.totalClaimableChips,
            legacyClaimableChips,
            escrowChips,
        ],
    );

    const refresh = useCallback(async () => {
        await Promise.all([bal.refresh(), vault.refresh(), clanClaims.refresh(), refreshExtras()]);
    }, [bal, clanClaims, refreshExtras, vault]);

    return {
        ...breakdown,
        walletRaw: bal.balance,
        walletReady: bal.balance != null,
        vaultClaimsCount: vault.claims.length,
        clanClaimsCount: clanClaims.claims.length,
        configured: bal.configured,
        isConnected: bal.isConnected,
        address,
        loading: bal.refreshing || vault.isLoading || clanClaims.isLoading || loadingExtras,
        refresh,
    };
}

export default useTotalChips;
