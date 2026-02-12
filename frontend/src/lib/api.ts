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
  portfolio_return: number | null;
  portfolio_cagr: number | null;
  conviction_return: number | null;
  conviction_cagr: number | null;
  priced_buy_count: number | null;
  years_active: number | null;
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
  total_buys: number;
  total_sells: number;
  avg_return_pct: number | null;
  win_rate_pct: number | null;
  portfolio_return_pct: number | null;
  portfolio_cagr_pct: number | null;
  conviction_return_pct: number | null;
  conviction_cagr_pct: number | null;
  priced_buy_count: number;
  years_active: number | null;
  last_trade_date: string | null;
}

export interface UnifiedLeaderboard {
  leaderboard: LeaderboardEntry[];
  total_ranked: number;
  has_portfolio_data: boolean;
  party_comparison: Record<string, {
    avg_cagr_pct: number | null;
    avg_return_pct: number | null;
    total_politicians: number;
    total_trades: number;
  }>;
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

export interface TestWeightsResult {
  weights: Record<string, number>;
  result: {
    fitness: number;
    correlation_30d: number;
    correlation_90d: number;
    hit_rate_30d: number;
    hit_rate_90d: number;
    high_score_avg_return_30d: number;
    high_score_avg_return_90d: number;
    low_score_avg_return_30d: number;
    low_score_avg_return_90d: number;
    edge_30d: number;
    edge_90d: number;
    n_trades: number;
    n_high_score: number;
    n_low_score: number;
  };
  cross_validation: {
    is_robust: boolean;
    avg_test_fitness: number;
    avg_overfit_ratio: number;
  };
  trades_analyzed: number;
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

export interface PortfolioNavPoint {
  date: string;
  eq_return: number;
  conv_return: number;
  eq_nav: number;
  conv_nav: number;
  positions: number;
}

export interface PortfolioStrategyStats {
  total_return: number;
  annual_return: number;
  total_invested: number;
  positions_open: number;
}

export interface PortfolioSimulation {
  nav_series: PortfolioNavPoint[];
  equal_weight: PortfolioStrategyStats;
  conviction_weighted: PortfolioStrategyStats;
  tickers_traded: number;
  tickers_priced: number;
  total_trades: number;
  years: number;
  error?: string;
}

export interface PortfolioLeaderboardEntry {
  politician: string;
  party: string | null;
  state: string | null;
  chamber: string | null;
  total_trades: number;
  equal_weight: PortfolioStrategyStats & { years: number };
  conviction_weighted: PortfolioStrategyStats & { years: number };
}

// Alerts
export interface AlertItem {
  id: string;
  source: "congress" | "insider";
  politician: string;
  party: string | null;
  state: string | null;
  ticker: string;
  action: string;
  tx_type: string;
  amount_low: number | null;
  amount_high: number | null;
  tx_date: string | null;
  disclosure_date: string | null;
  description: string;
  return_since: number | null;
}

export interface AlertsResponse {
  alerts: AlertItem[];
  total: number;
  page: number;
  page_size: number;
  hours: number;
}

export interface SuspiciousTrade {
  id: string;
  source: "congress" | "insider";
  politician: string;
  party: string | null;
  state: string | null;
  ticker: string;
  asset_description: string | null;
  amount_low: number | null;
  amount_high: number | null;
  tx_date: string | null;
  disclosure_date: string | null;
  disclosure_delay_days: number | null;
  tx_type: string;
  action: string;
  return_since: number | null;
  conviction_score: number;
  conviction_rating: "VERY_HIGH" | "HIGH" | "MEDIUM" | "LOW" | "VERY_LOW";
  factors: { factor: string; points: number; detail: string }[];
  cluster_count: number;
  insider_also_buying: boolean;
  fund_also_holds: boolean;
  committee_overlap: { committee: string; stock_sector: string; overlap_type: string; flag: string } | null;
}

export interface SuspiciousResponse {
  trades: SuspiciousTrade[];
  total: number;
  days_checked: number;
}

export interface ConvictionPortfolioPosition {
  id: string;
  source: "congress" | "insider";
  politician: string;
  party: string | null;
  ticker: string;
  conviction_score: number;
  conviction_rating: "VERY_HIGH" | "HIGH" | "MEDIUM" | "LOW" | "VERY_LOW";
  entry_date: string | null;
  entry_price: number;
  exit_date: string | null;
  exit_price: number;
  return_pct: number;
  invested: number;
  current_value: number;
  pnl: number;
  holding_days: number | null;
  status: "closed" | "holding";
}

export interface ConvictionPortfolioResponse {
  summary: {
    total_positions: number;
    closed_positions: number;
    open_positions: number;
    total_invested: number;
    total_current_value: number;
    total_pnl: number;
    total_return_pct: number;
    win_rate: number;
    avg_return_pct: number;
    best_trade_pct: number | null;
    worst_trade_pct: number | null;
    avg_holding_days: number | null;
  };
  positions: ConvictionPortfolioPosition[];
  min_score: number;
  days: number;
}

export interface AlertsSummary {
  periods: Record<string, { congress_trades: number; insider_trades: number; total: number }>;
  hot_tickers_24h: { ticker: string; count: number }[];
}

export interface ActivityItem {
  id: string;
  source: "congress" | "insider";
  actor: string;
  actor_detail: string;
  action: string;
  ticker: string;
  description: string | null;
  amount_low: number | null;
  amount_high: number | null;
  date: string | null;
  tx_date: string | null;
  return_pct: number | null;
  price_at_trade: number | null;
  price_current: number | null;
}

export interface ActivityFeedResponse {
  activities: ActivityItem[];
  page: number;
  page_size: number;
}

// ─── API Functions ───

export const api = {
  // Stats
  getStats: () => fetchApi<StatsResponse>("/api/v1/stats"),

  // Trades
  getRecentTrades: () => fetchApi<Trade[]>("/api/v1/trades/recent"),
  getTrades: (params?: Record<string, string>) => {
    const qs = params ? "?" + new URLSearchParams(params).toString() : "";
    return fetchApi<Trade[]>(`/api/v1/trades${qs}`);
  },

  // Politicians
  getPoliticians: (params?: Record<string, string>) => {
    const qs = params ? "?" + new URLSearchParams(params).toString() : "";
    return fetchApi<Politician[]>(`/api/v1/politicians${qs}`);
  },
  getPolitician: (name: string) =>
    fetchApi<Politician & { recent_trades: Trade[]; total_buys?: number; total_sells?: number }>(`/api/v1/politicians/${encodeURIComponent(name)}`),
  getPoliticianCommittees: (name: string) =>
    fetchApi<{ committee_id?: string; committee_name?: string; committee?: string; role?: string; rank?: number }[]>(`/api/v1/signals/committees/politician/${encodeURIComponent(name)}`),
  getPoliticianPortfolio: (name: string) =>
    fetchApi<PortfolioSimulation>(`/api/v1/politicians/${encodeURIComponent(name)}/portfolio`),

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
    return fetchApi<UnifiedLeaderboard>(`/api/v1/leaderboard${qs}`);
  },
  getBestTrades: () => fetchApi<Trade[]>("/api/v1/leaderboard/best-trades"),
  getPortfolioReturns: (params?: Record<string, string>) => {
    const qs = params ? "?" + new URLSearchParams(params).toString() : "";
    return fetchApi<PortfolioLeaderboardEntry[]>(`/api/v1/leaderboard/portfolio-returns${qs}`);
  },

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
    return fetchApi<TestWeightsResult>(`/api/v1/optimizer/test-weights?${qs}`);
  },

