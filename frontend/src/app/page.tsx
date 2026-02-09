"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { api, type Trade, type StatsResponse, type HedgeFund } from "@/lib/api";
import {
  Landmark,
  TrendingUp,
  Target,
  BarChart3,
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
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [funds, setFunds] = useState<HedgeFund[]>([]);
  const [trumpInsiders, setTrumpInsiders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const [s, t, f, tr] = await Promise.allSettled([
        api.getStats(),
        api.getRecentTrades(),
        api.getHedgeFunds(),
        api.getTrumpInsiders(),
      ]);
      if (s.status === "fulfilled") setStats(s.value);
      if (t.status === "fulfilled") setTrades(t.value);
      if (f.status === "fulfilled") setFunds(Array.isArray(f.value) ? f.value : []);
      if (tr.status === "fulfilled") setTrumpInsiders(Array.isArray(tr.value) ? tr.value : []);
      setLoading(false);
    }
    load();
  }, []);

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

  const totalFundValue = funds.reduce((sum, f) => sum + (f.total_value || 0), 0);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">SmartFlow</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Copy the smartest money — Congress, hedge funds, and Trump&apos;s inner circle
        </p>
      </div>

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
                {stats?.total_trades?.toLocaleString() || "28,000+"}
              </div>
              <div className="text-xs text-muted-foreground mt-1">Congressional trades</div>
            </CardContent>
          </Card>
        </Link>

        <Link href="/hedge-funds">
          <Card className="hover:border-primary/30 transition-colors cursor-pointer group">
            <CardContent className="p-5">
              <div className="flex items-center justify-between mb-3">
                <TrendingUp className="w-5 h-5 text-green-400" />
                <ChevronRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
              <div className="text-2xl font-bold font-mono-data">
                {funds.length || 14}
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                Hedge funds &middot; ${(totalFundValue / 1e12).toFixed(1)}T AUM
              </div>
            </CardContent>
          </Card>
        </Link>

        <Link href="/trump">
          <Card className="hover:border-primary/30 transition-colors cursor-pointer group">
            <CardContent className="p-5">
              <div className="flex items-center justify-between mb-3">
                <Target className="w-5 h-5 text-purple-400" />
                <ChevronRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
              <div className="text-2xl font-bold font-mono-data">
                {trumpInsiders.length || 18}
              </div>
              <div className="text-xs text-muted-foreground mt-1">Trump inner circle tracked</div>
            </CardContent>
          </Card>
        </Link>

        <Link href="/prediction-markets">
          <Card className="hover:border-primary/30 transition-colors cursor-pointer group">
            <CardContent className="p-5">
              <div className="flex items-center justify-between mb-3">
                <BarChart3 className="w-5 h-5 text-orange-400" />
                <ChevronRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
              <div className="text-2xl font-bold font-mono-data">50</div>
              <div className="text-xs text-muted-foreground mt-1">Polymarket top traders</div>
            </CardContent>
          </Card>
        </Link>
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
            trades.slice(0, 8).map((trade, i) => (
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

        {/* Right sidebar */}
        <div className="space-y-6">
          {/* Top Hedge Funds */}
          {funds.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Top Funds</h2>
                <Link href="/hedge-funds" className="text-xs text-primary hover:underline">View all</Link>
              </div>
              {funds.slice(0, 5).map((fund, i) => (
                <Card key={i} className="hover:border-border/80 transition-colors">
                  <CardContent className="p-3">
                    <div className="font-medium text-sm">{fund.manager_name}</div>
                    <div className="text-xs text-muted-foreground">{fund.name}</div>
                    <div className="flex items-center gap-4 mt-2">
                      <span className="text-xs">
                        <span className="text-muted-foreground">AUM </span>
                        <span className="font-mono-data font-medium">
                          {fund.total_value ? `$${(fund.total_value / 1e9).toFixed(1)}B` : "-"}
                        </span>
                      </span>
                      <span className="text-xs">
                        <span className="text-muted-foreground">Holdings </span>
                        <span className="font-mono-data font-medium">{fund.num_holdings || "-"}</span>
                      </span>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {/* Trump Circle Highlights */}
          {trumpInsiders.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Trump Circle</h2>
                <Link href="/trump" className="text-xs text-primary hover:underline">View all</Link>
              </div>
              {trumpInsiders.slice(0, 4).map((insider: any, i: number) => (
                <Card key={i} className="hover:border-border/80 transition-colors">
                  <CardContent className="p-3">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-sm">{insider.name}</span>
                      <Badge variant="outline" className="text-[10px] bg-purple-500/10 text-purple-400 border-purple-500/20">
                        {insider.category}
                      </Badge>
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">{insider.role}</div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {/* Most Traded */}
          {stats?.most_bought_tickers && stats.most_bought_tickers.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Most Bought</h2>
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
        </div>
      </div>
    </div>
  );
}
