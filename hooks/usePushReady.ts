"use client";

/**
 * R5 — push readiness for tx / WC session (REAL_WALLET_PLAN).
 * v1: permission + local notification hook; VAPID/service worker later.
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

    /** Local toast-style notification (not remote push until VAPID). */
    const notify = useCallback((title: string, body: string) => {
        if (typeof Notification !== "undefined" && Notification.permission === "granted") {
            try {
                new Notification(title, { body, icon: "/ludo-base-logo.svg" });
            } catch {
                /* ignore */
            }
        }
    }, []);

    return { permission, error, requestPermission, notify };
}
