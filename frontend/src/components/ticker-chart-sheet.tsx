"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { api, TickerChartData } from "@/lib/api";
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  Tooltip as RechartsTooltip,
  CartesianGrid,
} from "recharts";
import { BarChart2, Landmark, UserCheck, Loader2 } from "lucide-react";

const MONTH_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function buildChartData(
  data: TickerChartData,
  filterPolitician: string | null,
) {
  const filteredTrades = filterPolitician
    ? data.trades.filter((t) => t.politician === filterPolitician)
    : data.trades;

  const tradesByWeek = new Map<string, { buys: typeof filteredTrades; sells: typeof filteredTrades }>();
  for (const trade of filteredTrades) {
    if (!trade.date) continue;
    const tradeTs = new Date(trade.date).getTime();
    let nearestDate = data.prices[0]?.date;
    let nearestDiff = Infinity;
    for (const p of data.prices) {
      const diff = Math.abs(new Date(p.date).getTime() - tradeTs);
      if (diff < nearestDiff) { nearestDiff = diff; nearestDate = p.date; }
    }
    if (!nearestDate) continue;
    const existing = tradesByWeek.get(nearestDate) || { buys: [], sells: [] };
    if (trade.type === "buy") existing.buys.push(trade);
    else existing.sells.push(trade);
    tradesByWeek.set(nearestDate, existing);
  }

  return data.prices.map((p) => {
    const trades = tradesByWeek.get(p.date);
    const d = new Date(p.date);
    return {
      date: p.date,
      label: `${MONTH_SHORT[d.getMonth()]} '${String(d.getFullYear()).slice(2)}`,
      close: p.close,
      buyMarker: trades?.buys.length ? p.close : undefined,
      sellMarker: trades?.sells.length ? p.close : undefined,
      buyTrades: trades?.buys || [],
      sellTrades: trades?.sells || [],
    };
  });
}

interface ChartTarget {
  ticker: string;
  politician?: string;
  assetDescription?: string;
}

