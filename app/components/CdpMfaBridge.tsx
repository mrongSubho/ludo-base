"use client";

/**
 * Global CDP MFA listener (SMART_WALLET_PLANNING §5).
 * Sensitive ops (export key, some sends) require CDP MFA — without this
 * listener the SDK throws "MFA verification is required but no listener
 * is registered." We auto-complete via passkey when possible.
 */

import { useEffect, useRef } from "react";
import {
    useCancelMfaVerification,
    useInitiateMfaVerification,
    useRegisterMfaListener,
    useSubmitMfaVerification,
} from "@coinbase/cdp-hooks";

export default function CdpMfaBridge() {
    const { initiateMfaVerification } = useInitiateMfaVerification();
    const { submitMfaVerification } = useSubmitMfaVerification();
    const { cancelMfaVerification } = useCancelMfaVerification();
    const busy = useRef(false);

    useRegisterMfaListener((_context) => {
        void (async () => {
            if (busy.current) return;
            busy.current = true;
            try {
                // Prefer passkey (Face ID / Touch ID / security key).
                await initiateMfaVerification({ mfaMethod: "passkey" });
                await submitMfaVerification({ mfaMethod: "passkey", mfaCode: "" });
            } catch {
                try {
                    await cancelMfaVerification();
                } catch {
                    /* ignore */
                }
            } finally {
                busy.current = false;
            }
        })();
    }, {});

    // Keep listener registered for app lifetime (hook owns subscription).
    useEffect(() => () => undefined, []);

    return null;
}
