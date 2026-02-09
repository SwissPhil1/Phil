"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { api, type Trade, type Politician } from "@/lib/api";
import {
  ArrowLeft,
  ArrowUpRight,
  ArrowDownRight,
  Landmark,
  TrendingUp,
  ShoppingCart,
  Package,
  Calendar,
  Building2,
} from "lucide-react";

type PoliticianDetail = Politician & {
  recent_trades: Trade[];
  total_buys?: number;
  total_sells?: number;
};

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

export default function PoliticianPage() {
  const params = useParams();
  const name = decodeURIComponent(params.name as string);
  const [politician, setPolitician] = useState<PoliticianDetail | null>(null);
  const [committees, setCommittees] = useState<{ committee: string; subcommittee?: string }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const [pol, com] = await Promise.allSettled([
        api.getPolitician(name),
        api.getPoliticianCommittees(name),
      ]);
      if (pol.status === "fulfilled") setPolitician(pol.value as PoliticianDetail);
      if (com.status === "fulfilled") setCommittees(Array.isArray(com.value) ? com.value : []);
      setLoading(false);
    }
    load();
  }, [name]);

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <Card key={i}><CardContent className="p-5"><Skeleton className="h-14 w-full" /></CardContent></Card>)}
        </div>
        <div className="space-y-3">
          {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-20 w-full rounded-lg" />)}
        </div>
      </div>
    );
  }

  if (!politician) {
    return (
      <div className="space-y-4">
        <Link href="/congress" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-4 h-4" /> Back to Congress Trades
        </Link>
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Politician &quot;{name}&quot; not found.
          </CardContent>
        </Card>
      </div>
    );
  }

  // Filter to actual stock trades (with tickers), separate from PTR filings
  const stockTrades = politician.recent_trades.filter((t) => t.ticker);
  const ptrFilings = politician.recent_trades.filter((t) => !t.ticker);

  // Unique tickers
  const tickers = [...new Set(stockTrades.map((t) => t.ticker).filter(Boolean))];

  // Buy/sell counts from actual stock trades
  const buys = stockTrades.filter((t) => t.tx_type === "purchase").length;
  const sells = stockTrades.filter((t) => t.tx_type === "sale" || t.tx_type === "sale_full" || t.tx_type === "sale_partial").length;

  const partyColor =
    politician.party === "R" ? "bg-red-500/10 text-red-400 border-red-500/20" :
    politician.party === "D" ? "bg-blue-500/10 text-blue-400 border-blue-500/20" :
    "bg-muted text-muted-foreground";

  return (
    <div className="space-y-6">
      {/* Back link */}
      <Link href="/congress" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="w-4 h-4" /> Back to Congress Trades
      </Link>

      {/* Header */}
      <div className="flex items-center gap-4">
        <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center text-lg font-bold">
          {politician.name.split(" ").map(n => n[0]).join("").slice(0, 2)}
        </div>
        <div>
          <h1 className="text-2xl font-bold">{politician.name}</h1>
          <div className="flex items-center gap-2 mt-0.5">
            {politician.party && (
              <Badge variant="outline" className={partyColor}>
                {politician.party === "R" ? "Republican" : politician.party === "D" ? "Democrat" : politician.party}
              </Badge>
            )}
            {politician.state && <span className="text-sm text-muted-foreground">{politician.state}</span>}
            {politician.chamber && (
              <span className="text-sm text-muted-foreground capitalize">{politician.chamber}</span>
            )}
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <Landmark className="w-4 h-4 text-blue-400" />
              <span className="text-xs text-muted-foreground">Total Trades</span>
            </div>
            <div className="text-2xl font-bold font-mono-data">{politician.total_trades}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <ShoppingCart className="w-4 h-4 text-green-400" />
              <span className="text-xs text-muted-foreground">Buys</span>
            </div>
            <div className="text-2xl font-bold font-mono-data text-green-400">
              {politician.total_buys ?? buys}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <Package className="w-4 h-4 text-red-400" />
              <span className="text-xs text-muted-foreground">Sells</span>
            </div>
            <div className="text-2xl font-bold font-mono-data text-red-400">
              {politician.total_sells ?? sells}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <Calendar className="w-4 h-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Last Trade</span>
            </div>
            <div className="text-sm font-medium mt-1">
              {politician.last_trade_date
                ? timeAgo(politician.last_trade_date)
                : "-"}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tickers traded */}
      {tickers.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Stocks Traded</h2>
          <div className="flex flex-wrap gap-2">
            {tickers.map((t) => {
              const tickerTrades = stockTrades.filter((tr) => tr.ticker === t);
              const buyCount = tickerTrades.filter((tr) => tr.tx_type === "purchase").length;
              const sellCount = tickerTrades.length - buyCount;
              return (
                <div key={t} className="flex items-center gap-1.5 bg-muted/50 border border-border/50 rounded-lg px-3 py-1.5">
                  <span className="font-mono-data text-sm font-medium">{t}</span>
                  {buyCount > 0 && <span className="text-[10px] text-green-400">{buyCount}B</span>}
                  {sellCount > 0 && <span className="text-[10px] text-red-400">{sellCount}S</span>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Committees */}
      {committees.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Building2 className="w-4 h-4" />
              Committee Assignments
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {committees.map((c, i) => (
                <div key={i} className="p-3 rounded-lg bg-muted/30 border border-border/50">
                  <div className="text-sm font-medium">{c.committee}</div>
                  {c.subcommittee && (
                    <div className="text-xs text-muted-foreground mt-0.5">{c.subcommittee}</div>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Stock trades */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
            Trade History {stockTrades.length > 0 && `(${stockTrades.length})`}
          </h2>
        </div>

        {stockTrades.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground text-sm">
              {ptrFilings.length > 0
                ? `${ptrFilings.length} PTR filings found, but no individual stock trades with tickers in the data.`
                : "No trade data available."}
            </CardContent>
          </Card>
        ) : (
          stockTrades.map((trade, i) => (
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
                      <span className="font-mono-data text-sm font-bold">{trade.ticker}</span>
                      <span className="text-xs text-muted-foreground">
                        {trade.tx_type === "purchase" ? "Bought" : "Sold"}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
                      {trade.asset_description && trade.asset_description !== trade.ticker && (
                        <span className="truncate max-w-[250px]">{trade.asset_description}</span>
                      )}
                      {trade.amount_low && trade.amount_high && (
                        <span>{formatAmount(trade.amount_low, trade.amount_high)}</span>
                      )}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-xs text-muted-foreground">{timeAgo(trade.disclosure_date || trade.tx_date)}</div>
                    {trade.tx_date && (
                      <div className="text-[10px] text-muted-foreground/60 mt-0.5">
                        Traded {new Date(trade.tx_date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      </div>
                    )}
                    {trade.disclosure_delay_days != null && trade.disclosure_delay_days > 0 && (
                      <div className="text-[10px] text-yellow-400/70 mt-0.5">
                        {trade.disclosure_delay_days}d delay
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