export function useTickerChart() {
  const [target, setTarget] = useState<ChartTarget | null>(null);
  const [chartData, setChartData] = useState<TickerChartData | null>(null);
  const [chartLoading, setChartLoading] = useState(false);
  const [chartDays, setChartDays] = useState(365);
  const [chartFilter, setChartFilter] = useState<"all" | "politician">("all");

  const openChart = useCallback((ticker: string, politician?: string, assetDescription?: string) => {
    setTarget({ ticker, politician, assetDescription });
    setChartData(null);
    setChartLoading(true);
    setChartFilter(politician ? "politician" : "all");
    api.getTickerChart(ticker, 365).then((data) => {
      setChartData(data);
      setChartLoading(false);
    }).catch(() => {
      setChartLoading(false);
    });
    setChartDays(365);
  }, []);

  const closeChart = useCallback(() => {
    setTarget(null);
  }, []);

  // Re-fetch when period changes
  useEffect(() => {
    if (target) {
      setChartData(null);
      setChartLoading(true);
      api.getTickerChart(target.ticker, chartDays).then((data) => {
        setChartData(data);
        setChartLoading(false);
      }).catch(() => {
        setChartLoading(false);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chartDays]);

  return { target, chartData, chartLoading, chartDays, setChartDays, chartFilter, setChartFilter, openChart, closeChart };
}

export function TickerChartSheet({
  target,
  chartData,
  chartLoading,
  chartDays,
  setChartDays,
  chartFilter,
  setChartFilter,
  closeChart,
}: ReturnType<typeof useTickerChart>) {
  return (
    <Sheet open={!!target} onOpenChange={(open) => { if (!open) closeChart(); }}>
      <SheetContent side="right" className="sm:max-w-2xl w-full overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <BarChart2 className="w-5 h-5" />
            <span className="font-mono text-lg">{target?.ticker}</span>
            {target?.assetDescription && target.assetDescription !== target.ticker && (
              <span className="text-sm font-normal text-muted-foreground truncate">
                {target.assetDescription}
              </span>
            )}
          </SheetTitle>
          <SheetDescription>
            Stock price with buy/sell trade markers
          </SheetDescription>
        </SheetHeader>

        {/* Period toggle */}
        <div className="flex gap-1 px-4">
          {[
            { label: "3M", days: 90 },
            { label: "6M", days: 180 },
            { label: "1Y", days: 365 },
            { label: "2Y", days: 730 },
            { label: "ALL", days: 1825 },
          ].map((p) => (
            <button
              key={p.label}
              onClick={() => setChartDays(p.days)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                chartDays === p.days
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Politician filter toggle */}
        {target?.politician && (
          <div className="flex gap-1 px-4">
            <button
              onClick={() => setChartFilter("politician")}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                chartFilter === "politician"
                  ? "bg-purple-500/20 text-purple-400 border border-purple-500/30"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted border border-transparent"
              }`}
            >
              {target.politician} only
            </button>
            <button
              onClick={() => setChartFilter("all")}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                chartFilter === "all"
                  ? "bg-blue-500/20 text-blue-400 border border-blue-500/30"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted border border-transparent"
              }`}
            >
              All traders
            </button>
          </div>
        )}

        {/* Chart */}
        <div className="px-4">
          {chartLoading ? (
            <div className="h-64 flex items-center justify-center text-muted-foreground">
              <Loader2 className="w-6 h-6 animate-spin mr-2" />
              Loading price data...
            </div>
          ) : chartData && chartData.prices.length > 0 ? (
            (() => {
              const cData = buildChartData(
                chartData,
                chartFilter === "politician" && target?.politician ? target.politician : null,
              );
              return (
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={cData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
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
                        tickFormatter={(v: number) => `$${v.toFixed(0)}`}
                        axisLine={false}
                        tickLine={false}
                        width={55}
                        domain={["auto", "auto"]}
                      />
                      <RechartsTooltip
                        contentStyle={{
                          background: "#0f0f1a",
                          border: "1px solid #2a2a3e",
                          borderRadius: "10px",
                          fontSize: "12px",
                          boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
                        }}
                        content={({ active, payload, label }) => {
                          if (!active || !payload?.length) return null;
                          const item = payload[0]?.payload;
                          return (
                            <div className="bg-[#0f0f1a] border border-[#2a2a3e] rounded-lg p-3 text-xs shadow-lg">
                              <div className="text-muted-foreground mb-1">{label}</div>
                              <div className="font-mono font-bold text-sm">${item?.close?.toFixed(2)}</div>
                              {item?.buyTrades?.map((t: { politician: string }, i: number) => (
                                <div key={`b${i}`} className="text-emerald-400 mt-1">BUY — {t.politician}</div>
                              ))}
                              {item?.sellTrades?.map((t: { politician: string }, i: number) => (
                                <div key={`s${i}`} className="text-red-400 mt-1">SELL — {t.politician}</div>
                              ))}
                            </div>
                          );
                        }}
                      />
                      <Line
                        type="monotone"
                        dataKey="close"
                        stroke="#8b5cf6"
                        strokeWidth={2}
                        dot={(props) => {
                          const { cx, cy, payload } = props as { cx?: number; cy?: number; payload?: { buyMarker?: number; sellMarker?: number } };
                          if (cx == null || cy == null || !payload) return <circle r={0} />;
                          if (payload.buyMarker && payload.sellMarker) {
                            return (
                              <g key={`${cx}-${cy}`}>
                                <circle cx={cx - 4} cy={cy} r={5} fill="#10b981" stroke="#0f0f1a" strokeWidth={1.5} />
                                <circle cx={cx + 4} cy={cy} r={5} fill="#ef4444" stroke="#0f0f1a" strokeWidth={1.5} />
                              </g>
                            );
                          }
                          if (payload.buyMarker) {
                            return <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={5} fill="#10b981" stroke="#0f0f1a" strokeWidth={1.5} />;
                          }
                          if (payload.sellMarker) {
                            return <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={5} fill="#ef4444" stroke="#0f0f1a" strokeWidth={1.5} />;
                          }
                          return <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={0} fill="transparent" />;
                        }}
                        activeDot={{ r: 4, fill: "#8b5cf6" }}
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              );
            })()
          ) : (
            <div className="h-64 flex items-center justify-center text-sm text-muted-foreground">
              No price data available for {target?.ticker}
            </div>
          )}
        </div>

        {/* Legend */}
        <div className="flex gap-4 px-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" /> Buy
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500 inline-block" /> Sell
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-violet-500 inline-block" /> Price
          </span>
        </div>

        {/* Trade list */}
        {chartData && (
          <div className="px-4 space-y-2 pb-4">
            <div className="text-xs text-muted-foreground font-medium">
              Trades ({chartFilter === "politician" && target?.politician ? target.politician : "All traders"})
            </div>
            {(chartFilter === "politician" && target?.politician
              ? chartData.trades.filter((t) => t.politician === target.politician)
              : chartData.trades
            ).length === 0 ? (
              <div className="text-xs text-muted-foreground py-2">No trades in this period</div>
            ) : (
              (chartFilter === "politician" && target?.politician
                ? chartData.trades.filter((t) => t.politician === target.politician)
                : chartData.trades
              ).map((t, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between text-xs p-2 rounded bg-muted/20 border border-border/30"
                >
                  <div className="flex items-center gap-2">
                    <span className={`font-semibold ${t.type === "buy" ? "text-emerald-400" : "text-red-400"}`}>
                      {t.type === "buy" ? "BUY" : "SELL"}
                    </span>
                    <span>{t.politician}</span>
                    {t.source === "congress" ? (
                      <Landmark className="w-3 h-3 text-blue-400" />
                    ) : (
                      <UserCheck className="w-3 h-3 text-purple-400" />
                    )}
                    {t.party && <span className="text-muted-foreground">{t.party}</span>}
                  </div>
                  <div className="text-muted-foreground font-mono">
                    {t.date} {t.price ? `@ $${t.price.toFixed(2)}` : ""}
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
