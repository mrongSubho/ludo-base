"use client";

/**
 * Global CDP MFA listener (SMART_WALLET_PLANNING §5).
 * Sensitive ops require CDP MFA. Use verifyPasskey (full ceremony) —
 * submitMfaVerification with empty mfaCode is invalid for passkeys.
 */

import { useRef } from "react";
import { useRegisterMfaListener, useVerifyPasskey } from "@coinbase/cdp-hooks";

export default function CdpMfaBridge() {
    const { verifyPasskeyAsync } = useVerifyPasskey();
    const busy = useRef(false);

    useRegisterMfaListener((_context) => {
        void (async () => {
            if (busy.current) return;
            busy.current = true;
            try {
                await verifyPasskeyAsync();
            } catch {
                /* leave pending; caller can retry */
            } finally {
                busy.current = false;
            }
        })();
    }, {});

    return null;
}
