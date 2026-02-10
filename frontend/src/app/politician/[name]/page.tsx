"use client";

import { useEffect, useState, useMemo } from "react";
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
  TrendingUp,
  TrendingDown,
  Building2,
  Clock,
  Briefcase,
  BarChart3,
  Calendar,
  CircleDollarSign,
  Activity,
} from "lucide-react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip as RechartsTooltip,
  CartesianGrid,
  Cell,
} from "recharts";

type PoliticianDetail = Politician & {
  recent_trades: Trade[];
  total_buys?: number;
  total_sells?: number;
};

// ─── Helpers ───

function formatAmount(low: number, high: number) {
  const fmt = (n: number) => {
    if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
    return `$${n.toLocaleString()}`;
  };
  if (low === high) return fmt(low);
  return `${fmt(low)} – ${fmt(high)}`;
}

function formatPrice(price: number | null | undefined) {
  if (price == null) return "—";
  return `$${price.toFixed(2)}`;
}

function formatPnl(pnl: number | null | undefined) {
  if (pnl == null) return null;
  const sign = pnl >= 0 ? "+" : "";
  return `${sign}${pnl.toFixed(1)}%`;
}

function formatLargeNumber(n: number) {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toLocaleString()}`;
}

const PERIOD_FILTERS = [
  { label: "3M", days: 90 },
  { label: "6M", days: 180 },
  { label: "YTD", days: -1 },
  { label: "1Y", days: 365 },
  { label: "2Y", days: 730 },
  { label: "5Y", days: 1825 },
  { label: "ALL", days: 0 },
] as const;

function getFilterCutoff(periodDays: number): Date | null {
  if (periodDays === 0) return null; // ALL
  const now = new Date();
  if (periodDays === -1) return new Date(now.getFullYear(), 0, 1); // YTD
  return new Date(now.getTime() - periodDays * 86400000);
}

function filterTradesByPeriod(trades: Trade[], periodDays: number): Trade[] {
  const cutoff = getFilterCutoff(periodDays);
  if (!cutoff) return trades;
  return trades.filter((t) => {
    const d = new Date(t.tx_date || t.disclosure_date);
    return d >= cutoff;
  });
}

function buildPerformanceChart(trades: Trade[]) {
  const sorted = [...trades]
    .filter((t) => t.tx_date || t.disclosure_date)
    .sort(
      (a, b) =>
        new Date(a.tx_date || a.disclosure_date).getTime() -
        new Date(b.tx_date || b.disclosure_date).getTime()
    );

  if (sorted.length === 0) return [];

  const monthMap = new Map<
    string,
    { cumReturn: number; count: number; buys: number; sells: number; volumeMid: number }
  >();
  let cumReturn = 0;

  for (const t of sorted) {
    const d = new Date(t.tx_date || t.disclosure_date);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const ret = t.return_since_disclosure ?? 0;
    cumReturn += ret;
    const isBuy = t.tx_type === "purchase";
    const vol =
      t.amount_low != null && t.amount_high != null
        ? (t.amount_low + t.amount_high) / 2
        : 0;

    const existing = monthMap.get(key);
    if (existing) {
      existing.cumReturn = cumReturn;
      existing.count += 1;
      if (isBuy) existing.buys++;
      else existing.sells++;
      existing.volumeMid += vol;
    } else {
      monthMap.set(key, {
        cumReturn,
        count: 1,
        buys: isBuy ? 1 : 0,
        sells: isBuy ? 0 : 1,
        volumeMid: vol,
      });
    }
  }

  const monthNames = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];

  const points: {
    date: string;
    label: string;
    cumReturn: number;
    trades: number;
    buys: number;
    sells: number;
    volumeK: number;
  }[] = [];

  for (const [key, val] of monthMap) {
    const [y, m] = key.split("-");
    points.push({
      date: key,
      label: `${monthNames[parseInt(m) - 1]} '${y.slice(2)}`,
      cumReturn: Number(val.cumReturn.toFixed(1)),
      trades: val.count,
      buys: val.buys,
      sells: val.sells,
      volumeK: Math.round(val.volumeMid / 1000),
    });
  }

  return points;
}

