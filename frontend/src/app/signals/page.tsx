"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { api, type Signal, type CrossSourceSignal, type BacktestResult } from "@/lib/api";
import { Zap, Target, BarChart3, ArrowRight, Info } from "lucide-react";
import { useMultiApiData } from "@/lib/hooks";
import { ErrorState, RefreshIndicator } from "@/components/error-state";

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

type SignalsData = {
  clusters: Signal[];
  cross_source_signals: CrossSourceSignal[];
  total_high_signals: number;
};

export default function SignalsPage() {
  const { data, loading, errors, hasError, retry, refreshIn } = useMultiApiData<{
    signals: SignalsData;
    backtest: BacktestResult;
  }>(
    {
      signals: () => api.getSignals(),
      backtest: () => api.runBacktest({ days: "365", forward_days: "90", max_trades: "100" }),
    },
    { refreshInterval: 120 }
  );

  const signals = data.signals;
  const backtest = data.backtest;

  const hasClusters = signals?.clusters && signals.clusters.length > 0;
  const hasCrossSource = signals?.cross_source_signals && signals.cross_source_signals.length > 0;
  const hasBacktest = backtest && backtest.trades_with_returns > 0;

  if (hasError && !signals && !backtest) {
    return (
      <div className="space-y-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold">Smart Signals</h1>
            <p className="text-muted-foreground text-sm mt-1">
              AI-powered conviction scoring and cross-source signal detection
            </p>
          </div>
          <RefreshIndicator refreshIn={refreshIn} />
        </div>
        <ErrorState error={Object.values(errors).join("; ") || "Failed to load signals"} onRetry={retry} />
      </div>
    );
  }

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
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">Smart Signals</h1>
          <p className="text-muted-foreground text-sm mt-1">
            AI-powered conviction scoring and cross-source signal detection
          </p>
        </div>
        <RefreshIndicator refreshIn={refreshIn} />
      </div>

      {/* Info about signal detection */}
      <div className="flex items-start gap-3 p-4 rounded-lg bg-blue-500/5 border border-blue-500/10">
        <Info className="w-4 h-4 text-blue-400 mt-0.5 shrink-0" />
        <div className="text-sm text-muted-foreground">
          Signals are generated when <span className="text-foreground font-medium">multiple politicians buy the same stock</span> (clusters)
          or when <span className="text-foreground font-medium">Congress + insiders + hedge funds converge</span> (cross-source).
          The conviction engine scores each trade on 8 factors.
        </div>
      </div>

      {/* Cluster Signals */}
      {hasClusters && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Target className="w-4 h-4 text-yellow-400" />
              Trade Clusters
              <Badge variant="outline" className="text-[10px] ml-1">{signals!.clusters.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {signals!.clusters.map((cluster, i) => (
                <div key={i} className="p-4 rounded-lg bg-muted/30 border border-border/50 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="font-mono-data font-bold">{cluster.ticker}</span>
                      <Badge
                        variant="outline"
                        className={cluster.action === "BUYING" ? "text-green-400 border-green-500/30 text-[10px]" : "text-red-400 border-red-500/30 text-[10px]"}
                      >
                        {cluster.action}
                      </Badge>
                    </div>
                    <SignalBadge strength={cluster.signal_strength} />
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {cluster.politician_count} politicians in {cluster.window_days}-day window
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {cluster.politicians.map((p) => (
                      <span key={p} className="text-xs bg-secondary px-2 py-0.5 rounded">{p}</span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Cross-Source Signals */}
      {hasCrossSource && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Zap className="w-4 h-4 text-orange-400" />
              Cross-Source Convergence
              <Badge variant="outline" className="text-[10px] ml-1">{signals!.cross_source_signals.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {signals!.cross_source_signals.map((signal, i) => (
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
          </CardContent>
        </Card>
      )}

      {/* No signals state */}
      {!hasClusters && !hasCrossSource && (
        <Card>
          <CardContent className="py-12 text-center">
            <Zap className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
            <div className="font-medium text-sm mb-1">No active signals right now</div>
            <p className="text-xs text-muted-foreground max-w-md mx-auto">
              Signals appear when multiple politicians trade the same stock, or when Congress + hedge funds + insiders converge on the same ticker. Check back as more data is ingested.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Backtest Results */}
      {hasBacktest && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <BarChart3 className="w-4 h-4" />
              Conviction Score Backtest
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="p-3 rounded-lg bg-muted/30">
                <div className="text-xs text-muted-foreground">Trades Analyzed</div>
                <div className="text-xl font-bold font-mono-data">{backtest!.trades_with_returns}</div>
              </div>
              <div className="p-3 rounded-lg bg-muted/30">
                <div className="text-xs text-muted-foreground">Statistical Edge</div>
                {backtest!.score_validation?.error ? (
                  <div className="text-sm text-muted-foreground mt-1">{backtest!.score_validation.error}</div>
                ) : (
                  <div className={`text-xl font-bold font-mono-data ${(backtest!.score_validation?.edge_pct ?? 0) > 0 ? "text-green-400" : "text-red-400"}`}>
                    {(backtest!.score_validation?.edge_pct ?? 0) > 0 ? "+" : ""}{(backtest!.score_validation?.edge_pct ?? 0).toFixed(1)}%
                  </div>
                )}
              </div>
              <div className="p-3 rounded-lg bg-muted/30">
                <div className="text-xs text-muted-foreground">Significant</div>
                <div className={`text-xl font-bold ${backtest!.score_validation?.significant_95pct ? "text-green-400" : "text-yellow-400"}`}>
                  {backtest!.score_validation?.significant_95pct ? "Yes (p<0.05)" : "Not yet"}
                </div>
              </div>
            </div>

            {/* Score Buckets */}
            {backtest!.score_bucket_analysis && Object.keys(backtest!.score_bucket_analysis).length > 0 && (
              <div className="space-y-2">
                <div className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Score Bucket Performance</div>
                {Object.entries(backtest!.score_bucket_analysis).map(([bucket, stats]) => (
                  <div key={bucket} className="flex items-center justify-between py-2 border-b border-border/30 last:border-0">
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-medium w-36">{bucket}</span>
                      <span className="text-xs text-muted-foreground">{stats.trade_count} trades</span>
                    </div>
                    <span className={`font-mono-data text-sm ${(stats.avg_return_pct || 0) >= 0 ? "text-green-400" : "text-red-400"}`}>
                      {stats.avg_return_pct != null ? `${stats.avg_return_pct > 0 ? "+" : ""}${stats.avg_return_pct.toFixed(1)}%` : "-"}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
