"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAccount, useSignMessage } from 'wagmi';
import { buildSiweMessage, APP_SESSION_TTL_MS } from '@/lib/sessionProof';

const STORAGE_KEY = 'ludo-siwe-session';

type Stored = { sessionId: string; wallet: string; expiresAt: string };

/**
 * SIWE app session for chat / profile / settings.
 * Sign once per wallet (or after expiry). Not used for match moves.
 */
export function useAppSession() {
    const { address } = useAccount();
    const { signMessageAsync } = useSignMessage();
    const [sessionId, setSessionId] = useState<string | null>(null);
    const [ready, setReady] = useState(false);
    const signingRef = useRef(false);

    useEffect(() => {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw || !address) {
                setSessionId(null);
                setReady(true);
                return;
            }
            const parsed = JSON.parse(raw) as Stored;
            if (
                parsed.wallet.toLowerCase() === address.toLowerCase() &&
                new Date(parsed.expiresAt).getTime() > Date.now()
            ) {
                setSessionId(parsed.sessionId);
            } else {
                localStorage.removeItem(STORAGE_KEY);
                setSessionId(null);
            }
        } catch {
            setSessionId(null);
        }
        setReady(true);
    }, [address]);

    /** Prompt SIWE if needed; returns sessionId or null. */
    const ensureAppSession = useCallback(async (): Promise<string | null> => {
        if (!address) return null;
        if (sessionId) return sessionId;
        if (signingRef.current) return null;
        signingRef.current = true;
        try {
            const domain = window.location.hostname;
            const issuedAt = new Date().toISOString();
            const expirationTime = new Date(Date.now() + APP_SESSION_TTL_MS).toISOString();
            const nonce = crypto.randomUUID();
            const message = buildSiweMessage({ domain, address, issuedAt, expirationTime, nonce });
            const signature = await signMessageAsync({ account: address as `0x${string}`, message });
            const res = await fetch('/api/siwe/verify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    domain, address, nonce, issuedAt, expirationTime, signature, message,
                }),
            });
            const data = await res.json();
            if (!res.ok || !data.sessionId) {
                console.error('SIWE verify failed', data);
                return null;
            }
            const stored: Stored = {
                sessionId: data.sessionId,
                wallet: address,
                expiresAt: data.expiresAt,
            };
            localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
            setSessionId(data.sessionId);
            return data.sessionId;
        } catch {
            return null;
        } finally {
            signingRef.current = false;
        }
    }, [address, sessionId, signMessageAsync]);

    const clearAppSession = useCallback(() => {
        localStorage.removeItem(STORAGE_KEY);
        setSessionId(null);
    }, []);

    return { sessionId, ready, ensureAppSession, clearAppSession };
}
