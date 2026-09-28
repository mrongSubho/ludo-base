"use client";

/**
 * R5 — local biometrics gate before Wallet (device WebAuthn, not chain).
 * Optional lock: Face ID / Touch ID / Windows Hello. Never replaces wallet MFA.
 */

import { useCallback, useState } from "react";

const CHALLENGE_KEY = "ludo-bio-challenge";

export function useBiometricGate() {
    const [unlocked, setUnlocked] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [supported, setSupported] = useState<boolean | null>(null);

    const checkSupport = useCallback(() => {
        const ok = typeof window !== "undefined" && !!window.PublicKeyCredential;
        setSupported(ok);
        return ok;
    }, []);

    const unlock = useCallback(async () => {
        if (typeof window === "undefined" || !window.PublicKeyCredential) {
            setError("Biometrics not available in this browser");
            setSupported(false);
            return false;
        }
        setBusy(true);
        setError(null);
        try {
            const challenge = crypto.getRandomValues(new Uint8Array(32));
            try {
                sessionStorage.setItem(CHALLENGE_KEY, btoa(String.fromCharCode(...challenge)));
            } catch {
                /* ignore */
            }
            await navigator.credentials.get({
                publicKey: {
                    challenge,
                    // Empty allowCredentials → discoverable / platform authenticator
                    rpId: window.location.hostname,
                    userVerification: "required",
                    timeout: 60_000,
                },
            });
            setUnlocked(true);
            return true;
        } catch (e) {
            setError(e instanceof Error ? e.message : "Biometric unlock failed");
            return false;
        } finally {
            setBusy(false);
        }
    }, []);

    const lock = useCallback(() => setUnlocked(false), []);

    return { unlocked, busy, error, supported, checkSupport, unlock, lock };
}
