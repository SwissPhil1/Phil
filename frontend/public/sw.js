// RadioRevise Service Worker — Minimal offline cache
// Strategy: ALWAYS use network when available. Cache responses for offline fallback.
// No pre-caching. No install-time fetches. No complex routing.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  // Only handle GET requests
  if (event.request.method !== "GET") return;

  // Skip API calls — handled by IndexedDB via offlineFetch in the app
  const url = new URL(event.request.url);
  if (url.pathname.startsWith("/api/")) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Cache successful responses for offline use
        if (response.ok) {
          const clone = response.clone();
          caches.open("rv-offline").then((c) => c.put(event.request, clone));
        }
        return response;
      })
      .catch(() => {
        // Network failed — serve from cache if available
        return caches.match(event.request).then((cached) => cached || new Response("Offline", { status: 503 }));
      })
  );
});
