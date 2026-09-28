"use client";

/**
 * R5 — push readiness for tx / WC session (REAL_WALLET_PLAN).
 * Local Notification + service worker + optional VAPID subscribe.
 */

import { useCallback, useState } from "react";

export function usePushReady() {
    const [permission, setPermission] = useState<NotificationPermission | "unsupported">(
        typeof Notification !== "undefined" ? Notification.permission : "unsupported",
    );
    const [error, setError] = useState<string | null>(null);

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
                new Notification(title, { body, icon: "/ludo-base-logo.svg" });
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
     * Remote push (VAPID). Requires HTTPS + service worker.
     * Returns subscription JSON to POST to your push backend, or null.
     */
    const subscribePush = useCallback(
        async (vapidPublicKey?: string): Promise<PushSubscriptionJSON | null> => {
            const key = vapidPublicKey || process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
            if (!key) {
                setError("NEXT_PUBLIC_VAPID_PUBLIC_KEY not set — local notify only");
                return null;
            }
            try {
                const reg = await navigator.serviceWorker.register("/sw.js");
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

    return {
        permission,
        error,
        requestPermission,
        notify,
        registerServiceWorker,
        subscribePush,
    };
}
