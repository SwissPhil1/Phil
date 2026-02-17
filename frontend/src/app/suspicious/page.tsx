"use client";

import { useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Clock,
  Users,
  Filter,
  BarChart3,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { api, Trade, ClusterGroup } from "@/lib/api";
import { useApiData } from "@/lib/hooks";

function ScoreBadge({ score }: { score: number | null }) {
  if (score === null) return null;
  const color =
    score >= 70
      ? "bg-red-500/20 text-red-400 border-red-500/30"
      : score >= 40
        ? "bg-amber-500/20 text-amber-400 border-amber-500/30"
        : "bg-emerald-500/20 text-emerald-400 border-emerald-500/30";

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold border ${color}`}>
      <AlertTriangle className="w-3 h-3" />
      {score.toFixed(0)}
    </span>
  );
}

function ReturnBadge({ value, label }: { value: number | null; label?: string }) {
  if (value === null) return <span className="text-xs text-muted-foreground">--</span>;
  const color = value >= 0 ? "text-emerald-400" : "text-red-400";
  const Icon = value >= 0 ? TrendingUp : TrendingDown;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium ${color}`}>
      <Icon className="w-3 h-3" />
      {value > 0 ? "+" : ""}
      {value.toFixed(1)}%
      {label && <span className="text-muted-foreground ml-0.5">{label}</span>}
    </span>
  );
}

function AmountRange({ low, high }: { low: number | null; high: number | null }) {
  if (!low && !high) return <span className="text-xs text-muted-foreground">--</span>;
  const format = (n: number) => {
    if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
    return `$${n}`;
  };
  return (
    <span className="text-xs text-muted-foreground">
      {format(low || 0)} - {format(high || 0)}
    </span>
  );
}

function SuspiciousTradeRow({ trade }: { trade: Trade }) {
  return (
    <div className="flex items-center gap-4 px-4 py-3 border-b border-border hover:bg-muted/30 transition-colors">
      {/* Score */}
      <div className="w-16 shrink-0">
        <ScoreBadge score={trade.suspicion_score} />
      </div>

      {/* Ticker + Asset */}
      <div className="w-24 shrink-0">
        <Link
          href={`/congress?ticker=${trade.ticker}`}
          className="text-sm font-semibold text-primary hover:underline"
        >
          {trade.ticker}
        </Link>
        <p className="text-xs text-muted-foreground truncate">{trade.asset_description}</p>
      </div>

      {/* Politician */}
      <div className="flex-1 min-w-0">
        <Link
          href={`/politician/${encodeURIComponent(trade.politician)}`}
          className="text-sm font-medium hover:underline"
        >
          {trade.politician}
        </Link>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className={trade.party === "D" ? "text-blue-400" : trade.party === "R" ? "text-red-400" : ""}>
            {trade.party}
          </span>
          <span>{trade.state}</span>
          <span className="capitalize">{trade.chamber}</span>
          {trade.cluster_flag && (
            <span className="inline-flex items-center gap-0.5 text-amber-400">
              <Users className="w-3 h-3" />
              cluster
            </span>
          )}
        </div>
      </div>

      {/* Amount */}
      <div className="w-28 text-right shrink-0">
        <AmountRange low={trade.amount_low} high={trade.amount_high} />
      </div>

      {/* Delay */}
      <div className="w-16 text-right shrink-0">
        {trade.disclosure_delay_days !== undefined && trade.disclosure_delay_days !== null ? (
          <span className={`text-xs font-medium ${trade.disclosure_delay_days >= 35 ? "text-red-400" : trade.disclosure_delay_days >= 20 ? "text-amber-400" : "text-muted-foreground"}`}>
            <Clock className="w-3 h-3 inline mr-0.5" />
            {trade.disclosure_delay_days}d
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">--</span>
        )}
      </div>

      {/* Returns */}
      <div className="w-32 text-right shrink-0 space-y-0.5">
        <ReturnBadge value={trade.return_since_disclosure} label="now" />
        {trade.return_90d !== null && (
          <div>
            <ReturnBadge value={trade.return_90d} label="90d" />
          </div>
        )}
      </div>

      {/* Date */}
      <div className="w-20 text-right shrink-0">
        <span className="text-xs text-muted-foreground">
          {trade.disclosure_date ? new Date(trade.disclosure_date).toLocaleDateString() : "--"}
        </span>
      </div>
    </div>
  );
}

