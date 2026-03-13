"use client";

import { useEffect } from "react";

/**
 * Unregisters any existing service workers and clears their caches.
 * The SW was causing blank pages and broken styling after deployments.
 * Offline data features (IndexedDB + offlineFetch) work without it.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      // Unregister ALL service workers
      navigator.serviceWorker.getRegistrations().then((registrations) => {
        for (const registration of registrations) {
          registration.unregister();
          console.log("[SW] Unregistered service worker");
        }
      });
      // Clear all SW caches
      if ("caches" in window) {
        caches.keys().then((keys) => {
          keys.forEach((key) => {
            caches.delete(key);
            console.log(`[SW] Deleted cache: ${key}`);
          });
        });
      }
    }
  }, []);

  return null;
}
