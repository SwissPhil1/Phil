"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { api, type LeaderboardEntry, type UnifiedLeaderboard } from "@/lib/api";
import { Trophy, TrendingUp, Users } from "lucide-react";

type SortColumn = "cagr" | "total" | "conv_cagr" | "avg_return" | "win_rate" | "trades";

function partyBadgeClass(party: string | null) {
  if (party === "R") return "bg-red-500/10 text-red-400 border-red-500/20";
  if (party === "D") return "bg-blue-500/10 text-blue-400 border-blue-500/20";
  return "";
}

export default function LeaderboardPage() {
  const [data, setData] = useState<UnifiedLeaderboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [sortCol, setSortCol] = useState<SortColumn>("cagr");
  const [chamberFilter, setChamberFilter] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const result = await api.getLeaderboard();
        setData(result);
      } catch {
        // API error
      }
      setLoading(false);
    }
    load();
  }, []);

  // Auto-detect best sort: if portfolio data exists use CAGR, otherwise fall back to trades
  const hasPortfolioData = data?.leaderboard?.some((e) => e.portfolio_cagr_pct != null) ?? false;
  const effectiveSortCol = sortCol === "cagr" && !hasPortfolioData ? "trades" : sortCol;

  // Client-side sort (data comes pre-sorted by CAGR from backend)
  const sortedEntries = data?.leaderboard
    ? [...data.leaderboard]
        .filter((e) => !chamberFilter || e.chamber === chamberFilter)
        .sort((a, b) => {
          const getVal = (e: LeaderboardEntry) => {
            switch (effectiveSortCol) {
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Leaderboard</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Best politician traders ranked by simulated portfolio returns
        </p>
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
          <div className="flex gap-1">
            {([
              { key: "cagr" as const, label: "CAGR" },
              { key: "total" as const, label: "Total Return" },
              { key: "conv_cagr" as const, label: "Conviction" },
              { key: "avg_return" as const, label: "Avg/Trade" },
              { key: "win_rate" as const, label: "Win Rate" },
              { key: "trades" as const, label: "Most Active" },
            ]).map(({ key, label }) => (
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

      {loading ? (
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
                .map(([party, stats]) => (
                  <div key={party} className="rounded-xl border border-border bg-card p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Users className="w-4 h-4 text-muted-foreground" />
                      <Badge variant="outline" className={`text-[10px] px-1.5 ${partyBadgeClass(party)}`}>
                        {party === "D" ? "Democrats" : "Republicans"}
                      </Badge>
                    </div>
                    <div className={`text-xl font-bold font-mono ${(stats.avg_cagr_pct ?? 0) >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                      {(stats.avg_cagr_pct ?? 0) > 0 ? "+" : ""}{stats.avg_cagr_pct?.toFixed(1) ?? "—"}%
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">
                      avg CAGR ({stats.total_politicians} politicians)
                    </div>
                  </div>
                ))}
              <div className="rounded-xl border border-border bg-card p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Trophy className="w-4 h-4 text-amber-400" />
                  <span className="text-xs text-muted-foreground">Ranked</span>
                </div>
                <div className="text-xl font-bold font-mono">{data.total_ranked}</div>
                <div className="text-[10px] text-muted-foreground mt-0.5">
                  politicians with 3+ priced trades
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
                Portfolio returns simulated from actual trade disclosures. Equal $10K per trade.
              </p>
            </CardHeader>
            <CardContent>
              <div className="space-y-0">
                {sortedEntries.slice(0, 50).map((entry) => {
                  const mainVal = effectiveSortCol === "cagr" ? entry.portfolio_cagr_pct
                    : effectiveSortCol === "total" ? entry.portfolio_return_pct
                    : effectiveSortCol === "conv_cagr" ? entry.conviction_cagr_pct
                    : effectiveSortCol === "avg_return" ? entry.avg_return_pct
                    : effectiveSortCol === "win_rate" ? entry.win_rate_pct
                    : entry.total_trades;
                  const isPos = (mainVal ?? 0) >= 0;

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
                          {entry.priced_buy_count} priced buys · {entry.years_active ?? 0}yr track record · {entry.win_rate_pct?.toFixed(0) ?? "—"}% win rate
                        </div>
                      </div>

                      {/* Main Value (what we're sorting by) */}
                      <div className="text-right w-20">
                        <div className={`font-mono text-sm font-bold ${effectiveSortCol === "trades" ? "text-blue-400" : isPos ? "text-emerald-400" : "text-red-400"}`}>
                          {effectiveSortCol === "trades" ? (mainVal ?? 0) : `${(mainVal ?? 0) > 0 ? "+" : ""}${mainVal?.toFixed(1) ?? "—"}${effectiveSortCol === "win_rate" ? "" : "%"}`}
                        </div>
                        <div className="text-[10px] text-muted-foreground">
                          {effectiveSortCol === "cagr" ? "CAGR" : effectiveSortCol === "total" ? "total" : effectiveSortCol === "conv_cagr" ? "conv. CAGR" : effectiveSortCol === "avg_return" ? "avg/trade" : effectiveSortCol === "win_rate" ? "win rate" : "trades"}
                        </div>
                      </div>

                      {/* Secondary: CAGR (if not already showing) */}
                      {sortCol !== "cagr" && (
                        <div className="text-right w-16 hidden md:block">
                          <div className={`font-mono text-xs ${(entry.portfolio_cagr_pct ?? 0) >= 0 ? "text-emerald-400/60" : "text-red-400/60"}`}>
                            {(entry.portfolio_cagr_pct ?? 0) > 0 ? "+" : ""}{entry.portfolio_cagr_pct?.toFixed(1) ?? "—"}%
                          </div>
                          <div className="text-[9px] text-muted-foreground/60">CAGR</div>
                        </div>
                      )}

                      {/* Secondary: Total Return (if not already showing) */}
                      {sortCol !== "total" && (
                        <div className="text-right w-16 hidden md:block">
                          <div className={`font-mono text-xs ${(entry.portfolio_return_pct ?? 0) >= 0 ? "text-blue-400/60" : "text-red-400/60"}`}>
                            {(entry.portfolio_return_pct ?? 0) > 0 ? "+" : ""}{entry.portfolio_return_pct?.toFixed(0) ?? "—"}%
                          </div>
                          <div className="text-[9px] text-muted-foreground/60">total</div>
                        </div>
                      )}
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
