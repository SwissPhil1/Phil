"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { Trophy, Medal } from "lucide-react";

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
          Most active politician-traders ranked by year — who trades the most?
        </p>
      </div>

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
                      <div className="font-medium text-sm">{winner.politician}</div>
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
                      <div className={`w-7 text-center font-mono-data text-sm font-bold ${
                        entry.rank === 1 ? "text-yellow-400" :
                        entry.rank === 2 ? "text-gray-400" :
                        entry.rank === 3 ? "text-orange-400" : "text-muted-foreground"
                      }`}>
                        {entry.rank}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm truncate">{entry.politician}</span>
                          {entry.party && (
                            <Badge variant="outline" className={`text-[10px] px-1.5 ${
                              entry.party === "R" ? "bg-red-500/10 text-red-400 border-red-500/20" :
                              entry.party === "D" ? "bg-blue-500/10 text-blue-400 border-blue-500/20" : ""
                            }`}>{entry.party}</Badge>
                          )}
                          {entry.state && (
                            <span className="text-[10px] text-muted-foreground">{entry.state}</span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-4 shrink-0">
                        <div className="text-right">
                          <div className="font-mono-data text-sm font-medium">{entry.total_trades}</div>
                          <div className="text-[10px] text-muted-foreground">trades</div>
                        </div>
                        {entry.avg_return_pct != null && (
                          <div className="text-right w-16">
                            <div className={`font-mono-data text-sm font-medium ${entry.avg_return_pct >= 0 ? "text-green-400" : "text-red-400"}`}>
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
    </div>
  );
}
