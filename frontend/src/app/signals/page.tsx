"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, type Signal, type CrossSourceSignal, type BacktestResult } from "@/lib/api";
import { Zap, Target, BarChart3, ArrowRight } from "lucide-react";

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

export default function SignalsPage() {
  const [signals, setSignals] = useState<{
    clusters: Signal[];
    cross_source_signals: CrossSourceSignal[];
    total_high_signals: number;
  } | null>(null);
  const [backtest, setBacktest] = useState<BacktestResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [signalsData, backtestData] = await Promise.allSettled([
          api.getSignals(),
          api.runBacktest({ days: "365", forward_days: "90", max_trades: "100" }),
        ]);
        if (signalsData.status === "fulfilled") setSignals(signalsData.value);
        if (backtestData.status === "fulfilled") setBacktest(backtestData.value);
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
          <h1 className="text-2xl font-bold">Smart Signals</h1>
          <p className="text-muted-foreground text-sm mt-1">Loading signals...</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[...Array(4)].map((_, i) => (
            <Card key={i}><CardContent className="p-6"><Skeleton className="h-24 w-full" /></CardContent></Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Smart Signals</h1>
        <p className="text-muted-foreground text-sm mt-1">
          AI-powered conviction scoring and cross-source signal detection
        </p>
      </div>

      <Tabs defaultValue="clusters">
        <TabsList>
          <TabsTrigger value="clusters" className="gap-1.5">
            <Target className="w-3.5 h-3.5" /> Clusters
          </TabsTrigger>
          <TabsTrigger value="cross-source" className="gap-1.5">
            <Zap className="w-3.5 h-3.5" /> Cross-Source
          </TabsTrigger>
          <TabsTrigger value="backtest" className="gap-1.5">
            <BarChart3 className="w-3.5 h-3.5" /> Backtest
          </TabsTrigger>
        </TabsList>

        {/* Cluster Signals */}
        <TabsContent value="clusters" className="space-y-4 mt-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">
                Trade Clusters - Multiple politicians buying/selling the same stock
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!signals?.clusters?.length ? (
                <p className="text-sm text-muted-foreground py-6 text-center">
                  No active clusters detected. Data is being ingested...
                </p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {signals.clusters.map((cluster, i) => (
                    <div key={i} className="p-4 rounded-lg bg-muted/30 border border-border/50 space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="font-mono-data font-bold">{cluster.ticker}</span>
                          <Badge
                            variant="outline"
                            className={cluster.action === "BUYING" ? "text-green-400 border-green-500/30" : "text-red-400 border-red-500/30"}
                          >
                            {cluster.action}
                          </Badge>
                        </div>
                        <SignalBadge strength={cluster.signal_strength} />
                      </div>

                      <div className="text-sm text-muted-foreground">
                        {cluster.politician_count} politicians in {cluster.window_days}-day window
                        {cluster.is_mega_cap && <span className="text-xs ml-1">(mega-cap)</span>}
                      </div>

                      <div className="flex flex-wrap gap-1">
                        {cluster.politicians.map((p) => (
                          <span key={p} className="text-xs bg-secondary px-2 py-0.5 rounded">
                            {p}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Cross-Source Signals */}
        <TabsContent value="cross-source" className="space-y-4 mt-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">
                Cross-Source Convergence - When Congress + insiders + hedge funds all buy the same stock
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!signals?.cross_source_signals?.length ? (
                <p className="text-sm text-muted-foreground py-6 text-center">
                  No cross-source signals detected yet...
                </p>
              ) : (
                <div className="space-y-3">
                  {signals.cross_source_signals.map((signal, i) => (
                    <div key={i} className="p-4 rounded-lg bg-muted/30 border border-border/50">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className="font-mono-data font-bold text-lg">{signal.ticker}</span>
                          <span className="text-xs text-muted-foreground">{signal.sector}</span>
                        </div>
                        <SignalBadge strength={signal.signal_strength} />
                      </div>

                      <div className="flex items-center gap-2 flex-wrap">
                        {signal.sources.map((src, j) => (
                          <span key={j} className="flex items-center gap-1">
                            <Badge variant="secondary" className="text-xs">{src}</Badge>
                            {j < signal.sources.length - 1 && <ArrowRight className="w-3 h-3 text-muted-foreground" />}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Backtest Results */}
        <TabsContent value="backtest" className="space-y-4 mt-4">
          {!backtest ? (
            <Card>
              <CardContent className="p-6">
                <p className="text-sm text-muted-foreground text-center">
                  Backtest data not available. Run the backtester from the Optimizer page.
                </p>
              </CardContent>
            </Card>
          ) : (
            <>
              {/* Score Validation */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <BarChart3 className="w-4 h-4" />
                    Conviction Score Validation
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="p-3 rounded-lg bg-muted/30">
                      <div className="text-xs text-muted-foreground">Trades Analyzed</div>
                      <div className="text-xl font-bold font-mono-data">{backtest.summary.trades_with_returns}</div>
                    </div>
                    <div className="p-3 rounded-lg bg-muted/30">
                      <div className="text-xs text-muted-foreground">Statistical Edge</div>
                      <div className={`text-xl font-bold font-mono-data ${backtest.score_validation?.edge_pct > 0 ? "text-green-400" : "text-red-400"}`}>
                        {backtest.score_validation?.edge_pct > 0 ? "+" : ""}{backtest.score_validation?.edge_pct?.toFixed(1)}%
                      </div>
                    </div>
                    <div className="p-3 rounded-lg bg-muted/30">
                      <div className="text-xs text-muted-foreground">Statistically Significant</div>
                      <div className={`text-xl font-bold ${backtest.score_validation?.significant_95pct ? "text-green-400" : "text-yellow-400"}`}>
                        {backtest.score_validation?.significant_95pct ? "Yes (p<0.05)" : "Not yet"}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Score Buckets */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Score Bucket Performance</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {Object.entries(backtest.score_bucket_analysis || {}).map(([bucket, stats]) => (
                      <div key={bucket} className="flex items-center justify-between py-2 border-b border-border/30 last:border-0">
                        <div className="flex items-center gap-3">
                          <span className="text-sm font-medium w-36">{bucket}</span>
                          <span className="text-xs text-muted-foreground">{stats.count} trades</span>
                        </div>
                        <div className="flex items-center gap-4">
                          <div className="text-right">
                            <div className="text-xs text-muted-foreground">Avg Return</div>
                            <span className={`font-mono-data text-sm ${(stats.avg || 0) >= 0 ? "text-green-400" : "text-red-400"}`}>
                              {stats.avg != null ? `${stats.avg > 0 ? "+" : ""}${stats.avg.toFixed(1)}%` : "-"}
                            </span>
                          </div>
                          <div className="text-right">
                            <div className="text-xs text-muted-foreground">Win Rate</div>
                            <span className="font-mono-data text-sm">
                              {stats.win_rate != null ? `${stats.win_rate.toFixed(0)}%` : "-"}
                            </span>
                          </div>
                          <div className="text-right">
                            <div className="text-xs text-muted-foreground">Sharpe</div>
                            <span className="font-mono-data text-sm">
                              {stats.sharpe != null ? stats.sharpe.toFixed(2) : "-"}
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {/* Factor Attribution */}
              {backtest.factor_attribution && Object.keys(backtest.factor_attribution).length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Factor Attribution - Which factors predict returns?</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {Object.entries(backtest.factor_attribution)
                        .sort((a, b) => (b[1].edge_pct || 0) - (a[1].edge_pct || 0))
                        .map(([factor, data]) => (
                        <div key={factor} className="flex items-center justify-between py-2 border-b border-border/30 last:border-0">
                          <div>
                            <span className="text-sm font-medium">{factor.replace(/_/g, " ")}</span>
                            <span className="text-xs text-muted-foreground ml-2">({data.trades_with} trades)</span>
                          </div>
                          <div className="flex items-center gap-3">
                            <div className="text-right">
                              <div className="text-xs text-muted-foreground">Edge</div>
                              <span className={`font-mono-data text-sm font-medium ${(data.edge_pct ?? 0) >= 0 ? "text-green-400" : "text-red-400"}`}>
                                {(data.edge_pct ?? 0) >= 0 ? "+" : ""}{(data.edge_pct ?? 0).toFixed(1)}%
                              </span>
                            </div>
                            <div className="text-right">
                              <div className="text-xs text-muted-foreground">Win Rate</div>
                              <span className="font-mono-data text-sm">{(data.win_rate_with ?? 0).toFixed(0)}%</span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
