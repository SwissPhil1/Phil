// Always use relative paths - Next.js API route handler proxies /api/* to Railway backend.
// This avoids cross-origin issues and trailing-slash redirect loops.
const API_BASE = "";

async function fetchApi<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });
  if (!res.ok) {
    throw new Error(`API error: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

// ─── Types ───

export interface Trade {
  id: number;
  chamber: string;
  politician: string;
  party: string;
  state: string;
  ticker: string;
  asset_description: string;
  tx_type: string;
  tx_date: string;
  disclosure_date: string;
  amount_low: number;
  amount_high: number;
  price_at_disclosure: number | null;
  price_current: number | null;
  return_since_disclosure: number | null;
  disclosure_delay_days?: number;
}

export interface Politician {
  name: string;
  chamber: string;
  party: string;
  state: string;
  total_trades: number;
  avg_return: number | null;
  win_rate: number | null;
  last_trade_date: string;
}

export interface Signal {
  ticker: string;
  action: string;
  politician_count: number;
  politicians: string[];
  signal_strength: string;
  is_mega_cap: boolean;
  window_days: number;
}

export interface CrossSourceSignal {
  ticker: string;
  sector: string;
  sources: string[];
  source_count: number;
  signal_strength: string;
  description: string;
}

export interface ConvictionScore {
  score: number;
  rating: string;
  factors: { factor: string; points: number; detail: string }[];
  factor_breakdown: Record<string, number>;
  committee_overlap: { committee: string; stock_sector: string; flag: string } | null;
}

export interface StatsResponse {
  total_trades: number;
  total_politicians: number;
  trades_last_7d: number;
  trades_last_30d: number;
  most_bought_tickers: { ticker: string; count: number }[];
  most_active_politicians: { politician: string; total_trades: number }[];
  party_breakdown: Record<string, number>;
}

export interface LeaderboardEntry {
  rank: number;
  politician: string;
  party: string;
  state: string;
  chamber: string;
  total_trades: number;
  avg_return_pct: number | null;
  win_rate_pct: number | null;
  best_trade_return_pct: number | null;
}

export interface HedgeFund {
  name: string;
  manager_name: string;
  cik: string;
  total_value: number;
  num_holdings: number;
}

export interface OptimizerResult {
  optimization_params: {
    lookback_days: number;
    max_trades: number;
    generations: number;
    total_configs_tested: number;
    elapsed_seconds: number;
  };
  data_summary: {
    trades_with_returns: number;
    trades_with_30d_return: number;
    trades_with_90d_return: number;
    trades_with_exit: number;
  };
  generation_history: {
    generation: number;
    configs_tested: number;
    best_fitness: number;
    avg_fitness: number;
  }[];
  current_formula: {
    fitness: number;
    correlation_30d: number;
    correlation_90d: number;
    hit_rate_30d: number;
    hit_rate_90d: number;
    edge_30d: number;
    edge_90d: number;
    weights: Record<string, number>;
  };
  top_formulas: {
    rank: number;
    fitness: number;
    correlation_30d: number;
    correlation_90d: number;
    hit_rate_30d: number;
    hit_rate_90d: number;
    edge_30d: number;
    edge_90d: number;
    weights: Record<string, number>;
    cross_validation: {
      is_robust: boolean;
      avg_test_fitness: number;
      avg_overfit_ratio: number;
    };
  }[];
  best_robust_formula: {
    rank: number;
    fitness: number;
    weights: Record<string, number>;
    cross_validation: { is_robust: boolean };
  } | null;
  recommendation: {
    use_new_formula: boolean;
    improvement_pct: number;
    detail: string;
  };
}

export interface TrumpOverview {
  total_insiders: number;
  total_companies: number;
  total_donors: number;
  categories: Record<string, number>;
}

export interface BacktestResult {
  backtest_params: Record<string, unknown>;
  total_trades_checked: number;
  trades_with_returns: number;
  exits_found: number;
  still_holding: number;
  score_bucket_analysis: Record<string, {
    trade_count: number;
    avg_return_pct: number | null;
  }>;
  score_validation: {
    error?: string;
    significant_95pct?: boolean;
    edge_pct?: number;
    t_statistic?: number;
  };
  top_scored_trades?: any[];
}

// ─── API Functions ───

export const api = {
  // Stats
  getStats: () => fetchApi<StatsResponse>("/api/v1/stats"),

  // Trades
  getRecentTrades: () => fetchApi<Trade[]>("/api/v1/trades/recent"),
  getTrades: (params?: Record<string, string>) => {
    const qs = params ? "?" + new URLSearchParams(params).toString() : "";
    return fetchApi<{ trades: Trade[]; total: number }>(`/api/v1/trades${qs}`);
  },

  // Politicians
  getPoliticians: () => fetchApi<Politician[]>("/api/v1/politicians"),
  getPolitician: (name: string) =>
    fetchApi<Politician & { recent_trades: Trade[]; total_buys?: number; total_sells?: number }>(`/api/v1/politicians/${encodeURIComponent(name)}`),
  getPoliticianCommittees: (name: string) =>
    fetchApi<{ committee: string; subcommittee?: string }[]>(`/api/v1/signals/committees/politician/${encodeURIComponent(name)}`),

  // Signals
  getSignals: () =>
    fetchApi<{ clusters: Signal[]; cross_source_signals: CrossSourceSignal[]; total_high_signals: number }>(
      "/api/v1/signals"
    ),
  getClusters: () => fetchApi<Signal[]>("/api/v1/signals/clusters"),
  getCrossSourceSignals: () => fetchApi<CrossSourceSignal[]>("/api/v1/signals/cross-source"),
  scoreTrade: (params: Record<string, string>) => {
    const qs = new URLSearchParams(params).toString();
    return fetchApi<ConvictionScore>(`/api/v1/signals/score-trade?${qs}`);
  },

  // Leaderboard
  getLeaderboard: (params?: Record<string, string>) => {
    const qs = params ? "?" + new URLSearchParams(params).toString() : "";
    return fetchApi<{
      leaderboards: Record<string, { top_10: LeaderboardEntry[]; bottom_10: LeaderboardEntry[] }>;
      consistent_winners: LeaderboardEntry[];
    }>(`/api/v1/leaderboard${qs}`);
  },
  getBestTrades: () => fetchApi<Trade[]>("/api/v1/leaderboard/best-trades"),

  // Hedge Funds
  getHedgeFunds: () => fetchApi<HedgeFund[]>("/api/v1/hedge-funds"),
  getHedgeFundHoldings: (cik: string) =>
    fetchApi<{ fund: HedgeFund; holdings: unknown[] }>(`/api/v1/hedge-funds/${cik}/holdings`),

  // Insiders
  getInsiderTrades: (params?: Record<string, string>) => {
    const qs = params ? "?" + new URLSearchParams(params).toString() : "";
    return fetchApi<unknown[]>(`/api/v1/insiders/trades${qs}`);
  },
  getInsiderBuys: () => fetchApi<unknown[]>("/api/v1/insiders/buys"),

  // Prediction Markets
  getPolymarketLeaderboard: () => fetchApi<unknown[]>("/api/v1/prediction-markets/polymarket/leaderboard"),
  getKalshiMarkets: () => fetchApi<unknown[]>("/api/v1/prediction-markets/kalshi/markets"),

  // Trump
  getTrumpOverview: () => fetchApi<TrumpOverview>("/api/v1/trump"),
  getTrumpInsiders: () => fetchApi<unknown[]>("/api/v1/trump/insiders"),
  getTrumpConflictMap: () => fetchApi<unknown>("/api/v1/trump/conflict-map"),

  // Backtester
  runBacktest: (params?: Record<string, string>) => {
    const qs = params ? "?" + new URLSearchParams(params).toString() : "";
    return fetchApi<BacktestResult>(`/api/v1/leaderboard/backtest${qs}`);
  },

  // Optimizer
  runOptimizer: (params?: Record<string, string>) => {
    const qs = params ? "?" + new URLSearchParams(params).toString() : "";
    return fetchApi<OptimizerResult>(`/api/v1/optimizer/run${qs}`);
  },
  getOptimizerStatus: () => fetchApi<{ status: string; sample_trades: number }>("/api/v1/optimizer/status"),
  testCustomWeights: (params: Record<string, string>) => {
    const qs = new URLSearchParams(params).toString();
    return fetchApi<unknown>(`/api/v1/optimizer/test-weights?${qs}`);
  },

  // Most traded tickers
  getMostTraded: () => fetchApi<{ ticker: string; count: number }[]>("/api/v1/tickers/most-traded"),
};
