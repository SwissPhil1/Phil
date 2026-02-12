"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { api, AlertItem, SuspiciousTrade, TickerChartData } from "@/lib/api";
import { useApiData } from "@/lib/hooks";
import { ErrorState } from "@/components/error-state";
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  Tooltip as RechartsTooltip,
  CartesianGrid,
} from "recharts";
import {
  Bell,
  TrendingUp,
  TrendingDown,
  Clock,
  Flame,
  Landmark,
  UserCheck,
  ChevronLeft,
  ChevronRight,
  ShieldAlert,
  Building2,
  Users,
  Briefcase,
  ArrowUpDown,
  Wallet,
  BarChart2,
  Loader2,
} from "lucide-react";

function formatAmount(low: number | null, high: number | null): string {
  if (!low) return "-";
  if (high) return `$${(low / 1000).toFixed(0)}K–$${(high / 1000).toFixed(0)}K`;
  return `$${(low / 1000).toFixed(0)}K+`;
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "-";
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffH = Math.floor(diffMs / (1000 * 60 * 60));
  if (diffH < 1) return `${Math.max(1, Math.floor(diffMs / (1000 * 60)))}m ago`;
  if (diffH < 24) return `${diffH}h ago`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 30) return `${diffD}d ago`;
  return `${Math.floor(diffD / 30)}mo ago`;
}

function AlertRow({ alert }: { alert: AlertItem }) {
  const returnVal = alert.return_since;
  return (
    <TableRow>
      <TableCell className="w-8">
        {alert.source === "congress" ? (
          <Landmark className="w-4 h-4 text-blue-400" />
        ) : (
          <UserCheck className="w-4 h-4 text-purple-400" />
        )}
      </TableCell>
      <TableCell>
        <div className="font-medium text-sm">{alert.politician}</div>
        <div className="text-xs text-muted-foreground">
          {alert.party && alert.state ? `${alert.party}-${alert.state}` : alert.source === "insider" ? "Corporate Insider" : ""}
        </div>
      </TableCell>
      <TableCell>
        <Badge
          variant="outline"
          className={
            alert.action === "bought"
              ? "bg-green-500/10 text-green-400 border-green-500/20"
              : "bg-red-500/10 text-red-400 border-red-500/20"
          }
        >
          {alert.action === "bought" ? (
            <TrendingUp className="w-3 h-3 mr-1" />
          ) : (
            <TrendingDown className="w-3 h-3 mr-1" />
          )}
          {alert.action}
        </Badge>
      </TableCell>
      <TableCell className="font-mono font-semibold">{alert.ticker}</TableCell>
      <TableCell className="text-sm">{formatAmount(alert.amount_low, alert.amount_high)}</TableCell>
      <TableCell>
        {returnVal !== null && returnVal !== undefined ? (
          <span className={returnVal >= 0 ? "text-green-400" : "text-red-400"}>
            {returnVal >= 0 ? "+" : ""}
            {returnVal.toFixed(1)}%
          </span>
        ) : (
          <span className="text-muted-foreground">-</span>
        )}
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">
        <Clock className="w-3 h-3 inline mr-1" />
        {timeAgo(alert.disclosure_date)}
      </TableCell>
    </TableRow>
  );
}

const RATING_CONFIG: Record<string, { color: string; label: string }> = {
  VERY_HIGH: { color: "text-red-400 bg-red-500/10 border-red-500/20", label: "Very High" },
  HIGH: { color: "text-orange-400 bg-orange-500/10 border-orange-500/20", label: "High" },
  MEDIUM: { color: "text-yellow-400 bg-yellow-500/10 border-yellow-500/20", label: "Medium" },
  LOW: { color: "text-blue-400 bg-blue-500/10 border-blue-500/20", label: "Low" },
  VERY_LOW: { color: "text-slate-400 bg-slate-500/10 border-slate-500/20", label: "Very Low" },
};

