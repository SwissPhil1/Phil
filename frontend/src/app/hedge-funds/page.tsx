"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { api, type HedgeFund } from "@/lib/api";
import { TrendingUp, Building2 } from "lucide-react";

export default function HedgeFundsPage() {
  const [funds, setFunds] = useState<HedgeFund[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const data = await api.getHedgeFunds();
        setFunds(Array.isArray(data) ? data : []);
      } catch {}
      setLoading(false);
    }
    load();
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Hedge Fund Tracker</h1>
        <p className="text-muted-foreground text-sm mt-1">
          13F filings from top hedge fund managers - Buffett, Burry, Ackman, Dalio, and more
        </p>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => <Card key={i}><CardContent className="p-6"><Skeleton className="h-20 w-full" /></CardContent></Card>)}
        </div>
      ) : funds.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-center text-muted-foreground">
            No hedge fund data loaded yet. 13F ingestion in progress...
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {funds.map((fund, i) => (
            <Card key={i} className="hover:border-primary/30 transition-colors cursor-pointer">
              <CardContent className="p-4">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <div className="font-medium">{fund.manager_name}</div>
                    <div className="text-xs text-muted-foreground">{fund.name}</div>
                  </div>
                  <Building2 className="w-4 h-4 text-muted-foreground shrink-0" />
                </div>
                <div className="flex items-center gap-4 mt-3">
                  <div>
                    <div className="text-xs text-muted-foreground">Portfolio Value</div>
                    <div className="font-mono-data text-sm font-medium">
                      {fund.total_value ? `$${(fund.total_value / 1_000_000_000).toFixed(1)}B` : "-"}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Holdings</div>
                    <div className="font-mono-data text-sm font-medium">{fund.num_holdings || "-"}</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
