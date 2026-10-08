"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { useAccount, useChainId } from 'wagmi';
import { usePlayerSigner } from '@/hooks/usePlayerSigner';
import { buildSiweMessage, APP_SESSION_TTL_MS } from '@/lib/sessionProof';
import { parseChainId, DEFAULT_CHAIN_ID } from '@/lib/chains';
import { AppSessionGuard } from '@/lib/appSessionGuard';
import { readSecurityPrefs } from '@/hooks/useSecurityPrefs';

const STORAGE_KEY = 'ludo-siwe-session';

/** Bound for one wallet-sign attempt (see the sign callback below). */
const SIGN_TIMEOUT_MS = 60_000;

function withSignTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(
            () => reject(new Error(`sign-timeout: wallet did not return a signature within ${ms}ms`)),
            ms,
        );
    });
    return Promise.race([p, timeout]).finally(() => {
        if (timer !== undefined) clearTimeout(timer);
    }) as Promise<T>;
}

type Stored = { sessionId: string; wallet: string; expiresAt: string };

/**
 * SIWE app session for chat / profile / settings.
 * Sign once per wallet (or after expiry). Not used for match moves.
 *
 * Storm-hardened: all hook instances share one module-level AppSessionGuard
 * (singleton store + shared in-flight promise keyed by address), with
 * exponential verify-failure backoff, a user-rejection cooldown, and a
 * terminal non-retrying state after repeated verify failures. Timer pollers
 * calling ensureAppSession() therefore cannot popup-loop a sessionless
 * wallet — they get null + a surfaced error instead.
 *
 * Return shape is backward compatible: `{ sessionId, ready,
 * ensureAppSession, clearAppSession }` plus additive `verifyFailed` /
 * `lastError` for UIs that want to surface the terminal state.
 * `ensureAppSession` accepts an optional `{ force: true }` for explicit
 * user-initiated retries (bypasses cooldown/backoff/terminal once).
 */
const guard = new AppSessionGuard();

function readStored(address: string | undefined): Stored | null {
    try {
        if (typeof window === 'undefined' || !address) return null;
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as Stored;
        if (
            parsed.wallet.toLowerCase() === address.toLowerCase() &&
            new Date(parsed.expiresAt).getTime() > Date.now()
        ) {
            return parsed;
        }
        localStorage.removeItem(STORAGE_KEY);
        return null;
    } catch {
        return null;
    }
}

export function useAppSession() {
    const { address: accountAddress } = useAccount();
    const player = usePlayerSigner();
    const address = player.address ?? accountAddress;
    const walletChainId = useChainId();
    const signMessageAsync = player.signMessageAsync;
    const [ready, setReady] = useState(false);

    // Re-render this instance whenever the shared guard state changes.
    useSyncExternalStore(
        guard.subscribe,
        () => {
            const s = guard.getSnapshot(address);
            return `${s.sessionId || ''}|${s.verifyFailed ? 1 : 0}|${s.lastError || ''}`;
        },
        () => '',
    );

    useEffect(() => {
        guard.setCached(address || '', readStored(address));
        setReady(true);
    }, [address]);

    const snap = guard.getSnapshot(address);
    const sessionId = snap.sessionId;

    /** Prompt SIWE if needed; returns sessionId or null (never throws). */
    const ensureAppSession = useCallback(async (opts?: { force?: boolean }): Promise<string | null> => {
        if (!address) return null;
        const result = await guard.ensure(address, {
            sign: async () => {
                // autoSign off → require device Face ID / Touch ID before
                // CDP/background message sign (security prefs). External
                // wallets must use their native wallet confirmation flow.
                if (
                    player.mode === "ingame" &&
                    !readSecurityPrefs().autoSign &&
                    typeof window !== "undefined" &&
                    window.PublicKeyCredential
                ) {
                    try {
                        console.error('[siwe-sign] stage=biometrics-prompt');
                        const ch = crypto.getRandomValues(new Uint8Array(32));
                        await navigator.credentials.get({
                            publicKey: {
                                challenge: ch,
                                rpId: window.location.hostname,
                                userVerification: "required",
                                timeout: 60_000,
                            },
                        });
                        console.error('[siwe-sign] stage=biometrics-done');
                    } catch {
                        return Promise.reject(new Error("Device biometrics required to sign in"));
                    }
                }
                const domain = window.location.hostname;
                const issuedAt = new Date().toISOString();
                const expirationTime = new Date(Date.now() + APP_SESSION_TTL_MS).toISOString();
                const nonce = crypto.randomUUID();
                // Sign on the active wallet chain when supported (Sepolia-first
                // for Phase 1 testing), else mainnet default. Server enforces
                // the allowlist and rebuilds the identical text.
                const chainId = parseChainId(walletChainId) ?? DEFAULT_CHAIN_ID;
                const message = buildSiweMessage({ domain, address, issuedAt, expirationTime, nonce, chainId });
                // A parked signer used to hang this promise forever: no CDP
                // popup, no error, UI stuck on "sending" with zero feedback and
                // nothing in any log. Bound it so a stall surfaces as a loud,
                // retryable error carrying the stage it died in.
                console.error('[siwe-sign] stage=wallet-sign-start');
                const signature = await withSignTimeout(
                    signMessageAsync({ account: address as `0x${string}`, message }),
                    SIGN_TIMEOUT_MS,
                );
                console.error('[siwe-sign] stage=wallet-sign-done');
                return {
                    signature: signature as string,
                    body: { domain, address, nonce, issuedAt, expirationTime, signature, message, chainId },
                };
            },
            verify: async (signed) => {
                try {
                    const res = await fetch('/api/siwe/verify', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(signed.body),
                    });
                    const data = await res.json().catch(() => ({}));
                    if (!res.ok || !data.sessionId) {
                        console.error('SIWE verify failed', data);
                        const code =
                            typeof data?.code === 'string'
                                ? data.code
                                : res.status === 401
                                  ? 'signer-mismatch'
                                  : `http-${res.status}`;
                        return { ok: false as const, code };
                    }
                    return {
                        ok: true as const,
                        sessionId: data.sessionId as string,
                        expiresAt: data.expiresAt as string,
                    };
                } catch (err) {
                    console.error('SIWE verify network error', err);
                    return { ok: false as const, code: 'network-error' };
                }
            },
            persist: (stored: Stored) => {
                try {
                    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
                } catch {
                    /* best-effort */
                }
            },
        }, opts);
        return result.sessionId;
    }, [address, signMessageAsync, walletChainId]);

    const clearAppSession = useCallback(() => {
        try {
            localStorage.removeItem(STORAGE_KEY);
        } catch {
            /* best-effort */
        }
        guard.clear(address || '');
    }, [address]);

    /**
     * Cached session only — **never** opens a wallet popup.
     * Background pollers (presence, inbox poll, notifications) must use this.
     * `ensureAppSession` is for explicit user gestures only (click send / match).
     */
    const peekAppSession = useCallback((): string | null => {
        return guard.getSnapshot(address).sessionId;
    }, [address]);

    return {
        sessionId,
        ready,
        ensureAppSession,
        peekAppSession,
        clearAppSession,
        verifyFailed: snap.verifyFailed,
        lastError: snap.lastError,
    };
}
