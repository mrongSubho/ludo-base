"use client";

/**
 * React hook that pulls each wallet's mission progress/completion from the
 * MissionSystem contract (Base Sepolia). Designed to OVERLAY the existing
 * DB-derived MissionPanel without taking it over: when the contract is not
 * configured, or a particular mission read fails, `states` simply omits that
 * mission and the panel falls back to its DB values.
 *
 * SSR-safe: the first client + server render both have `states = {}`, so the
 * on-chain overlay only kicks in after the effect runs on the client — no
 * hydration mismatch.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  isMissionSystemConfigured,
  readMissionStates,
  type OnChainMissionState,
} from "@/lib/missionSystem";

export function useMissionOnChainState(
  address: string | undefined,
  missionIds: string[],
) {
  const [states, setStates] = useState<Record<string, OnChainMissionState>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const configured = isMissionSystemConfigured();

  // Keep the latest closure values in a ref so `refresh` can stay stable.
  const latest = useRef({ address, missionIds, configured });
  latest.current = { address, missionIds, configured };

  const run = useCallback(async () => {
    const { address: addr, missionIds: ids, configured: cfg } = latest.current;
    if (!cfg || !addr || ids.length === 0) {
      setStates({});
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await readMissionStates(addr as `0x${string}`, ids);
      setStates(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "on-chain read failed");
    } finally {
      setLoading(false);
    }
  }, []);

  // Re-run only when the joined id list, address, or config changes — not on
  // every render (missionIds is a fresh array each render; the string key is stable).
  const key = missionIds.join(",");
  useEffect(() => {
    const { address: addr, missionIds: ids, configured: cfg } = latest.current;
    if (!cfg || !addr || ids.length === 0) {
      setStates({});
      return;
    }
    let cancelled = false;
    setLoading(true);
    readMissionStates(addr as `0x${string}`, ids)
      .then((r) => {
        if (!cancelled) setStates(r);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "on-chain read failed");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // missionIds is intentionally NOT a dep: it's a fresh array each render. The
    // effect body reads ids/address/configured from the `latest` ref, so the
    // primitive `key` (joined ids) + address + configured are the correct deps.
  }, [key, address, configured]);

  return { states, loading, error, configured, refresh: run };
}

export default useMissionOnChainState;
