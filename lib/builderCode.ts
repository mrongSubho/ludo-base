/**
 * Base Builder Code (ERC-8021 attribution).
 *
 * The `BUILDER_CODE` value comes from base.dev → Settings → Builder Codes
 * (one-time registration; never re-register while this file exists).
 * It is embedded in every transaction as an ERC-8021 data suffix so Base can
 * attribute on-chain activity (pool joins, claims, marketplace buys) to Ludo Base.
 *
 * TODO(Phase 1): replace the placeholder with the real code from base.dev.
 * Until then `DATA_SUFFIX` is `undefined` and wagmi sends unattributed txs.
 */
import { Attribution } from "ox/erc8021";

export const BUILDER_CODE =
    process.env.NEXT_PUBLIC_BUILDER_CODE || "TODO-from-base.dev";

/** ERC-8021 suffix for wagmi `dataSuffix` / `sendCalls` capabilities. */
export const DATA_SUFFIX =
    BUILDER_CODE.startsWith("TODO")
        ? undefined
        : Attribution.toDataSuffix({ codes: [BUILDER_CODE] });