function ClusterCard({ cluster }: { cluster: ClusterGroup }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border border-amber-500/20 rounded-lg bg-amber-500/5 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-4 px-4 py-3 hover:bg-amber-500/10 transition-colors"
      >
        <div className="w-8 h-8 rounded-lg bg-amber-500/20 flex items-center justify-center shrink-0">
          <Users className="w-4 h-4 text-amber-400" />
        </div>
        <div className="flex-1 text-left">
          <span className="text-sm font-semibold text-amber-400">{cluster.ticker}</span>
          <span className="text-xs text-muted-foreground ml-2">
            {cluster.politicians} politicians
          </span>
        </div>
        <span className="text-xs text-muted-foreground">{cluster.week}</span>
        {expanded ? (
          <ChevronUp className="w-4 h-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="w-4 h-4 text-muted-foreground" />
        )}
      </button>
      {expanded && (
        <div className="border-t border-amber-500/20 px-4 py-2 space-y-1">
          {cluster.trades.map((t) => (
            <div key={t.id} className="flex items-center gap-3 text-xs py-1">
              <Link
                href={`/politician/${encodeURIComponent(t.politician)}`}
                className="font-medium hover:underline flex-1"
              >
                {t.politician}
              </Link>
              <span className={t.party === "D" ? "text-blue-400" : t.party === "R" ? "text-red-400" : "text-muted-foreground"}>
                {t.party}
              </span>
              <span className="text-muted-foreground">{t.tx_date ? new Date(t.tx_date).toLocaleDateString() : "--"}</span>
              <ScoreBadge score={t.suspicion_score} />
              <ReturnBadge value={t.return_since_disclosure} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function SuspiciousPage() {
  const [minScore, setMinScore] = useState(30);
  const [days, setDays] = useState(365);
  const [chamber, setChamber] = useState("");
  const [party, setParty] = useState("");
  const [tab, setTab] = useState<"trades" | "clusters">("trades");

  const params: Record<string, string> = {
    min_score: String(minScore),
    days: String(days),
    limit: "100",
  };
  if (chamber) params.chamber = chamber;
  if (party) params.party = party;

  const { data: trades, loading: tradesLoading } = useApiData(
    () => api.getSuspiciousTrades(params),
    { deps: [minScore, days, chamber, party] }
  );

  const { data: clusters, loading: clustersLoading } = useApiData(
    () => api.getClusterTrades({ days: String(days) }),
    { deps: [days] }
  );

  const { data: stats } = useApiData(() => api.getScoringStats());

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <AlertTriangle className="w-6 h-6 text-amber-400" />
          Suspicious Trades
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Congressional trades scored by suspicion signals: disclosure delay, trade size, committee overlap, cluster activity, and politician track record.
        </p>
      </div>

      {/* Stats cards */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="rounded-lg border border-border bg-card p-3">
            <p className="text-xs text-muted-foreground">Scored Trades</p>
            <p className="text-lg font-bold">{stats.scored_trades.toLocaleString()}</p>
            <p className="text-xs text-muted-foreground">{stats.scoring_coverage} of purchases</p>
          </div>
          <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3">
            <p className="text-xs text-muted-foreground">High Suspicion</p>
            <p className="text-lg font-bold text-red-400">{stats.high_suspicion_count.toLocaleString()}</p>
            <p className="text-xs text-muted-foreground">Score 70+</p>
          </div>
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
            <p className="text-xs text-muted-foreground">Cluster Trades</p>
            <p className="text-lg font-bold text-amber-400">{stats.cluster_trades.toLocaleString()}</p>
            <p className="text-xs text-muted-foreground">3+ politicians, same ticker</p>
          </div>
          <div className="rounded-lg border border-border bg-card p-3">
            <p className="text-xs text-muted-foreground">Avg Score</p>
            <p className="text-lg font-bold">{stats.avg_suspicion_score?.toFixed(1) ?? "--"}</p>
            <p className="text-xs text-muted-foreground">out of 100</p>
          </div>
        </div>
      )}

      {/* Tabs + Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex rounded-lg border border-border overflow-hidden">
          <button
            onClick={() => setTab("trades")}
            className={`px-4 py-1.5 text-sm font-medium transition-colors ${tab === "trades" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
          >
            <BarChart3 className="w-3.5 h-3.5 inline mr-1.5" />
            Scored Trades
          </button>
          <button
            onClick={() => setTab("clusters")}
            className={`px-4 py-1.5 text-sm font-medium transition-colors ${tab === "clusters" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
          >
            <Users className="w-3.5 h-3.5 inline mr-1.5" />
            Clusters
          </button>
        </div>

        <div className="flex items-center gap-2 ml-auto">
          <Filter className="w-3.5 h-3.5 text-muted-foreground" />
          <select
            value={minScore}
            onChange={(e) => setMinScore(Number(e.target.value))}
            className="text-xs bg-background border border-border rounded px-2 py-1"
          >
            <option value={0}>All scores</option>
            <option value={30}>Score 30+</option>
            <option value={50}>Score 50+</option>
            <option value={70}>Score 70+</option>
          </select>
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="text-xs bg-background border border-border rounded px-2 py-1"
          >
            <option value={30}>30 days</option>
            <option value={90}>90 days</option>
            <option value={365}>1 year</option>
            <option value={3650}>All time</option>
          </select>
          <select
            value={chamber}
            onChange={(e) => setChamber(e.target.value)}
            className="text-xs bg-background border border-border rounded px-2 py-1"
          >
            <option value="">All chambers</option>
            <option value="house">House</option>
            <option value="senate">Senate</option>
          </select>
          <select
            value={party}
            onChange={(e) => setParty(e.target.value)}
            className="text-xs bg-background border border-border rounded px-2 py-1"
          >
            <option value="">All parties</option>
            <option value="D">Democrat</option>
            <option value="R">Republican</option>
          </select>
        </div>
      </div>

      {/* Content */}
      {tab === "trades" && (
        <div className="border border-border rounded-lg bg-card overflow-hidden">
          {/* Table header */}
          <div className="flex items-center gap-4 px-4 py-2 bg-muted/30 border-b border-border text-xs font-medium text-muted-foreground">
            <div className="w-16 shrink-0">Score</div>
            <div className="w-24 shrink-0">Ticker</div>
            <div className="flex-1">Politician</div>
            <div className="w-28 text-right shrink-0">Amount</div>
            <div className="w-16 text-right shrink-0">Delay</div>
            <div className="w-32 text-right shrink-0">Return</div>
            <div className="w-20 text-right shrink-0">Disclosed</div>
          </div>

          {tradesLoading ? (
            <div className="px-4 py-12 text-center text-sm text-muted-foreground">
              Loading suspicious trades...
            </div>
          ) : !trades || trades.length === 0 ? (
            <div className="px-4 py-12 text-center text-sm text-muted-foreground">
              No suspicious trades found. Trades need to be scored first — trigger via admin API.
            </div>
          ) : (
            trades.map((trade) => <SuspiciousTradeRow key={trade.id} trade={trade} />)
          )}
        </div>
      )}

      {tab === "clusters" && (
        <div className="space-y-3">
          {clustersLoading ? (
            <div className="px-4 py-12 text-center text-sm text-muted-foreground">
              Loading cluster trades...
            </div>
          ) : !clusters || clusters.length === 0 ? (
            <div className="px-4 py-12 text-center text-sm text-muted-foreground">
              No cluster trades found. Run the scoring pipeline to detect clusters.
            </div>
          ) : (
            clusters.map((cluster, i) => <ClusterCard key={`${cluster.ticker}-${cluster.week}-${i}`} cluster={cluster} />)
          )}
        </div>
      )}
    </div>
  );
}
