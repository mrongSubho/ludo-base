"use client";

/**
 * Global CDP MFA listener (SMART_WALLET_PLANNING §5).
 * Sensitive ops (export key, some sends) require CDP MFA — without this
 * listener the SDK throws "MFA verification is required but no listener
 * is registered." We auto-complete via passkey when possible.
 */

import { useEffect, useRef } from "react";
import {
    useInitiateMfaVerification,
    useRegisterMfaListener,
    useSubmitMfaVerification,
} from "@coinbase/cdp-hooks";

export default function CdpMfaBridge() {
    const { initiateMfaVerification } = useInitiateMfaVerification();
    const { submitMfaVerification } = useSubmitMfaVerification();
    const busy = useRef(false);

    useRegisterMfaListener((_context) => {
        void (async () => {
            if (busy.current) return;
            busy.current = true;
            try {
                // Prefer passkey (Face ID / Touch ID). Do NOT cancel on error —
                // cancelMfaVerification surfaces as "MFA verification was cancelled".
                await initiateMfaVerification({ mfaMethod: "passkey" });
                await submitMfaVerification({ mfaMethod: "passkey", mfaCode: "" });
            } catch {
                /* leave pending; caller UI can retry */
            } finally {
                busy.current = false;
            }
        })();
    }, {});

    // Keep listener registered for app lifetime (hook owns subscription).
    useEffect(() => () => undefined, []);

    return null;
}
