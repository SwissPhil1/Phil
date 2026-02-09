"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { ArrowUpRight } from "lucide-react";

export default function InsidersPage() {
  const [buys, setBuys] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const data = await api.getInsiderBuys();
        setBuys(Array.isArray(data) ? data : []);
      } catch {}
      setLoading(false);
    }
    load();
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Corporate Insider Trades</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Form 4 filings - CEOs, directors, and 10%+ owners buying and selling their own stock
        </p>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <ArrowUpRight className="w-4 h-4 text-green-400" />
            Recent Insider Purchases
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3">
              {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : buys.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              No insider trade data yet. Form 4 ingestion in progress...
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-xs text-muted-foreground">
                    <th className="text-left py-2 pr-3">Insider</th>
                    <th className="text-left py-2 px-3">Title</th>
                    <th className="text-left py-2 px-3">Ticker</th>
                    <th className="text-right py-2 px-3">Shares</th>
                    <th className="text-right py-2 px-3">Value</th>
                    <th className="text-right py-2 pl-3">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {buys.slice(0, 30).map((trade: any, i: number) => (
                    <tr key={i} className="border-b border-border/30 hover:bg-muted/30">
                      <td className="py-2 pr-3 font-medium">{trade.insider_name}</td>
                      <td className="py-2 px-3 text-xs text-muted-foreground">{trade.insider_title || "-"}</td>
                      <td className="py-2 px-3 font-mono-data font-medium">{trade.ticker}</td>
                      <td className="py-2 px-3 text-right font-mono-data">{trade.shares?.toLocaleString() || "-"}</td>
                      <td className="py-2 px-3 text-right font-mono-data">
                        {trade.total_value ? `$${(trade.total_value / 1000).toFixed(0)}K` : "-"}
                      </td>
                      <td className="py-2 pl-3 text-right text-muted-foreground">
                        {trade.tx_date ? new Date(trade.tx_date).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "-"}
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
