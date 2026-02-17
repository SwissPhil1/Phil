"use client";

import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { api, type Trade, type StatsResponse } from "@/lib/api";
import { useMultiApiData } from "@/lib/hooks";
import { ErrorState, RefreshIndicator } from "@/components/error-state";
import {
  Landmark,
  Users,
  Calendar,
  TrendingUp,
  ArrowUpRight,
  ArrowDownRight,
  ChevronRight,
  Info,
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
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

function formatAmount(low: number, high: number) {
  const fmt = (n: number) => {
    if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
    return `$${n}`;
  };
  return `${fmt(low)} – ${fmt(high)}`;
}

export default function Dashboard() {
  const { data, loading, errors, hasError, retry, refreshIn } = useMultiApiData<{
    stats: StatsResponse;
    trades: Trade[];
  }>(
    {
      stats: () => api.getStats(),
      trades: () => api.getRecentTrades(),
    },
    { refreshInterval: 60 }
  );

  const stats = data.stats;
  const trades = data.trades ?? [];

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">SmartFlow</h1>
          <p className="text-muted-foreground text-sm mt-1">Loading your intelligence feed...</p>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <Card key={i}><CardContent className="p-5"><Skeleton className="h-14 w-full" /></CardContent></Card>
          ))}
        </div>
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-20 w-full rounded-lg" />)}
        </div>
      </div>
    );
  }

  if (hasError && !stats && trades.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">SmartFlow</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Copy trading intelligence — Congressional STOCK Act trades
          </p>
        </div>
        <ErrorState
          error={Object.values(errors).filter(Boolean).join("; ") || "Failed to load data"}
          onRetry={retry}
        />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">SmartFlow</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Copy trading intelligence — Congressional STOCK Act trades
          </p>
        </div>
        <RefreshIndicator refreshIn={refreshIn} />
      </div>

      {/* Partial errors banner */}
      {hasError && (
        <ErrorState
          error={Object.values(errors).filter(Boolean).join("; ") || "Some data failed to load"}
          onRetry={retry}
          compact
        />
      )}

      {/* Hero Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Link href="/congress">
          <Card className="hover:border-primary/30 transition-colors cursor-pointer group">
            <CardContent className="p-5">
              <div className="flex items-center justify-between mb-3">
                <Landmark className="w-5 h-5 text-blue-400" />
                <ChevronRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
              <div className="text-2xl font-bold font-mono-data">
                {stats?.total_trades?.toLocaleString() || "—"}
              </div>
              <div className="text-xs text-muted-foreground mt-1">Total trades tracked</div>
            </CardContent>
          </Card>
        </Link>

        <Link href="/leaderboard">
          <Card className="hover:border-primary/30 transition-colors cursor-pointer group">
            <CardContent className="p-5">
              <div className="flex items-center justify-between mb-3">
                <Users className="w-5 h-5 text-green-400" />
                <ChevronRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
              <div className="text-2xl font-bold font-mono-data">
                {stats?.total_politicians?.toLocaleString() || "—"}
              </div>
              <div className="text-xs text-muted-foreground mt-1">Politicians tracked</div>
            </CardContent>
          </Card>
        </Link>

        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-3">
              <Calendar className="w-5 h-5 text-purple-400" />
            </div>
            <div className="text-2xl font-bold font-mono-data">
              {stats?.trades_last_7d?.toLocaleString() || "—"}
            </div>
            <div className="text-xs text-muted-foreground mt-1">Trades last 7 days</div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-3">
              <TrendingUp className="w-5 h-5 text-orange-400" />
            </div>
            <div className="text-2xl font-bold font-mono-data">
              {stats?.trades_last_30d?.toLocaleString() || "—"}
            </div>
            <div className="text-xs text-muted-foreground mt-1">Trades last 30 days</div>
          </CardContent>
        </Card>
      </div>

      {/* Filing delay notice */}
      <div className="flex items-start gap-3 p-4 rounded-lg bg-blue-500/5 border border-blue-500/10">
        <Info className="w-4 h-4 text-blue-400 mt-0.5 shrink-0" />
        <div className="text-sm text-muted-foreground">
          <span className="text-foreground font-medium">STOCK Act filing delay:</span>{" "}
          Members of Congress have up to 45 days to disclose trades. Most recent filings may reflect trades from several weeks ago.
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Trades Feed */}
        <div className="lg:col-span-2 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Recent Trades</h2>
            <Link href="/congress" className="text-xs text-primary hover:underline">View all</Link>
          </div>

          {trades.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground text-sm">
                Trade data loading...
              </CardContent>
            </Card>
          ) : (
            trades.slice(0, 10).map((trade, i) => (
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
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-xs text-muted-foreground">{timeAgo(trade.disclosure_date || trade.tx_date)}</div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>

        {/* Right sidebar - Most Traded */}
        <div className="space-y-6">
          {stats?.most_bought_tickers && stats.most_bought_tickers.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Most Bought (30d)</h2>
              <Card>
                <CardContent className="p-3">
                  <div className="flex flex-wrap gap-2">
                    {stats.most_bought_tickers.slice(0, 10).map((t) => (
                      <div key={t.ticker} className="flex items-center gap-1.5 bg-muted/50 rounded-md px-2.5 py-1.5">
                        <span className="font-mono-data text-xs font-medium">{t.ticker}</span>
                        <span className="text-[10px] text-muted-foreground">{t.count}</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {stats?.most_active_politicians && stats.most_active_politicians.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Most Active (30d)</h2>
              <Card>
                <CardContent className="p-3 space-y-2">
                  {stats.most_active_politicians.slice(0, 8).map((p: any, i: number) => (
                    <Link
                      key={i}
                      href={`/politician/${encodeURIComponent(p.politician)}`}
                      className="flex items-center justify-between py-1 hover:text-primary transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-sm">{p.politician}</span>
                        {p.party && (
                          <Badge variant="outline" className={`text-[10px] px-1.5 ${
                            p.party === "R" ? "bg-red-500/10 text-red-400 border-red-500/20" :
                            p.party === "D" ? "bg-blue-500/10 text-blue-400 border-blue-500/20" : ""
                          }`}>{p.party}</Badge>
                        )}
                      </div>
                      <span className="font-mono-data text-xs text-muted-foreground">{p.count} trades</span>
                    </Link>
                  ))}
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
