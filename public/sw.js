/* R5 — service worker: shell cache + Web Push display (VAPID remote push). */
const CACHE = "ludo-wallet-v1";

self.addEventListener("install", (event) => {
    self.skipWaiting();
    event.waitUntil(caches.open(CACHE).then((c) => c.addAll(["/", "/ludo-base-logo.svg"]).catch(() => undefined)));
});

self.addEventListener("activate", (event) => {
    event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
    let data = { title: "Ludo Base", body: "", url: "/", tag: undefined };
    try {
        if (event.data) data = { ...data, ...event.data.json() };
    } catch {
        if (event.data) data.body = event.data.text();
    }
    event.waitUntil(
        self.registration.showNotification(data.title, {
            body: data.body,
            icon: "/ludo-base-logo.svg",
            tag: data.tag,
            data: { url: data.url || "/" },
        }),
    );
});

self.addEventListener("notificationclick", (event) => {
    event.notification.close();
    const url = (event.notification.data && event.notification.data.url) || "/";
    event.waitUntil(
        (async () => {
            const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
            for (const client of all) {
                if ("focus" in client) {
                    await client.focus();
                    if ("navigate" in client) await client.navigate(url);
                    return;
                }
            }
            await self.clients.openWindow(url);
        })(),
    );
});

// Browser may rotate the push endpoint; ask the page to re-register.
self.addEventListener("pushsubscriptionchange", (event) => {
    event.waitUntil(
        (async () => {
            const clientsList = await self.clients.matchAll({ type: "window" });
            for (const client of clientsList) {
                client.postMessage({ type: "pushsubscriptionchange" });
            }
        })(),
    );
});