function buildHoldings(trades: Trade[]) {
  const map = new Map<
    string,
    {
      ticker: string;
      description: string;
      totalBuys: number;
      totalSells: number;
      amountMid: number;
      entryPrice: number | null;
      currentPrice: number | null;
      returnPct: number | null;
      lastDate: string;
      isHolding: boolean;
    }
  >();

  for (const t of trades) {
    if (!t.ticker) continue;
    const existing = map.get(t.ticker);
    const mid =
      t.amount_low != null && t.amount_high != null
        ? (t.amount_low + t.amount_high) / 2
        : 0;
    const isBuy = t.tx_type === "purchase";

    if (!existing) {
      map.set(t.ticker, {
        ticker: t.ticker,
        description: t.asset_description || t.ticker,
        totalBuys: isBuy ? 1 : 0,
        totalSells: isBuy ? 0 : 1,
        amountMid: mid,
        entryPrice: t.price_at_disclosure,
        currentPrice: t.price_current,
        returnPct: t.return_since_disclosure,
        lastDate: t.tx_date || t.disclosure_date,
        isHolding: isBuy,
      });
    } else {
      if (isBuy) existing.totalBuys++;
      else existing.totalSells++;
      existing.amountMid += mid;
      if (!existing.entryPrice && t.price_at_disclosure)
        existing.entryPrice = t.price_at_disclosure;
      if (t.price_current) existing.currentPrice = t.price_current;
      if (t.return_since_disclosure != null)
        existing.returnPct = t.return_since_disclosure;
      const tDate = t.tx_date || t.disclosure_date;
      if (tDate > existing.lastDate) existing.lastDate = tDate;
      if (!isBuy) existing.isHolding = false;
    }
  }

  const holdings = Array.from(map.values());
  const totalAmount = holdings.reduce((s, h) => s + h.amountMid, 0);

  return holdings
    .map((h) => ({
      ...h,
      allocationPct: totalAmount > 0 ? (h.amountMid / totalAmount) * 100 : 0,
    }))
    .sort((a, b) => b.allocationPct - a.allocationPct);
}

// ─── Component ───

