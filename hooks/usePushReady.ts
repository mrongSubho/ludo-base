"use client";

/**
 * R5 — push readiness for tx / WC session (WALLET_PLAN).
 * Local Notification + service worker + VAPID remote push (app-session gated).
 */

import { useCallback, useState } from "react";

export type RemotePushStatus = "idle" | "subscribed" | "unsubscribed" | "error";

export function usePushReady() {
    const [permission, setPermission] = useState<NotificationPermission | "unsupported">(
        typeof Notification !== "undefined" ? Notification.permission : "unsupported",
    );
    const [error, setError] = useState<string | null>(null);
    const [remote, setRemote] = useState<RemotePushStatus>("idle");

    const requestPermission = useCallback(async () => {
        if (typeof Notification === "undefined") {
            setPermission("unsupported");
            return false;
        }
        try {
            const p = await Notification.requestPermission();
            setPermission(p);
            return p === "granted";
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
            return false;
        }
    }, []);

    const notify = useCallback((title: string, body: string) => {
        if (typeof Notification !== "undefined" && Notification.permission === "granted") {
            try {
                // Prefer SW registration so clicks open via the SW handler.
                if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
                    void navigator.serviceWorker.ready
                        .then((reg) => reg.showNotification(title, { body, icon: "/ludo-base-logo.svg" }))
                        .catch(() => {
                            new Notification(title, { body, icon: "/ludo-base-logo.svg" });
                        });
                } else {
                    new Notification(title, { body, icon: "/ludo-base-logo.svg" });
                }
            } catch {
                /* ignore */
            }
        }
    }, []);

    /** Register /sw.js (push display + shell cache). */
    const registerServiceWorker = useCallback(async () => {
        if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return false;
        try {
            await navigator.serviceWorker.register("/sw.js");
            return true;
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
            return false;
        }
    }, []);

    /**
     * Remote push (VAPID). Requires HTTPS + service worker + NEXT_PUBLIC_VAPID_PUBLIC_KEY.
     * Returns subscription JSON, or null. Does **not** POST — caller registers with
     * `/api/push/subscribe` using a peeked app session (no silent SIWE).
     */
    const subscribePush = useCallback(
        async (vapidPublicKey?: string): Promise<PushSubscriptionJSON | null> => {
            const key = vapidPublicKey || process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
            if (!key) {
                setError("NEXT_PUBLIC_VAPID_PUBLIC_KEY not set — local notify only");
                return null;
            }
            if (typeof Notification === "undefined" || Notification.permission !== "granted") {
                setError("Notification permission not granted");
                return null;
            }
            try {
                const reg = await navigator.serviceWorker.register("/sw.js");
                await navigator.serviceWorker.ready;
                const sub = await reg.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey: key,
                });
                return sub.toJSON();
            } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
                return null;
            }
        },
        [],
    );

    const unsubscribePush = useCallback(async (): Promise<boolean> => {
        if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return false;
        try {
            const reg = await navigator.serviceWorker.getRegistration("/sw.js");
            const sub = await reg?.pushManager.getSubscription();
            if (sub) await sub.unsubscribe();
            return true;
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
            return false;
        }
    }, []);

    /**
     * Enable remote push end-to-end: permission → SW → VAPID subscribe → POST to API.
     * `sessionId` must come from `peekAppSession` (or a prior user-gesture SIWE).
     */
    const enableRemotePush = useCallback(
        async (opts: {
            walletAddress: string;
            sessionId: string | null;
            vapidPublicKey?: string;
        }): Promise<{ ok: boolean; subscription: PushSubscriptionJSON | null }> => {
            setError(null);
            const granted = await requestPermission();
            if (!granted) {
                setRemote("error");
                return { ok: false, subscription: null };
            }
            await registerServiceWorker();
            const subscription = await subscribePush(opts.vapidPublicKey);
            if (!subscription?.endpoint) {
                setRemote("error");
                return { ok: false, subscription: null };
            }
            if (!opts.sessionId) {
                setError("Sign in once to save push subscription");
                setRemote("error");
                return { ok: false, subscription };
            }
            try {
                const res = await fetch("/api/push/subscribe", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        walletAddress: opts.walletAddress,
                        sessionId: opts.sessionId,
                        subscription,
                        action: "subscribe",
                    }),
                });
                if (!res.ok) {
                    const data = await res.json().catch(() => ({}));
                    setError(String(data.error || res.statusText));
                    setRemote("error");
                    return { ok: false, subscription };
                }
                setRemote("subscribed");
                return { ok: true, subscription };
            } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
                setRemote("error");
                return { ok: false, subscription };
            }
        },
        [registerServiceWorker, requestPermission, subscribePush],
    );

    /** Unsubscribe locally + drop server row (app-session gated). */
    const disableRemotePush = useCallback(
        async (opts: { walletAddress: string; sessionId: string | null }): Promise<boolean> => {
            let endpoint: string | null = null;
            try {
                const reg = await navigator.serviceWorker?.getRegistration("/sw.js");
                endpoint = (await reg?.pushManager.getSubscription())?.endpoint ?? null;
            } catch {
                /* ignore */
            }
            await unsubscribePush();
            if (opts.sessionId && endpoint) {
                try {
                    await fetch("/api/push/subscribe", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            walletAddress: opts.walletAddress,
                            sessionId: opts.sessionId,
                            endpoint,
                            action: "unsubscribe",
                        }),
                    });
                } catch {
                    /* local unsub already done */
                }
            }
            setRemote("unsubscribed");
            return true;
        },
        [unsubscribePush],
    );

    /** Test push to this wallet's saved subscriptions. */
    const sendTestPush = useCallback(
        async (opts: { walletAddress: string; sessionId: string | null }): Promise<string | null> => {
            if (!opts.sessionId) {
                setError("Sign in to send a test push");
                return "Sign in to send a test push";
            }
            try {
                const res = await fetch("/api/push/test", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ walletAddress: opts.walletAddress, sessionId: opts.sessionId }),
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) return String(data.error || res.statusText);
                return null;
            } catch (e) {
                return e instanceof Error ? e.message : String(e);
            }
        },
        [],
    );

    return {
        permission,
        error,
        remote,
        requestPermission,
        notify,
        registerServiceWorker,
        subscribePush,
        unsubscribePush,
        enableRemotePush,
        disableRemotePush,
        sendTestPush,
    };
}
