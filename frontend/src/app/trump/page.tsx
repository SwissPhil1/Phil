"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { Target, Users, Building2, DollarSign, AlertTriangle } from "lucide-react";

export default function TrumpPage() {
  const [overview, setOverview] = useState<{ total_insiders: number; total_companies: number; total_donors: number; categories: Record<string, number> } | null>(null);
  const [insiders, setInsiders] = useState<any[]>([]);
  const [conflictMap, setConflictMap] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [ov, ins, cm] = await Promise.allSettled([
          api.getTrumpOverview(),
          api.getTrumpInsiders(),
          api.getTrumpConflictMap(),
        ]);
        if (ov.status === "fulfilled") setOverview(ov.value);
        if (ins.status === "fulfilled") setInsiders(ins.value as any[]);
        if (cm.status === "fulfilled") setConflictMap(cm.value);
      } catch {}
      setLoading(false);
    }
    load();
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Trump & Inner Circle</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Track financial interests, conflicts, and trades of Trump family, appointees, associates, and major donors
        </p>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => <Card key={i}><CardContent className="p-6"><Skeleton className="h-16 w-full" /></CardContent></Card>)}
        </div>
      ) : (
        <>
          {/* Stats */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card className="border-purple-500/20">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="text-sm text-muted-foreground">Tracked Insiders</div>
                  <Users className="w-4 h-4 text-purple-400" />
                </div>
                <div className="text-2xl font-bold font-mono-data mt-1 text-purple-400">{overview?.total_insiders || insiders.length || 0}</div>
              </CardContent>
            </Card>
            <Card className="border-purple-500/20">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="text-sm text-muted-foreground">Connected Companies</div>
                  <Building2 className="w-4 h-4 text-purple-400" />
                </div>
                <div className="text-2xl font-bold font-mono-data mt-1">{overview?.total_companies || new Set(insiders.flatMap((i: any) => Array.isArray(i.tickers) ? i.tickers : []).filter(Boolean)).size || 0}</div>
              </CardContent>
            </Card>
            <Card className="border-purple-500/20">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="text-sm text-muted-foreground">Major Donors</div>
                  <DollarSign className="w-4 h-4 text-purple-400" />
                </div>
                <div className="text-2xl font-bold font-mono-data mt-1">{overview?.total_donors || (overview?.categories?.donors ?? 0)}</div>
              </CardContent>
            </Card>
            <Card className="border-purple-500/20">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="text-sm text-muted-foreground">Categories</div>
                  <Target className="w-4 h-4 text-purple-400" />
                </div>
                <div className="text-2xl font-bold font-mono-data mt-1">{Object.keys(overview?.categories || {}).length}</div>
              </CardContent>
            </Card>
          </div>

          {/* Category breakdown */}
          {overview?.categories && Object.keys(overview.categories).length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Categories</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(overview.categories).map(([cat, count]) => (
                    <Badge key={cat} variant="outline" className="bg-purple-500/10 text-purple-400 border-purple-500/20">
                      {cat}: {count}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
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
                <p className="text-sm text-muted-foreground py-6 text-center">
                  Trump insider data loading...
                </p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {insiders.slice(0, 20).map((insider: any, i: number) => (
                    <div key={i} className="p-3 rounded-lg bg-muted/30 border border-border/50">
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
                <pre className="text-xs text-muted-foreground overflow-x-auto">
                  {JSON.stringify(conflictMap, null, 2)}
                </pre>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
