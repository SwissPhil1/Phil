"use client";

import { useState, useEffect, useCallback, useRef } from "react";

// ─── useApiData: fetcher with loading, error, retry, and auto-refresh ───

interface UseApiDataOptions {
  /** Auto-refresh interval in seconds. 0 = disabled. */
  refreshInterval?: number;
  /** Whether to fetch on mount. Default true. */
  enabled?: boolean;
  /** Re-fetch when these values change (serialized with JSON.stringify). */
  deps?: unknown[];
}

interface UseApiDataResult<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  retry: () => void;
  /** Seconds until next auto-refresh, null if disabled */
  refreshIn: number | null;
}

export function useApiData<T>(
  fetcher: () => Promise<T>,
  options: UseApiDataOptions = {}
): UseApiDataResult<T> {
  const { refreshInterval = 0, enabled = true } = options;
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshIn, setRefreshIn] = useState<number | null>(null);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const mountedRef = useRef(true);

  const load = useCallback(async (isRetry = false) => {
    if (!isRetry && data !== null) {
      // silent refresh - don't show loading spinner
    } else {
      setLoading(true);
    }
    setError(null);
    try {
      const result = await fetcherRef.current();
      if (mountedRef.current) {
        setData(result);
        setLoading(false);
      }
    } catch (e) {
      if (mountedRef.current) {
        const msg =
          e instanceof Error ? e.message : "Failed to load data";
        setError(msg);
        setLoading(false);
      }
    }
  }, [data]);

  // Serialized deps key for triggering re-fetches
  const depsKey = options.deps ? JSON.stringify(options.deps) : "";

  // Initial fetch + re-fetch when deps change
  useEffect(() => {
    mountedRef.current = true;
    if (enabled) {
      load(true);
    }
    return () => {
      mountedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, depsKey]);

  // Auto-refresh
  useEffect(() => {
    if (refreshInterval <= 0 || !enabled) {
      setRefreshIn(null);
      return;
    }

    let countdown = refreshInterval;
    setRefreshIn(countdown);

    const tick = setInterval(() => {
      countdown -= 1;
      if (countdown <= 0) {
        load(false);
        countdown = refreshInterval;
      }
      setRefreshIn(countdown);
    }, 1000);

    return () => clearInterval(tick);
  }, [refreshInterval, enabled, load]);

  const retry = useCallback(() => load(true), [load]);

  return { data, loading, error, retry, refreshIn };
}

// ─── useMultiApiData: fetch multiple APIs with shared loading/error ───

type FetcherMap<T> = { [K in keyof T]: () => Promise<T[K]> };

interface UseMultiApiDataResult<T> {
  data: { [K in keyof T]: T[K] | null };
  loading: boolean;
  errors: { [K in keyof T]?: string };
  hasError: boolean;
  retry: () => void;
  refreshIn: number | null;
}

export function useMultiApiData<T extends Record<string, unknown>>(
  fetchers: FetcherMap<T>,
  options: UseApiDataOptions = {}
): UseMultiApiDataResult<T> {
  const { refreshInterval = 0, enabled = true } = options;
  const keys = Object.keys(fetchers) as (keyof T)[];
  const [data, setData] = useState<{ [K in keyof T]: T[K] | null }>(
    () => {
      const init = {} as { [K in keyof T]: T[K] | null };
      for (const k of keys) init[k] = null;
      return init;
    }
  );
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<{ [K in keyof T]?: string }>({});
  const [refreshIn, setRefreshIn] = useState<number | null>(null);
  const fetchersRef = useRef(fetchers);
  fetchersRef.current = fetchers;
  const mountedRef = useRef(true);

  const load = useCallback(
    async (showLoading = true) => {
      if (showLoading) setLoading(true);
      const currentKeys = Object.keys(fetchersRef.current) as (keyof T)[];
      const results = await Promise.allSettled(
        currentKeys.map((k) => fetchersRef.current[k]())
      );

      if (!mountedRef.current) return;

      const newData = { ...data };
      const newErrors: { [K in keyof T]?: string } = {};

      results.forEach((result, i) => {
        const key = currentKeys[i];
        if (result.status === "fulfilled") {
          (newData as Record<string, unknown>)[key as string] = result.value;
        } else {
          newErrors[key] = result.reason?.message || "Failed to load";
        }
      });

      setData(newData as { [K in keyof T]: T[K] | null });
      setErrors(newErrors);
      setLoading(false);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  useEffect(() => {
    mountedRef.current = true;
    if (enabled) load(true);
    return () => {
      mountedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  useEffect(() => {
    if (refreshInterval <= 0 || !enabled) {
      setRefreshIn(null);
      return;
    }
    let countdown = refreshInterval;
    setRefreshIn(countdown);
    const tick = setInterval(() => {
      countdown -= 1;
      if (countdown <= 0) {
        load(false);
        countdown = refreshInterval;
      }
      setRefreshIn(countdown);
    }, 1000);
    return () => clearInterval(tick);
  }, [refreshInterval, enabled, load]);

  const retry = useCallback(() => load(true), [load]);
  const hasError = Object.keys(errors).length > 0;

  return { data, loading, errors, hasError, retry, refreshIn };
}

