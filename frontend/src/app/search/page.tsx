"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { api, type AISearchResult, type SavedSegment } from "@/lib/api";
import { useTickerChart, TickerChartSheet } from "@/components/ticker-chart-sheet";
import {
  Sparkles, Send, Loader2, Database, ChevronDown, ChevronUp, AlertCircle,
  BookmarkPlus, RefreshCw, Trash2, Clock, ChevronRight, Layers,
} from "lucide-react";

interface SearchEntry {
  query: string;
  result: AISearchResult | null;
  error: string | null;
  loading: boolean;
  saved?: boolean;
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
  if (val === null || val === undefined) return "\u2014";
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

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function DataTable({ columns, results, chart }: { columns: string[]; results: Record<string, unknown>[]; chart: ReturnType<typeof useTickerChart> }) {
  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/50 border-b border-border">
              {columns.map((col) => (
                <th key={col} className="px-3 py-2 text-left text-xs font-medium text-muted-foreground whitespace-nowrap">
                  {col.replace(/_/g, " ")}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {results.map((row, i) => (
              <tr key={i} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                {columns.map((col) => {
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
  );
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
      {result.summary && (
        <div className="text-sm text-foreground leading-relaxed">{result.summary}</div>
      )}

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

      {showSql && (
        <pre className="text-xs bg-muted/50 border border-border rounded-lg p-3 overflow-x-auto text-muted-foreground font-mono">
          {result.sql}
        </pre>
      )}

      {result.results.length > 0 && (
        <DataTable columns={result.columns} results={result.results} chart={chart} />
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

  // Segments state
  const [segments, setSegments] = useState<SavedSegment[]>([]);
  const [segmentsLoading, setSegmentsLoading] = useState(true);
  const [expandedSegment, setExpandedSegment] = useState<number | null>(null);
  const [refreshingIds, setRefreshingIds] = useState<Set<number>>(new Set());
  const [showSegments, setShowSegments] = useState(true);

  // Load segments on mount
  useEffect(() => {
    api.getSegments()
      .then(setSegments)
      .catch(() => {})
      .finally(() => setSegmentsLoading(false));
  }, []);

  const saveSegment = useCallback(async (result: AISearchResult) => {
    if (!result.sql || result.error || result.results.length === 0) return;
    try {
      const seg = await api.createSegment({
        name: result.query,
        query: result.query,
        sql: result.sql,
        columns: result.columns,
        results: result.results,
        summary: result.summary,
      });
      setSegments(prev => [seg, ...prev]);
    } catch {
      // silently fail — segment saving is best-effort
    }
  }, []);

  const refreshSegment = useCallback(async (id: number) => {
    setRefreshingIds(prev => new Set(prev).add(id));
    try {
      const updated = await api.refreshSegment(id);
      setSegments(prev => prev.map(s => s.id === id ? updated : s));
    } catch {
      // silently fail
    }
    setRefreshingIds(prev => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const deleteSegment = useCallback(async (id: number) => {
    try {
      await api.deleteSegment(id);
      setSegments(prev => prev.filter(s => s.id !== id));
      if (expandedSegment === id) setExpandedSegment(null);
    } catch {
      // silently fail
    }
  }, [expandedSegment]);

  const runSearch = useCallback(async (query: string) => {
    if (!query.trim() || isSearching) return;

    const entryIndex = entries.length;
    const newEntry: SearchEntry = { query: query.trim(), result: null, error: null, loading: true };

    setEntries(prev => [...prev, newEntry]);
    setInput("");
    setIsSearching(true);

    setTimeout(() => resultsEndRef.current?.scrollIntoView({ behavior: "smooth" }), 100);

    try {
      const result = await api.aiSearch(query.trim());
      setEntries(prev => prev.map((e, i) =>
        i === entryIndex ? { ...e, result, error: result.error || null, loading: false, saved: !result.error && result.results.length > 0 } : e
      ));

      // Auto-save as segment if successful with results
      if (!result.error && result.results.length > 0) {
        saveSegment(result);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Search failed";
      setEntries(prev => prev.map((e, i) =>
        i === entryIndex ? { ...e, error: message, loading: false } : e
      ));
    }

    setIsSearching(false);
    setTimeout(() => resultsEndRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
  }, [entries.length, isSearching, saveSegment]);

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
              Search using plain English — results auto-save as refreshable segments
            </p>
          </div>
        </div>
      </div>

      {/* Saved Segments panel */}
      {(segments.length > 0 || segmentsLoading) && (
        <div className="shrink-0 mb-4">
          <button
            type="button"
            onClick={() => setShowSegments(!showSegments)}
            className="flex items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors mb-2 cursor-pointer"
          >
            <Layers className="w-3.5 h-3.5" />
            Saved Segments ({segments.length})
            {showSegments ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          </button>

          {showSegments && (
            <div className="space-y-2 max-h-[40vh] overflow-y-auto">
              {segmentsLoading ? (
                <div className="text-xs text-muted-foreground flex items-center gap-2 py-2">
                  <Loader2 className="w-3 h-3 animate-spin" /> Loading segments...
                </div>
              ) : (
                segments.map((seg) => (
                  <Card key={seg.id} className="border-border/50">
                    <CardContent className="p-0">
                      {/* Segment header row */}
                      <div className="flex items-center gap-2 px-3 py-2.5">
                        <button
                          type="button"
                          onClick={() => setExpandedSegment(expandedSegment === seg.id ? null : seg.id)}
                          className="flex-1 text-left min-w-0 cursor-pointer"
                        >
                          <div className="text-sm font-medium truncate">{seg.name}</div>
                          <div className="flex items-center gap-2 text-[10px] text-muted-foreground mt-0.5">
                            <span>{seg.result_count} results</span>
                            <span className="flex items-center gap-0.5">
                              <Clock className="w-2.5 h-2.5" />
                              {timeAgo(seg.refreshed_at)}
                            </span>
                          </div>
                        </button>

                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => refreshSegment(seg.id)}
                            disabled={refreshingIds.has(seg.id)}
                            className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer disabled:opacity-50"
                            title="Refresh with latest data"
                          >
                            <RefreshCw className={`w-3.5 h-3.5 ${refreshingIds.has(seg.id) ? "animate-spin" : ""}`} />
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteSegment(seg.id)}
                            className="p-1.5 rounded-md hover:bg-red-500/10 text-muted-foreground hover:text-red-400 transition-colors cursor-pointer"
                            title="Delete segment"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* Expanded: show results table */}
                      {expandedSegment === seg.id && (
                        <div className="px-3 pb-3 border-t border-border/30 pt-3 space-y-2">
                          {seg.summary && (
                            <div className="text-sm text-foreground leading-relaxed">{seg.summary}</div>
                          )}
                          {seg.results.length > 0 ? (
                            <DataTable columns={seg.columns} results={seg.results} chart={chart} />
                          ) : (
                            <div className="text-xs text-muted-foreground py-2">No results. Try refreshing.</div>
                          )}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          )}
        </div>
      )}

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
                <div className="flex items-center gap-2 pt-1">
                  <div className="text-sm font-medium">{entry.query}</div>
                  {entry.saved && (
                    <Badge variant="outline" className="text-[10px] gap-1 text-purple-400 border-purple-500/30">
                      <BookmarkPlus className="w-2.5 h-2.5" /> saved
                    </Badge>
                  )}
                </div>
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

      {/* Input bar */}
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
          AI-generated SQL queries — results auto-save as refreshable segments
        </div>
      </div>

      <TickerChartSheet {...chart} />
    </div>
  );
}
