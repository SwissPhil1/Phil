"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { api, type HedgeFund } from "@/lib/api";
import { Building2 } from "lucide-react";
import { useApiData } from "@/lib/hooks";
import { ErrorState, RefreshIndicator } from "@/components/error-state";

export default function HedgeFundsPage() {
  const { data: rawFunds, loading, error, retry, refreshIn } = useApiData<HedgeFund[]>(
    () => api.getHedgeFunds().then((data) => (Array.isArray(data) ? data : [])),
    { refreshInterval: 120 }
  );
  const funds = rawFunds ?? [];

  const totalValue = funds.reduce((sum, f) => sum + (f.total_value || 0), 0);
  const totalHoldings = funds.reduce((sum, f) => sum + (f.num_holdings || 0), 0);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">Hedge Fund Tracker</h1>
          <p className="text-muted-foreground text-sm mt-1">
            13F filings from top hedge fund managers — see what the smart money is holding
          </p>
        </div>
        <RefreshIndicator refreshIn={refreshIn} />
      </div>

      {/* Summary stats */}
      {!loading && !error && funds.length > 0 && (
        <div className="grid grid-cols-3 gap-4">
          <Card>
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground">Funds Tracked</div>
              <div className="text-2xl font-bold font-mono-data mt-1">{funds.length}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground">Combined AUM</div>
              <div className="text-2xl font-bold font-mono-data mt-1">
                ${(totalValue / 1e12).toFixed(1)}T
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground">Total Holdings</div>
              <div className="text-2xl font-bold font-mono-data mt-1">
                {totalHoldings.toLocaleString()}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {error && !rawFunds ? (
        <ErrorState error={error} onRetry={retry} />
      ) : loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => (
            <Card key={i}><CardContent className="p-6"><Skeleton className="h-20 w-full" /></CardContent></Card>
          ))}
        </div>
      ) : funds.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground text-sm">
            No hedge fund data loaded yet.
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {funds.map((fund, i) => (
            <Card key={i} className="hover:border-primary/30 transition-colors">
              <CardContent className="p-5">
                <div className="flex items-start justify-between mb-3">
                  <div className="min-w-0">
                    <div className="font-medium text-sm">{fund.manager_name}</div>
                    <div className="text-xs text-muted-foreground truncate">{fund.name}</div>
                  </div>
                  <div className="w-8 h-8 rounded-lg bg-green-500/10 flex items-center justify-center shrink-0">
                    <Building2 className="w-4 h-4 text-green-400" />
                  </div>
                </div>
                <div className="flex items-center gap-6">
                  <div>
                    <div className="text-[10px] text-muted-foreground uppercase">AUM</div>
                    <div className="font-mono-data text-sm font-bold">
                      {fund.total_value
                        ? fund.total_value >= 1e12
                          ? `$${(fund.total_value / 1e12).toFixed(2)}T`
                          : `$${(fund.total_value / 1e9).toFixed(1)}B`
                        : "-"}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-muted-foreground uppercase">Holdings</div>
                    <div className="font-mono-data text-sm font-bold">{fund.num_holdings || "-"}</div>
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
