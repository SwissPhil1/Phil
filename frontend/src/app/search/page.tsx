"use client";

import { useState, useRef, useCallback } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { api, type AISearchResult } from "@/lib/api";
import { useTickerChart, TickerChartSheet } from "@/components/ticker-chart-sheet";
import { Sparkles, Send, Loader2, Database, ChevronDown, ChevronUp, AlertCircle } from "lucide-react";

interface SearchEntry {
  query: string;
  result: AISearchResult | null;
  error: string | null;
  loading: boolean;
}

const EXAMPLE_QUERIES = [
  "Politicians with the highest win rate who traded tech stocks",
  "Top 10 trades with best returns in the last year",
  "Which politicians sit on the finance committee and traded bank stocks?",
  "Show me insider buys over $1M in the last 6 months",
  "Politicians who bought NVDA before it went up",
  "Most active traders from the Republican party",
  "Trades with conviction score above 70",
  "Which stocks did Nancy Pelosi buy recently?",
];

// Detect if a column value is a ticker symbol
function isTicker(col: string, val: unknown): boolean {
  if (typeof val !== "string") return false;
  const tickerCols = ["ticker", "symbol", "stock", "stock_ticker"];
  return tickerCols.some(t => col.toLowerCase().includes(t)) && /^[A-Z]{1,5}$/.test(val);
}

// Detect if a column value is a politician name
function isPolitician(col: string): boolean {
  const politicianCols = ["politician", "politician_name", "name", "actor", "member", "representative", "senator"];
  return politicianCols.some(p => col.toLowerCase().includes(p));
}

