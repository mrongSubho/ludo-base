"use client";

/**
 * R2 — passkey / Touch ID step-up before sensitive ops (Send / Export).
 * SMART_WALLET_PLANNING §3.5. In-game CDP only; External uses the wallet's own UI.
 */

import { useCallback, useState } from "react";
import {
    useCurrentUser,
    useInitiateMfaVerification,
    useSubmitMfaVerification,
} from "@coinbase/cdp-hooks";
import { usePlayerSigner } from "@/hooks/usePlayerSigner";

export function useMfaStepUp() {
    const player = usePlayerSigner();
    const { currentUser } = useCurrentUser();
    const { initiateMfaVerification } = useInitiateMfaVerification();
    const { submitMfaVerification } = useSubmitMfaVerification();
    const [mfaBusy, setMfaBusy] = useState(false);
    const [mfaError, setMfaError] = useState<string | null>(null);

    const hasPasskeyMfa = Boolean(currentUser?.mfaMethods?.passkey?.length);

    /**
     * Run step-up if needed. Returns true if the caller may proceed.
     * External mode: no CDP MFA — wallet/extension owns auth.
     */
    const stepUp = useCallback(async (): Promise<boolean> => {
        if (player.mode !== "ingame" || !hasPasskeyMfa) return true;
        setMfaBusy(true);
        setMfaError(null);
        try {
            // Passkey MFA: browser prompt (Face ID / Touch ID / security key)
            await initiateMfaVerification({ mfaMethod: "passkey" });
            // Some SDK paths need an explicit submit; ignore if void
            await submitMfaVerification({ mfaMethod: "passkey", mfaCode: "" }).catch(() => undefined);
            return true;
        } catch (e) {
            setMfaError(e instanceof Error ? e.message : String(e));
            return false;
        } finally {
            setMfaBusy(false);
        }
    }, [player.mode, hasPasskeyMfa, initiateMfaVerification, submitMfaVerification]);

    return { stepUp, mfaBusy, mfaError, hasPasskeyMfa, mode: player.mode };
}
