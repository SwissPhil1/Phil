"use client";

import { useState, useMemo, useCallback } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api, type Trade, type Politician } from "@/lib/api";
import { useWatchlist, useApiData } from "@/lib/hooks";
import { useMultiApiData } from "@/lib/hooks";
import { ErrorState, RefreshIndicator } from "@/components/error-state";
import {
  Eye,
  Plus,
  Trash2,
  Search,
  ArrowUpRight,
  ArrowDownRight,
  Star,
  User,
  Hash,
} from "lucide-react";

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

export default function WatchlistPage() {
  const { items, politicians: watchedPoliticians, tickers: watchedTickers, add, remove, isWatched } = useWatchlist();
  const [addMode, setAddMode] = useState<"politician" | "ticker" | null>(null);
  const [search, setSearch] = useState("");

  // Fetch data for watched items
  const { data, loading, errors, hasError, retry, refreshIn } = useMultiApiData<{
    politicians: Politician[];
    trades: Trade[];
  }>(
    {
      politicians: () => api.getPoliticians({ limit: "200" }),
      trades: () => api.getRecentTrades(),
    },
    { refreshInterval: 60 }
  );

  // Server-side search for politician add panel
  const searchActive = addMode === "politician" && search.trim().length >= 2;
  const { data: searchPoliticians } = useApiData<Politician[]>(
    () => api.getPoliticians({ search: search.trim(), limit: "50" }),
    { enabled: searchActive, deps: [search] }
  );

  const basePoliticians = data.politicians ?? [];
  const allPoliticians = searchActive && searchPoliticians ? searchPoliticians : basePoliticians;
  const allTrades = data.trades ?? [];

  // Filter trades for watched politicians and tickers
  const watchedPoliticianNames = watchedPoliticians.map((p) => p.value.toLowerCase());
  const watchedTickerNames = watchedTickers.map((t) => t.value.toUpperCase());

  const relevantTrades = useMemo(() => {
    if (items.length === 0) return [];
    return allTrades.filter(
      (t) =>
        watchedPoliticianNames.includes(t.politician?.toLowerCase()) ||
        watchedTickerNames.includes(t.ticker?.toUpperCase())
    );
  }, [allTrades, items, watchedPoliticianNames, watchedTickerNames]);

  // Politician details for watched ones
  const watchedPoliticianDetails = useMemo(() => {
    return allPoliticians.filter((p) =>
      watchedPoliticianNames.includes(p.name.toLowerCase())
    );
  }, [allPoliticians, watchedPoliticianNames]);

  // Search results for adding
  const searchResults = useMemo(() => {
    if (!search.trim()) return [];
    const q = search.toLowerCase();
    if (addMode === "politician") {
      return allPoliticians
        .filter((p) => p.name.toLowerCase().includes(q))
        .slice(0, 10);
    }
    if (addMode === "ticker") {
      // Get unique tickers from trades
      const tickers = new Set(allTrades.map((t) => t.ticker).filter(Boolean));
      return Array.from(tickers)
        .filter((t) => t.toLowerCase().includes(q))
        .slice(0, 10)
        .map((t) => ({ ticker: t }));
    }
    return [];
  }, [search, addMode, allPoliticians, allTrades]);

  const handleAdd = useCallback(
    (type: "politician" | "ticker", value: string) => {
      add(type, value);
      setSearch("");
      setAddMode(null);
    },
    [add]
  );

  const isEmpty = items.length === 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Eye className="w-6 h-6" />
            Watchlist
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Track your favorite politicians and tickers — saved locally on your browser
          </p>
        </div>
        <div className="flex items-center gap-2">
          <RefreshIndicator refreshIn={refreshIn} />
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setAddMode(addMode ? null : "politician");
              setSearch("");
            }}
            className="gap-1.5"
          >
            <Plus className="w-4 h-4" />
            Add
          </Button>
        </div>
      </div>

      {/* Add Panel */}
      {addMode && (
        <Card className="border-primary/30">
          <CardContent className="p-4 space-y-3">
            <div className="flex gap-2">
              <button
                onClick={() => { setAddMode("politician"); setSearch(""); }}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  addMode === "politician"
                    ? "bg-blue-500/20 text-blue-400 border border-blue-500/30"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted border border-transparent"
                }`}
              >
                <User className="w-3 h-3 inline mr-1" />
                Politician
              </button>
              <button
                onClick={() => { setAddMode("ticker"); setSearch(""); }}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  addMode === "ticker"
                    ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted border border-transparent"
                }`}
              >
                <Hash className="w-3 h-3 inline mr-1" />
                Ticker
              </button>
            </div>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="text"
                placeholder={addMode === "politician" ? "Search politicians..." : "Search tickers (e.g. NVDA)..."}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                autoFocus
                className="w-full pl-10 pr-4 py-2 bg-muted/30 border border-border rounded-lg text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
              />
            </div>
            {search.trim() && (
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {addMode === "politician" &&
                  (searchResults as Politician[]).map((p) => (
                    <button
                      key={p.name}
                      onClick={() => handleAdd("politician", p.name)}
                      disabled={isWatched("politician", p.name)}
                      className="w-full flex items-center justify-between p-2 rounded-md hover:bg-muted/50 transition-colors disabled:opacity-50"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-sm">{p.name}</span>
                        {p.party && (
                          <Badge variant="outline" className={`text-[9px] px-1 ${
                            p.party === "R" ? "text-red-400 border-red-500/20" :
                            p.party === "D" ? "text-blue-400 border-blue-500/20" : ""
                          }`}>{p.party}</Badge>
                        )}
                      </div>
                      {isWatched("politician", p.name) ? (
                        <span className="text-[10px] text-muted-foreground">Added</span>
                      ) : (
                        <Plus className="w-4 h-4 text-muted-foreground" />
                      )}
                    </button>
                  ))}
                {addMode === "ticker" &&
                  (searchResults as { ticker: string }[]).map((t) => (
                    <button
                      key={t.ticker}
                      onClick={() => handleAdd("ticker", t.ticker)}
                      disabled={isWatched("ticker", t.ticker)}
                      className="w-full flex items-center justify-between p-2 rounded-md hover:bg-muted/50 transition-colors disabled:opacity-50"
                    >
                      <span className="font-mono-data text-sm font-medium">{t.ticker}</span>
                      {isWatched("ticker", t.ticker) ? (
                        <span className="text-[10px] text-muted-foreground">Added</span>
                      ) : (
                        <Plus className="w-4 h-4 text-muted-foreground" />
                      )}
                    </button>
                  ))}
                {searchResults.length === 0 && (
                  <div className="text-sm text-muted-foreground py-2 text-center">
                    {addMode === "ticker" ? (
                      <button
                        onClick={() => handleAdd("ticker", search.toUpperCase().trim())}
                        className="text-primary hover:underline"
                      >
                        Add &quot;{search.toUpperCase().trim()}&quot; to watchlist
                      </button>
                    ) : (
                      "No results found"
                    )}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Error banner */}
      {hasError && (
        <ErrorState
          error={Object.values(errors).filter(Boolean).join("; ") || "Failed to load data"}
          onRetry={retry}
          compact
        />
      )}

      {loading && isEmpty ? (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-lg" />)}
        </div>
      ) : isEmpty ? (
        <Card>
          <CardContent className="py-16 text-center">
            <Star className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
            <div className="font-medium mb-1">Your watchlist is empty</div>
            <p className="text-sm text-muted-foreground max-w-sm mx-auto mb-4">
              Add politicians or tickers to track their trades in one place.
              Your watchlist is saved locally in your browser.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setAddMode("politician")}
              className="gap-1.5"
            >
              <Plus className="w-4 h-4" />
              Add your first item
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {/* Watched Items Tags */}
          <div className="flex flex-wrap gap-2">
            {items.map((item) => (
              <div
                key={`${item.type}-${item.value}`}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border ${
                  item.type === "politician"
                    ? "bg-blue-500/5 border-blue-500/20"
                    : "bg-emerald-500/5 border-emerald-500/20"
                }`}
              >
                {item.type === "politician" ? (
                  <User className="w-3 h-3 text-blue-400" />
                ) : (
                  <Hash className="w-3 h-3 text-emerald-400" />
                )}
                <span className="text-sm font-medium">
                  {item.type === "ticker" ? item.value.toUpperCase() : item.value}
                </span>
                <button
                  onClick={() => remove(item.type, item.value)}
                  className="text-muted-foreground hover:text-red-400 transition-colors"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>

          {/* Watched Politicians Stats */}
          {watchedPoliticianDetails.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Watched Politicians</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {watchedPoliticianDetails.map((p) => (
                    <div key={p.name} className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/30 transition-colors">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <Link
                            href={`/politician/${encodeURIComponent(p.name)}`}
                            className="font-medium text-sm hover:underline hover:text-primary"
                          >
                            {p.name}
                          </Link>
                          {p.party && (
                            <Badge variant="outline" className={`text-[9px] px-1 ${
                              p.party === "R" ? "text-red-400 border-red-500/20" :
                              p.party === "D" ? "text-blue-400 border-blue-500/20" : ""
                            }`}>{p.party}</Badge>
                          )}
                        </div>
                        <div className="text-[10px] text-muted-foreground mt-0.5">
                          {p.total_trades} trades
                          {p.portfolio_cagr != null && ` · CAGR ${p.portfolio_cagr > 0 ? "+" : ""}${p.portfolio_cagr}%`}
                          {p.win_rate != null && ` · ${p.win_rate.toFixed(0)}% win`}
                        </div>
                      </div>
                      {p.portfolio_cagr != null && (
                        <div className={`font-mono text-sm font-bold ${p.portfolio_cagr >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                          {p.portfolio_cagr > 0 ? "+" : ""}{p.portfolio_cagr}%
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Relevant Trades Feed */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Recent Activity for Your Watchlist
              </CardTitle>
            </CardHeader>
            <CardContent>
              {relevantTrades.length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  No recent trades matching your watchlist items.
                </div>
              ) : (
                <div className="space-y-2">
                  {relevantTrades.slice(0, 20).map((trade, i) => (
                    <div key={i} className="flex items-center gap-3 py-2 border-b border-border/30 last:border-0">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                        trade.tx_type === "purchase" ? "bg-green-500/10" : "bg-red-500/10"
                      }`}>
                        {trade.tx_type === "purchase" ? (
                          <ArrowUpRight className="w-3.5 h-3.5 text-green-400" />
                        ) : (
                          <ArrowDownRight className="w-3.5 h-3.5 text-red-400" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <Link
                            href={`/politician/${encodeURIComponent(trade.politician)}`}
                            className="font-medium text-sm truncate hover:underline hover:text-primary"
                          >
                            {trade.politician}
                          </Link>
                          <span className="font-mono-data text-xs font-medium">{trade.ticker}</span>
                        </div>
                        <div className="text-[10px] text-muted-foreground mt-0.5">
                          {trade.tx_type === "purchase" ? "Bought" : "Sold"}
                          {trade.amount_low && trade.amount_high && ` · ${formatAmount(trade.amount_low, trade.amount_high)}`}
                        </div>
                      </div>
                      <div className="text-xs text-muted-foreground shrink-0">
                        {timeAgo(trade.disclosure_date || trade.tx_date)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
