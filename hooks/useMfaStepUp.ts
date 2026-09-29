"use client";

/**
 * R2 — passkey / Touch ID step-up before sensitive ops (Send / Export / Swap).
 * SMART_WALLET_PLANNING §3.5. In-game CDP: passkey if enrolled, else local
 * device bio. External: wallet/extension owns auth.
 *
 * Security prefs:
 * - txStepUp "strict" (default) — passkey or device Face ID required
 * - txStepUp "confirm" — Ludo Confirm only (user opted into CDP auto-approve)
 */

import { useCallback, useState } from "react";
import {
    useCurrentUser,
    useInitiateMfaVerification,
    useSubmitMfaVerification,
} from "@coinbase/cdp-hooks";
import { usePlayerSigner } from "@/hooks/usePlayerSigner";
import { useSecurityPrefs } from "@/hooks/useSecurityPrefs";
import { useBiometricGate } from "@/hooks/useBiometricGate";

export function useMfaStepUp() {
    const player = usePlayerSigner();
    const { currentUser } = useCurrentUser();
    const { initiateMfaVerification } = useInitiateMfaVerification();
    const { submitMfaVerification } = useSubmitMfaVerification();
    const bio = useBiometricGate();
    const { txStepUp } = useSecurityPrefs();
    const [mfaBusy, setMfaBusy] = useState(false);
    const [mfaError, setMfaError] = useState<string | null>(null);

    const hasPasskeyMfa = Boolean(currentUser?.mfaMethods?.passkey?.length);

    /**
     * Run step-up if needed. Returns true if the caller may proceed.
     * External mode: no CDP MFA — wallet/extension owns auth.
     */
    const stepUp = useCallback(async (): Promise<boolean> => {
        // External wallets prompt in their own UI.
        if (player.mode !== "ingame") return true;
        // User opted into confirm-only txs (setting).
        if (txStepUp === "confirm") return true;

        setMfaBusy(true);
        setMfaError(null);
        try {
            if (hasPasskeyMfa) {
                // CDP passkey MFA (Face ID / Touch ID / security key)
                await initiateMfaVerification({ mfaMethod: "passkey" });
                await submitMfaVerification({ mfaMethod: "passkey", mfaCode: "" }).catch(() => undefined);
                return true;
            }
            // No CDP passkey — require local device bio before value moves.
            const ok = await bio.unlock();
            if (!ok) {
                setMfaError(bio.error || "Device Face ID / Touch ID required to approve this transaction");
            }
            return ok;
        } catch (e) {
            setMfaError(e instanceof Error ? e.message : String(e));
            return false;
        } finally {
            setMfaBusy(false);
        }
    }, [
        player.mode,
        txStepUp,
        hasPasskeyMfa,
        initiateMfaVerification,
        submitMfaVerification,
        bio,
    ]);

    return {
        stepUp,
        mfaBusy,
        mfaError: mfaError ?? bio.error,
        hasPasskeyMfa,
        mode: player.mode,
        txStepUp,
    };
}
