"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api, type Politician, type PortfolioSimulation, type PortfolioNavPoint } from "@/lib/api";
import { useApiData } from "@/lib/hooks";
import { ErrorState } from "@/components/error-state";
import {
  FlaskConical,
  Play,
  TrendingUp,
  TrendingDown,
  Search,
  Loader2,
  BarChart3,
  Calendar,
  DollarSign,
  Target,
} from "lucide-react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip as RechartsTooltip,
  CartesianGrid,
  ReferenceLine,
} from "recharts";

const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function fmtPct(val: number | null | undefined): string {
  if (val == null) return "—";
  return `${val > 0 ? "+" : ""}${val.toFixed(1)}%`;
}

function fmtMoney(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toLocaleString()}`;
}

export default function BacktesterPage() {
  const [search, setSearch] = useState("");
  const [selectedPolitician, setSelectedPolitician] = useState<string | null>(null);
  const [simulation, setSimulation] = useState<PortfolioSimulation | null>(null);
  const [simLoading, setSimLoading] = useState(false);
  const [simError, setSimError] = useState<string | null>(null);
  const [investment, setInvestment] = useState(10000);
  const [strategy, setStrategy] = useState<"eq" | "conv">("eq");

  // Load politicians with server-side search
  const searchParams = useMemo(() => {
    const params: Record<string, string> = { limit: "200" };
    const q = search.trim();
    if (q.length >= 2) params.search = q;
    return params;
  }, [search]);

  const { data: politicians, loading, error, retry } = useApiData<Politician[]>(
    () => api.getPoliticians(searchParams),
    { deps: [searchParams.search || ""] }
  );

  // Client-side filter for additional refinement
  const filtered = useMemo(() => {
    if (!politicians) return [];
    const q = search.toLowerCase().trim();
    if (!q) return politicians.slice(0, 20);
    return politicians
      .filter((p) =>
        p.name.toLowerCase().includes(q) ||
        (p.state && p.state.toLowerCase().includes(q)) ||
        (p.party && p.party.toLowerCase().includes(q))
      )
      .slice(0, 20);
  }, [politicians, search]);

  // Run simulation
  async function runSimulation(name: string) {
    setSelectedPolitician(name);
    setSimLoading(true);
    setSimError(null);
    setSimulation(null);
    try {
      const result = await api.getPoliticianPortfolio(name);
      if (result.error) {
        setSimError(result.error);
      } else {
        setSimulation(result);
      }
    } catch (e) {
      setSimError(e instanceof Error ? e.message : "Failed to run simulation");
    } finally {
      setSimLoading(false);
    }
  }

  // Chart data
  const chartData = useMemo(() => {
    if (!simulation?.nav_series?.length) return [];
    return simulation.nav_series.map((p) => {
      const d = new Date(p.date);
      return {
        date: p.date,
        label: `${MONTH_NAMES[d.getMonth()]} '${String(d.getFullYear()).slice(2)}`,
        eqReturn: Math.round(p.eq_return * 10) / 10,
        convReturn: Math.round(p.conv_return * 10) / 10,
        eqValue: Math.round(investment * (1 + p.eq_return / 100)),
        convValue: Math.round(investment * (1 + p.conv_return / 100)),
        positions: p.positions,
      };
    });
  }, [simulation, investment]);

  // Final values
  const finalData = chartData.length > 0 ? chartData[chartData.length - 1] : null;
  const totalReturn = strategy === "eq"
    ? simulation?.equal_weight?.total_return ?? null
    : simulation?.conviction_weighted?.total_return ?? null;
  const annualReturn = strategy === "eq"
    ? simulation?.equal_weight?.annual_return ?? null
    : simulation?.conviction_weighted?.annual_return ?? null;
  const finalValue = finalData
    ? (strategy === "eq" ? finalData.eqValue : finalData.convValue)
    : null;
  const profit = finalValue ? finalValue - investment : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <FlaskConical className="w-6 h-6" />
          Historical Backtester
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Simulate copy-trading any politician — see what your portfolio would look like if you followed their trades
        </p>
      </div>

      {/* Politician Picker */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            1. Choose a politician to copy-trade
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search by name, state, or party..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-muted/30 border border-border rounded-lg text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
            />
          </div>

          {loading ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {[...Array(8)].map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-lg" />)}
            </div>
          ) : error ? (
            <ErrorState error={error} onRetry={retry} compact />
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {filtered.map((p) => {
                const isSelected = selectedPolitician === p.name;
                const partyColor = p.party === "R"
                  ? "border-red-500/30 bg-red-500/5"
                  : p.party === "D"
                    ? "border-blue-500/30 bg-blue-500/5"
                    : "border-border";
                return (
                  <button
                    key={p.name}
                    onClick={() => runSimulation(p.name)}
                    className={`p-3 rounded-lg border text-left transition-all ${
                      isSelected
                        ? "ring-2 ring-primary border-primary bg-primary/5"
                        : `${partyColor} hover:border-primary/50`
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm truncate">{p.name}</span>
                      {p.party && (
                        <Badge variant="outline" className={`text-[9px] px-1 shrink-0 ${
                          p.party === "R" ? "text-red-400 border-red-500/20" :
                          p.party === "D" ? "text-blue-400 border-blue-500/20" : ""
                        }`}>{p.party}</Badge>
                      )}
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-1">
                      {p.total_trades} trades
                      {p.portfolio_cagr != null && ` · ${fmtPct(p.portfolio_cagr)} CAGR`}
                    </div>
                  </button>
                );
              })}
              {filtered.length === 0 && (
                <div className="col-span-full text-center text-sm text-muted-foreground py-4">
                  No politicians found matching &quot;{search}&quot;
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Configuration */}
      {selectedPolitician && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              2. Configure your simulation
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-center gap-6">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Initial Investment</label>
                <div className="flex gap-1">
                  {[1000, 5000, 10000, 50000, 100000].map((amt) => (
                    <button
                      key={amt}
                      onClick={() => setInvestment(amt)}
                      className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                        investment === amt
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:text-foreground hover:bg-muted border border-transparent"
                      }`}
                    >
                      {fmtMoney(amt)}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Strategy</label>
                <div className="flex gap-1">
                  <button
                    onClick={() => setStrategy("eq")}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                      strategy === "eq"
                        ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted border border-transparent"
                    }`}
                  >
                    Equal Weight
                  </button>
                  <button
                    onClick={() => setStrategy("conv")}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                      strategy === "conv"
                        ? "bg-blue-500/20 text-blue-400 border border-blue-500/30"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted border border-transparent"
                    }`}
                  >
                    Conviction Weighted
                  </button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Simulation Loading */}
      {simLoading && (
        <Card>
          <CardContent className="py-12 flex flex-col items-center gap-3">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
            <div className="text-sm font-medium">Running backtest for {selectedPolitician}...</div>
            <p className="text-xs text-muted-foreground">Fetching historical prices and computing portfolio simulation</p>
          </CardContent>
        </Card>
      )}

      {/* Simulation Error */}
      {simError && (
        <ErrorState
          error={simError}
          onRetry={() => selectedPolitician && runSimulation(selectedPolitician)}
        />
      )}

      {/* Simulation Results */}
      {simulation && !simLoading && (
        <div className="space-y-6">
          {/* Hero Result */}
          <div className="relative overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-card via-card to-muted/20 p-6">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-lg font-bold">
                  Copy-Trading: {selectedPolitician}
                </h2>
                <p className="text-sm text-muted-foreground mt-1">
                  {simulation.total_trades} trades over {simulation.years.toFixed(1)} years
                  {" · "}{simulation.tickers_priced}/{simulation.tickers_traded} tickers priced
                </p>
              </div>
              <div className="text-right">
                {totalReturn != null && (
                  <>
                    <div className={`text-4xl font-bold font-mono tracking-tight ${
                      totalReturn >= 0 ? "text-emerald-400" : "text-red-400"
                    }`}>
                      {totalReturn >= 0 ? "+" : ""}{totalReturn.toFixed(1)}%
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      total return ({strategy === "eq" ? "equal weight" : "conviction"})
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Stats Grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-center gap-2 mb-2">
                <DollarSign className="w-4 h-4 text-emerald-400" />
                <span className="text-xs text-muted-foreground">Final Value</span>
              </div>
              <div className={`text-xl font-bold font-mono ${(profit ?? 0) >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                {finalValue != null ? fmtMoney(finalValue) : "—"}
              </div>
              <div className="text-[10px] text-muted-foreground mt-0.5">
                from {fmtMoney(investment)} invested
              </div>
            </div>

            <div className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-center gap-2 mb-2">
                {(profit ?? 0) >= 0 ? (
                  <TrendingUp className="w-4 h-4 text-emerald-400" />
                ) : (
                  <TrendingDown className="w-4 h-4 text-red-400" />
                )}
                <span className="text-xs text-muted-foreground">Profit/Loss</span>
              </div>
              <div className={`text-xl font-bold font-mono ${(profit ?? 0) >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                {profit != null ? `${profit >= 0 ? "+" : ""}${fmtMoney(Math.abs(profit))}` : "—"}
              </div>
              <div className="text-[10px] text-muted-foreground mt-0.5">
                {fmtPct(totalReturn)} total
              </div>
            </div>

            <div className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-center gap-2 mb-2">
                <BarChart3 className="w-4 h-4 text-blue-400" />
                <span className="text-xs text-muted-foreground">Annual Return</span>
              </div>
              <div className={`text-xl font-bold font-mono ${(annualReturn ?? 0) >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                {fmtPct(annualReturn)}
              </div>
              <div className="text-[10px] text-muted-foreground mt-0.5">
                CAGR over {simulation.years.toFixed(1)}yr
              </div>
            </div>

            <div className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-center gap-2 mb-2">
                <Target className="w-4 h-4 text-purple-400" />
                <span className="text-xs text-muted-foreground">Positions</span>
              </div>
              <div className="text-xl font-bold font-mono">
                {simulation.tickers_traded}
              </div>
              <div className="text-[10px] text-muted-foreground mt-0.5">
                unique tickers traded
              </div>
            </div>
          </div>

          {/* Equity Curve Chart */}
          {chartData.length > 0 && (
            <Card className="overflow-hidden">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <Calendar className="w-4 h-4" />
                  Portfolio Value Over Time
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0 pb-4">
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                      data={chartData}
                      margin={{ top: 10, right: 10, left: 10, bottom: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#333" vertical={false} />
                      <XAxis
                        dataKey="label"
                        tick={{ fontSize: 11, fill: "#666" }}
                        axisLine={false}
                        tickLine={false}
                        interval="preserveStartEnd"
                      />
                      <YAxis
                        tick={{ fontSize: 11, fill: "#666" }}
                        tickFormatter={(v) => `$${(v / 1000).toFixed(0)}K`}
                        axisLine={false}
                        tickLine={false}
                        width={55}
                      />
                      <ReferenceLine y={investment} stroke="#555" strokeDasharray="3 3" />
                      <RechartsTooltip
                        contentStyle={{
                          background: "#0f0f1a",
                          border: "1px solid #2a2a3e",
                          borderRadius: "10px",
                          fontSize: "12px",
                          boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
                        }}
                        formatter={(value, dataKey) => {
                          const v = Number(value);
                          if (dataKey === "eqValue") return [fmtMoney(v), "Equal Weight"];
                          if (dataKey === "convValue") return [fmtMoney(v), "Conviction"];
                          return [`${v}`, String(dataKey)];
                        }}
                      />
                      {(strategy === "eq") && (
                        <Line
                          type="monotone"
                          dataKey="eqValue"
                          stroke="#10b981"
                          strokeWidth={2.5}
                          dot={false}
                          activeDot={{ r: 4, fill: "#10b981" }}
                        />
                      )}
                      {(strategy === "conv") && (
                        <Line
                          type="monotone"
                          dataKey="convValue"
                          stroke="#6366f1"
                          strokeWidth={2.5}
                          dot={false}
                          activeDot={{ r: 4, fill: "#6366f1" }}
                        />
                      )}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <div className="text-xs text-muted-foreground text-center mt-2">
                  Dashed line = initial investment ({fmtMoney(investment)})
                </div>
              </CardContent>
            </Card>
          )}

          {/* Compare: Both Strategies */}
          {simulation.equal_weight && simulation.conviction_weighted && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Strategy Comparison</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 rounded-lg bg-emerald-500/5 border border-emerald-500/10">
                    <div className="text-xs text-emerald-400 font-medium mb-2">Equal Weight</div>
                    <div className="space-y-1">
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Total Return</span>
                        <span className="font-mono">{fmtPct(simulation.equal_weight.total_return)}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">CAGR</span>
                        <span className="font-mono">{fmtPct(simulation.equal_weight.annual_return)}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Final Value</span>
                        <span className="font-mono">
                          {fmtMoney(investment * (1 + (simulation.equal_weight.total_return || 0) / 100))}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="p-4 rounded-lg bg-blue-500/5 border border-blue-500/10">
                    <div className="text-xs text-blue-400 font-medium mb-2">Conviction Weighted</div>
                    <div className="space-y-1">
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Total Return</span>
                        <span className="font-mono">{fmtPct(simulation.conviction_weighted.total_return)}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">CAGR</span>
                        <span className="font-mono">{fmtPct(simulation.conviction_weighted.annual_return)}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Final Value</span>
                        <span className="font-mono">
                          {fmtMoney(investment * (1 + (simulation.conviction_weighted.total_return || 0) / 100))}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Link to full profile */}
          {selectedPolitician && (
            <div className="text-center">
              <Link
                href={`/politician/${encodeURIComponent(selectedPolitician)}`}
                className="text-sm text-primary hover:underline"
              >
                View full profile for {selectedPolitician} &rarr;
              </Link>
            </div>
          )}
        </div>
      )}

      {/* Empty state - no politician selected */}
      {!selectedPolitician && !loading && (
        <Card>
          <CardContent className="py-12 text-center">
            <FlaskConical className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
            <div className="font-medium mb-1">Select a politician above to start</div>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              The backtester will simulate copy-trading their disclosed trades using real historical prices.
              See how a {fmtMoney(investment)} investment would have performed.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
