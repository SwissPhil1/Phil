"use client";

import { useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { api, type LeaderboardEntry, type UnifiedLeaderboard } from "@/lib/api";
import { Trophy, TrendingUp, Users, BarChart3 } from "lucide-react";
import { useApiData } from "@/lib/hooks";
import { ErrorState, RefreshIndicator } from "@/components/error-state";

type SortColumn = "avg_return" | "win_rate" | "trades" | "cagr" | "total" | "conv_cagr";

function partyBadgeClass(party: string | null) {
  if (party === "R") return "bg-red-500/10 text-red-400 border-red-500/20";
  if (party === "D") return "bg-blue-500/10 text-blue-400 border-blue-500/20";
  return "";
}

function fmtPct(val: number | null | undefined, decimals = 1): string {
  if (val == null) return "—";
  return `${val > 0 ? "+" : ""}${val.toFixed(decimals)}%`;
}

export default function LeaderboardPage() {
  const { data, loading, error, retry, refreshIn } = useApiData<UnifiedLeaderboard>(
    () => api.getLeaderboard(),
    { refreshInterval: 120 }
  );
  const [sortCol, setSortCol] = useState<SortColumn>(() => "avg_return");
  const [chamberFilter, setChamberFilter] = useState<string | null>(null);
  const [sortInitialized, setSortInitialized] = useState(false);

  // Auto-select best default sort based on available data (once)
  if (data?.has_portfolio_data && !sortInitialized) {
    setSortCol("cagr");
    setSortInitialized(true);
  }

  const hasPortfolio = data?.has_portfolio_data ?? false;

  // Build tab list based on available data
  const sortTabs: { key: SortColumn; label: string }[] = hasPortfolio
    ? [
        { key: "cagr", label: "CAGR" },
        { key: "total", label: "Total Return" },
        { key: "conv_cagr", label: "Conviction" },
        { key: "avg_return", label: "Avg/Trade" },
        { key: "win_rate", label: "Win Rate" },
        { key: "trades", label: "Most Active" },
      ]
    : [
        { key: "avg_return", label: "Avg Return" },
        { key: "win_rate", label: "Win Rate" },
        { key: "trades", label: "Most Active" },
      ];

  // Client-side sort
  const sortedEntries = data?.leaderboard
    ? [...data.leaderboard]
        .filter((e) => !chamberFilter || e.chamber === chamberFilter)
        .sort((a, b) => {
          const getVal = (e: LeaderboardEntry) => {
            switch (sortCol) {
              case "cagr": return e.portfolio_cagr_pct ?? -999;
              case "total": return e.portfolio_return_pct ?? -999;
              case "conv_cagr": return e.conviction_cagr_pct ?? -999;
              case "avg_return": return e.avg_return_pct ?? -999;
              case "win_rate": return e.win_rate_pct ?? -999;
              case "trades": return e.total_trades ?? 0;
            }
          };
          return getVal(b) - getVal(a);
        })
        .map((e, i) => ({ ...e, rank: i + 1 }))
    : null;

  // Helper: get main display value for an entry
  function getMainValue(entry: LeaderboardEntry): { val: number | null; label: string; isCount: boolean } {
    switch (sortCol) {
      case "cagr": return { val: entry.portfolio_cagr_pct, label: "CAGR", isCount: false };
      case "total": return { val: entry.portfolio_return_pct, label: "total return", isCount: false };
      case "conv_cagr": return { val: entry.conviction_cagr_pct, label: "conv. CAGR", isCount: false };
      case "avg_return": return { val: entry.avg_return_pct, label: "avg/trade", isCount: false };
      case "win_rate": return { val: entry.win_rate_pct, label: "win rate", isCount: false };
      case "trades": return { val: entry.total_trades, label: "trades", isCount: true };
    }
  }

  // Helper: choose 2 secondary stats that aren't the main column
  function getSecondaryStats(entry: LeaderboardEntry): { val: string; label: string }[] {
    const stats: { val: string; label: string; key: SortColumn }[] = [];

    if (hasPortfolio) {
      if (sortCol !== "cagr") stats.push({ val: fmtPct(entry.portfolio_cagr_pct), label: "CAGR", key: "cagr" });
      if (sortCol !== "total") stats.push({ val: fmtPct(entry.portfolio_return_pct, 0), label: "total", key: "total" });
      if (sortCol !== "avg_return") stats.push({ val: fmtPct(entry.avg_return_pct), label: "avg", key: "avg_return" });
    } else {
      if (sortCol !== "trades") stats.push({ val: String(entry.total_trades), label: "trades", key: "trades" });
      if (sortCol !== "avg_return") stats.push({ val: fmtPct(entry.avg_return_pct), label: "avg return", key: "avg_return" });
      if (sortCol !== "win_rate") stats.push({ val: entry.win_rate_pct != null ? `${entry.win_rate_pct.toFixed(0)}%` : "—", label: "win rate", key: "win_rate" });
    }

    return stats.slice(0, 2);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">Leaderboard</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {hasPortfolio
              ? "Best politician traders ranked by simulated portfolio returns"
              : "Politicians ranked by trading performance"}
          </p>
        </div>
        <RefreshIndicator refreshIn={refreshIn} />
      </div>

      {/* Filters + Sort */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">Chamber:</span>
          <div className="flex gap-1">
            {([
              { key: null, label: "All" },
              { key: "house", label: "House" },
              { key: "senate", label: "Senate" },
            ] as const).map(({ key, label }) => (
              <button
                key={label}
                onClick={() => setChamberFilter(key)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  chamberFilter === key
                    ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted border border-transparent"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">Rank by:</span>
          <div className="flex gap-1 flex-wrap">
            {sortTabs.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setSortCol(key)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  sortCol === key
                    ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted border border-transparent"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {error && !data ? (
        <ErrorState error={error} onRetry={retry} />
      ) : loading ? (
        <div className="space-y-4">
          {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
        </div>
      ) : !sortedEntries || sortedEntries.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground text-sm">
            No leaderboard data available yet. Ensure trades have price data.
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Party Comparison */}
          {data?.party_comparison && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {Object.entries(data.party_comparison)
                .filter(([party]) => party === "D" || party === "R")
                .map(([party, stats]) => {
                  const displayVal = stats.avg_cagr_pct ?? stats.avg_return_pct;
                  const displayLabel = stats.avg_cagr_pct != null ? "avg CAGR" : "avg return/trade";
                  return (
                    <div key={party} className="rounded-xl border border-border bg-card p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <Users className="w-4 h-4 text-muted-foreground" />
                        <Badge variant="outline" className={`text-[10px] px-1.5 ${partyBadgeClass(party)}`}>
                          {party === "D" ? "Democrats" : "Republicans"}
                        </Badge>
                      </div>
                      <div className={`text-xl font-bold font-mono ${displayVal != null ? ((displayVal ?? 0) >= 0 ? "text-emerald-400" : "text-red-400") : ""}`}>
                        {displayVal != null ? fmtPct(displayVal) : "—"}
                      </div>
                      <div className="text-[10px] text-muted-foreground mt-0.5">
                        {displayLabel} ({stats.total_politicians} politicians)
                      </div>
                    </div>
                  );
                })}
              <div className="rounded-xl border border-border bg-card p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Trophy className="w-4 h-4 text-amber-400" />
                  <span className="text-xs text-muted-foreground">Ranked</span>
                </div>
                <div className="text-xl font-bold font-mono">{data.total_ranked}</div>
                <div className="text-[10px] text-muted-foreground mt-0.5">
                  politicians with 3+ trades
                </div>
              </div>
            </div>
          )}

          {/* Leaderboard Table */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-emerald-400" />
                Politician Trading Leaderboard
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                {hasPortfolio
                  ? "Portfolio returns simulated from actual trade disclosures. Equal $10K per trade."
                  : "Ranked by per-trade return and win rate from disclosed stock trades."}
              </p>
            </CardHeader>
            <CardContent>
              <div className="space-y-0">
                {sortedEntries.slice(0, 50).map((entry) => {
                  const main = getMainValue(entry);
                  const secondary = getSecondaryStats(entry);
                  const isPos = (main.val ?? 0) >= 0;

                  // Build subtitle: show useful info
                  const subtitleParts: string[] = [];
                  subtitleParts.push(`${entry.total_trades} trades`);
                  if (hasPortfolio && entry.priced_buy_count > 0) {
                    subtitleParts[0] = `${entry.priced_buy_count} priced buys`;
                  }
                  if (entry.years_active && entry.years_active > 0) {
                    subtitleParts.push(`${entry.years_active.toFixed(1)}yr`);
                  }
                  if (entry.win_rate_pct != null) {
                    subtitleParts.push(`${entry.win_rate_pct.toFixed(0)}% win rate`);
                  }

                  return (
                    <div key={entry.politician} className="flex items-center gap-3 py-3 border-b border-border/30 last:border-0">
                      {/* Rank */}
                      <div className={`w-8 text-center font-mono text-sm font-bold ${
                        entry.rank === 1 ? "text-yellow-400" :
                        entry.rank === 2 ? "text-gray-400" :
                        entry.rank === 3 ? "text-orange-400" : "text-muted-foreground"
                      }`}>
                        {entry.rank}
                      </div>

                      {/* Name + metadata */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <Link
                            href={`/politician/${encodeURIComponent(entry.politician)}`}
                            className="font-medium text-sm truncate hover:underline hover:text-primary transition-colors"
                          >
                            {entry.politician}
                          </Link>
                          {entry.party && (
                            <Badge variant="outline" className={`text-[10px] px-1.5 ${partyBadgeClass(entry.party)}`}>
                              {entry.party}
                            </Badge>
                          )}
                          {entry.state && (
                            <span className="text-[10px] text-muted-foreground">{entry.state}</span>
                          )}
                          {entry.chamber && (
                            <span className="text-[10px] text-muted-foreground capitalize">{entry.chamber}</span>
                          )}
                        </div>
                        <div className="text-[10px] text-muted-foreground mt-0.5">
                          {subtitleParts.join(" · ")}
                        </div>
                      </div>

                      {/* Main Value (what we're sorting by) */}
                      <div className="text-right w-20">
                        <div className={`font-mono text-sm font-bold ${main.isCount ? "text-blue-400" : isPos ? "text-emerald-400" : "text-red-400"}`}>
                          {main.isCount
                            ? (main.val ?? 0).toLocaleString()
                            : main.val != null
                              ? fmtPct(main.val)
                              : "—"}
                        </div>
                        <div className="text-[10px] text-muted-foreground">
                          {main.label}
                        </div>
                      </div>

                      {/* Secondary stats */}
                      {secondary.map((s, i) => (
                        <div key={i} className="text-right w-16 hidden md:block">
                          <div className="font-mono text-xs text-muted-foreground">
                            {s.val}
                          </div>
                          <div className="text-[9px] text-muted-foreground/60">{s.label}</div>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
              {sortedEntries.length > 50 && (
                <div className="text-xs text-muted-foreground text-center pt-3 border-t border-border/50">
                  Showing top 50 of {sortedEntries.length} politicians
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
