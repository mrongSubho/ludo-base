"use client";

/**
 * Global CDP MFA listener (SMART_WALLET_PLANNING §5).
 * Sensitive ops require CDP MFA. Use verifyPasskey (full ceremony) —
 * submitMfaVerification with empty mfaCode is invalid for passkeys.
 *
 * Failure contract (learned the hard way, 2026-10-07): CDP's withMfa awaits a
 * deferred that NOTHING in the public SDK resolves except a fully-completed
 * verifyPasskey. If the ceremony never prompts — e.g. the browser reports no
 * user-verifying platform authenticator (Chrome-for-Testing returns false for
 * isUserVerifyingPlatformAuthenticatorAvailable while real Touch ID ceremonies
 * still complete) so the SDK throws PASSKEY_NOT_SUPPORTED before any UI — then
 * nothing settles the sign. The old code swallowed that throw (`catch {}`),
 * left `busy` set, and left the UI on "sending" forever: every later MFA
 * trigger hit `busy` and was dropped, a permanent silent signing outage that
 * survived everything except a reload and appeared in no log.
 *
 * So: bound the attempt, log LOUDLY on any failure, and always reset `busy`.
 * A rejection still can't settle CDP's deferred (no public API for that), but
 * the sign-level timeout in useAppSession surfaces it, the log names it, and
 * the next trigger supersedes the stale deferred instead of being dropped.
 */

import { useRef } from "react";
import { useRegisterMfaListener, useVerifyPasskey } from "@coinbase/cdp-hooks";

/** Below the sign-level timeout so the bridge is reusable before it fires. */
const MFA_VERIFY_TIMEOUT_MS = 45_000;

function withMfaTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(
            () => reject(new Error(`mfa-timeout: passkey verification did not settle within ${ms}ms`)),
            ms,
        );
    });
    return Promise.race([p, timeout]).finally(() => {
        if (timer !== undefined) clearTimeout(timer);
    }) as Promise<T>;
}

export default function CdpMfaBridge() {
    const { verifyPasskeyAsync } = useVerifyPasskey();
    const busy = useRef(false);

    useRegisterMfaListener((_context) => {
        void (async () => {
            if (busy.current) return;
            busy.current = true;
            try {
                await withMfaTimeout(verifyPasskeyAsync(), MFA_VERIFY_TIMEOUT_MS);
            } catch (err) {
                console.error("[cdp-mfa] verification failed or timed out", err);
            } finally {
                busy.current = false;
            }
        })();
    }, {});

    return null;
}
