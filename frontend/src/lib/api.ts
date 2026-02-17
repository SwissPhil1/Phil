// Always use relative paths - Next.js API route handler proxies /api/* to Railway backend.
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

// --- Types ---

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
  suspicion_score: number | null;
  cluster_flag: boolean;
  return_30d: number | null;
  return_90d: number | null;
  excess_return_90d: number | null;
  realized_return: number | null;
  hold_days: number | null;
  sell_price: number | null;
}

export interface ClusterGroup {
  ticker: string;
  week: string;
  politicians: number;
  trades: {
    id: number;
    politician: string;
    party: string | null;
    tx_date: string | null;
    amount_low: number | null;
    amount_high: number | null;
    suspicion_score: number | null;
    return_since_disclosure: number | null;
  }[];
}

export interface ScoringStats {
  total_purchases: number;
  scored_trades: number;
  scoring_coverage: string;
  with_90d_forward_returns: number;
  with_excess_returns: number;
  cluster_trades: number;
  avg_suspicion_score: number | null;
  high_suspicion_count: number;
  medium_suspicion_count: number;
  round_trips?: {
    matched_trades: number;
    avg_realized_return: number | null;
    avg_hold_days: number | null;
    win_rate: number | null;
  };
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

export interface TickerChartData {
  ticker: string;
  prices: { date: string; close: number }[];
  trades: {
    date: string | null;
    type: "buy" | "sell";
    politician: string;
    source: string;
    party: string | null;
    amount_low: number | null;
    amount_high: number | null;
    price: number | null;
  }[];
  days: number;
}

// --- API Functions ---

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
  getPoliticianPortfolio: (name: string) =>
    fetchApi<PortfolioSimulation>(`/api/v1/politicians/${encodeURIComponent(name)}/portfolio`),

  // Leaderboard
  getLeaderboard: (params?: Record<string, string>) => {
    const qs = params ? "?" + new URLSearchParams(params).toString() : "";
    return fetchApi<UnifiedLeaderboard>(`/api/v1/leaderboard${qs}`);
  },
  getPortfolioReturns: (params?: Record<string, string>) => {
    const qs = params ? "?" + new URLSearchParams(params).toString() : "";
    return fetchApi<PortfolioLeaderboardEntry[]>(`/api/v1/leaderboard/portfolio-returns${qs}`);
  },

  // Most traded tickers
  getMostTraded: () => fetchApi<{ ticker: string; count: number }[]>("/api/v1/tickers/most-traded"),

  // Ticker chart
  getTickerChart: (ticker: string, days?: number) => {
    const params = new URLSearchParams();
    if (days) params.set("days", String(days));
    const qs = params.toString() ? `?${params.toString()}` : "";
    return fetchApi<TickerChartData>(`/api/v1/tickers/${encodeURIComponent(ticker)}/chart${qs}`);
  },

  // Suspicious trades
  getSuspiciousTrades: (params?: Record<string, string>) => {
    const qs = params ? "?" + new URLSearchParams(params).toString() : "";
    return fetchApi<Trade[]>(`/api/v1/trades/suspicious${qs}`);
  },
  getClusterTrades: (params?: Record<string, string>) => {
    const qs = params ? "?" + new URLSearchParams(params).toString() : "";
    return fetchApi<ClusterGroup[]>(`/api/v1/trades/clusters${qs}`);
  },
  getScoringStats: () => fetchApi<ScoringStats>("/api/v1/scoring/stats"),
  getScoringValidation: () => fetchApi<Record<string, unknown>>("/api/v1/scoring/validation"),
  getRoundTrips: (params?: Record<string, string>) => {
    const qs = params ? "?" + new URLSearchParams(params).toString() : "";
    return fetchApi<Trade[]>(`/api/v1/trades/round-trips${qs}`);
  },
};