  // Most traded tickers
  getMostTraded: () => fetchApi<{ ticker: string; count: number }[]>("/api/v1/tickers/most-traded"),

  // Alerts
  getRecentAlerts: (hours?: number, page?: number, pageSize?: number) => {
    const params = new URLSearchParams();
    if (hours) params.set("hours", String(hours));
    if (page) params.set("page", String(page));
    if (pageSize) params.set("page_size", String(pageSize));
    const qs = params.toString() ? `?${params.toString()}` : "";
    return fetchApi<AlertsResponse>(`/api/v1/alerts/recent${qs}`);
  },
  getAlertsSummary: () => fetchApi<AlertsSummary>("/api/v1/alerts/summary"),
  getActivityFeed: (params?: Record<string, string>) => {
    const qs = params ? "?" + new URLSearchParams(params).toString() : "";
    return fetchApi<ActivityFeedResponse>(`/api/v1/alerts/feed${qs}`);
  },
  getSuspiciousTrades: (days?: number) => {
    const qs = days ? `?days=${days}&limit=200` : "?limit=200";
    return fetchApi<SuspiciousResponse>(`/api/v1/alerts/suspicious${qs}`);
  },
  getConvictionPortfolio: (minScore?: number, days?: number) => {
    const params = new URLSearchParams();
    if (minScore !== undefined) params.set("min_score", String(minScore));
    if (days) params.set("days", String(days));
    const qs = params.toString() ? `?${params.toString()}` : "";
    return fetchApi<ConvictionPortfolioResponse>(`/api/v1/alerts/conviction-portfolio${qs}`);
  },
};
