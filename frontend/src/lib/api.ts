// SmartFlow API Client
// Update this URL to your Railway deployment URL
const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

async function fetchApi<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
  const url = new URL(`${API_BASE_URL}${path}`);
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    });
  }
  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`API error: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

// --- Congress ---

export interface Trade {
  id: number;
  chamber: string;
  politician: string;
  party: string | null;
  state: string | null;
  ticker: string | null;
  asset_description: string | null;
  tx_type: string;
  tx_date: string | null;
  disclosure_date: string | null;
  amount_low: number | null;
  amount_high: number | null;
  price_at_disclosure: number | null;
  return_since_disclosure: number | null;
  disclosure_delay_days: number | null;
}

export interface Politician {
  id: number;
  name: string;
  chamber: string | null;
  party: string | null;
  state: string | null;
  total_trades: number;
  total_buys: number;
  total_sells: number;
  avg_return: number | null;
  win_rate: number | null;
  last_trade_date: string | null;
}

export interface PoliticianDetail extends Politician {
  recent_trades: Trade[];
}

export interface Stats {
  total_trades: number;
  total_politicians: number;
  trades_last_7d: number;
  trades_last_30d: number;
  most_bought_tickers: { ticker: string; count: number }[];
  most_active_politicians: { politician: string; party: string; count: number }[];
  party_breakdown: Record<string, number>;
}

export const congress = {
  getTrades: (params?: {
    chamber?: string;
    politician?: string;
    party?: string;
    state?: string;
    ticker?: string;
    tx_type?: string;
    days?: number;
    page?: number;
    page_size?: number;
  }) => fetchApi<Trade[]>("/api/v1/trades", params as Record<string, string | number>),

  getRecentTrades: (limit = 20) =>
    fetchApi<Trade[]>("/api/v1/trades/recent", { limit }),

  getPoliticians: (params?: {
    chamber?: string;
    party?: string;
    sort_by?: string;
    min_trades?: number;
    limit?: number;
  }) => fetchApi<Politician[]>("/api/v1/politicians", params as Record<string, string | number>),

  getRankings: (params?: {
    chamber?: string;
    party?: string;
    min_trades?: number;
    limit?: number;
  }) => fetchApi<Politician[]>("/api/v1/politicians/rankings", params as Record<string, string | number>),

  getPolitician: (name: string) =>
    fetchApi<PoliticianDetail>(`/api/v1/politicians/${encodeURIComponent(name)}`),

  getMostTraded: (days = 30, limit = 20) =>
    fetchApi<{ ticker: string; trade_count: number; politician_count: number }[]>(
      "/api/v1/tickers/most-traded", { days, limit }
    ),

  getStats: () => fetchApi<Stats>("/api/v1/stats"),
};

// --- Hedge Funds ---

export interface HedgeFund {
  name: string;
  manager: string;
  cik: string;
  total_value: number | null;
  num_holdings: number | null;
  last_filing_date: string | null;
  report_date: string | null;
}

export interface Holding {
  issuer: string;
  title: string;
  cusip: string;
  ticker: string | null;
  value: number;
  shares: number;
  share_type: string;
  put_call: string | null;
  pct_of_portfolio: number | null;
  is_new: boolean;
  shares_change_pct: number | null;
}

export interface FundHoldings {
  fund: string;
  manager: string;
  report_date: string;
  total_value: number;
  num_holdings: number;
  holdings: Holding[];
}

export const hedgeFunds = {
  list: () => fetchApi<HedgeFund[]>("/api/v1/hedge-funds/"),

  getTracked: () =>
    fetchApi<{ name: string; manager: string; cik: string }[]>("/api/v1/hedge-funds/tracked"),

  getHoldings: (cik: string, params?: { sort_by?: string; limit?: number }) =>
    fetchApi<FundHoldings>(`/api/v1/hedge-funds/${cik}/holdings`, params as Record<string, string | number>),

  getOverlap: (ticker: string) =>
    fetchApi<{
      fund: string;
      manager: string;
      issuer: string;
      value: number;
      shares: number;
      put_call: string | null;
    }[]>("/api/v1/hedge-funds/overlap", { ticker }),
};

// --- Insiders ---

export interface InsiderTrade {
  insider: string;
  title: string | null;
  is_director: boolean;
  is_officer: boolean;
  is_ten_pct_owner: boolean;
  company: string;
  ticker: string | null;
  tx_date: string | null;
  filing_date: string | null;
  tx_type: string;
  tx_code: string;
  shares: number;
  price_per_share: number | null;
  total_value: number | null;
  shares_after: number | null;
  acquired_disposed: string;
}

export const insiders = {
  getTrades: (params?: {
    ticker?: string;
    insider?: string;
    tx_type?: string;
    min_value?: number;
    days?: number;
    page?: number;
  }) => fetchApi<InsiderTrade[]>("/api/v1/insiders/trades", params as Record<string, string | number>),

  getBuys: (days = 30, min_value = 100000, limit = 30) =>
    fetchApi<InsiderTrade[]>("/api/v1/insiders/buys", { days, min_value, limit }),

  getMostActive: (days = 30, limit = 20) =>
    fetchApi<{
      ticker: string;
      company: string;
      trade_count: number;
      insider_count: number;
      total_value: number;
    }[]>("/api/v1/insiders/most-active-tickers", { days, limit }),
};

// --- Prediction Markets ---

export interface PolymarketTrader {
  wallet: string;
  username: string;
  x_username: string | null;
  verified: boolean;
  pnl_all: number | null;
  pnl_month: number | null;
  pnl_week: number | null;
  volume_all: number | null;
  portfolio_value: number | null;
  rank_all: number | null;
  rank_month: number | null;
}

export interface PolymarketPosition {
  market: string;
  slug: string | null;
  outcome: string;
  size: number;
  avg_price: number | null;
  current_price: number | null;
  current_value: number | null;
  pnl: number | null;
  pnl_pct: number | null;
  end_date: string | null;
}

export interface TraderDetail {
  trader: PolymarketTrader;
  positions: PolymarketPosition[];
  recent_trades: {
    side: string;
    market: string;
    outcome: string;
    size: number;
    price: number;
    timestamp: string;
    tx_hash: string;
  }[];
}

export interface KalshiMarket {
  ticker: string;
  event_ticker: string;
  title: string;
  last_price: number | null;
  yes_bid: number | null;
  yes_ask: number | null;
  volume: number | null;
  open_interest: number | null;
  liquidity: number | null;
  close_time: string | null;
}

export const predictionMarkets = {
  polymarketLeaderboard: (sort_by = "pnl_month", limit = 50) =>
    fetchApi<PolymarketTrader[]>("/api/v1/prediction-markets/polymarket/leaderboard", { sort_by, limit }),

  polymarketTrader: (wallet: string) =>
    fetchApi<TraderDetail>(`/api/v1/prediction-markets/polymarket/traders/${wallet}`),

  polymarketPositions: (min_value = 10000, limit = 50) =>
    fetchApi<{
      wallet: string;
      market: string;
      outcome: string;
      current_value: number;
      pnl: number | null;
      pnl_pct: number | null;
    }[]>("/api/v1/prediction-markets/polymarket/positions", { min_value, limit }),

  kalshiMarkets: (params?: { search?: string; sort_by?: string; limit?: number }) =>
    fetchApi<KalshiMarket[]>("/api/v1/prediction-markets/kalshi/markets", params as Record<string, string | number>),
};

// --- Autopilot ---

export interface AutopilotPortfolio {
  autopilot_name: string;
  category: string;
  our_data_source: string;
  replicable: boolean;
  portfolio_url: string | null;
}

export const autopilot = {
  getPortfolios: () =>
    fetchApi<AutopilotPortfolio[]>("/api/v1/autopilot/portfolios"),
};

// --- Smart Signals ---

export interface SignalCluster {
  ticker: string;
  action: string;
  politician_count: number;
  politicians: string[];
  first_trade: string | null;
  last_trade: string | null;
  window_days: number;
  signal_strength: string;
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
  factors: string[];
  ticker: string;
  politician: string | null;
  committees_checked: string[];
}

export interface CommitteeAssignment {
  committee_id: string;
  committee_name: string;
  role: string | null;
  rank: number | null;
}

export interface CommitteeOverlap {
  politician: string;
  ticker: string;
  committees: CommitteeAssignment[];
  overlap: {
    committee: string;
    stock_sector: string;
    overlap_type: string;
    flag: string;
  } | null;
  has_conflict: boolean;
  flag: string | null;
}

export const signals = {
  getAll: () =>
    fetchApi<{
      timestamp: string;
      clusters: SignalCluster[];
      cross_source_signals: CrossSourceSignal[];
      total_high_signals: number;
    }>("/api/v1/signals/"),

  getClusters: (days = 14, min_politicians = 3) =>
    fetchApi<SignalCluster[]>("/api/v1/signals/clusters", { days, min_politicians }),

  getCrossSource: (days = 30) =>
    fetchApi<CrossSourceSignal[]>("/api/v1/signals/cross-source", { days }),

  scoreTrade: (ticker: string, politician?: string, amount_low?: number) =>
    fetchApi<ConvictionScore>("/api/v1/signals/score-trade", {
      ticker,
      politician,
      amount_low,
    } as Record<string, string | number>),

  checkCommitteeConflict: (ticker: string, politician: string) =>
    fetchApi<CommitteeOverlap>("/api/v1/signals/committee-check", { ticker, politician }),

  getPoliticianCommittees: (name: string) =>
    fetchApi<CommitteeAssignment[]>(`/api/v1/signals/committees/politician/${encodeURIComponent(name)}`),

  getCommitteeMembers: (committee: string) =>
    fetchApi<{
      politician_name: string;
      bioguide_id: string;
      party: string;
      state: string;
      chamber: string;
      role: string | null;
      rank: number | null;
    }[]>("/api/v1/signals/committees/members", { committee }),
};

// --- Trump & Inner Circle ---

export interface TrumpInsider {
  name: string;
  role: string;
  category: string;
  relationship: string;
  known_interests: string[];
  board_seats: string[];
  tickers: string[];
  notes: string;
}

export interface TrumpConnectedCompany {
  company_name?: string;
  name?: string;
  ticker: string | null;
  connection?: string;
  connection_description?: string;
  category: string;
  sector: string;
  connected_insiders?: string[];
  insiders?: string[];
}

export interface TrumpDonor {
  name: string;
  amount_known: number;
  entity: string;
  interests: string[];
}

export interface PolicyConnection {
  policy: string;
  description: string;
  winners: string[];
  losers: string[];
  tickers_affected: string[];
}

export interface ConflictOfInterest {
  insider: string;
  role: string;
  category: string;
  financial_interests: string[];
  connected_tickers: string[];
  board_seats: string[];
  connected_companies: string[];
  policy_conflicts: {
    policy: string;
    description: string;
    affected_tickers: string[];
    insider_is_winner: boolean;
  }[];
  conflict_severity: string;
}

export const trump = {
  getOverview: () =>
    fetchApi<{
      description: string;
      tracked_insiders: number;
      tracked_companies: number;
      major_donors: number;
      policy_connections: number;
      categories: Record<string, number>;
    }>("/api/v1/trump/"),

  getInsiders: (category?: string) =>
    fetchApi<TrumpInsider[]>("/api/v1/trump/insiders", category ? { category } : undefined),

  getInsider: (name: string) =>
    fetchApi<TrumpInsider & { connected_companies: TrumpConnectedCompany[] }>(
      `/api/v1/trump/insiders/${encodeURIComponent(name)}`
    ),

  getCompanies: (category?: string) =>
    fetchApi<TrumpConnectedCompany[]>("/api/v1/trump/companies", category ? { category } : undefined),

  getDonors: () =>
    fetchApi<TrumpDonor[]>("/api/v1/trump/donors"),

  getPolicyConnections: () =>
    fetchApi<PolicyConnection[]>("/api/v1/trump/policy-connections"),

  getTrades: () =>
    fetchApi<{
      source: string;
      ticker: string;
      company: string;
      trump_connection: string;
      [key: string]: unknown;
    }[]>("/api/v1/trump/trades"),

  getHedgeFundOverlap: () =>
    fetchApi<{
      ticker: string;
      company: string;
      trump_connection: string;
      fund_cik: string;
      value: number;
      shares: number;
      is_new_position: boolean;
    }[]>("/api/v1/trump/hedge-fund-overlap"),

  getConflictMap: () =>
    fetchApi<ConflictOfInterest[]>("/api/v1/trump/conflict-map"),
};

// --- Hedge Fund Changes (Q-over-Q) ---

export interface FundChanges {
  fund: string;
  manager: string;
  current_quarter: string;
  previous_quarter: string | null;
  summary: {
    new_positions: number;
    closed_positions: number;
    increased: number;
    decreased: number;
    unchanged: number;
  };
  new_positions: {
    issuer: string;
    ticker: string | null;
    value: number;
    shares: number;
  }[];
  closed_positions: {
    issuer: string;
    ticker: string | null;
    prev_value: number;
    prev_shares: number;
  }[];
  increased: {
    issuer: string;
    ticker: string | null;
    shares_change_pct: number;
    value: number;
  }[];
  decreased: {
    issuer: string;
    ticker: string | null;
    shares_change_pct: number;
    value: number;
  }[];
}

// Add changes endpoint to hedgeFunds
export const hedgeFundsExtended = {
  ...hedgeFunds,
  getChanges: (cik: string) =>
    fetchApi<FundChanges>(`/api/v1/hedge-funds/${cik}/changes`),
};

// --- Leaderboard & Backtest ---

export interface PoliticianLeaderboardEntry {
  rank: number;
  politician: string;
  party: string | null;
  state: string | null;
  chamber: string | null;
  total_trades: number;
  buys: number;
  sells: number;
  avg_return_pct: number | null;
  win_rate_pct: number | null;
  trades_with_returns: number;
  biggest_trade_amount: number | null;
  best_trade_return_pct: number | null;
  worst_trade_return_pct: number | null;
}

export interface YearLeaderboard {
  year: number;
  politicians_ranked: number;
  top_10: PoliticianLeaderboardEntry[];
  bottom_10: PoliticianLeaderboardEntry[];
  full_leaderboard: PoliticianLeaderboardEntry[];
}

export interface LeaderboardResponse {
  available_years: number[];
  leaderboards: Record<string, YearLeaderboard>;
  consistent_winners: {
    politician: string;
    years_active: number;
    avg_rank: number;
    avg_return_all_years: number;
    yearly_data: { year: number; rank: number; avg_return: number | null; trades: number }[];
  }[];
  party_comparison: Record<string, {
    avg_return_pct: number | null;
    total_politicians: number;
    total_trades: number;
  }>;
}

export interface BacktestResponse {
  backtest_params: { lookback_days: number; forward_days: number; max_trades: number };
  total_trades_checked: number;
  trades_with_returns: number;
  score_bucket_analysis: Record<string, {
    trade_count: number;
    avg_return_pct: number | null;
    median_return_pct?: number;
    win_rate_pct?: number;
    best_trade_pct?: number;
    worst_trade_pct?: number;
  }>;
  score_validation: {
    high_score_avg_return?: number;
    low_score_avg_return?: number;
    high_score_count?: number;
    low_score_count?: number;
    score_predicts_returns?: boolean;
    edge_pct?: number;
    error?: string;
  };
  committee_analysis: {
    committee_overlap_trades: number;
    committee_avg_return: number | null;
    non_committee_trades: number;
    non_committee_avg_return: number | null;
    committee_edge: number | null;
  };
  small_vs_large_cap: {
    question: string;
    small_cap_committee_trades: number;
    small_cap_committee_avg_return: number | null;
    large_cap_cluster_trades: number;
    large_cap_cluster_avg_return: number | null;
  };
  top_scored_trades: {
    politician: string;
    ticker: string;
    score: number;
    factors: string[];
    forward_return_pct: number | null;
    tx_date: string | null;
    amount_low: number | null;
  }[];
}

export interface ProfitableTrade {
  rank: number;
  politician: string;
  party: string | null;
  ticker: string;
  asset: string | null;
  tx_date: string | null;
  disclosure_date: string | null;
  amount_low: number | null;
  amount_high: number | null;
  price_at_disclosure: number | null;
  price_current: number | null;
  return_pct: number;
  disclosure_delay_days: number | null;
}

export const leaderboard = {
  get: (params?: { year?: number; min_trades?: number; chamber?: string }) =>
    fetchApi<LeaderboardResponse>("/api/v1/leaderboard/", params as Record<string, string | number>),

  bestTrades: (days = 365, limit = 50) =>
    fetchApi<ProfitableTrade[]>("/api/v1/leaderboard/best-trades", { days, limit }),

  backtest: (params?: { days?: number; forward_days?: number; max_trades?: number }) =>
    fetchApi<BacktestResponse>("/api/v1/leaderboard/backtest", params as Record<string, string | number>),
};

// --- Helpers ---

export function formatMoney(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  if (Math.abs(value) >= 1e9) return `$${(value / 1e9).toFixed(1)}B`;
  if (Math.abs(value) >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
  if (Math.abs(value) >= 1e3) return `$${(value / 1e3).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}

export function formatPct(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

export function formatRelativeDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`;
  return date.toLocaleDateString();
}

export function partyColor(party: string | null): string {
  if (party === "D") return "bg-blue-600";
  if (party === "R") return "bg-red-600";
  return "bg-gray-600";
}

export function txTypeColor(txType: string): string {
  if (txType === "purchase") return "text-green-400";
  if (txType.includes("sale")) return "text-red-400";
  if (txType === "exercise") return "text-orange-400";
  return "text-gray-400";
}