// Format cell values nicely
function formatCell(col: string, val: unknown): string {
  if (val === null || val === undefined) return "—";
  if (typeof val === "number") {
    const lower = col.toLowerCase();
    if (lower.includes("return") || lower.includes("pct") || lower.includes("rate") || lower.includes("cagr")) {
      return `${val >= 0 ? "+" : ""}${val.toFixed(1)}%`;
    }
    if (lower.includes("amount") || lower.includes("value") || lower.includes("price")) {
      if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(1)}M`;
      if (val >= 1_000) return `$${(val / 1_000).toFixed(0)}K`;
      return `$${val.toFixed(2)}`;
    }
    if (lower.includes("score")) return val.toFixed(1);
    if (Number.isInteger(val)) return val.toLocaleString();
    return val.toFixed(2);
  }
  return String(val);
}

function ResultTable({ result, chart }: { result: AISearchResult; chart: ReturnType<typeof useTickerChart> }) {
  const [showSql, setShowSql] = useState(false);

  if (result.error) {
    return (
      <div className="flex items-start gap-3 p-4 rounded-lg bg-red-500/5 border border-red-500/10">
        <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
        <div className="text-sm text-red-400">{result.error}</div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Summary */}
      {result.summary && (
        <div className="text-sm text-foreground leading-relaxed">{result.summary}</div>
      )}

      {/* Stats */}
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span>{result.total} result{result.total !== 1 ? "s" : ""}</span>
        <span>{result.columns.length} columns</span>
        <button
          onClick={() => setShowSql(!showSql)}
          className="flex items-center gap-1 hover:text-foreground transition-colors cursor-pointer"
        >
          <Database className="w-3 h-3" />
          SQL
          {showSql ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </button>
      </div>

      {/* SQL preview */}
      {showSql && (
        <pre className="text-xs bg-muted/50 border border-border rounded-lg p-3 overflow-x-auto text-muted-foreground font-mono">
          {result.sql}
        </pre>
      )}

      {/* Results table */}
      {result.results.length > 0 && (
        <div className="rounded-lg border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50 border-b border-border">
                  {result.columns.map((col) => (
                    <th key={col} className="px-3 py-2 text-left text-xs font-medium text-muted-foreground whitespace-nowrap">
                      {col.replace(/_/g, " ")}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.results.map((row, i) => (
                  <tr key={i} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                    {result.columns.map((col) => {
                      const val = row[col];
                      const tickerMatch = isTicker(col, val);
                      const politicianMatch = isPolitician(col) && typeof val === "string" && val.length > 2;

                      return (
                        <td key={col} className="px-3 py-2 whitespace-nowrap">
                          {tickerMatch ? (
                            <button
                              onClick={() => chart.openChart(String(val))}
                              className="font-mono text-xs font-medium text-foreground hover:text-primary hover:underline transition-colors cursor-pointer"
                            >
                              {String(val)}
                            </button>
                          ) : politicianMatch ? (
                            <Link
                              href={`/politician/${encodeURIComponent(String(val))}`}
                              className="text-sm hover:text-primary hover:underline transition-colors"
                            >
                              {String(val)}
                            </Link>
                          ) : (
                            <span className={`text-sm ${typeof val === "number" ? "font-mono-data" : ""} ${
                              typeof val === "number" && col.toLowerCase().includes("return")
                                ? val > 0 ? "text-green-400" : val < 0 ? "text-red-400" : ""
                                : ""
                            }`}>
                              {formatCell(col, val)}
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {result.results.length === 0 && !result.error && (
        <div className="text-sm text-muted-foreground text-center py-6">
          No results found for this query.
        </div>
      )}
    </div>
  );
}

export default function SearchPage() {
  const chart = useTickerChart();
  const [entries, setEntries] = useState<SearchEntry[]>([]);
  const [input, setInput] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsEndRef = useRef<HTMLDivElement>(null);

  const runSearch = useCallback(async (query: string) => {
    if (!query.trim() || isSearching) return;

    const entryIndex = entries.length;
    const newEntry: SearchEntry = { query: query.trim(), result: null, error: null, loading: true };

    setEntries(prev => [...prev, newEntry]);
    setInput("");
    setIsSearching(true);

    // Scroll to bottom
    setTimeout(() => resultsEndRef.current?.scrollIntoView({ behavior: "smooth" }), 100);

    try {
      const result = await api.aiSearch(query.trim());
      setEntries(prev => prev.map((e, i) =>
        i === entryIndex ? { ...e, result, error: result.error || null, loading: false } : e
      ));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Search failed";
      setEntries(prev => prev.map((e, i) =>
        i === entryIndex ? { ...e, error: message, loading: false } : e
      ));
    }

    setIsSearching(false);
    setTimeout(() => resultsEndRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
  }, [entries.length, isSearching]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    runSearch(input);
  };

  const handleExample = (query: string) => {
    setInput(query);
    inputRef.current?.focus();
  };

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      {/* Header */}
      <div className="shrink-0 pb-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-purple-500/10 flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-purple-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">AI Search</h1>
            <p className="text-muted-foreground text-sm">
              Search the database using plain English — powered by AI
            </p>
          </div>
        </div>
      </div>

      {/* Results area (scrollable) */}
      <div className="flex-1 overflow-y-auto space-y-6 pb-4 min-h-0">
        {entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-6">
            <div className="text-center space-y-2">
              <Sparkles className="w-10 h-10 text-purple-400/50 mx-auto" />
              <p className="text-muted-foreground text-sm max-w-md">
                Ask anything about congressional trades, politicians, insider activity,
                hedge funds, and more. Your question will be converted to a database query automatically.
              </p>
            </div>

            {/* Example queries */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-2xl w-full">
              {EXAMPLE_QUERIES.map((q) => (
                <button
                  key={q}
                  onClick={() => handleExample(q)}
                  className="text-left text-xs text-muted-foreground hover:text-foreground p-3 rounded-lg border border-border/50 hover:border-border hover:bg-muted/30 transition-all cursor-pointer"
                >
                  &ldquo;{q}&rdquo;
                </button>
              ))}
            </div>
          </div>
        ) : (
          entries.map((entry, i) => (
            <div key={i} className="space-y-3">
              {/* User query */}
              <div className="flex items-start gap-3">
                <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                  <span className="text-xs font-medium text-primary">Q</span>
                </div>
                <div className="text-sm font-medium pt-1">{entry.query}</div>
              </div>

              {/* AI response */}
              <div className="flex items-start gap-3">
                <div className="w-7 h-7 rounded-full bg-purple-500/10 flex items-center justify-center shrink-0 mt-0.5">
                  <Sparkles className="w-3.5 h-3.5 text-purple-400" />
                </div>
                <div className="flex-1 min-w-0">
                  {entry.loading ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Analyzing your question and querying the database...
                    </div>
                  ) : entry.error && !entry.result ? (
                    <Card>
                      <CardContent className="p-4">
                        <div className="flex items-start gap-3">
                          <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
                          <div className="text-sm text-red-400">{entry.error}</div>
                        </div>
                      </CardContent>
                    </Card>
                  ) : entry.result ? (
                    <Card>
                      <CardContent className="p-4">
                        <ResultTable result={entry.result} chart={chart} />
                      </CardContent>
                    </Card>
                  ) : null}
                </div>
              </div>
            </div>
          ))
        )}
        <div ref={resultsEndRef} />
      </div>

      {/* Input bar (fixed at bottom) */}
      <div className="shrink-0 pt-4 border-t border-border">
        <form onSubmit={handleSubmit} className="relative">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about trades, politicians, patterns..."
            disabled={isSearching}
            className="w-full pl-4 pr-12 py-3 bg-muted/30 border border-border rounded-lg text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-purple-500/50 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={!input.trim() || isSearching}
            className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-md bg-purple-500 hover:bg-purple-600 disabled:opacity-30 disabled:hover:bg-purple-500 flex items-center justify-center transition-colors cursor-pointer"
          >
            {isSearching ? (
              <Loader2 className="w-4 h-4 text-white animate-spin" />
            ) : (
              <Send className="w-4 h-4 text-white" />
            )}
          </button>
        </form>
        <div className="flex items-center gap-2 mt-2 text-[10px] text-muted-foreground/60">
          <Sparkles className="w-3 h-3" />
          AI-generated SQL queries — results are read-only and limited to 100 rows
        </div>
      </div>

      <TickerChartSheet {...chart} />
    </div>
  );
}
