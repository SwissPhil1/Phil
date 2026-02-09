"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { api, type Trade } from "@/lib/api";
import { Landmark, ArrowUpRight, ArrowDownRight } from "lucide-react";

function formatAmount(low: number, high: number) {
  const fmt = (n: number) => {
    if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
    return `$${n}`;
  };
  return `${fmt(low)} - ${fmt(high)}`;
}

export default function CongressPage() {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const recent = await api.getRecentTrades();
        setTrades(Array.isArray(recent) ? recent : []);
      } catch {}
      setLoading(false);
    }
    load();
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Congressional Trades</h1>
        <p className="text-muted-foreground text-sm mt-1">
          STOCK Act disclosures from House and Senate members
        </p>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Landmark className="w-4 h-4" />
            All Trades
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3">
              {[...Array(8)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : trades.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              No trades loaded yet. Data ingestion in progress...
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-xs text-muted-foreground">
                    <th className="text-left py-2 pr-3">Type</th>
                    <th className="text-left py-2 px-3">Politician</th>
                    <th className="text-left py-2 px-3">Party</th>
                    <th className="text-left py-2 px-3">Ticker</th>
                    <th className="text-left py-2 px-3">Date</th>
                    <th className="text-right py-2 px-3">Amount</th>
                    <th className="text-right py-2 pl-3">Return</th>
                  </tr>
                </thead>
                <tbody>
                  {trades.map((trade, i) => (
                    <tr key={i} className="border-b border-border/30 hover:bg-muted/30">
                      <td className="py-2 pr-3">
                        {trade.tx_type === "purchase" ? (
                          <ArrowUpRight className="w-4 h-4 text-green-400" />
                        ) : (
                          <ArrowDownRight className="w-4 h-4 text-red-400" />
                        )}
                      </td>
                      <td className="py-2 px-3 font-medium">{trade.politician}</td>
                      <td className="py-2 px-3">
                        <Badge variant="outline" className={
                          trade.party === "R" ? "bg-red-500/10 text-red-400 border-red-500/20" :
                          trade.party === "D" ? "bg-blue-500/10 text-blue-400 border-blue-500/20" : ""
                        }>
                          {trade.party}
                        </Badge>
                      </td>
                      <td className="py-2 px-3 font-mono-data font-medium">{trade.ticker}</td>
                      <td className="py-2 px-3 text-muted-foreground">
                        {trade.tx_date ? new Date(trade.tx_date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" }) : "-"}
                      </td>
                      <td className="py-2 px-3 text-right font-mono-data text-xs">
                        {trade.amount_low && trade.amount_high ? formatAmount(trade.amount_low, trade.amount_high) : "-"}
                      </td>
                      <td className="py-2 pl-3 text-right">
                        {trade.return_since_disclosure != null ? (
                          <span className={`font-mono-data ${trade.return_since_disclosure >= 0 ? "text-green-400" : "text-red-400"}`}>
                            {trade.return_since_disclosure >= 0 ? "+" : ""}{trade.return_since_disclosure.toFixed(1)}%
                          </span>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
