"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { TrendingUp } from "lucide-react";

export default function PredictionMarketsPage() {
  const [polyTraders, setPolyTraders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const poly = await api.getPolymarketLeaderboard();
        setPolyTraders(Array.isArray(poly) ? poly : []);
      } catch {}
      setLoading(false);
    }
    load();
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Prediction Markets</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Top traders on Polymarket — who&apos;s making the biggest bets and winning
        </p>
      </div>

      {/* Stats */}
      {!loading && polyTraders.length > 0 && (
        <div className="grid grid-cols-3 gap-4">
          <Card>
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground">Top Traders</div>
              <div className="text-2xl font-bold font-mono-data mt-1">{polyTraders.length}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground">Top All-Time PnL</div>
              <div className="text-2xl font-bold font-mono-data mt-1 text-green-400">
                {polyTraders[0]?.pnl_all ? `$${(polyTraders[0].pnl_all / 1_000_000).toFixed(1)}M` : "-"}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground">Total Volume (Top 50)</div>
              <div className="text-2xl font-bold font-mono-data mt-1">
                ${(polyTraders.reduce((sum: number, t: any) => sum + (t.volume_all || 0), 0) / 1e9).toFixed(1)}B
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-orange-400" />
            Polymarket Leaderboard
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3">
              {[...Array(8)].map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
            </div>
          ) : polyTraders.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              No Polymarket data yet.
            </p>
          ) : (
            <div className="space-y-2">
              {polyTraders.slice(0, 30).map((trader: any, i: number) => (
                <div key={i} className="flex items-center gap-4 p-3 rounded-lg hover:bg-muted/30 transition-colors">
                  <div className="w-8 text-center font-mono-data text-sm text-muted-foreground">
                    {trader.rank_all || i + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm truncate">
                      {trader.username || (trader.wallet ? trader.wallet.slice(0, 8) + "..." : `Trader ${i + 1}`)}
                    </div>
                    <div className="flex items-center gap-3 mt-0.5">
                      <span className="text-xs text-muted-foreground">
                        Vol: {trader.volume_all ? `$${(trader.volume_all / 1_000_000).toFixed(1)}M` : "-"}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        Portfolio: {trader.portfolio_value ? `$${(trader.portfolio_value / 1000).toFixed(0)}K` : "-"}
                      </span>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className={`font-mono-data text-sm font-bold ${(trader.pnl_all || 0) >= 0 ? "text-green-400" : "text-red-400"}`}>
                      {trader.pnl_all ? `${trader.pnl_all >= 0 ? "+" : ""}$${Math.abs(trader.pnl_all / 1000).toFixed(0)}K` : "-"}
                    </div>
                    <div className="text-[10px] text-muted-foreground">all-time PnL</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
