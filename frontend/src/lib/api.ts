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
