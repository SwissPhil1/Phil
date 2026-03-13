// RadioRevise Service Worker — Offline Support
// Strategy: network-first everywhere. Only serve from cache when offline.
const CACHE_NAME = "radiorevise-v3";

// Install: activate immediately, no pre-caching
// (pages are cached during offline download via useOfflineDownload)
self.addEventListener("install", () => {
  self.skipWaiting();
});

// Activate: clean old caches, claim clients
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
  self.clients.claim();
});

// Fetch: network-first for everything, cache fallback only when offline
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Skip non-GET requests
  if (event.request.method !== "GET") return;

  // Skip API requests — handled by offlineFetch + IndexedDB in the app
  if (url.pathname.startsWith("/api/")) return;

  // Navigation requests (page loads / full refreshes)
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          // Cache successful responses for offline use
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          return response;
        })
        .catch(() => {
          // Offline: try exact match, then try a cached chapter page for dynamic routes
          return caches.match(event.request).then((cached) => {
            if (cached) return cached;
            if (url.pathname.match(/^\/chapters\/\d+/)) {
              return findAnyCachedChapter().then((ch) => ch || caches.match("/"));
            }
            return caches.match("/");
          });
        })
    );
    return;
  }

  // RSC / client-side navigation requests for chapter detail pages
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
            // Reuse ANY cached chapter RSC response (client component handles data)
            return findAnyCachedChapter(event.request.headers.get("RSC"));
          });
        })
    );
    return;
  }

  // All other assets (_next/static, images, etc): network-first with cache fallback
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

// Helper: find any cached /chapters/:id response
function findAnyCachedChapter(rscHeader) {
  return caches.open(CACHE_NAME).then((cache) =>
    cache.keys().then((keys) => {
      const match = keys.find((k) => {
        const u = new URL(k.url);
        if (!u.pathname.match(/^\/chapters\/\d+$/)) return false;
        // Match RSC vs non-RSC requests
        if (rscHeader !== undefined) {
          return k.headers.get("RSC") === rscHeader;
        }
        return true;
      });
      return match ? cache.match(match) : undefined;
    })
  );
}
