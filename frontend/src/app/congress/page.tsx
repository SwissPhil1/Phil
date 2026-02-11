"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState, RefreshIndicator } from "@/components/error-state";
import { api, type Trade } from "@/lib/api";
import { ArrowUpRight, ArrowDownRight, Info, Search, Loader2 } from "lucide-react";

const AUTO_REFRESH_SECONDS = 60;

function timeAgo(dateStr: string) {
  if (!dateStr) return "";
  const now = new Date();
  const d = new Date(dateStr);
  const diffMs = now.getTime() - d.getTime();
  const days = Math.floor(diffMs / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" });
}

function formatAmount(low: number, high: number) {
  const fmt = (n: number) => {
    if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
    return `$${n}`;
  };
  return `${fmt(low)} – ${fmt(high)}`;
}

export default function CongressPage() {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [refreshIn, setRefreshIn] = useState<number | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load recent trades — used for initial load, retry, and auto-refresh
  const loadTrades = useCallback(async (isAutoRefresh = false) => {
    if (!isAutoRefresh) {
      setLoading(true);
      setError(null);
    }
    try {
      const recent = await api.getRecentTrades();
      setTrades(Array.isArray(recent) ? recent : []);
      setError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load trades";
      setError(message);
      // On auto-refresh failure, keep stale data visible — only set error banner
    }
    if (!isAutoRefresh) {
      setLoading(false);
    }
  }, []);

  // Start the auto-refresh countdown (resets on each call)
  const startAutoRefresh = useCallback(() => {
    // Clear any existing timers
    if (refreshTimerRef.current) clearInterval(refreshTimerRef.current);
    if (countdownRef.current) clearInterval(countdownRef.current);

    let remaining = AUTO_REFRESH_SECONDS;
    setRefreshIn(remaining);

    countdownRef.current = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        setRefreshIn(AUTO_REFRESH_SECONDS);
        remaining = AUTO_REFRESH_SECONDS;
      } else {
        setRefreshIn(remaining);
      }
    }, 1000);

    refreshTimerRef.current = setInterval(() => {
      loadTrades(true);
    }, AUTO_REFRESH_SECONDS * 1000);
  }, [loadTrades]);

  // Stop auto-refresh (when the user is actively searching)
  const stopAutoRefresh = useCallback(() => {
    if (refreshTimerRef.current) {
      clearInterval(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
    setRefreshIn(null);
  }, []);

  // Initial load + auto-refresh setup
  useEffect(() => {
    loadTrades().then(() => startAutoRefresh());
    return () => {
      stopAutoRefresh();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Server-side search with debounce
  const doSearch = useCallback(async (query: string) => {
    setSearchError(null);

    if (!query.trim()) {
      // Empty search: go back to recent trades and restart auto-refresh
      setSearching(true);
      try {
        const recent = await api.getRecentTrades();
        setTrades(Array.isArray(recent) ? recent : []);
        setError(null);
        startAutoRefresh();
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to load trades";
        setError(message);
      }
      setSearching(false);
      return;
    }

    // Active search — pause auto-refresh
    stopAutoRefresh();
    setSearching(true);
    try {
      const results = await api.getTrades({
        search: query.trim(),
        days: "3650",
        page_size: "50",
      });
      setTrades(Array.isArray(results) ? results : []);
      setSearchError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Search failed";
      setSearchError(message);
    }
    setSearching(false);
  }, [startAutoRefresh, stopAutoRefresh]);

  const handleFilterChange = (value: string) => {
    setFilter(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(value), 400);
  };

  const handleRetryInitial = () => {
    setError(null);
    loadTrades().then(() => startAutoRefresh());
  };

  const handleRetrySearch = () => {
    doSearch(filter);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Congressional Trades</h1>
          <p className="text-muted-foreground text-sm mt-1">
            STOCK Act disclosures from House and Senate members
          </p>
        </div>
        {!filter.trim() && !loading && !error && (
          <RefreshIndicator refreshIn={refreshIn} />
        )}
      </div>

      {/* Filing delay info */}
      <div className="flex items-start gap-3 p-4 rounded-lg bg-blue-500/5 border border-blue-500/10">
        <Info className="w-4 h-4 text-blue-400 mt-0.5 shrink-0" />
        <div className="text-sm text-muted-foreground">
          Members of Congress have <span className="text-foreground font-medium">up to 45 days</span> to file disclosures under the STOCK Act.
          The most recent trades shown may reflect activity from several weeks ago.
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          type="text"
          placeholder="Search by politician or ticker..."
          value={filter}
          onChange={(e) => handleFilterChange(e.target.value)}
          className="w-full pl-10 pr-10 py-2.5 bg-muted/30 border border-border rounded-lg text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
        />
        {searching && (
          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground animate-spin" />
        )}
      </div>

      {/* Search error (compact inline banner) */}
      {searchError && (
        <ErrorState error={searchError} onRetry={handleRetrySearch} compact />
      )}

      {/* Stats bar */}
      {!loading && !error && trades.length > 0 && (
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span>{trades.length} trades{filter ? " found" : " loaded"}</span>
          <span>{new Set(trades.map(t => t.politician)).size} politicians</span>
          <span>{new Set(trades.map(t => t.ticker)).size} unique tickers</span>
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          {[...Array(8)].map((_, i) => <Skeleton key={i} className="h-20 w-full rounded-lg" />)}
        </div>
      ) : error && trades.length === 0 ? (
        // Full error state when there is no data to show
        <ErrorState error={error} onRetry={handleRetryInitial} />
      ) : (
        <>
          {/* Stale-data error banner — show if we have data but the latest refresh failed */}
          {error && trades.length > 0 && (
            <ErrorState error={error} onRetry={handleRetryInitial} compact />
          )}

          {trades.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground text-sm">
                {filter ? "No trades match your search." : "No trades loaded yet."}
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {trades.map((trade, i) => (
                <Card key={i} className="hover:border-border/80 transition-colors">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-3">
                      <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                        trade.tx_type === "purchase" ? "bg-green-500/10" : "bg-red-500/10"
                      }`}>
                        {trade.tx_type === "purchase" ? (
                          <ArrowUpRight className="w-4 h-4 text-green-400" />
                        ) : (
                          <ArrowDownRight className="w-4 h-4 text-red-400" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <Link href={`/politician/${encodeURIComponent(trade.politician)}`} className="font-medium text-sm truncate hover:underline hover:text-primary transition-colors">{trade.politician}</Link>
                          {trade.party && (
                            <Badge variant="outline" className={`text-[10px] px-1.5 shrink-0 ${
                              trade.party === "R" ? "bg-red-500/10 text-red-400 border-red-500/20" :
                              trade.party === "D" ? "bg-blue-500/10 text-blue-400 border-blue-500/20" : ""
                            }`}>{trade.party}</Badge>
                          )}
                          {trade.state && (
                            <span className="text-[10px] text-muted-foreground shrink-0">{trade.state}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="font-mono-data text-xs font-medium text-foreground">{trade.ticker}</span>
                          <span className="text-xs text-muted-foreground">
                            {trade.tx_type === "purchase" ? "Bought" : "Sold"}
                          </span>
                          {trade.amount_low && trade.amount_high && (
                            <span className="text-xs text-muted-foreground">
                              {formatAmount(trade.amount_low, trade.amount_high)}
                            </span>
                          )}
                          {trade.asset_description && trade.asset_description !== trade.ticker && (
                            <span className="text-xs text-muted-foreground truncate max-w-[200px]">
                              {trade.asset_description}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-xs text-muted-foreground">
                          {timeAgo(trade.disclosure_date || trade.tx_date)}
                        </div>
                        {trade.tx_date && (
                          <div className="text-[10px] text-muted-foreground/60 mt-0.5">
                            Traded {new Date(trade.tx_date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                          </div>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
