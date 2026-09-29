"use client";

/**
 * Boot lock — require passkey / device Face ID on **every page load**
 * when the user is signed in (SMART_WALLET_PLANNING §5).
 * Unlock is per document only (no sessionStorage — reload is a new boot).
 * After 5 failed tries, sign out so the user can sign in again cleanly.
 */

import { useCallback, useState } from "react";
import {
    useCurrentUser,
    useInitiateMfaVerification,
    useIsSignedIn,
    useListPasskeys,
    useSignOut,
    useSubmitMfaVerification,
} from "@coinbase/cdp-hooks";
import { resolvePlayerIdentity } from "@/lib/playerIdentity";
import { useSecurityPrefs } from "@/hooks/useSecurityPrefs";

/** Reset on every full navigation / refresh — one unlock per boot. */
let unlockedThisLoad = false;

/**
 * Call after a successful sign-in / create in this document so we do not
 * immediately re-lock a user who just proved themselves.
 */
export function markBootUnlocked(): void {
    unlockedThisLoad = true;
}

const MAX_ATTEMPTS = 5;

function friendlyError(e: unknown): string {
    const raw = e instanceof Error ? e.message : String(e);
    const msg = raw.toLowerCase();
    if (msg.includes("not allowed") || msg.includes("denied") || msg.includes("security")) {
        return "Biometric prompt was cancelled or blocked. Try Unlock again.";
    }
    if (msg.includes("timeout") || msg.includes("timed out")) {
        return "No response from Face ID / Touch ID. Tap Unlock when ready.";
    }
    if (msg.includes("not available") || msg.includes("not supported")) {
        return "This device has no Face ID / Touch ID. Use a device with biometrics, or sign out.";
    }
    if (msg.includes("already") && msg.includes("pending")) {
        return "Unlock already in progress — finish the prompt.";
    }
    return "Unlock failed. Try again.";
}

export default function BootLock() {
    const { isSignedIn } = useIsSignedIn();
    const { currentUser } = useCurrentUser();
    const { data: passkeys } = useListPasskeys();
    const { initiateMfaVerification } = useInitiateMfaVerification();
    const { submitMfaVerification } = useSubmitMfaVerification();
    const { signOut } = useSignOut();
    const { bootLock } = useSecurityPrefs();
    const [unlocked, setUnlocked] = useState(unlockedThisLoad);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [attempts, setAttempts] = useState(0);

    const id = resolvePlayerIdentity(currentUser);
    const hasPasskey = Boolean((passkeys || []).length || currentUser?.mfaMethods?.passkey?.length);
    const left = Math.max(0, MAX_ATTEMPTS - attempts);
    const lockedOut = attempts >= MAX_ATTEMPTS;

    // Security gate is **server-side only**: CDP reports an enrolled passkey.
    // Never trust localStorage (clearing site data must not skip the lock).
    // markBootUnlocked() only covers the create → ready → passkey handoff
    // in this same document; the next reload always locks.
    const required =
        bootLock && isSignedIn && Boolean(id.address) && hasPasskey && !unlocked;

    const signOutNow = useCallback(async () => {
        try {
            await signOut();
        } catch {
            /* ignore */
        }
        unlockedThisLoad = false;
        setUnlocked(true); // drop the overlay — page shows sign-in gate
    }, [signOut]);

    const fail = useCallback(
        (e: unknown) => {
            const next = attempts + 1;
            setAttempts(next);
            if (next >= MAX_ATTEMPTS) {
                setError("Too many failed attempts. Signing out…");
                void signOutNow();
            } else {
                setError(friendlyError(e));
            }
        },
        [attempts, signOutNow],
    );

    const unlock = useCallback(async () => {
        if (lockedOut || busy) return;
        setBusy(true);
        setError(null);
        try {
            // Device WebAuthn is the real gate — it always opens the OS
            // passkey / Face ID sheet. CDP MFA alone can no-op.
            if (typeof window === "undefined" || !window.PublicKeyCredential || !navigator.credentials) {
                fail(new Error("Biometrics not available"));
                return;
            }
            const challenge = crypto.getRandomValues(new Uint8Array(32));
            const cred = await navigator.credentials.get({
                publicKey: {
                    challenge,
                    rpId: window.location.hostname,
                    userVerification: "required",
                    timeout: 60_000,
                },
            });
            if (!cred) {
                fail(new Error("No credential"));
                return;
            }
            if (hasPasskey) {
                try {
                    await initiateMfaVerification({ mfaMethod: "passkey" });
                    await submitMfaVerification({ mfaMethod: "passkey", mfaCode: "" });
                } catch {
                    /* device proof already done */
                }
            }
            unlockedThisLoad = true;
            setUnlocked(true);
        } catch (e) {
            fail(e);
        } finally {
            setBusy(false);
        }
    }, [busy, lockedOut, fail, hasPasskey, initiateMfaVerification, submitMfaVerification]);

    if (!required) return null;

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
                <p className="boot-lock-sub">
                    {hasPasskey
                        ? "Unlock with your passkey or Face ID"
                        : "Unlock with Face ID / Touch ID"}
                </p>

                {error && (
                    <div className="boot-lock-alert" role="alert">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                            <circle cx="12" cy="12" r="9" />
                            <path d="M12 8v5M12 16h.01" />
                        </svg>
                        <span>{error}</span>
                    </div>
                )}

                {!lockedOut && attempts > 0 && (
                    <p className="boot-lock-tally">
                        {left} attempt{left === 1 ? "" : "s"} left
                    </p>
                )}

                <button
                    type="button"
                    className="boot-lock-cta"
                    disabled={busy || lockedOut}
                    onClick={unlock}
                >
                    {busy ? "Waiting for Face ID…" : lockedOut ? "Signed out" : "Unlock"}
                </button>
                <button
                    type="button"
                    className="boot-lock-ghost"
                    disabled={busy}
                    onClick={() => void signOutNow()}
                >
                    Sign out instead
                </button>
            </div>
        </div>
    );
}