function SuspiciousRow({ trade, onClick }: { trade: SuspiciousTrade; onClick?: () => void }) {
  const rating = RATING_CONFIG[trade.conviction_rating] || RATING_CONFIG.VERY_LOW;

  return (
    <div
      className="p-4 rounded-lg bg-muted/20 border border-border/50 space-y-2 cursor-pointer hover:bg-muted/30 hover:border-border/80 transition-colors"
      onClick={onClick}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2 flex-wrap">
          {trade.source === "congress" ? (
            <Landmark className="w-4 h-4 text-blue-400" />
          ) : (
            <UserCheck className="w-4 h-4 text-purple-400" />
          )}
          <span className="font-mono text-base font-bold">{trade.ticker}</span>
          {trade.asset_description && trade.asset_description !== trade.ticker && (
            <span className="text-xs text-muted-foreground/70 truncate max-w-xs">{trade.asset_description}</span>
          )}
          <Badge variant="outline" className={`text-xs ${rating.color}`}>
            {trade.conviction_score} — {rating.label}
          </Badge>
          <Badge
            variant="outline"
            className={`text-[10px] ${
              trade.action === "bought"
                ? "bg-green-500/10 text-green-400 border-green-500/20"
                : "bg-red-500/10 text-red-400 border-red-500/20"
            }`}
          >
            {trade.action === "bought" ? (
              <TrendingUp className="w-3 h-3 mr-1" />
            ) : (
              <TrendingDown className="w-3 h-3 mr-1" />
            )}
            {trade.action}
          </Badge>
          {trade.committee_overlap && (
            <Badge variant="outline" className="text-[10px] bg-amber-500/10 text-amber-400 border-amber-500/20">
              <Building2 className="w-3 h-3 mr-1" />
              Committee Overlap
            </Badge>
          )}
          {trade.insider_also_buying && (
            <Badge variant="outline" className="text-[10px] bg-purple-500/10 text-purple-400 border-purple-500/20">
              <UserCheck className="w-3 h-3 mr-1" />
              Insider Buying
            </Badge>
          )}
          {trade.fund_also_holds && (
            <Badge variant="outline" className="text-[10px] bg-blue-500/10 text-blue-400 border-blue-500/20">
              <Briefcase className="w-3 h-3 mr-1" />
              Fund Position
            </Badge>
          )}
        </div>
        <div className="text-right">
          {trade.return_since != null && (
            <span className={`text-sm font-mono font-semibold ${trade.return_since >= 0 ? "text-emerald-400" : "text-red-400"}`}>
              {trade.return_since >= 0 ? "+" : ""}{trade.return_since.toFixed(1)}%
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 text-sm">
        <span className="font-medium">{trade.politician}</span>
        <span className="text-muted-foreground text-xs">
          {trade.party && trade.state ? `${trade.party}-${trade.state}` : trade.source === "insider" ? "Corporate Insider" : ""}
        </span>
        <span className="text-muted-foreground text-xs">·</span>
        <span className="text-xs text-muted-foreground">{formatAmount(trade.amount_low, trade.amount_high)}</span>
        {trade.cluster_count > 1 && (
          <>
            <span className="text-muted-foreground text-xs">·</span>
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Users className="w-3 h-3" /> {trade.cluster_count} politicians
            </span>
          </>
        )}
      </div>

      {trade.factors.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {trade.factors.map((factor, i) => (
            <span
              key={i}
              className={`text-[11px] px-2 py-0.5 rounded-md border ${
                factor.points >= 15
                  ? "bg-red-500/5 border-red-500/10 text-red-300"
                  : factor.points >= 8
                  ? "bg-amber-500/5 border-amber-500/10 text-amber-300"
                  : factor.points > 0
                  ? "bg-blue-500/5 border-blue-500/10 text-blue-300"
                  : "bg-slate-500/5 border-slate-500/10 text-slate-400"
              }`}
            >
              <span className="font-mono font-semibold mr-1">
                {factor.points > 0 ? "+" : ""}{factor.points}
              </span>
              {factor.detail}
            </span>
          ))}
        </div>
      )}

      <div className="text-[11px] text-muted-foreground">
        Traded: {trade.tx_date ? new Date(trade.tx_date).toLocaleDateString() : "-"}
        {trade.disclosure_date && ` · Disclosed: ${new Date(trade.disclosure_date).toLocaleDateString()}`}
        {trade.disclosure_delay_days != null && trade.disclosure_delay_days > 0 && (
          <span className={trade.disclosure_delay_days > 30 ? "text-amber-400" : ""}>
            {" "}· {trade.disclosure_delay_days}d delay
          </span>
        )}
      </div>
    </div>
  );
}

const MONTH_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function buildChartData(
  data: TickerChartData,
  filterPolitician: string | null,
) {
  const filteredTrades = filterPolitician
    ? data.trades.filter((t) => t.politician === filterPolitician)
    : data.trades;

  // Map trades to nearest price week
  const tradesByWeek = new Map<string, { buys: typeof filteredTrades; sells: typeof filteredTrades }>();
  for (const trade of filteredTrades) {
    if (!trade.date) continue;
    const tradeTs = new Date(trade.date).getTime();
    let nearestDate = data.prices[0]?.date;
    let nearestDiff = Infinity;
    for (const p of data.prices) {
      const diff = Math.abs(new Date(p.date).getTime() - tradeTs);
      if (diff < nearestDiff) { nearestDiff = diff; nearestDate = p.date; }
    }
    if (!nearestDate) continue;
    const existing = tradesByWeek.get(nearestDate) || { buys: [], sells: [] };
    if (trade.type === "buy") existing.buys.push(trade);
    else existing.sells.push(trade);
    tradesByWeek.set(nearestDate, existing);
  }

  return data.prices.map((p) => {
    const trades = tradesByWeek.get(p.date);
    const d = new Date(p.date);
    return {
      date: p.date,
      label: `${MONTH_SHORT[d.getMonth()]} '${String(d.getFullYear()).slice(2)}`,
      close: p.close,
      buyMarker: trades?.buys.length ? p.close : undefined,
      sellMarker: trades?.sells.length ? p.close : undefined,
      buyTrades: trades?.buys || [],
      sellTrades: trades?.sells || [],
    };
  });
}

export default function AlertsPage() {
  const [hours, setHours] = useState(168);
  const [page, setPage] = useState(1);
  const [suspSort, setSuspSort] = useState<"score" | "date">("score");
  const [simMinScore, setSimMinScore] = useState(50);
  const [chartTrade, setChartTrade] = useState<SuspiciousTrade | null>(null);
  const [chartData, setChartData] = useState<TickerChartData | null>(null);
  const [chartLoading, setChartLoading] = useState(false);
  const [chartDays, setChartDays] = useState(365);
  const [chartFilter, setChartFilter] = useState<"all" | "politician">("politician");
  const pageSize = 100;

  const openChart = useCallback(async (trade: SuspiciousTrade, days: number) => {
    setChartTrade(trade);
    setChartData(null);
    setChartLoading(true);
    setChartFilter("politician");
    try {
      const data = await api.getTickerChart(trade.ticker, days);
      setChartData(data);
    } catch {
      // Error handled by showing "no price data" in sheet
    }
    setChartLoading(false);
  }, []);

  // Re-fetch chart when period changes while sheet is open
  useEffect(() => {
    if (chartTrade) {
      openChart(chartTrade, chartDays);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chartDays]);

  const { data: alertsData, loading, error, retry } = useApiData(
    () => api.getRecentAlerts(hours, page, pageSize),
    { refreshInterval: 60, deps: [hours, page] }
  );
  const { data: summary } = useApiData(() => api.getAlertsSummary(), { refreshInterval: 120 });
  const suspDays = Math.max(1, Math.ceil(hours / 24));
  const { data: suspiciousData, loading: suspLoading, error: suspError } = useApiData(
    () => api.getSuspiciousTrades(suspDays),
    { refreshInterval: 300, deps: [hours] }
  );
  const { data: portfolioData, loading: portfolioLoading, error: portfolioError } = useApiData(
    () => api.getConvictionPortfolio(simMinScore),
    { refreshInterval: 0, deps: [simMinScore] }
  );

  if (error) return <ErrorState error={error} onRetry={retry} />;

  const alerts = alertsData?.alerts || [];
  const totalAlerts = alertsData?.total || 0;
  const totalPages = Math.ceil(totalAlerts / pageSize);
  const congressAlerts = alerts.filter((a) => a.source === "congress");
  const insiderAlerts = alerts.filter((a) => a.source === "insider");
  const suspicious = suspiciousData?.trades || [];

  const sortedSuspicious = [...suspicious].sort((a, b) => {
    if (suspSort === "score") return b.conviction_score - a.conviction_score;
    const dateA = a.tx_date || a.disclosure_date || "";
    const dateB = b.tx_date || b.disclosure_date || "";
    return dateB.localeCompare(dateA);
  });

  const formatPeriod = (h: number) =>
    h < 24 ? `${h}h` : h <= 720 ? `${h / 24}d` : h <= 2160 ? `${Math.round(h / 720)}mo` : "1y";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Bell className="w-6 h-6" />
            Trade Alerts
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Real-time trade disclosures from Congress and corporate insiders
          </p>
        </div>
        <div className="flex gap-2">
          {[24, 168, 720, 2160, 8760].map((h) => (
            <Button
              key={h}
              variant={hours === h ? "default" : "outline"}
              size="sm"
              onClick={() => { setHours(h); setPage(1); }}
            >
              {formatPeriod(h)}
            </Button>
          ))}
        </div>
      </div>

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-4 pb-3">
              <div className="text-xs text-muted-foreground">Last Hour</div>
              <div className="text-2xl font-bold">{summary.periods["1h"]?.total || 0}</div>
              <div className="text-xs text-muted-foreground">new trades</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3">
              <div className="text-xs text-muted-foreground">Last 6 Hours</div>
              <div className="text-2xl font-bold">{summary.periods["6h"]?.total || 0}</div>
              <div className="text-xs text-muted-foreground">new trades</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3">
              <div className="text-xs text-muted-foreground">Last 24 Hours</div>
              <div className="text-2xl font-bold">{summary.periods["24h"]?.total || 0}</div>
              <div className="text-xs text-muted-foreground">new trades</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3">
              <div className="text-xs text-muted-foreground flex items-center gap-1">
                <Flame className="w-3 h-3 text-orange-400" /> Hot Tickers (24h)
              </div>
              <div className="flex flex-wrap gap-1 mt-1">
                {(summary.hot_tickers_24h || []).slice(0, 4).map((t) => (
                  <Badge key={t.ticker} variant="outline" className="text-xs font-mono">
                    {t.ticker} ({t.count})
                  </Badge>
                ))}
                {(!summary.hot_tickers_24h || summary.hot_tickers_24h.length === 0) && (
                  <span className="text-xs text-muted-foreground">No activity</span>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Alert Tables */}
      <Tabs defaultValue="suspicious" className="w-full">
        <TabsList>
          <TabsTrigger value="suspicious" className="gap-1.5">
            <ShieldAlert className="w-3.5 h-3.5" />
            Suspicious ({suspicious.length})
          </TabsTrigger>
          <TabsTrigger value="portfolio" className="gap-1.5">
            <Wallet className="w-3.5 h-3.5" />
            Copy Trade Sim
          </TabsTrigger>
          <TabsTrigger value="all">All ({totalAlerts})</TabsTrigger>
          <TabsTrigger value="congress">
            Congress ({congressAlerts.length})
          </TabsTrigger>
          <TabsTrigger value="insider">
            Insiders ({insiderAlerts.length})
          </TabsTrigger>
        </TabsList>

        {/* Suspicious trades tab */}
        <TabsContent value="suspicious">
          <Card className="border-amber-500/10">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <ShieldAlert className="w-4 h-4 text-amber-400" />
                  Suspicious Trades
                </CardTitle>
                <div className="flex items-center gap-1">
                  <ArrowUpDown className="w-3.5 h-3.5 text-muted-foreground" />
                  <Button
                    variant={suspSort === "score" ? "default" : "outline"}
                    size="sm"
                    className="h-6 text-xs px-2"
                    onClick={() => setSuspSort("score")}
                  >
                    Score
                  </Button>
                  <Button
                    variant={suspSort === "date" ? "default" : "outline"}
                    size="sm"
                    className="h-6 text-xs px-2"
                    onClick={() => setSuspSort("date")}
                  >
                    Recent
                  </Button>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Trades in the last {formatPeriod(hours)} scored by conviction: committee overlap, political clustering, cross-source confirmation, trade size, disclosure timing, and track record
              </p>
            </CardHeader>
            <CardContent>
              {suspLoading ? (
                <div className="space-y-3">
                  {[...Array(5)].map((_, i) => (
                    <div key={i} className="h-24 bg-muted/30 rounded-lg animate-pulse" />
                  ))}
                </div>
              ) : suspError ? (
                <div className="text-center py-8 text-red-400">
                  <ShieldAlert className="w-8 h-8 mx-auto mb-2 opacity-70" />
                  <p className="font-medium">Failed to load suspicious trades</p>
                  <p className="text-xs text-muted-foreground mt-1">{suspError}</p>
                </div>
              ) : sortedSuspicious.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <ShieldAlert className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p>No suspicious trades detected in the last {formatPeriod(hours)}</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {sortedSuspicious.map((trade) => (
                    <SuspiciousRow key={trade.id} trade={trade} onClick={() => openChart(trade, chartDays)} />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Copy Trade Portfolio Simulation */}
        <TabsContent value="portfolio">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Wallet className="w-4 h-4 text-emerald-400" />
                Copy-Trade Portfolio Simulator
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                What if you had invested $10K in every trade above a conviction score threshold — buying when they buy, selling when they sell?
              </p>
              <div className="flex items-center gap-2 mt-3">
                <span className="text-xs text-muted-foreground whitespace-nowrap">Min Score:</span>
                {[0, 25, 50, 65, 85].map((score) => (
                  <Button
                    key={score}
                    variant={simMinScore === score ? "default" : "outline"}
                    size="sm"
                    className="h-7 text-xs px-3"
                    onClick={() => setSimMinScore(score)}
                  >
                    {score === 0 ? "All" : `${score}+`}
                  </Button>
                ))}
              </div>
            </CardHeader>
            <CardContent>
              {portfolioLoading ? (
                <div className="space-y-3">
                  {[...Array(3)].map((_, i) => (
                    <div key={i} className="h-20 bg-muted/30 rounded-lg animate-pulse" />
                  ))}
                </div>
              ) : portfolioError ? (
                <div className="text-center py-8 text-red-400">
                  <Wallet className="w-8 h-8 mx-auto mb-2 opacity-70" />
                  <p className="font-medium">Failed to run simulation</p>
                  <p className="text-xs text-muted-foreground mt-1">{portfolioError}</p>
                </div>
              ) : !portfolioData || portfolioData.summary.total_positions === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Wallet className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p>No trades with price data meet the {simMinScore}+ conviction threshold</p>
                  <p className="text-xs mt-1">Try lowering the minimum score</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Summary stats */}
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                    <div className="bg-muted/20 rounded-lg p-3 border border-border/50">
                      <div className="text-[11px] text-muted-foreground">Total Return</div>
                      <div className={`text-xl font-bold font-mono ${portfolioData.summary.total_return_pct >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                        {portfolioData.summary.total_return_pct >= 0 ? "+" : ""}{portfolioData.summary.total_return_pct.toFixed(1)}%
                      </div>
                    </div>
                    <div className="bg-muted/20 rounded-lg p-3 border border-border/50">
                      <div className="text-[11px] text-muted-foreground">P&L</div>
                      <div className={`text-xl font-bold font-mono ${portfolioData.summary.total_pnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                        {portfolioData.summary.total_pnl >= 0 ? "+" : ""}${(portfolioData.summary.total_pnl / 1000).toFixed(1)}K
                      </div>
                    </div>
                    <div className="bg-muted/20 rounded-lg p-3 border border-border/50">
                      <div className="text-[11px] text-muted-foreground">Win Rate</div>
                      <div className="text-xl font-bold font-mono">{portfolioData.summary.win_rate.toFixed(0)}%</div>
                    </div>
                    <div className="bg-muted/20 rounded-lg p-3 border border-border/50">
                      <div className="text-[11px] text-muted-foreground">Positions</div>
                      <div className="text-xl font-bold font-mono">{portfolioData.summary.total_positions}</div>
                      <div className="text-[10px] text-muted-foreground">
                        {portfolioData.summary.open_positions} open · {portfolioData.summary.closed_positions} closed
                      </div>
                    </div>
                    <div className="bg-muted/20 rounded-lg p-3 border border-border/50">
                      <div className="text-[11px] text-muted-foreground">Avg Holding</div>
                      <div className="text-xl font-bold font-mono">
                        {portfolioData.summary.avg_holding_days ? `${portfolioData.summary.avg_holding_days}d` : "-"}
                      </div>
                    </div>
                  </div>

                  {/* Investment summary bar */}
                  <div className="flex items-center justify-between text-xs bg-muted/10 rounded-lg px-4 py-2 border border-border/30">
                    <span>Invested: <span className="font-mono font-semibold">${(portfolioData.summary.total_invested / 1000).toFixed(0)}K</span></span>
                    <span>Current Value: <span className="font-mono font-semibold">${(portfolioData.summary.total_current_value / 1000).toFixed(0)}K</span></span>
                    <span>Avg Return: <span className={`font-mono font-semibold ${portfolioData.summary.avg_return_pct >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                      {portfolioData.summary.avg_return_pct >= 0 ? "+" : ""}{portfolioData.summary.avg_return_pct.toFixed(1)}%
                    </span></span>
                    {portfolioData.summary.best_trade_pct != null && (
                      <span>Best: <span className="font-mono font-semibold text-emerald-400">+{portfolioData.summary.best_trade_pct.toFixed(1)}%</span></span>
                    )}
                    {portfolioData.summary.worst_trade_pct != null && (
                      <span>Worst: <span className="font-mono font-semibold text-red-400">{portfolioData.summary.worst_trade_pct.toFixed(1)}%</span></span>
                    )}
                  </div>

                  {/* Position table */}
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-8"></TableHead>
                        <TableHead>Ticker</TableHead>
                        <TableHead>Trader</TableHead>
                        <TableHead>Score</TableHead>
                        <TableHead>Entry</TableHead>
                        <TableHead>Exit</TableHead>
                        <TableHead>Return</TableHead>
                        <TableHead>P&L</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {portfolioData.positions.slice(0, 100).map((pos) => {
                        const ratingCfg = RATING_CONFIG[pos.conviction_rating] || RATING_CONFIG.VERY_LOW;
                        return (
                          <TableRow key={pos.id}>
                            <TableCell>
                              {pos.source === "congress" ? (
                                <Landmark className="w-4 h-4 text-blue-400" />
                              ) : (
                                <UserCheck className="w-4 h-4 text-purple-400" />
                              )}
                            </TableCell>
                            <TableCell className="font-mono font-semibold">{pos.ticker}</TableCell>
                            <TableCell>
                              <div className="text-sm">{pos.politician}</div>
                              {pos.party && <div className="text-[10px] text-muted-foreground">{pos.party}</div>}
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className={`text-[10px] ${ratingCfg.color}`}>
                                {pos.conviction_score}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-xs">
                              <div className="font-mono">${pos.entry_price.toFixed(2)}</div>
                              <div className="text-muted-foreground">{pos.entry_date ? new Date(pos.entry_date).toLocaleDateString() : "-"}</div>
                            </TableCell>
                            <TableCell className="text-xs">
                              <div className="font-mono">${pos.exit_price.toFixed(2)}</div>
                              <div className="text-muted-foreground">
                                {pos.exit_date ? new Date(pos.exit_date).toLocaleDateString() : "now"}
                              </div>
                            </TableCell>
                            <TableCell>
                              <span className={`font-mono font-semibold text-sm ${pos.return_pct >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                                {pos.return_pct >= 0 ? "+" : ""}{pos.return_pct.toFixed(1)}%
                              </span>
                            </TableCell>
                            <TableCell>
                              <span className={`font-mono text-sm ${pos.pnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                                {pos.pnl >= 0 ? "+" : ""}${pos.pnl.toLocaleString()}
                              </span>
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className={`text-[10px] ${
                                pos.status === "holding"
                                  ? "bg-blue-500/10 text-blue-400 border-blue-500/20"
                                  : "bg-slate-500/10 text-slate-400 border-slate-500/20"
                              }`}>
                                {pos.status === "holding" ? "Holding" : "Closed"}
                                {pos.holding_days != null && ` · ${pos.holding_days}d`}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                  {portfolioData.positions.length > 100 && (
                    <p className="text-xs text-muted-foreground text-center mt-2">
                      Showing top 100 of {portfolioData.positions.length} positions
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {["all", "congress", "insider"].map((tab) => {
          const filtered =
            tab === "all"
              ? alerts
              : tab === "congress"
                ? congressAlerts
                : insiderAlerts;
          return (
            <TabsContent key={tab} value={tab}>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">
                    {loading
                      ? "Loading alerts..."
                      : `${totalAlerts} alerts in the last ${formatPeriod(hours)}`
                    }
                    {totalAlerts > pageSize && (
                      <span className="text-xs text-muted-foreground font-normal ml-2">
                        (showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, totalAlerts)})
                      </span>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {loading ? (
                    <div className="space-y-2">
                      {[...Array(5)].map((_, i) => (
                        <div key={i} className="h-12 bg-muted/30 rounded animate-pulse" />
                      ))}
                    </div>
                  ) : filtered.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <Bell className="w-8 h-8 mx-auto mb-2 opacity-50" />
                      <p>No alerts in this time period</p>
                    </div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-8"></TableHead>
                          <TableHead>Trader</TableHead>
                          <TableHead>Action</TableHead>
                          <TableHead>Ticker</TableHead>
                          <TableHead>Amount</TableHead>
                          <TableHead>Return</TableHead>
                          <TableHead>When</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filtered.map((alert) => (
                          <AlertRow key={alert.id} alert={alert} />
                        ))}
                      </TableBody>
                    </Table>
                  )}

                  {/* Pagination */}
                  {totalPages > 1 && (
                    <div className="flex items-center justify-between mt-4 pt-4 border-t border-border/50">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={page <= 1}
                        onClick={() => setPage(page - 1)}
                      >
                        <ChevronLeft className="w-4 h-4 mr-1" /> Previous
                      </Button>
                      <span className="text-xs text-muted-foreground">
                        Page {page} of {totalPages}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={page >= totalPages}
                        onClick={() => setPage(page + 1)}
                      >
                        Next <ChevronRight className="w-4 h-4 ml-1" />
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          );
        })}
      </Tabs>

      {/* Chart Sheet */}
      <Sheet open={!!chartTrade} onOpenChange={(open) => { if (!open) setChartTrade(null); }}>
        <SheetContent side="right" className="sm:max-w-2xl w-full overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <BarChart2 className="w-5 h-5" />
              <span className="font-mono text-lg">{chartTrade?.ticker}</span>
              {chartTrade?.asset_description && chartTrade.asset_description !== chartTrade.ticker && (
                <span className="text-sm font-normal text-muted-foreground truncate">
                  {chartTrade.asset_description}
                </span>
              )}
            </SheetTitle>
            <SheetDescription>
              Stock price with buy/sell trade markers
            </SheetDescription>
          </SheetHeader>

          {/* Period toggle */}
          <div className="flex gap-1 px-4">
            {[
              { label: "3M", days: 90 },
              { label: "6M", days: 180 },
              { label: "1Y", days: 365 },
              { label: "2Y", days: 730 },
              { label: "ALL", days: 1825 },
            ].map((p) => (
              <button
                key={p.label}
                onClick={() => setChartDays(p.days)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                  chartDays === p.days
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Politician filter toggle */}
          <div className="flex gap-1 px-4">
            <button
              onClick={() => setChartFilter("politician")}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                chartFilter === "politician"
                  ? "bg-purple-500/20 text-purple-400 border border-purple-500/30"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted border border-transparent"
              }`}
            >
              {chartTrade?.politician} only
            </button>
            <button
              onClick={() => setChartFilter("all")}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                chartFilter === "all"
                  ? "bg-blue-500/20 text-blue-400 border border-blue-500/30"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted border border-transparent"
              }`}
            >
              All traders
            </button>
          </div>

          {/* Chart */}
          <div className="px-4">
            {chartLoading ? (
              <div className="h-64 flex items-center justify-center text-muted-foreground">
                <Loader2 className="w-6 h-6 animate-spin mr-2" />
                Loading price data...
              </div>
            ) : chartData && chartData.prices.length > 0 ? (
              (() => {
                const cData = buildChartData(
                  chartData,
                  chartFilter === "politician" ? chartTrade?.politician || null : null,
                );
                return (
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={cData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
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
                          tickFormatter={(v: number) => `$${v.toFixed(0)}`}
                          axisLine={false}
                          tickLine={false}
                          width={55}
                          domain={["auto", "auto"]}
                        />
                        <RechartsTooltip
                          contentStyle={{
                            background: "#0f0f1a",
                            border: "1px solid #2a2a3e",
                            borderRadius: "10px",
                            fontSize: "12px",
                            boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
                          }}
                          content={({ active, payload, label }) => {
                            if (!active || !payload?.length) return null;
                            const item = payload[0]?.payload;
                            return (
                              <div className="bg-[#0f0f1a] border border-[#2a2a3e] rounded-lg p-3 text-xs shadow-lg">
                                <div className="text-muted-foreground mb-1">{label}</div>
                                <div className="font-mono font-bold text-sm">${item?.close?.toFixed(2)}</div>
                                {item?.buyTrades?.map((t: { politician: string }, i: number) => (
                                  <div key={`b${i}`} className="text-emerald-400 mt-1">BUY — {t.politician}</div>
                                ))}
                                {item?.sellTrades?.map((t: { politician: string }, i: number) => (
                                  <div key={`s${i}`} className="text-red-400 mt-1">SELL — {t.politician}</div>
                                ))}
                              </div>
                            );
                          }}
                        />
                        <Line
                          type="monotone"
                          dataKey="close"
                          stroke="#8b5cf6"
                          strokeWidth={2}
                          dot={(props) => {
                            const { cx, cy, payload } = props as { cx?: number; cy?: number; payload?: { buyMarker?: number; sellMarker?: number } };
                            if (cx == null || cy == null || !payload) return <circle r={0} />;
                            if (payload.buyMarker && payload.sellMarker) {
                              return (
                                <g key={`${cx}-${cy}`}>
                                  <circle cx={cx - 4} cy={cy} r={5} fill="#10b981" stroke="#0f0f1a" strokeWidth={1.5} />
                                  <circle cx={cx + 4} cy={cy} r={5} fill="#ef4444" stroke="#0f0f1a" strokeWidth={1.5} />
                                </g>
                              );
                            }
                            if (payload.buyMarker) {
                              return <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={5} fill="#10b981" stroke="#0f0f1a" strokeWidth={1.5} />;
                            }
                            if (payload.sellMarker) {
                              return <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={5} fill="#ef4444" stroke="#0f0f1a" strokeWidth={1.5} />;
                            }
                            return <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={0} fill="transparent" />;
                          }}
                          activeDot={{ r: 4, fill: "#8b5cf6" }}
                        />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                );
              })()
            ) : (
              <div className="h-64 flex items-center justify-center text-sm text-muted-foreground">
                No price data available for {chartTrade?.ticker}
              </div>
            )}
          </div>

          {/* Legend */}
          <div className="flex gap-4 px-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" /> Buy
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-red-500 inline-block" /> Sell
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-violet-500 inline-block" /> Price
            </span>
          </div>

          {/* Trade list */}
          {chartData && (
            <div className="px-4 space-y-2 pb-4">
              <div className="text-xs text-muted-foreground font-medium">
                Trades ({chartFilter === "politician" ? chartTrade?.politician : "All traders"})
              </div>
              {(chartFilter === "politician"
                ? chartData.trades.filter((t) => t.politician === chartTrade?.politician)
                : chartData.trades
              ).length === 0 ? (
                <div className="text-xs text-muted-foreground py-2">No trades in this period</div>
              ) : (
                (chartFilter === "politician"
                  ? chartData.trades.filter((t) => t.politician === chartTrade?.politician)
                  : chartData.trades
                ).map((t, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between text-xs p-2 rounded bg-muted/20 border border-border/30"
                  >
                    <div className="flex items-center gap-2">
                      <span className={`font-semibold ${t.type === "buy" ? "text-emerald-400" : "text-red-400"}`}>
                        {t.type === "buy" ? "BUY" : "SELL"}
                      </span>
                      <span>{t.politician}</span>
                      {t.source === "congress" ? (
                        <Landmark className="w-3 h-3 text-blue-400" />
                      ) : (
                        <UserCheck className="w-3 h-3 text-purple-400" />
                      )}
                      {t.party && <span className="text-muted-foreground">{t.party}</span>}
                    </div>
                    <div className="text-muted-foreground font-mono">
                      {t.date} {t.price ? `@ $${t.price.toFixed(2)}` : ""}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
