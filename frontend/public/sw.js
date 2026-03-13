// RadioRevise Service Worker — Offline Support
const CACHE_NAME = "radiorevise-v2";

// App shell pages to cache on install
const APP_SHELL = [
  "/",
  "/chapters",
  "/flashcards",
  "/review",
  "/quiz",
  "/analytics",
];

// Install: cache app shell
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Cache pages — don't fail install if some pages can't be cached
      return Promise.allSettled(
        APP_SHELL.map((url) =>
          cache.add(url).catch((err) => {
            console.warn(`[SW] Failed to cache ${url}:`, err);
          })
        )
      );
    })
  );
  // Activate immediately
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  // Claim all clients immediately
  self.clients.claim();
});

// Fetch strategy:
// - Navigation requests: network-first, fall back to cache
// - Static assets (_next/static): cache-first
// - API requests: network-only (data from IndexedDB when offline)
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Skip non-GET requests
  if (event.request.method !== "GET") return;

  // Skip API requests — handled by IndexedDB in the app
  if (url.pathname.startsWith("/api/")) return;

  // Static assets: cache-first
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/_next/image")) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  // Navigation: network-first, fall back to cache
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          // Cache the latest version
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          return response;
        })
        .catch(() => {
          // Offline: try exact cache match first
          return caches.match(event.request).then((cached) => {
            if (cached) return cached;
            // For dynamic routes like /chapters/123, try the parent route
            const path = url.pathname;
            if (path.match(/^\/chapters\/\d+/)) {
              return caches.match("/chapters").then((parent) => parent || caches.match("/"));
            }
            // Fall back to root page
            return caches.match("/");
          });
        })
    );
    return;
  }

  // Chapter detail routes (RSC payloads for client-side navigation)
  // Since /chapters/[id] is a client component, the RSC payload is the same
  // structure for all chapters — only the data differs (loaded from IndexedDB).
  // So we can reuse any cached chapter response for all chapter IDs.
  if (url.pathname.match(/^\/chapters\/\d+/)) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => {
          return caches.match(event.request).then((exact) => {
            if (exact) return exact;
            // Find ANY cached /chapters/:id response to reuse
            return caches.open(CACHE_NAME).then((cache) =>
              cache.keys().then((keys) => {
                const chapterKey = keys.find((k) => {
                  const u = new URL(k.url);
                  return u.pathname.match(/^\/chapters\/\d+$/) && k.headers.get("RSC") === event.request.headers.get("RSC");
                });
                if (chapterKey) return cache.match(chapterKey);
                return caches.match("/chapters").then((parent) => parent || caches.match("/"));
              })
            );
          });
        })
    );
    return;
  }

  // Other assets: network-first with cache fallback
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
