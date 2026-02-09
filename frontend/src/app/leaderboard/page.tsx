"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { Trophy, Medal, TrendingUp } from "lucide-react";

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

export default function LeaderboardPage() {
  const [data, setData] = useState<LeaderboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const result = await api.getLeaderboard();
        setData(result as unknown as LeaderboardData);
      } catch {}
      setLoading(false);
    }
    load();
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Leaderboard</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Who are the best (and worst) investor-politicians? Year-over-year rankings.
        </p>
      </div>

      {loading ? (
        <div className="space-y-4">
          {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}
        </div>
      ) : !data ? (
        <Card>
          <CardContent className="p-6 text-center text-muted-foreground">
            No leaderboard data available yet. Data is being ingested...
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
                  Consistent Winners (Multi-Year)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {data.consistent_winners.slice(0, 6).map((winner, i) => (
                    <div key={i} className="p-3 rounded-lg bg-muted/30 flex items-center justify-between">
                      <div>
                        <div className="font-medium text-sm">{winner.politician}</div>
                        <div className="text-xs text-muted-foreground">{winner.years_active} years active</div>
                      </div>
                      <div className="text-right">
                        <div className={`font-mono-data font-bold ${winner.avg_return_all_years >= 0 ? "text-green-400" : "text-red-400"}`}>
                          {winner.avg_return_all_years >= 0 ? "+" : ""}{winner.avg_return_all_years.toFixed(1)}%
                        </div>
                        <div className="text-xs text-muted-foreground">avg rank #{winner.avg_rank.toFixed(0)}</div>
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
                  {year} Rankings
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-xs text-muted-foreground">
                        <th className="text-left py-2 pr-3">#</th>
                        <th className="text-left py-2 px-3">Politician</th>
                        <th className="text-left py-2 px-3">Party</th>
                        <th className="text-right py-2 px-3">Trades</th>
                        <th className="text-right py-2 px-3">Avg Return</th>
                        <th className="text-right py-2 pl-3">Win Rate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {yearData.top_10.map((entry) => (
                        <tr key={entry.rank} className="border-b border-border/30 hover:bg-muted/30">
                          <td className="py-2 pr-3 font-mono-data">
                            {entry.rank <= 3 ? (
                              <span className={entry.rank === 1 ? "text-yellow-400" : entry.rank === 2 ? "text-gray-400" : "text-orange-400"}>
                                {entry.rank}
                              </span>
                            ) : entry.rank}
                          </td>
                          <td className="py-2 px-3 font-medium">{entry.politician}</td>
                          <td className="py-2 px-3">
                            <Badge variant="outline" className={
                              entry.party === "R" ? "bg-red-500/10 text-red-400 border-red-500/20" :
                              entry.party === "D" ? "bg-blue-500/10 text-blue-400 border-blue-500/20" : ""
                            }>{entry.party}</Badge>
                          </td>
                          <td className="py-2 px-3 text-right font-mono-data">{entry.total_trades}</td>
                          <td className="py-2 px-3 text-right">
                            {entry.avg_return_pct !== null ? (
                              <span className={`font-mono-data ${entry.avg_return_pct >= 0 ? "text-green-400" : "text-red-400"}`}>
                                {entry.avg_return_pct >= 0 ? "+" : ""}{entry.avg_return_pct.toFixed(1)}%
                              </span>
                            ) : "-"}
                          </td>
                          <td className="py-2 pl-3 text-right font-mono-data">
                            {entry.win_rate_pct !== null ? `${entry.win_rate_pct.toFixed(0)}%` : "-"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          ))}
        </>
      )}
    </div>
  );
}
