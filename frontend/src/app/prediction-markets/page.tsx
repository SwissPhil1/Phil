"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import { BarChart3, TrendingUp } from "lucide-react";

export default function PredictionMarketsPage() {
  const [polyTraders, setPolyTraders] = useState<any[]>([]);
  const [kalshiMarkets, setKalshiMarkets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [poly, kalshi] = await Promise.allSettled([
          api.getPolymarketLeaderboard(),
          api.getKalshiMarkets(),
        ]);
        if (poly.status === "fulfilled") setPolyTraders(Array.isArray(poly.value) ? poly.value : []);
        if (kalshi.status === "fulfilled") setKalshiMarkets(Array.isArray(kalshi.value) ? kalshi.value : []);
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
          Top traders on Polymarket and event contracts on Kalshi
        </p>
      </div>

      <Tabs defaultValue="polymarket">
        <TabsList>
          <TabsTrigger value="polymarket" className="gap-1.5">
            <TrendingUp className="w-3.5 h-3.5" /> Polymarket
          </TabsTrigger>
          <TabsTrigger value="kalshi" className="gap-1.5">
            <BarChart3 className="w-3.5 h-3.5" /> Kalshi
          </TabsTrigger>
        </TabsList>

        <TabsContent value="polymarket" className="mt-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Top Polymarket Traders</CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="space-y-3">
                  {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
                </div>
              ) : polyTraders.length === 0 ? (
                <p className="text-sm text-muted-foreground py-6 text-center">
                  No Polymarket data yet. Ingestion in progress...
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-xs text-muted-foreground">
                        <th className="text-left py-2 pr-3">#</th>
                        <th className="text-left py-2 px-3">Trader</th>
                        <th className="text-right py-2 px-3">All-Time PnL</th>
                        <th className="text-right py-2 px-3">Month PnL</th>
                        <th className="text-right py-2 px-3">Volume</th>
                        <th className="text-right py-2 pl-3">Portfolio</th>
                      </tr>
                    </thead>
                    <tbody>
                      {polyTraders.slice(0, 20).map((trader: any, i: number) => (
                        <tr key={i} className="border-b border-border/30 hover:bg-muted/30">
                          <td className="py-2 pr-3 font-mono-data">{trader.rank_all || i + 1}</td>
                          <td className="py-2 px-3 font-medium">{trader.username || trader.wallet?.slice(0, 8) + "..."}</td>
                          <td className={`py-2 px-3 text-right font-mono-data ${(trader.pnl_all || 0) >= 0 ? "text-green-400" : "text-red-400"}`}>
                            {trader.pnl_all ? `$${(trader.pnl_all / 1000).toFixed(0)}K` : "-"}
                          </td>
                          <td className={`py-2 px-3 text-right font-mono-data ${(trader.pnl_month || 0) >= 0 ? "text-green-400" : "text-red-400"}`}>
                            {trader.pnl_month ? `$${(trader.pnl_month / 1000).toFixed(0)}K` : "-"}
                          </td>
                          <td className="py-2 px-3 text-right font-mono-data">
                            {trader.volume_all ? `$${(trader.volume_all / 1_000_000).toFixed(1)}M` : "-"}
                          </td>
                          <td className="py-2 pl-3 text-right font-mono-data">
                            {trader.portfolio_value ? `$${(trader.portfolio_value / 1000).toFixed(0)}K` : "-"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="kalshi" className="mt-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Kalshi Event Markets</CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="space-y-3">
                  {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
                </div>
              ) : kalshiMarkets.length === 0 ? (
                <p className="text-sm text-muted-foreground py-6 text-center">
                  No Kalshi data yet. Ingestion in progress...
                </p>
              ) : (
                <div className="space-y-2">
                  {kalshiMarkets.slice(0, 20).map((market: any, i: number) => (
                    <div key={i} className="p-3 rounded-lg bg-muted/30 flex items-center justify-between">
                      <div className="min-w-0 mr-4">
                        <div className="text-sm font-medium truncate">{market.title}</div>
                        <div className="text-xs text-muted-foreground">{market.ticker}</div>
                      </div>
                      <div className="flex items-center gap-4 shrink-0">
                        <div className="text-right">
                          <div className="text-xs text-muted-foreground">Yes Price</div>
                          <div className="font-mono-data">{market.last_price ? `${(market.last_price * 100).toFixed(0)}c` : "-"}</div>
                        </div>
                        <div className="text-right">
                          <div className="text-xs text-muted-foreground">Volume</div>
                          <div className="font-mono-data text-sm">{market.volume?.toLocaleString() || "-"}</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
