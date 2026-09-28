/* R5 — minimal service worker: cache shell + push display. VAPID remote push later. */
const CACHE = "ludo-wallet-v1";

self.addEventListener("install", (event) => {
    self.skipWaiting();
    event.waitUntil(caches.open(CACHE).then((c) => c.addAll(["/", "/ludo-base-logo.svg"]).catch(() => undefined)));
});

self.addEventListener("activate", (event) => {
    event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
    let data = { title: "Ludo Base", body: "" };
    try {
        if (event.data) data = { ...data, ...event.data.json() };
    } catch {
        if (event.data) data.body = event.data.text();
    }
    event.waitUntil(
        self.registration.showNotification(data.title, {
            body: data.body,
            icon: "/ludo-base-logo.svg",
        }),
    );
});

self.addEventListener("notificationclick", (event) => {
    event.notification.close();
    event.waitUntil(self.clients.openWindow("/"));
});