export default function PoliticianPage() {
  const params = useParams();
  const name = decodeURIComponent(params.name as string);
  const [politician, setPolitician] = useState<PoliticianDetail | null>(null);
  const [committees, setCommittees] = useState<
    { committee: string; subcommittee?: string }[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [selectedPeriod, setSelectedPeriod] = useState(6); // default ALL

  useEffect(() => {
    async function load() {
      const [pol, com] = await Promise.allSettled([
        api.getPolitician(name),
        api.getPoliticianCommittees(name),
      ]);
      if (pol.status === "fulfilled")
        setPolitician(pol.value as PoliticianDetail);
      if (com.status === "fulfilled")
        setCommittees(Array.isArray(com.value) ? com.value : []);
      setLoading(false);
    }
    load();
  }, [name]);

  // All trades with tickers (unfiltered)
  const allStockTrades = useMemo(
    () => politician?.recent_trades.filter((t) => t.ticker) ?? [],
    [politician]
  );

  // Period-filtered stock trades - this drives EVERYTHING on the page
  const filteredTrades = useMemo(
    () => filterTradesByPeriod(allStockTrades, PERIOD_FILTERS[selectedPeriod].days),
    [allStockTrades, selectedPeriod]
  );

  const chartData = useMemo(
    () => buildPerformanceChart(filteredTrades),
    [filteredTrades]
  );
  const holdings = useMemo(() => buildHoldings(filteredTrades), [filteredTrades]);

  const stats = useMemo(() => {
    const trades = filteredTrades;
    const buys = trades.filter((t) => t.tx_type === "purchase").length;
    const sells = trades.filter((t) => t.tx_type !== "purchase").length;

    const tradesWithReturn = trades.filter(
      (t) => t.return_since_disclosure != null
    );
    const avgReturn =
      tradesWithReturn.length > 0
        ? tradesWithReturn.reduce(
            (s, t) => s + (t.return_since_disclosure ?? 0),
            0
          ) / tradesWithReturn.length
        : null;
    const winners = tradesWithReturn.filter(
      (t) => (t.return_since_disclosure ?? 0) > 0
    ).length;
    const winRate =
      tradesWithReturn.length > 0
        ? (winners / tradesWithReturn.length) * 100
        : null;

    // Cumulative return (sum of individual trade returns)
    const cumReturn =
      tradesWithReturn.length > 0
        ? tradesWithReturn.reduce(
            (s, t) => s + (t.return_since_disclosure ?? 0),
            0
          )
        : null;

    // Estimated AUM from mid-amounts
    const estAum = trades.reduce((s, t) => {
      if (t.amount_low != null && t.amount_high != null)
        return s + (t.amount_low + t.amount_high) / 2;
      return s;
    }, 0);

    // Average disclosure delay
    const delayTrades = trades.filter(
      (t) => t.disclosure_delay_days != null && t.disclosure_delay_days > 0
    );
    const avgDelay =
      delayTrades.length > 0
        ? delayTrades.reduce(
            (s, t) => s + (t.disclosure_delay_days ?? 0),
            0
          ) / delayTrades.length
        : null;

    // Unique active tickers
    const activeStocks = new Set(
      holdings.filter((h) => h.isHolding).map((h) => h.ticker)
    ).size;

    return {
      totalTrades: trades.length,
      buys,
      sells,
      avgReturn,
      winRate,
      winners,
      tradesWithReturn: tradesWithReturn.length,
      cumReturn,
      estAum,
      avgDelay,
      activeStocks,
    };
  }, [filteredTrades, holdings]);

  const periodLabel =
    PERIOD_FILTERS[selectedPeriod].label === "ALL"
      ? "all time"
      : PERIOD_FILTERS[selectedPeriod].label;

  const hasReturnData = stats.tradesWithReturn > 0;
  const isPositiveReturn = (stats.cumReturn ?? 0) >= 0;

  // ─── Loading ───
  if (loading) {
    return (
      <div className="space-y-6 max-w-4xl mx-auto">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 w-full rounded-2xl" />
        <Skeleton className="h-64 w-full rounded-2xl" />
        <div className="grid grid-cols-4 gap-3">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-20 w-full rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-48 w-full rounded-2xl" />
      </div>
    );
  }

  if (!politician) {
    return (
      <div className="space-y-4 max-w-4xl mx-auto">
        <Link
          href="/congress"
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
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

  const partyColor =
    politician.party === "R"
      ? "text-red-400"
      : politician.party === "D"
        ? "text-blue-400"
        : "text-muted-foreground";

  const partyBg =
    politician.party === "R"
      ? "bg-red-500/10 border-red-500/20"
      : politician.party === "D"
        ? "bg-blue-500/10 border-blue-500/20"
        : "bg-muted border-border";

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Back Navigation */}
      <Link
        href="/congress"
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="w-4 h-4" /> Congress Trades
      </Link>

      {/* ─── Hero Header ─── */}
      <div className="relative overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-card via-card to-muted/20 p-6">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4">
            <div
              className={`w-16 h-16 rounded-2xl flex items-center justify-center text-xl font-bold border ${partyBg} ${partyColor}`}
            >
              {politician.name
                .split(" ")
                .map((n) => n[0])
                .join("")
                .slice(0, 2)}
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">
                {politician.name}
              </h1>
              <div className="flex items-center gap-2 mt-1">
                <Badge
                  variant="outline"
                  className={`${partyBg} ${partyColor} text-xs`}
                >
                  {politician.party === "R"
                    ? "Republican"
                    : politician.party === "D"
                      ? "Democrat"
                      : politician.party || "—"}
                </Badge>
                {politician.state && (
                  <span className="text-sm text-muted-foreground">
                    {politician.state}
                  </span>
                )}
                {politician.chamber && (
                  <span className="text-sm text-muted-foreground capitalize">
                    • {politician.chamber}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Big Return Number or Volume */}
          <div className="text-right">
            {hasReturnData ? (
              <>
                <div
                  className={`text-4xl font-bold tracking-tight font-mono ${isPositiveReturn ? "text-emerald-400" : "text-red-400"}`}
                >
                  <span className="text-2xl">
                    {isPositiveReturn ? "▲" : "▼"}
                  </span>{" "}
                  {Math.abs(stats.cumReturn ?? 0).toFixed(1)}%
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  {periodLabel} cumulative return
                </div>
              </>
            ) : (
              <>
                <div className="text-4xl font-bold tracking-tight font-mono text-blue-400">
                  {stats.estAum > 0 ? formatLargeNumber(stats.estAum) : `${stats.totalTrades}`}
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  {stats.estAum > 0
                    ? `${periodLabel} est. volume`
                    : `${periodLabel} trades`}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Committees inline */}
        {committees.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-4">
            {committees.slice(0, 4).map((c, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md bg-muted/50 border border-border/50 text-muted-foreground"
              >
                <Building2 className="w-3 h-3" />
                {c.committee}
              </span>
            ))}
            {committees.length > 4 && (
              <span className="text-[11px] px-2 py-0.5 text-muted-foreground">
                +{committees.length - 4} more
              </span>
            )}
          </div>
        )}
      </div>

      {/* ─── Performance Chart ─── */}
      <Card className="overflow-hidden">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Activity className="w-4 h-4" />
              {hasReturnData ? "Portfolio Performance" : "Trading Activity"}
            </CardTitle>
            {/* Period Selectors */}
            <div className="flex gap-1">
              {PERIOD_FILTERS.map((p, i) => (
                <button
                  key={p.label}
                  onClick={() => setSelectedPeriod(i)}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                    selectedPeriod === i
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0 pb-4">
          {chartData.length > 0 ? (
            hasReturnData ? (
              /* ─── Return Chart (when price data exists) ─── */
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart
                    data={chartData}
                    margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
                  >
                    <defs>
                      <linearGradient id="perfGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop
                          offset="5%"
                          stopColor={isPositiveReturn ? "#10b981" : "#ef4444"}
                          stopOpacity={0.3}
                        />
                        <stop
                          offset="95%"
                          stopColor={isPositiveReturn ? "#10b981" : "#ef4444"}
                          stopOpacity={0}
                        />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#333" vertical={false} />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 11, fill: "#666" }}
                      axisLine={false}
                      tickLine={false}
                      interval="preserveStartEnd"
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: "#666" }}
                      tickFormatter={(v) => `${v}%`}
                      axisLine={false}
                      tickLine={false}
                      width={50}
                    />
                    <RechartsTooltip
                      contentStyle={{
                        background: "#0f0f1a",
                        border: "1px solid #2a2a3e",
                        borderRadius: "10px",
                        fontSize: "12px",
                        boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
                      }}
                      formatter={(value) => [
                        `${Number(value) > 0 ? "+" : ""}${value}%`,
                        "Cumulative Return",
                      ]}
                      labelFormatter={(label) => `${label}`}
                    />
                    <Area
                      type="monotone"
                      dataKey="cumReturn"
                      stroke={isPositiveReturn ? "#10b981" : "#ef4444"}
                      fill="url(#perfGradient)"
                      strokeWidth={2.5}
                      dot={false}
                      activeDot={{
                        r: 4,
                        fill: isPositiveReturn ? "#10b981" : "#ef4444",
                      }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : (
              /* ─── Volume Bar Chart (when no price data) ─── */
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={chartData}
                    margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#333" vertical={false} />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 11, fill: "#666" }}
                      axisLine={false}
                      tickLine={false}
                      interval="preserveStartEnd"
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: "#666" }}
                      tickFormatter={(v) =>
                        v >= 1000 ? `$${(v / 1000).toFixed(0)}M` : `$${v}K`
                      }
                      axisLine={false}
                      tickLine={false}
                      width={55}
                    />
                    <RechartsTooltip
                      contentStyle={{
                        background: "#0f0f1a",
                        border: "1px solid #2a2a3e",
                        borderRadius: "10px",
                        fontSize: "12px",
                        boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
                      }}
                      formatter={(value, dataKey) => {
                        if (dataKey === "volumeK") {
                          const v = Number(value);
                          return [
                            v >= 1000
                              ? `$${(v / 1000).toFixed(1)}M`
                              : `$${v}K`,
                            "Est. Volume",
                          ];
                        }
                        return [`${value}`, String(dataKey)];
                      }}
                      labelFormatter={(label) => `${label}`}
                    />
                    <Bar dataKey="volumeK" radius={[4, 4, 0, 0]}>
                      {chartData.map((entry, idx) => (
                        <Cell
                          key={idx}
                          fill={
                            entry.buys > entry.sells
                              ? "#10b981"
                              : entry.sells > entry.buys
                                ? "#ef4444"
                                : "#6366f1"
                          }
                          fillOpacity={0.7}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                <div className="flex items-center justify-center gap-4 mt-1 text-[10px] text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-sm bg-emerald-500/70" /> Net buying
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-sm bg-red-500/70" /> Net selling
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-sm bg-indigo-500/70" /> Mixed
                  </span>
                </div>
              </div>
            )
          ) : (
            <div className="h-56 flex items-center justify-center text-sm text-muted-foreground">
              No trades in this period
            </div>
          )}
          {/* Period context bar */}
          <div className="flex items-center justify-between mt-2 pt-2 border-t border-border/30 text-xs text-muted-foreground">
            <span>
              {stats.totalTrades} stock trade{stats.totalTrades !== 1 ? "s" : ""} in{" "}
              {periodLabel}
            </span>
            {stats.avgReturn != null ? (
              <span>
                Avg return per trade:{" "}
                <span
                  className={
                    stats.avgReturn >= 0
                      ? "text-emerald-400"
                      : "text-red-400"
                  }
                >
                  {formatPnl(stats.avgReturn)}
                </span>
              </span>
            ) : (
              <span className="text-muted-foreground/60">
                Price data pending
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ─── Stats Row ─── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center">
              <CircleDollarSign className="w-4 h-4 text-emerald-400" />
            </div>
            <span className="text-xs text-muted-foreground">Est. Volume</span>
          </div>
          <div className="text-xl font-bold font-mono">
            {stats.estAum > 0 ? formatLargeNumber(stats.estAum) : "—"}
          </div>
          <div className="text-[10px] text-muted-foreground mt-0.5">
            {periodLabel}
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center">
              <Clock className="w-4 h-4 text-amber-400" />
            </div>
            <span className="text-xs text-muted-foreground">Avg. Delay</span>
          </div>
          <div className="text-xl font-bold font-mono">
            {stats.avgDelay != null ? `${Math.round(stats.avgDelay)}d` : "—"}
          </div>
          <div className="text-[10px] text-muted-foreground mt-0.5">
            disclosure lag
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
              <Briefcase className="w-4 h-4 text-blue-400" />
            </div>
            <span className="text-xs text-muted-foreground">Positions</span>
          </div>
          <div className="text-xl font-bold font-mono">
            {holdings.length}
          </div>
          <div className="text-[10px] text-muted-foreground mt-0.5">
            {stats.activeStocks} active
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-lg bg-purple-500/10 flex items-center justify-center">
              <TrendingUp className="w-4 h-4 text-purple-400" />
            </div>
            <span className="text-xs text-muted-foreground">Win Rate</span>
          </div>
          <div className="text-xl font-bold font-mono">
            {stats.winRate != null ? `${stats.winRate.toFixed(0)}%` : "—"}
          </div>
          {stats.tradesWithReturn > 0 && (
            <div className="text-[10px] text-muted-foreground mt-0.5">
              {stats.winners}W / {stats.tradesWithReturn - stats.winners}L
            </div>
          )}
        </div>
      </div>

      {/* ─── Current Holdings (Allocation) ─── */}
      {holdings.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <BarChart3 className="w-4 h-4" />
                Holdings
              </CardTitle>
              <span className="text-xs text-muted-foreground">
                {holdings.length} positions · {periodLabel}
              </span>
            </div>
          </CardHeader>
          <CardContent className="space-y-2.5">
            {holdings.slice(0, 15).map((h) => {
              const hasReturn = h.returnPct != null;
              const isPos = (h.returnPct ?? 0) >= 0;
              return (
                <div key={h.ticker} className="group">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-lg bg-muted/50 border border-border/50 flex items-center justify-center">
                        <span className="text-[10px] font-bold font-mono">
                          {h.ticker.slice(0, 3)}
                        </span>
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm font-bold">
                            {h.ticker}
                          </span>
                          {h.isHolding ? (
                            <Badge
                              variant="outline"
                              className="text-[9px] h-4 border-emerald-500/30 text-emerald-400 px-1.5"
                            >
                              HOLDING
                            </Badge>
                          ) : (
                            <Badge
                              variant="outline"
                              className="text-[9px] h-4 border-muted-foreground/30 text-muted-foreground px-1.5"
                            >
                              CLOSED
                            </Badge>
                          )}
                        </div>
                        <div className="text-[10px] text-muted-foreground">
                          {h.totalBuys}B
                          {h.totalSells > 0 ? ` / ${h.totalSells}S` : ""}
                          {h.entryPrice != null && (
                            <> · Entry {formatPrice(h.entryPrice)}</>
                          )}
                          {h.currentPrice != null && (
                            <> · Now {formatPrice(h.currentPrice)}</>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="text-right">
                      <div className="flex items-center gap-3">
                        {hasReturn && (
                          <span
                            className={`text-sm font-mono font-semibold ${isPos ? "text-emerald-400" : "text-red-400"}`}
                          >
                            {formatPnl(h.returnPct)}
                          </span>
                        )}
                        <span className="text-sm font-mono text-muted-foreground w-12 text-right">
                          {h.allocationPct.toFixed(0)}%
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Allocation Bar */}
                  <div className="h-1.5 rounded-full bg-muted/30 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        hasReturn
                          ? isPos
                            ? "bg-emerald-500/60"
                            : "bg-red-500/60"
                          : "bg-blue-500/40"
                      }`}
                      style={{
                        width: `${Math.min(h.allocationPct, 100)}%`,
                      }}
                    />
                  </div>
                </div>
              );
            })}
            {holdings.length > 15 && (
              <div className="text-xs text-muted-foreground text-center pt-2">
                + {holdings.length - 15} more positions
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ─── Trade Activity Summary ─── */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-border bg-card p-4 text-center">
          <div className="text-2xl font-bold font-mono">
            {stats.totalTrades}
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            Trades ({periodLabel})
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 text-center">
          <div className="text-2xl font-bold font-mono text-emerald-400">
            {stats.buys}
          </div>
          <div className="text-xs text-muted-foreground mt-1">Buys</div>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 text-center">
          <div className="text-2xl font-bold font-mono text-red-400">
            {stats.sells}
          </div>
          <div className="text-xs text-muted-foreground mt-1">Sells</div>
        </div>
      </div>

      {/* ─── Trade Updates Timeline ─── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Calendar className="w-4 h-4" />
              Trade Updates
            </CardTitle>
            <span className="text-xs text-muted-foreground">
              {filteredTrades.length} trades · {periodLabel}
            </span>
          </div>
        </CardHeader>
        <CardContent>
          {filteredTrades.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground text-sm">
              No stock trades in this period.
            </div>
          ) : (
            <div className="relative">
              {/* Timeline line */}
              <div className="absolute left-[17px] top-2 bottom-2 w-px bg-border" />

              <div className="space-y-0">
                {[...filteredTrades]
                  .sort(
                    (a, b) =>
                      new Date(
                        b.tx_date || b.disclosure_date
                      ).getTime() -
                      new Date(
                        a.tx_date || a.disclosure_date
                      ).getTime()
                  )
                  .slice(0, 50)
                  .map((trade, i) => {
                    const isBuy = trade.tx_type === "purchase";
                    const hasPnl = trade.return_since_disclosure != null;
                    const pnlPositive =
                      (trade.return_since_disclosure ?? 0) >= 0;
                    const tradeDate = new Date(
                      trade.tx_date || trade.disclosure_date
                    );

                    return (
                      <div
                        key={i}
                        className="relative flex gap-4 py-3 group"
                      >
                        {/* Timeline dot */}
                        <div
                          className={`relative z-10 mt-0.5 w-[9px] h-[9px] rounded-full border-2 shrink-0 ml-[13px] ${
                            isBuy
                              ? "border-emerald-400 bg-emerald-400/20"
                              : "border-red-400 bg-red-400/20"
                          }`}
                        />

                        {/* Content */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-mono text-sm font-bold">
                              {trade.ticker}
                            </span>
                            <span
                              className={`text-xs font-medium ${isBuy ? "text-emerald-400" : "text-red-400"}`}
                            >
                              {isBuy ? "Bought" : "Sold"}
                            </span>
                            {trade.amount_low != null &&
                              trade.amount_high != null && (
                                <span className="text-xs text-muted-foreground">
                                  {formatAmount(
                                    trade.amount_low,
                                    trade.amount_high
                                  )}
                                </span>
                              )}
                            {hasPnl && (
                              <span
                                className={`inline-flex items-center gap-0.5 text-xs font-mono font-semibold ${
                                  pnlPositive
                                    ? "text-emerald-400"
                                    : "text-red-400"
                                }`}
                              >
                                {pnlPositive ? (
                                  <TrendingUp className="w-3 h-3" />
                                ) : (
                                  <TrendingDown className="w-3 h-3" />
                                )}
                                {formatPnl(trade.return_since_disclosure)}
                              </span>
                            )}
                          </div>

                          {trade.asset_description &&
                            trade.asset_description !== trade.ticker && (
                              <div className="text-[11px] text-muted-foreground/60 truncate max-w-sm mt-0.5">
                                {trade.asset_description}
                              </div>
                            )}

                          <div className="flex items-center gap-3 mt-1 text-[11px] text-muted-foreground">
                            <span>
                              {tradeDate.toLocaleDateString("en-US", {
                                month: "short",
                                day: "numeric",
                                year: "numeric",
                              })}
                            </span>
                            {trade.price_at_disclosure != null && (
                              <span>
                                Entry:{" "}
                                {formatPrice(trade.price_at_disclosure)}
                              </span>
                            )}
                            {trade.price_current != null && (
                              <span>
                                Now: {formatPrice(trade.price_current)}
                              </span>
                            )}
                            {trade.disclosure_delay_days != null &&
                              trade.disclosure_delay_days > 0 && (
                                <span className="text-amber-400/70">
                                  {trade.disclosure_delay_days}d delay
                                </span>
                              )}
                          </div>
                        </div>

                        {/* Buy/Sell icon */}
                        <div
                          className={`shrink-0 w-8 h-8 rounded-lg flex items-center justify-center ${
                            isBuy
                              ? "bg-emerald-500/10"
                              : "bg-red-500/10"
                          }`}
                        >
                          {isBuy ? (
                            <ArrowUpRight className="w-4 h-4 text-emerald-400" />
                          ) : (
                            <ArrowDownRight className="w-4 h-4 text-red-400" />
                          )}
                        </div>
                      </div>
                    );
                  })}
              </div>

              {filteredTrades.length > 50 && (
                <div className="text-xs text-muted-foreground text-center pt-3 border-t border-border/50">
                  Showing latest 50 of {filteredTrades.length} trades
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
