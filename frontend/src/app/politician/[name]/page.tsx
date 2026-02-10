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
  TrendingDown,
  ShoppingCart,
  Package,
  Building2,
  DollarSign,
  BarChart3,
  Target,
} from "lucide-react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
} from "recharts";

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

function formatPrice(price: number | null | undefined) {
  if (price == null) return "-";
  return `$${price.toFixed(2)}`;
}

function formatPnl(pnl: number | null | undefined) {
  if (pnl == null) return null;
  const sign = pnl >= 0 ? "+" : "";
  return `${sign}${pnl.toFixed(1)}%`;
}

function buildTickerSummary(trades: Trade[]) {
  const map = new Map<string, {
    ticker: string;
    buys: Trade[];
    sells: Trade[];
    latestPrice: number | null;
    entryPrice: number | null;
    totalReturn: number | null;
  }>();

  for (const t of trades) {
    if (!t.ticker) continue;
    if (!map.has(t.ticker)) {
      map.set(t.ticker, { ticker: t.ticker, buys: [], sells: [], latestPrice: null, entryPrice: null, totalReturn: null });
    }
    const entry = map.get(t.ticker)!;
    if (t.tx_type === "purchase") {
      entry.buys.push(t);
      if (t.price_at_disclosure && !entry.entryPrice) entry.entryPrice = t.price_at_disclosure;
    } else {
      entry.sells.push(t);
    }
    if (t.price_current && !entry.latestPrice) entry.latestPrice = t.price_current;
    if (t.return_since_disclosure != null && entry.totalReturn == null) entry.totalReturn = t.return_since_disclosure;
  }

  return Array.from(map.values()).sort((a, b) => (b.buys.length + b.sells.length) - (a.buys.length + a.sells.length));
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
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {[...Array(5)].map((_, i) => <Card key={i}><CardContent className="p-4"><Skeleton className="h-14 w-full" /></CardContent></Card>)}
        </div>
        <Skeleton className="h-48 w-full rounded-lg" />
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24 w-full rounded-lg" />)}
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

  const stockTrades = politician.recent_trades.filter((t) => t.ticker);
  const tickerSummary = buildTickerSummary(stockTrades);
  const buys = stockTrades.filter((t) => t.tx_type === "purchase").length;
  const sells = stockTrades.filter((t) => t.tx_type === "sale" || t.tx_type === "sale_full" || t.tx_type === "sale_partial").length;

  const tradesWithReturn = stockTrades.filter(t => t.return_since_disclosure != null);
  const avgReturn = tradesWithReturn.length > 0
    ? tradesWithReturn.reduce((s, t) => s + (t.return_since_disclosure ?? 0), 0) / tradesWithReturn.length
    : null;
  const winners = tradesWithReturn.filter(t => (t.return_since_disclosure ?? 0) > 0).length;
  const winRate = tradesWithReturn.length > 0 ? (winners / tradesWithReturn.length) * 100 : null;

  const partyColor =
    politician.party === "R" ? "bg-red-500/10 text-red-400 border-red-500/20" :
    politician.party === "D" ? "bg-blue-500/10 text-blue-400 border-blue-500/20" :
    "bg-muted text-muted-foreground";

  return (
    <div className="space-y-6">
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
            {politician.chamber && <span className="text-sm text-muted-foreground capitalize">{politician.chamber}</span>}
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Landmark className="w-3.5 h-3.5 text-blue-400" />
              <span className="text-xs text-muted-foreground">Total Trades</span>
            </div>
            <div className="text-2xl font-bold font-mono-data">{politician.total_trades}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <ShoppingCart className="w-3.5 h-3.5 text-green-400" />
              <span className="text-xs text-muted-foreground">Buys</span>
            </div>
            <div className="text-2xl font-bold font-mono-data text-green-400">{politician.total_buys ?? buys}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Package className="w-3.5 h-3.5 text-red-400" />
              <span className="text-xs text-muted-foreground">Sells</span>
            </div>
            <div className="text-2xl font-bold font-mono-data text-red-400">{politician.total_sells ?? sells}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-xs text-muted-foreground">Avg Return</span>
            </div>
            <div className={`text-2xl font-bold font-mono-data ${(politician.avg_return ?? avgReturn ?? 0) >= 0 ? "text-green-400" : "text-red-400"}`}>
              {formatPnl(politician.avg_return ?? avgReturn) ?? "-"}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Target className="w-3.5 h-3.5 text-amber-400" />
              <span className="text-xs text-muted-foreground">Win Rate</span>
            </div>
            <div className="text-2xl font-bold font-mono-data">
              {politician.win_rate != null ? `${politician.win_rate.toFixed(0)}%` : winRate != null ? `${winRate.toFixed(0)}%` : "-"}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Portfolio Positions Table */}
      {tickerSummary.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <BarChart3 className="w-4 h-4" />
              Portfolio Positions ({tickerSummary.length} stocks)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-xs text-muted-foreground">
                    <th className="text-left py-2 pr-3">Ticker</th>
                    <th className="text-right py-2 px-2">Trades</th>
                    <th className="text-right py-2 px-2">Entry</th>
                    <th className="text-right py-2 px-2">Current</th>
                    <th className="text-right py-2 px-2">PnL</th>
                    <th className="text-right py-2 pl-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {tickerSummary.map((ts) => {
                    const hasReturn = ts.totalReturn != null;
                    const isPositive = (ts.totalReturn ?? 0) >= 0;
                    const isClosed = ts.sells.length > 0 && ts.buys.length > 0;
                    return (
                      <tr key={ts.ticker} className="border-b border-border/20 hover:bg-muted/30">
                        <td className="py-2.5 pr-3">
                          <span className="font-mono-data font-bold">{ts.ticker}</span>
                        </td>
                        <td className="text-right py-2.5 px-2">
                          <span className="text-green-400 text-xs">{ts.buys.length}B</span>
                          {ts.sells.length > 0 && <span className="text-red-400 text-xs ml-1">{ts.sells.length}S</span>}
                        </td>
                        <td className="text-right py-2.5 px-2 font-mono-data text-muted-foreground">
                          {formatPrice(ts.entryPrice)}
                        </td>
                        <td className="text-right py-2.5 px-2 font-mono-data">
                          {formatPrice(ts.latestPrice)}
                        </td>
                        <td className={`text-right py-2.5 px-2 font-mono-data font-medium ${hasReturn ? (isPositive ? "text-green-400" : "text-red-400") : "text-muted-foreground"}`}>
                          {hasReturn ? formatPnl(ts.totalReturn) : "-"}
                        </td>
                        <td className="text-right py-2.5 pl-2">
                          {isClosed ? (
                            <Badge variant="outline" className="text-[10px] border-muted-foreground/30 text-muted-foreground">Realized</Badge>
                          ) : (
                            <Badge variant="outline" className="text-[10px] border-blue-500/30 text-blue-400">Holding</Badge>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Returns Chart */}
      {tradesWithReturn.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <DollarSign className="w-4 h-4" />
              Trade Returns
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={tradesWithReturn
                    .filter(t => t.ticker)
                    .sort((a, b) => (a.return_since_disclosure ?? 0) - (b.return_since_disclosure ?? 0))
                    .map((t) => ({
                      ticker: t.ticker,
                      return: Number((t.return_since_disclosure ?? 0).toFixed(1)),
                    }))}
                  margin={{ top: 5, right: 10, left: 10, bottom: 30 }}
                >
                  <defs>
                    <linearGradient id="returnFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="ticker" tick={{ fontSize: 10, fill: "#888" }} interval={0} angle={-45} textAnchor="end" height={40} />
                  <YAxis tick={{ fontSize: 10, fill: "#888" }} tickFormatter={(v) => `${v}%`} width={45} />
                  <Tooltip
                    contentStyle={{ background: "#1a1a2e", border: "1px solid #333", borderRadius: "8px", fontSize: "12px" }}
                    formatter={(value) => [`${Number(value) > 0 ? "+" : ""}${value}%`, "Return"]}
                  />
                  <ReferenceLine y={0} stroke="#666" strokeDasharray="3 3" />
                  <Area type="monotone" dataKey="return" stroke="#22c55e" fill="url(#returnFill)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div className="flex items-center justify-between mt-1 text-xs text-muted-foreground">
              <span>{tradesWithReturn.length} trades with return data</span>
              <span>{winners}W / {tradesWithReturn.length - winners}L</span>
            </div>
          </CardContent>
        </Card>
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
            <div className="flex flex-wrap gap-2">
              {committees.map((c, i) => (
                <div key={i} className="px-3 py-1.5 rounded-lg bg-muted/30 border border-border/50 text-sm">
                  {c.committee}
                  {c.subcommittee && <span className="text-xs text-muted-foreground ml-1">/ {c.subcommittee}</span>}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Trade History */}
      <div className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
          Trade History {stockTrades.length > 0 && `(${stockTrades.length})`}
        </h2>

        {stockTrades.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground text-sm">
              No individual stock trades with tickers in the data.
            </CardContent>
          </Card>
        ) : (
          stockTrades.map((trade, i) => {
            const isBuy = trade.tx_type === "purchase";
            const hasPnl = trade.return_since_disclosure != null;
            const pnlPositive = (trade.return_since_disclosure ?? 0) >= 0;
            return (
              <Card key={i} className="hover:border-border/80 transition-colors">
                <CardContent className="p-4">
                  <div className="flex items-center gap-3">
                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${isBuy ? "bg-green-500/10" : "bg-red-500/10"}`}>
                      {isBuy ? <ArrowUpRight className="w-4 h-4 text-green-400" /> : <ArrowDownRight className="w-4 h-4 text-red-400" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono-data text-sm font-bold">{trade.ticker}</span>
                        <span className="text-xs text-muted-foreground">{isBuy ? "Bought" : "Sold"}</span>
                        {trade.amount_low != null && trade.amount_high != null && (
                          <span className="text-xs text-muted-foreground/70">{formatAmount(trade.amount_low, trade.amount_high)}</span>
                        )}
                      </div>
                      {trade.asset_description && trade.asset_description !== trade.ticker && (
                        <div className="text-xs text-muted-foreground/60 truncate max-w-[300px] mt-0.5">{trade.asset_description}</div>
                      )}
                      <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                        {trade.price_at_disclosure != null && (
                          <span className="text-xs text-muted-foreground">
                            Entry: <span className="font-mono-data text-foreground">{formatPrice(trade.price_at_disclosure)}</span>
                          </span>
                        )}
                        {trade.price_current != null && (
                          <span className="text-xs text-muted-foreground">
                            Now: <span className="font-mono-data text-foreground">{formatPrice(trade.price_current)}</span>
                          </span>
                        )}
                        {hasPnl && (
                          <span className={`text-xs font-mono-data font-semibold inline-flex items-center gap-0.5 ${pnlPositive ? "text-green-400" : "text-red-400"}`}>
                            {pnlPositive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                            {formatPnl(trade.return_since_disclosure)}
                          </span>
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
                        <div className="text-[10px] text-yellow-400/70 mt-0.5">{trade.disclosure_delay_days}d delay</div>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}
