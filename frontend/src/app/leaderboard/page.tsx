"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { api, type PortfolioLeaderboardEntry } from "@/lib/api";
import { Trophy, Medal, TrendingUp, Loader2 } from "lucide-react";

interface LeaderboardData {
  leaderboards: Record<string, {
    year: number;
    top_10: {
      rank: number;
      politician: string;
      party: string;
      state: string;
      total_trades: number;
      avg_return_pct: number | null;
      win_rate_pct: number | null;
    }[];
  }>;
  consistent_winners: {
    politician: string;
    avg_return_all_years: number;
    years_active: number;
    avg_rank: number;
  }[];
}

type SortMode = "equal_weight" | "conviction_weighted";

function partyBadgeClass(party: string | null) {
  if (party === "R") return "bg-red-500/10 text-red-400 border-red-500/20";
  if (party === "D") return "bg-blue-500/10 text-blue-400 border-blue-500/20";
  return "";
}

export default function LeaderboardPage() {
  const [data, setData] = useState<LeaderboardData | null>(null);
  const [portfolioData, setPortfolioData] = useState<PortfolioLeaderboardEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [portfolioLoading, setPortfolioLoading] = useState(true);
  const [sortMode, setSortMode] = useState<SortMode>("equal_weight");
  const [activeTab, setActiveTab] = useState<"portfolio" | "yearly">("portfolio");

  useEffect(() => {
    async function load() {
      try {
        const result = await api.getLeaderboard();
        setData(result as unknown as LeaderboardData);
      } catch {}
      setLoading(false);
    }
    async function loadPortfolio() {
      try {
        const result = await api.getPortfolioReturns({ sort_by: sortMode });
        setPortfolioData(result);
      } catch {}
      setPortfolioLoading(false);
    }
    load();
    loadPortfolio();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-sort portfolio data when sort mode changes (client-side)
  const sortedPortfolio = portfolioData
    ? [...portfolioData].sort((a, b) => {
        const aRet = a[sortMode]?.annual_return ?? 0;
        const bRet = b[sortMode]?.annual_return ?? 0;
        return bRet - aRet;
      })
    : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Leaderboard</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Best politician traders ranked by simulated portfolio returns
        </p>
      </div>

      {/* Tab Switcher */}
      <div className="flex gap-1 border-b border-border pb-0">
        {([
          { key: "portfolio" as const, label: "Portfolio Returns", icon: TrendingUp },
          { key: "yearly" as const, label: "Yearly Activity", icon: Trophy },
        ]).map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
              activeTab === key
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {activeTab === "portfolio" ? (
        /* ─── Portfolio Returns Tab ─── */
        <>
          {/* Strategy Toggle */}
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground">Sort by:</span>
            <div className="flex gap-1">
              <button
                onClick={() => setSortMode("equal_weight")}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  sortMode === "equal_weight"
                    ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted border border-transparent"
                }`}
              >
                Copy Trading (Equal Weight)
              </button>
              <button
                onClick={() => setSortMode("conviction_weighted")}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  sortMode === "conviction_weighted"
                    ? "bg-blue-500/20 text-blue-400 border border-blue-500/30"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted border border-transparent"
                }`}
              >
                Conviction Weighted
              </button>
            </div>
          </div>

          {portfolioLoading ? (
            <div className="space-y-4">
              <div className="flex items-center gap-3 text-muted-foreground">
                <Loader2 className="w-5 h-5 animate-spin" />
                <span className="text-sm">Computing portfolio returns for all politicians...</span>
              </div>
              {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
            </div>
          ) : !sortedPortfolio || sortedPortfolio.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground text-sm">
                No portfolio return data available yet. Ensure trades have price data.
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-emerald-400" />
                  Best Traders by {sortMode === "equal_weight" ? "Copy Trading" : "Conviction-Weighted"} Returns
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-1">
                  {sortMode === "equal_weight"
                    ? "Equal $10K per trade — what you'd make copy-trading each politician"
                    : "Position-sized by STOCK Act range (1x–5x) — captures conviction signal"}
                </p>
              </CardHeader>
              <CardContent>
                <div className="space-y-0">
                  {sortedPortfolio.slice(0, 50).map((entry, idx) => {
                    const stats = entry[sortMode];
                    const altStats = entry[sortMode === "equal_weight" ? "conviction_weighted" : "equal_weight"];
                    const isPos = (stats?.annual_return ?? 0) >= 0;
                    return (
                      <div key={entry.politician} className="flex items-center gap-3 py-3 border-b border-border/30 last:border-0">
                        {/* Rank */}
                        <div className={`w-8 text-center font-mono text-sm font-bold ${
                          idx === 0 ? "text-yellow-400" :
                          idx === 1 ? "text-gray-400" :
                          idx === 2 ? "text-orange-400" : "text-muted-foreground"
                        }`}>
                          {idx + 1}
                        </div>

                        {/* Name + party */}
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
                            {entry.total_trades} buy trades · {stats?.years ?? 0}yr track record
                          </div>
                        </div>

                        {/* Annual Return (CAGR) */}
                        <div className="text-right w-20">
                          <div className={`font-mono text-sm font-bold ${isPos ? "text-emerald-400" : "text-red-400"}`}>
                            {(stats?.annual_return ?? 0) > 0 ? "+" : ""}{stats?.annual_return?.toFixed(1) ?? "0"}%
                          </div>
                          <div className="text-[10px] text-muted-foreground">CAGR</div>
                        </div>

                        {/* Total Return */}
                        <div className="text-right w-20">
                          <div className={`font-mono text-sm font-medium ${(stats?.total_return ?? 0) >= 0 ? "text-emerald-400/80" : "text-red-400/80"}`}>
                            {(stats?.total_return ?? 0) > 0 ? "+" : ""}{stats?.total_return?.toFixed(0) ?? "0"}%
                          </div>
                          <div className="text-[10px] text-muted-foreground">total</div>
                        </div>

                        {/* Alt strategy comparison */}
                        <div className="text-right w-16 hidden md:block">
                          <div className={`font-mono text-xs ${(altStats?.annual_return ?? 0) >= 0 ? "text-blue-400/60" : "text-red-400/60"}`}>
                            {(altStats?.annual_return ?? 0) > 0 ? "+" : ""}{altStats?.annual_return?.toFixed(1) ?? "0"}%
                          </div>
                          <div className="text-[9px] text-muted-foreground/60">
                            {sortMode === "equal_weight" ? "conv." : "eq.wt."}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {sortedPortfolio.length > 50 && (
                  <div className="text-xs text-muted-foreground text-center pt-3 border-t border-border/50">
                    Showing top 50 of {sortedPortfolio.length} politicians
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </>
      ) : (
        /* ─── Yearly Activity Tab (original leaderboard) ─── */
        <>
          {loading ? (
            <div className="space-y-4">
              {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}
            </div>
          ) : !data ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground text-sm">
                No leaderboard data available yet.
              </CardContent>
            </Card>
          ) : (
            <>
              {/* Consistent Winners */}
              {data.consistent_winners && data.consistent_winners.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Medal className="w-4 h-4 text-yellow-400" />
                      Most Consistent Traders
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                      {data.consistent_winners.slice(0, 6).map((winner, i) => (
                        <div key={i} className="p-4 rounded-lg bg-muted/30 border border-border/50">
                          <Link href={`/politician/${encodeURIComponent(winner.politician)}`} className="font-medium text-sm hover:underline hover:text-primary transition-colors">{winner.politician}</Link>
                          <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                            <span>{winner.years_active} years active</span>
                            <span>Avg rank #{(winner.avg_rank ?? 0).toFixed(0)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Yearly Leaderboards */}
              {Object.entries(data.leaderboards)
                .sort(([a], [b]) => Number(b) - Number(a))
                .map(([year, yearData]) => (
                <Card key={year}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Trophy className="w-4 h-4" />
                      {year} — Most Active Traders
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-1">
                      {yearData.top_10.map((entry) => (
                        <div key={entry.rank} className="flex items-center gap-3 py-2.5 border-b border-border/30 last:border-0">
                          <div className={`w-7 text-center font-mono text-sm font-bold ${
                            entry.rank === 1 ? "text-yellow-400" :
                            entry.rank === 2 ? "text-gray-400" :
                            entry.rank === 3 ? "text-orange-400" : "text-muted-foreground"
                          }`}>
                            {entry.rank}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <Link href={`/politician/${encodeURIComponent(entry.politician)}`} className="font-medium text-sm truncate hover:underline hover:text-primary transition-colors">{entry.politician}</Link>
                              {entry.party && (
                                <Badge variant="outline" className={`text-[10px] px-1.5 ${partyBadgeClass(entry.party)}`}>{entry.party}</Badge>
                              )}
                              {entry.state && (
                                <span className="text-[10px] text-muted-foreground">{entry.state}</span>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-4 shrink-0">
                            <div className="text-right">
                              <div className="font-mono text-sm font-medium">{entry.total_trades}</div>
                              <div className="text-[10px] text-muted-foreground">trades</div>
                            </div>
                            {entry.avg_return_pct != null && (
                              <div className="text-right w-16">
                                <div className={`font-mono text-sm font-medium ${entry.avg_return_pct >= 0 ? "text-green-400" : "text-red-400"}`}>
                                  {entry.avg_return_pct >= 0 ? "+" : ""}{entry.avg_return_pct.toFixed(1)}%
                                </div>
                                <div className="text-[10px] text-muted-foreground">avg return</div>
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </>
          )}
        </>
      )}
    </div>
  );
}
