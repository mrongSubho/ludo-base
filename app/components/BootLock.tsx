"use client";

/**
 * Boot lock — if the user has passkey / device Face ID set up, require
 * it on every app boot (SMART_WALLET_PLANNING §5 security prefs).
 * Session-scoped: unlocks once per page load / tab session.
 */

import { useCallback, useEffect, useState } from "react";
import {
    useCurrentUser,
    useInitiateMfaVerification,
    useIsSignedIn,
    useListPasskeys,
    useSubmitMfaVerification,
} from "@coinbase/cdp-hooks";
import { resolvePlayerIdentity } from "@/lib/playerIdentity";
import { useSecurityPrefs } from "@/hooks/useSecurityPrefs";

export default function BootLock() {
    const { isSignedIn } = useIsSignedIn();
    const { currentUser } = useCurrentUser();
    const { data: passkeys } = useListPasskeys();
    const { initiateMfaVerification } = useInitiateMfaVerification();
    const { submitMfaVerification } = useSubmitMfaVerification();
    const { bootLock } = useSecurityPrefs();
    const [unlocked, setUnlocked] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [ready, setReady] = useState(false);

    const id = resolvePlayerIdentity(currentUser);
    const hasPasskey = Boolean((passkeys || []).length || currentUser?.mfaMethods?.passkey?.length);

    useEffect(() => {
        try {
            if (sessionStorage.getItem("ludo-boot-unlocked") === "1") setUnlocked(true);
        } catch {
            /* ignore */
        }
        setReady(true);
    }, []);

    const required = ready && bootLock && isSignedIn && Boolean(id.address) && hasPasskey;

    const unlock = useCallback(async () => {
        setBusy(true);
        setError(null);
        try {
            if (hasPasskey) {
                await initiateMfaVerification({ mfaMethod: "passkey" });
                await submitMfaVerification({ mfaMethod: "passkey", mfaCode: "" }).catch(() => undefined);
            } else if (typeof window !== "undefined" && window.PublicKeyCredential) {
                const challenge = crypto.getRandomValues(new Uint8Array(32));
                await navigator.credentials.get({
                    publicKey: {
                        challenge,
                        rpId: window.location.hostname,
                        userVerification: "required",
                        timeout: 60_000,
                    },
                });
            } else {
                setError("Passkey / device biometrics not available");
                return;
            }
            try {
                sessionStorage.setItem("ludo-boot-unlocked", "1");
            } catch {
                /* ignore */
            }
            setUnlocked(true);
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setBusy(false);
        }
    }, [hasPasskey, initiateMfaVerification, submitMfaVerification]);

    if (!required || unlocked) return null;

    return (
        <div className="boot-lock" role="dialog" aria-modal="true" aria-label="Unlock">
            <div className="boot-lock-card">
                <div className="boot-lock-badge" aria-hidden>
                    <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="5" y="10" width="14" height="10" rx="2" />
                        <path d="M8 10V7a4 4 0 0 1 8 0v3" />
                    </svg>
                </div>
                <h2 className="boot-lock-title">Welcome back</h2>
                <p className="boot-lock-sub">Unlock Ludo with your passkey / Face ID</p>
                {error && <p className="boot-lock-err">{error}</p>}
                <button type="button" className="boot-lock-cta" disabled={busy} onClick={unlock}>
                    {busy ? "Waiting for biometric…" : "Unlock"}
                </button>
            </div>
        </div>
    );
}
