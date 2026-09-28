/**
 * R5 — server-side Web Push (VAPID). Real remote push, not just local Notification.
 * Keys: NEXT_PUBLIC_VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT.
 * Send helpers are for turn nudges, claim reminders, WC session events.
 */

import webpush from "web-push";
import { serviceDb } from "@/lib/serverAuth";

export type PushPayload = {
    title: string;
    body: string;
    /** Relative URL the SW opens on notificationclick (default "/"). */
    url?: string;
    tag?: string;
};

export type PushSubscriptionRow = {
    endpoint: string;
    p256dh: string;
    auth: string;
    wallet_address: string;
};

let vapidReady: "pending" | "ok" | "missing" = "pending";

function ensureVapid(): boolean {
    if (vapidReady === "ok") return true;
    if (vapidReady === "missing") return false;
    const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    const privateKey = process.env.VAPID_PRIVATE_KEY;
    const subject = process.env.VAPID_SUBJECT || "mailto:ops@ludo.base";
    if (!publicKey || !privateKey) {
        vapidReady = "missing";
        return false;
    }
    try {
        webpush.setVapidDetails(subject, publicKey, privateKey);
        vapidReady = "ok";
        return true;
    } catch {
        vapidReady = "missing";
        return false;
    }
}

export function pushConfigured(): boolean {
    return ensureVapid();
}

function isGone(status: number | undefined): boolean {
    return status === 404 || status === 410;
}

/** Send one payload to every live subscription for a wallet. Drops dead endpoints. */
export async function sendPushToWallet(walletAddress: string, payload: PushPayload): Promise<{ sent: number; dropped: number }> {
    const wallet = String(walletAddress || "").toLowerCase();
    if (!/^0x[a-f0-9]{40}$/.test(wallet) || !ensureVapid()) return { sent: 0, dropped: 0 };

    const { data, error } = await serviceDb()
        .from("push_subscriptions")
        .select("endpoint, p256dh, auth, wallet_address")
        .eq("wallet_address", wallet);
    if (error || !data?.length) return { sent: 0, dropped: 0 };

    const body = JSON.stringify({
        title: payload.title,
        body: payload.body,
        url: payload.url || "/",
        tag: payload.tag,
    });

    let sent = 0;
    const dead: string[] = [];
    await Promise.all(
        data.map(async (row: PushSubscriptionRow) => {
            try {
                const res = await webpush.sendNotification(
                    {
                        endpoint: row.endpoint,
                        keys: { p256dh: row.p256dh, auth: row.auth },
                    },
                    body,
                    { TTL: 3600, urgency: "normal" },
                );
                if (res.statusCode >= 200 && res.statusCode < 300) sent += 1;
                else if (isGone(res.statusCode)) dead.push(row.endpoint);
            } catch (e) {
                const status = (e as { statusCode?: number }).statusCode;
                if (isGone(status)) dead.push(row.endpoint);
            }
        }),
    );

    if (dead.length) {
        await serviceDb().from("push_subscriptions").delete().in("endpoint", dead);
    }
    return { sent, dropped: dead.length };
}

/** Drop one endpoint (unsubscribe / 410 cleanup). */
export async function dropPushSubscription(endpoint: string): Promise<void> {
    if (!endpoint) return;
    await serviceDb().from("push_subscriptions").delete().eq("endpoint", endpoint);
}

/** Upsert a browser PushSubscription for a wallet. */
export async function savePushSubscription(
    walletAddress: string,
    sub: { endpoint: string; keys?: { p256dh?: string; auth?: string } },
    userAgent?: string,
): Promise<{ ok: boolean; error?: string }> {
    const wallet = String(walletAddress || "").toLowerCase();
    const endpoint = String(sub?.endpoint || "");
    const p256dh = String(sub?.keys?.p256dh || "");
    const auth = String(sub?.keys?.auth || "");
    if (!/^0x[a-f0-9]{40}$/.test(wallet) || !endpoint || !p256dh || !auth) {
        return { ok: false, error: "Invalid subscription" };
    }
    const { error } = await serviceDb().from("push_subscriptions").upsert(
        {
            wallet_address: wallet,
            endpoint,
            p256dh,
            auth,
            user_agent: userAgent?.slice(0, 200) ?? null,
            last_used_at: new Date().toISOString(),
        },
        { onConflict: "endpoint" },
    );
    return error ? { ok: false, error: error.message } : { ok: true };
}
