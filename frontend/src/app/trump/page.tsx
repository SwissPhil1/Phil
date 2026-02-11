"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { Target, Users, Building2, DollarSign, AlertTriangle } from "lucide-react";
import { useMultiApiData } from "@/lib/hooks";
import { ErrorState, RefreshIndicator } from "@/components/error-state";

type TrumpOverview = { total_insiders: number; total_companies: number; total_donors: number; categories: Record<string, number> };

export default function TrumpPage() {
  const { data, loading, errors, hasError, retry, refreshIn } = useMultiApiData<{
    overview: TrumpOverview;
    insiders: any[];
    conflictMap: any;
  }>(
    {
      overview: () => api.getTrumpOverview(),
      insiders: () => api.getTrumpInsiders(),
      conflictMap: () => api.getTrumpConflictMap(),
    },
    { refreshInterval: 120 }
  );

  const overview = data.overview;
  const insiders = data.insiders ?? [];
  const conflictMap = data.conflictMap;

  const categories = overview?.categories || {};
  const uniqueCompanies = new Set(insiders.flatMap((i: any) => Array.isArray(i.tickers) ? i.tickers : []).filter(Boolean)).size;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">Trump & Inner Circle</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Financial interests, conflicts, and connections of Trump family, appointees, and associates
          </p>
        </div>
        <RefreshIndicator refreshIn={refreshIn} />
      </div>

      {hasError && !overview && insiders.length === 0 && !conflictMap ? (
        <ErrorState error={Object.values(errors).join("; ") || "Failed to load data"} onRetry={retry} />
      ) : loading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <Card key={i}><CardContent className="p-5"><Skeleton className="h-14 w-full" /></CardContent></Card>)}
        </div>
      ) : (
        <>
          {/* Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card className="border-purple-500/20">
              <CardContent className="p-5">
                <div className="flex items-center justify-between mb-2">
                  <Users className="w-5 h-5 text-purple-400" />
                </div>
                <div className="text-2xl font-bold font-mono-data text-purple-400">
                  {overview?.total_insiders || insiders.length || 0}
                </div>
                <div className="text-xs text-muted-foreground mt-1">Tracked Insiders</div>
              </CardContent>
            </Card>
            <Card className="border-purple-500/20">
              <CardContent className="p-5">
                <div className="flex items-center justify-between mb-2">
                  <Building2 className="w-5 h-5 text-purple-400" />
                </div>
                <div className="text-2xl font-bold font-mono-data">
                  {overview?.total_companies || uniqueCompanies || 0}
                </div>
                <div className="text-xs text-muted-foreground mt-1">Connected Companies</div>
              </CardContent>
            </Card>
            <Card className="border-purple-500/20">
              <CardContent className="p-5">
                <div className="flex items-center justify-between mb-2">
                  <DollarSign className="w-5 h-5 text-purple-400" />
                </div>
                <div className="text-2xl font-bold font-mono-data">
                  {overview?.total_donors || (categories?.donors ?? 0)}
                </div>
                <div className="text-xs text-muted-foreground mt-1">Major Donors</div>
              </CardContent>
            </Card>
            <Card className="border-purple-500/20">
              <CardContent className="p-5">
                <div className="flex items-center justify-between mb-2">
                  <Target className="w-5 h-5 text-purple-400" />
                </div>
                <div className="text-2xl font-bold font-mono-data">
                  {Object.keys(categories).length}
                </div>
                <div className="text-xs text-muted-foreground mt-1">Categories</div>
              </CardContent>
            </Card>
          </div>

          {/* Category breakdown */}
          {Object.keys(categories).length > 0 && (
            <div className="flex flex-wrap gap-2">
              {Object.entries(categories).map(([cat, count]) => (
                <Badge key={cat} variant="outline" className="bg-purple-500/10 text-purple-400 border-purple-500/20">
                  {cat}: {count}
                </Badge>
              ))}
            </div>
          )}

          {/* Insiders List */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Users className="w-4 h-4 text-purple-400" />
                Tracked Insiders
              </CardTitle>
            </CardHeader>
            <CardContent>
              {insiders.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">
                  Loading insider data...
                </p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {insiders.map((insider: any, i: number) => (
                    <div key={i} className="p-4 rounded-lg bg-muted/30 border border-border/50">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-medium text-sm">{insider.name}</span>
                        <Badge variant="outline" className="text-[10px] bg-purple-500/10 text-purple-400 border-purple-500/20">
                          {insider.category}
                        </Badge>
                      </div>
                      <div className="text-xs text-muted-foreground">{insider.role}</div>
                      {insider.tickers && (Array.isArray(insider.tickers) ? insider.tickers.length > 0 : insider.tickers) && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {(Array.isArray(insider.tickers) ? insider.tickers : String(insider.tickers).split(",")).map((t: string) => (
                            <span key={t} className="text-[10px] font-mono-data bg-secondary px-1.5 py-0.5 rounded">
                              {String(t).trim()}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Conflict Map */}
          {conflictMap && (
            <Card className="border-yellow-500/20">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-yellow-400" />
                  Conflict of Interest Map
                </CardTitle>
              </CardHeader>
              <CardContent>
                {Array.isArray(conflictMap) ? (
                  <div className="space-y-2">
                    {conflictMap.map((conflict: any, i: number) => (
                      <div key={i} className="p-3 rounded-lg bg-yellow-500/5 border border-yellow-500/10">
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-medium text-sm">{conflict.insider || conflict.name || `Conflict ${i + 1}`}</span>
                          {conflict.ticker && (
                            <span className="font-mono-data text-xs font-medium">{conflict.ticker}</span>
                          )}
                        </div>
                        {conflict.conflict_type && (
                          <div className="text-xs text-muted-foreground">{conflict.conflict_type}</div>
                        )}
                        {conflict.description && (
                          <div className="text-xs text-muted-foreground mt-1">{conflict.description}</div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <pre className="text-xs text-muted-foreground overflow-x-auto">
                    {JSON.stringify(conflictMap, null, 2)}
                  </pre>
                )}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
