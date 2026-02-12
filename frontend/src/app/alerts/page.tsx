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
import { api, AlertItem } from "@/lib/api";
import { useApiData } from "@/lib/hooks";
import { ErrorState } from "@/components/error-state";
import { Bell, TrendingUp, TrendingDown, Clock, Flame, Landmark, UserCheck } from "lucide-react";

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
  return `${diffD}d ago`;
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

export default function AlertsPage() {
  const [hours, setHours] = useState(24);
  const { data: alertsData, loading, error, retry } = useApiData(
    () => api.getRecentAlerts(hours),
    { refreshInterval: 60 }
  );
  const { data: summary } = useApiData(() => api.getAlertsSummary(), { refreshInterval: 120 });

  if (error) return <ErrorState error={error} onRetry={retry} />;

  const alerts = alertsData?.alerts || [];
  const congressAlerts = alerts.filter((a) => a.source === "congress");
  const insiderAlerts = alerts.filter((a) => a.source === "insider");

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
          {[6, 24, 48, 168].map((h) => (
            <Button
              key={h}
              variant={hours === h ? "default" : "outline"}
              size="sm"
              onClick={() => setHours(h)}
            >
              {h < 24 ? `${h}h` : `${h / 24}d`}
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
      <Tabs defaultValue="all" className="w-full">
        <TabsList>
          <TabsTrigger value="all">All ({alerts.length})</TabsTrigger>
          <TabsTrigger value="congress">
            Congress ({congressAlerts.length})
          </TabsTrigger>
          <TabsTrigger value="insider">
            Insiders ({insiderAlerts.length})
          </TabsTrigger>
        </TabsList>

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
                    {loading ? "Loading alerts..." : `${filtered.length} alerts in the last ${hours < 24 ? `${hours}h` : `${hours / 24}d`}`}
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
                </CardContent>
              </Card>
            </TabsContent>
          );
        })}
      </Tabs>
    </div>
  );
}
