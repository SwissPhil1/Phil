"use client";

import { useState } from "react";
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
import { api, AlertItem, SuspiciousTrade, ConvictionPortfolioResponse } from "@/lib/api";
import { useApiData } from "@/lib/hooks";
import { ErrorState } from "@/components/error-state";
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
  ArrowUp,
  ArrowDown,
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

function SuspiciousRow({ trade }: { trade: SuspiciousTrade }) {
  const rating = RATING_CONFIG[trade.conviction_rating] || RATING_CONFIG.VERY_LOW;

  return (
    <div className="p-4 rounded-lg bg-muted/20 border border-border/50 space-y-2">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          {trade.source === "congress" ? (
            <Landmark className="w-4 h-4 text-blue-400" />
          ) : (
            <UserCheck className="w-4 h-4 text-purple-400" />
          )}
          <span className="font-mono text-base font-bold">{trade.ticker}</span>
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

export default function AlertsPage() {
  const [hours, setHours] = useState(168);
  const [page, setPage] = useState(1);
  const [suspSort, setSuspSort] = useState<"score" | "date">("score");
  const [simMinScore, setSimMinScore] = useState(50);
  const pageSize = 100;

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
                    <SuspiciousRow key={trade.id} trade={trade} />
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
    </div>
  );
}
