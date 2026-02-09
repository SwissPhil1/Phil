"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { api, type Trade } from "@/lib/api";
import { ArrowUpRight, ArrowDownRight, Info, Search } from "lucide-react";

function timeAgo(dateStr: string) {
  if (!dateStr) return "";
  const now = new Date();
  const d = new Date(dateStr);
  const diffMs = now.getTime() - d.getTime();
  const days = Math.floor(diffMs / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" });
}

function formatAmount(low: number, high: number) {
  const fmt = (n: number) => {
    if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
    return `$${n}`;
  };
  return `${fmt(low)} – ${fmt(high)}`;
}

export default function CongressPage() {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");

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

  const filtered = filter
    ? trades.filter(t =>
        t.politician.toLowerCase().includes(filter.toLowerCase()) ||
        t.ticker.toLowerCase().includes(filter.toLowerCase())
      )
    : trades;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Congressional Trades</h1>
        <p className="text-muted-foreground text-sm mt-1">
          STOCK Act disclosures from House and Senate members
        </p>
      </div>

      {/* Filing delay info */}
      <div className="flex items-start gap-3 p-4 rounded-lg bg-blue-500/5 border border-blue-500/10">
        <Info className="w-4 h-4 text-blue-400 mt-0.5 shrink-0" />
        <div className="text-sm text-muted-foreground">
          Members of Congress have <span className="text-foreground font-medium">up to 45 days</span> to file disclosures under the STOCK Act.
          The most recent trades shown may reflect activity from several weeks ago.
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          type="text"
          placeholder="Search by politician or ticker..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="w-full pl-10 pr-4 py-2.5 bg-muted/30 border border-border rounded-lg text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
        />
      </div>

      {/* Stats bar */}
      {!loading && trades.length > 0 && (
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span>{trades.length} trades loaded</span>
          <span>{new Set(trades.map(t => t.politician)).size} politicians</span>
          <span>{new Set(trades.map(t => t.ticker)).size} unique tickers</span>
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          {[...Array(8)].map((_, i) => <Skeleton key={i} className="h-20 w-full rounded-lg" />)}
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground text-sm">
            {filter ? "No trades match your search." : "No trades loaded yet."}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((trade, i) => (
            <Card key={i} className="hover:border-border/80 transition-colors">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                    trade.tx_type === "purchase" ? "bg-green-500/10" : "bg-red-500/10"
                  }`}>
                    {trade.tx_type === "purchase" ? (
                      <ArrowUpRight className="w-4 h-4 text-green-400" />
                    ) : (
                      <ArrowDownRight className="w-4 h-4 text-red-400" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <Link href={`/politician/${encodeURIComponent(trade.politician)}`} className="font-medium text-sm truncate hover:underline hover:text-primary transition-colors">{trade.politician}</Link>
                      {trade.party && (
                        <Badge variant="outline" className={`text-[10px] px-1.5 shrink-0 ${
                          trade.party === "R" ? "bg-red-500/10 text-red-400 border-red-500/20" :
                          trade.party === "D" ? "bg-blue-500/10 text-blue-400 border-blue-500/20" : ""
                        }`}>{trade.party}</Badge>
                      )}
                      {trade.state && (
                        <span className="text-[10px] text-muted-foreground shrink-0">{trade.state}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="font-mono-data text-xs font-medium text-foreground">{trade.ticker}</span>
                      <span className="text-xs text-muted-foreground">
                        {trade.tx_type === "purchase" ? "Bought" : "Sold"}
                      </span>
                      {trade.amount_low && trade.amount_high && (
                        <span className="text-xs text-muted-foreground">
                          {formatAmount(trade.amount_low, trade.amount_high)}
                        </span>
                      )}
                      {trade.asset_description && trade.asset_description !== trade.ticker && (
                        <span className="text-xs text-muted-foreground truncate max-w-[200px]">
                          {trade.asset_description}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-xs text-muted-foreground">
                      {timeAgo(trade.disclosure_date || trade.tx_date)}
                    </div>
                    {trade.tx_date && (
                      <div className="text-[10px] text-muted-foreground/60 mt-0.5">
                        Traded {new Date(trade.tx_date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      </div>
                    )}
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
