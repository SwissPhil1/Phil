"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api, ActivityItem } from "@/lib/api";
import { useApiData } from "@/lib/hooks";
import { ErrorState } from "@/components/error-state";
import {
  Activity,
  TrendingUp,
  TrendingDown,
  Landmark,
  UserCheck,
  ChevronLeft,
  ChevronRight,
  Filter,
} from "lucide-react";

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "-";
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatMoney(val: number | null): string {
  if (!val) return "";
  if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(1)}M`;
  if (val >= 1_000) return `$${(val / 1_000).toFixed(0)}K`;
  return `$${val.toFixed(0)}`;
}

function ActivityCard({ item }: { item: ActivityItem }) {
  const isBuy = item.action === "bought";
  return (
    <div className="flex items-start gap-3 p-3 border-b border-border/40 last:border-0 hover:bg-muted/20 transition-colors">
      <div className="mt-1">
        {item.source === "congress" ? (
          <div className="w-8 h-8 rounded-full bg-blue-500/10 flex items-center justify-center">
            <Landmark className="w-4 h-4 text-blue-400" />
          </div>
        ) : (
          <div className="w-8 h-8 rounded-full bg-purple-500/10 flex items-center justify-center">
            <UserCheck className="w-4 h-4 text-purple-400" />
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm truncate">{item.actor}</span>
          <span className="text-xs text-muted-foreground">{item.actor_detail}</span>
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <Badge
            variant="outline"
            className={`text-[10px] ${
              isBuy
                ? "bg-green-500/10 text-green-400 border-green-500/20"
                : "bg-red-500/10 text-red-400 border-red-500/20"
            }`}
          >
            {isBuy ? <TrendingUp className="w-3 h-3 mr-0.5" /> : <TrendingDown className="w-3 h-3 mr-0.5" />}
            {item.action}
          </Badge>
          <span className="font-mono text-sm font-semibold">{item.ticker}</span>
          {item.amount_low && (
            <span className="text-xs text-muted-foreground">{formatMoney(item.amount_low)}</span>
          )}
        </div>
        {item.description && (
          <div className="text-xs text-muted-foreground mt-0.5 truncate">{item.description}</div>
        )}
      </div>
      <div className="text-right shrink-0">
        <div className="text-xs text-muted-foreground">{formatDate(item.date)}</div>
        {item.return_pct !== null && item.return_pct !== undefined && (
          <div className={`text-sm font-medium ${item.return_pct >= 0 ? "text-green-400" : "text-red-400"}`}>
            {item.return_pct >= 0 ? "+" : ""}
            {item.return_pct.toFixed(1)}%
          </div>
        )}
        {item.price_current && (
          <div className="text-xs text-muted-foreground">${item.price_current.toFixed(2)}</div>
        )}
      </div>
    </div>
  );
}

export default function ActivityFeedPage() {
  const [page, setPage] = useState(1);
  const [sourceFilter, setSourceFilter] = useState<string | null>(null);
  const [tickerFilter, setTickerFilter] = useState("");

  const params: Record<string, string> = { page: String(page), page_size: "30" };
  if (sourceFilter) params.source = sourceFilter;
  if (tickerFilter.trim()) params.ticker = tickerFilter.trim().toUpperCase();

  const { data, loading, error, retry } = useApiData(
    () => api.getActivityFeed(params),
    { refreshInterval: 60 }
  );

  if (error) return <ErrorState error={error} onRetry={retry} />;

  const activities = data?.activities || [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Activity className="w-6 h-6" />
          Activity Feed
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Unified stream of all trade disclosures across all sources
        </p>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <Filter className="w-4 h-4 text-muted-foreground" />
        <div className="flex gap-2">
          {[
            { label: "All", value: null },
            { label: "Congress", value: "congress" },
            { label: "Insiders", value: "insider" },
          ].map((opt) => (
            <Button
              key={opt.label}
              variant={sourceFilter === opt.value ? "default" : "outline"}
              size="sm"
              onClick={() => {
                setSourceFilter(opt.value);
                setPage(1);
              }}
            >
              {opt.label}
            </Button>
          ))}
        </div>
        <input
          type="text"
          placeholder="Filter by ticker..."
          value={tickerFilter}
          onChange={(e) => {
            setTickerFilter(e.target.value);
            setPage(1);
          }}
          className="h-8 px-3 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-ring w-36"
        />
      </div>

      {/* Feed */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            {loading ? "Loading..." : `Trade Activity (Page ${page})`}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-4 space-y-3">
              {[...Array(8)].map((_, i) => (
                <div key={i} className="h-16 bg-muted/30 rounded animate-pulse" />
              ))}
            </div>
          ) : activities.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Activity className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p>No activity found</p>
            </div>
          ) : (
            <div>
              {activities.map((item) => (
                <ActivityCard key={item.id} item={item} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      <div className="flex items-center justify-center gap-4">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setPage(Math.max(1, page - 1))}
          disabled={page === 1}
        >
          <ChevronLeft className="w-4 h-4 mr-1" />
          Previous
        </Button>
        <span className="text-sm text-muted-foreground">Page {page}</span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setPage(page + 1)}
          disabled={activities.length < 30}
        >
          Next
          <ChevronRight className="w-4 h-4 ml-1" />
        </Button>
      </div>
    </div>
  );
}
