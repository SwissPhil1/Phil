"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { api, type Trade, type Signal, type CrossSourceSignal, type StatsResponse } from "@/lib/api";
import {
  Landmark,
  TrendingUp,
  Zap,
  Users,
  ArrowUpRight,
  ArrowDownRight,
  Clock,
  AlertTriangle,
} from "lucide-react";

function formatAmount(low: number, high: number) {
  const fmt = (n: number) => {
    if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
    return `$${n}`;
  };
  return `${fmt(low)} - ${fmt(high)}`;
}

function formatDate(dateStr: string) {
  if (!dateStr) return "-";
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function SignalBadge({ strength }: { strength: string }) {
  const colors: Record<string, string> = {
    VERY_HIGH: "bg-red-500/20 text-red-400 border-red-500/30",
    HIGH: "bg-orange-500/20 text-orange-400 border-orange-500/30",
    MEDIUM: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
    LOW: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  };
  return (
    <Badge variant="outline" className={colors[strength] || colors.LOW}>
      {strength}
    </Badge>
  );
}

function PartyBadge({ party }: { party: string }) {
  if (party === "R") return <Badge variant="outline" className="bg-red-500/10 text-red-400 border-red-500/20 text-[10px] px-1.5">R</Badge>;
  if (party === "D") return <Badge variant="outline" className="bg-blue-500/10 text-blue-400 border-blue-500/20 text-[10px] px-1.5">D</Badge>;
  return <Badge variant="outline" className="text-[10px] px-1.5">{party}</Badge>;
}

function ReturnDisplay({ value }: { value: number | null }) {
  if (value === null || value === undefined) return <span className="text-muted-foreground text-xs">-</span>;
  const isPositive = value >= 0;
  return (
    <span className={`font-mono-data font-medium text-sm ${isPositive ? "text-green-400" : "text-red-400"}`}>
      {isPositive ? "+" : ""}{value.toFixed(1)}%
    </span>
  );
}

export default function Dashboard() {
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [signals, setSignals] = useState<{
    clusters: Signal[];
    cross_source_signals: CrossSourceSignal[];
    total_high_signals: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const errors: string[] = [];
      try {
        const [statsData, tradesData, signalsData] = await Promise.allSettled([
          api.getStats(),
          api.getRecentTrades(),
          api.getSignals(),
        ]);
        if (statsData.status === "fulfilled") {
          setStats(statsData.value);
        } else {
          errors.push(`Stats: ${statsData.reason}`);
        }
        if (tradesData.status === "fulfilled") {
          setTrades(tradesData.value);
        } else {
          errors.push(`Trades: ${tradesData.reason}`);
        }
        if (signalsData.status === "fulfilled") {
          setSignals(signalsData.value);
        } else {
          errors.push(`Signals: ${signalsData.reason}`);
        }
        if (errors.length > 0) {
          setError(errors.join(" | "));
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load data");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-muted-foreground text-sm mt-1">Loading market intelligence...</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <Card key={i}><CardContent className="p-6"><Skeleton className="h-16 w-full" /></CardContent></Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Real-time intelligence from Congress, hedge funds, insiders, and prediction markets
        </p>
      </div>

      {error && (
        <Card className="border-destructive/50">
          <CardContent className="p-4 space-y-1">
            <div className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="w-4 h-4" />
              <span className="text-sm font-medium">API Error</span>
            </div>
            <p className="text-xs text-destructive/80 break-all">{error}</p>
            <p className="text-xs text-muted-foreground">API: {process.env.NEXT_PUBLIC_API_URL || "(proxied via /api)"}</p>
          </CardContent>
        </Card>
      )}

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="text-sm text-muted-foreground">Total Trades</div>
              <Landmark className="w-4 h-4 text-muted-foreground" />
            </div>
            <div className="text-2xl font-bold font-mono-data mt-1">
              {stats?.total_trades?.toLocaleString() || "-"}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              From {stats?.total_politicians || 0} politicians
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="text-sm text-muted-foreground">Active Signals</div>
              <Zap className="w-4 h-4 text-yellow-400" />
            </div>
            <div className="text-2xl font-bold font-mono-data mt-1 text-yellow-400">
              {signals?.total_high_signals || 0}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              High-conviction alerts
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="text-sm text-muted-foreground">Trade Clusters</div>
              <Users className="w-4 h-4 text-muted-foreground" />
            </div>
            <div className="text-2xl font-bold font-mono-data mt-1">
              {signals?.clusters?.length || 0}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              Multiple politicians same stock
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="text-sm text-muted-foreground">Cross-Source</div>
              <TrendingUp className="w-4 h-4 text-green-400" />
            </div>
            <div className="text-2xl font-bold font-mono-data mt-1 text-green-400">
              {signals?.cross_source_signals?.length || 0}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              Congress + insiders + funds
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Latest Trades */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="w-4 h-4" />
              Latest Congressional Trades
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1">
              {trades.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">
                  No trades loaded yet. Data is being ingested...
                </p>
              ) : (
                trades.slice(0, 12).map((trade, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between py-2 border-b border-border/50 last:border-0"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className={`w-7 h-7 rounded flex items-center justify-center shrink-0 ${
                          trade.tx_type === "purchase"
                            ? "bg-green-500/10"
                            : "bg-red-500/10"
                        }`}
                      >
                        {trade.tx_type === "purchase" ? (
                          <ArrowUpRight className="w-3.5 h-3.5 text-green-400" />
                        ) : (
                          <ArrowDownRight className="w-3.5 h-3.5 text-red-400" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-medium truncate max-w-[180px]">
                            {trade.politician}
                          </span>
                          <PartyBadge party={trade.party} />
                        </div>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span className="font-mono-data font-medium text-foreground">
                            {trade.ticker}
                          </span>
                          <span>{formatDate(trade.tx_date)}</span>
                          {trade.amount_low && trade.amount_high && (
                            <span>{formatAmount(trade.amount_low, trade.amount_high)}</span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="text-right shrink-0 ml-2">
                      <ReturnDisplay value={trade.return_since_disclosure} />
                    </div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>

        {/* Smart Signals Sidebar */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Zap className="w-4 h-4 text-yellow-400" />
              Smart Signals
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {signals?.clusters?.slice(0, 3).map((cluster, i) => (
                <div key={`cl-${i}`} className="p-3 rounded-lg bg-muted/50 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="font-mono-data font-bold text-sm">{cluster.ticker}</span>
                    <SignalBadge strength={cluster.signal_strength} />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {cluster.politician_count} politicians {cluster.action.toLowerCase()} in {cluster.window_days}d
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {cluster.politicians.slice(0, 3).map((p) => (
                      <span key={p} className="text-[10px] bg-secondary px-1.5 py-0.5 rounded">
                        {p.split(" ").pop()}
                      </span>
                    ))}
                    {cluster.politicians.length > 3 && (
                      <span className="text-[10px] text-muted-foreground">
                        +{cluster.politicians.length - 3}
                      </span>
                    )}
                  </div>
                </div>
              ))}

              {signals?.cross_source_signals?.slice(0, 3).map((signal, i) => (
                <div key={`cs-${i}`} className="p-3 rounded-lg bg-muted/50 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="font-mono-data font-bold text-sm">{signal.ticker}</span>
                    <SignalBadge strength={signal.signal_strength} />
                  </div>
                  <p className="text-xs text-muted-foreground">{signal.description}</p>
                </div>
              ))}

              {(!signals?.clusters?.length && !signals?.cross_source_signals?.length) && (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  No active signals. Data ingestion in progress...
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Top Traded Tickers */}
      {stats?.top_traded_tickers && stats.top_traded_tickers.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="w-4 h-4" />
              Most Traded by Politicians
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {stats.top_traded_tickers.slice(0, 20).map((t) => (
                <div
                  key={t.ticker}
                  className="px-3 py-1.5 rounded-lg bg-muted/50 flex items-center gap-2"
                >
                  <span className="font-mono-data font-medium text-sm">{t.ticker}</span>
                  <span className="text-xs text-muted-foreground">{t.count}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
