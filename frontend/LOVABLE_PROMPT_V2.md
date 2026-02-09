# SmartFlow - Complete Lovable Frontend Prompt (v2)

## How to use
Copy everything between the `---START---` and `---END---` markers below and paste it into Lovable as a single prompt.

---START---

Build a full-featured financial intelligence dashboard called **"SmartFlow"** with tagline **"Copy the smartest money in the world"**. It tracks insider trading from US politicians, corporate insiders, hedge fund managers, Trump's inner circle, and prediction market whales. It has a proprietary conviction scoring system (0-100) that rates how suspicious each trade is.

## TECH STACK
- React + TypeScript + Vite
- shadcn/ui components (use extensively)
- Tailwind CSS
- React Router for navigation
- TanStack Query (React Query) for API calls with caching
- Recharts for all charts/graphs
- Lucide React for icons

## DESIGN SYSTEM
- **Theme**: Dark mode only. Background: slate-950 (#0a0f1a). Cards: slate-900 with subtle border. Bloomberg Terminal / TradingView aesthetic.
- **Colors**: Green (#22c55e) = profit/buy, Red (#ef4444) = loss/sell, Blue (#3b82f6) = neutral/info, Amber (#f59e0b) = warning/medium signal, Cyan (#06b6d4) = accents, Purple (#a855f7) = Trump tracker
- **Typography**: Monospace font for numbers/prices (font-mono). Inter/system font for text.
- **Cards**: Rounded-lg, border border-slate-800, bg-slate-900/50 backdrop-blur
- **Tables**: Striped rows (odd:bg-slate-800/30), hover:bg-slate-800/60, sticky headers
- **Badges**: Rounded-full, small, uppercase, font-semibold
- **Responsive**: Mobile-first. Sidebar collapses to bottom tab bar on mobile.

## API CLIENT (src/lib/api.ts)

Create a typed API client. Base URL configurable via `VITE_API_URL` env var, default `http://localhost:8000`.

```typescript
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
  if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`);
  return res.json();
}
```

All endpoints are under `/api/v1/`. Here are the exact endpoints:

### Congress Trades
- `GET /api/v1/trades` - params: chamber, politician, party, state, ticker, tx_type, days, page, page_size
- `GET /api/v1/trades/recent` - params: limit (default 20)
- `GET /api/v1/politicians` - params: chamber, party, sort_by, min_trades, limit
- `GET /api/v1/politicians/rankings` - params: chamber, party, min_trades, limit
- `GET /api/v1/politicians/{name}` - detail with recent trades
- `GET /api/v1/tickers/most-traded` - params: days, limit
- `GET /api/v1/stats` - dashboard summary stats

### Hedge Funds (13F)
- `GET /api/v1/hedge-funds/` - list all tracked funds
- `GET /api/v1/hedge-funds/tracked` - list of tracked fund names/CIKs
- `GET /api/v1/hedge-funds/{cik}/holdings` - params: sort_by, limit
- `GET /api/v1/hedge-funds/{cik}/changes` - quarter-over-quarter changes
- `GET /api/v1/hedge-funds/overlap` - params: ticker (which funds hold this stock)

### Corporate Insiders (Form 4)
- `GET /api/v1/insiders/trades` - params: ticker, insider, tx_type, min_value, days, page
- `GET /api/v1/insiders/buys` - params: days, min_value, limit
- `GET /api/v1/insiders/most-active-tickers` - params: days, limit

### Prediction Markets
- `GET /api/v1/prediction-markets/polymarket/leaderboard` - params: sort_by, limit
- `GET /api/v1/prediction-markets/polymarket/traders/{wallet}` - trader detail + positions
- `GET /api/v1/prediction-markets/polymarket/positions` - params: min_value, limit
- `GET /api/v1/prediction-markets/kalshi/markets` - params: search, sort_by, limit

### Smart Signals & Conviction Scoring
- `GET /api/v1/signals/` - all signals (clusters + cross-source)
- `GET /api/v1/signals/clusters` - params: days, min_politicians
- `GET /api/v1/signals/cross-source` - params: days
- `GET /api/v1/signals/score-trade` - params: ticker, tx_type, amount_low, politician, disclosure_delay_days
- `GET /api/v1/signals/committee-check` - params: ticker, politician
- `GET /api/v1/signals/committees/politician/{name}`
- `GET /api/v1/signals/committees/members` - params: committee

### Trump & Inner Circle
- `GET /api/v1/trump/` - overview stats
- `GET /api/v1/trump/insiders` - params: category (family/associate/appointee/donor)
- `GET /api/v1/trump/insiders/{name}` - detail + connected companies
- `GET /api/v1/trump/companies` - params: category
- `GET /api/v1/trump/donors`
- `GET /api/v1/trump/policy-connections`
- `GET /api/v1/trump/trades` - trades involving Trump-connected companies
- `GET /api/v1/trump/hedge-fund-overlap`
- `GET /api/v1/trump/conflict-map`

### Leaderboard & Backtesting
- `GET /api/v1/leaderboard/` - params: year, min_trades, chamber
- `GET /api/v1/leaderboard/best-trades` - params: days, limit
- `GET /api/v1/leaderboard/backtest` - params: days, forward_days, max_trades, return_mode (forward/exit/both)

### Autopilot Monitor
- `GET /api/v1/autopilot/portfolios`

## PAGES & NAVIGATION

### Sidebar (left, fixed)
Collapsible sidebar with icon + text. On mobile, becomes a bottom tab bar showing only icons.

Navigation items (with Lucide icons):
1. **Dashboard** - LayoutDashboard
2. **Congress** - Landmark
3. **Smart Signals** - Zap (NEW - this is a key page)
4. **Hedge Funds** - Briefcase
5. **Insiders** - UserCheck
6. **Trump Tracker** - Shield (purple accent)
7. **Prediction Markets** - TrendingUp
8. **Leaderboard** - Trophy
9. **Backtest** - FlaskConical
10. **Settings** - Settings

---

### PAGE 1: DASHBOARD (/)

Top stats row (4 cards):
- Total Trades Tracked (from /api/v1/stats → total_trades)
- Active Politicians (total_politicians)
- Trades Last 7 Days (trades_last_7d)
- High Signals Active (from /api/v1/signals/ → total_high_signals) - use amber color

**Latest Congressional Trades** card:
- Scrollable list of 10 most recent trades (GET /api/v1/trades/recent?limit=10)
- Each row: politician name with party badge (D=blue pill, R=red pill), ticker in mono font, BUY/SELL badge (green/red), amount range ($15K-$50K format), relative date
- Click any trade to navigate to Congress page filtered by that politician

**Smart Signals Alert** card (prominent, bordered amber/cyan):
- Shows clusters and cross-source signals from /api/v1/signals/
- Format: "🔥 {politician_count} politicians buying {ticker}" for clusters
- Format: "⚡ {ticker}: {source1} + {source2}" for cross-source
- Signal strength badge: VERY_HIGH=red, HIGH=amber, MEDIUM=blue
- "View All Signals →" link to Smart Signals page

**Top Politicians** card:
- Mini leaderboard table: Rank, Name (with party badge), Avg Return %, Win Rate %, Total Trades
- From /api/v1/politicians/rankings?limit=10
- Green text for positive returns, red for negative

**Most Bought by Congress** card:
- Horizontal bar chart (Recharts) of top 10 tickers from /api/v1/tickers/most-traded?days=30
- Bars colored by sector (tech=blue, defense=slate, energy=amber, finance=green, pharma=purple)

**Hedge Fund Spotlight** card:
- 3 mini cards for Buffett, Burry, Ackman showing their top 5 holdings each
- From /api/v1/hedge-funds/{cik}/holdings?limit=5

---

### PAGE 2: CONGRESS (/congress)

**Filter Bar** (sticky at top):
- Chamber: All / House / Senate (segmented button)
- Party: All / D / R (segmented button)
- State: dropdown with all US states
- Ticker: text input with search
- Date range: preset buttons (7d, 30d, 90d, 1y, All)

**Trades Table** (main content):
- Columns: Date, Politician (with party badge), State, Ticker (mono font, clickable), Type (BUY green / SELL red badge), Amount ($15K-$50K), Disclosure Delay (days, red if >45), Conviction Score (0-100 colored badge)
- For the conviction score column: call /api/v1/signals/score-trade for each visible trade
- Sortable columns, paginated (20 per page)
- Click politician name → slide-out panel or sub-page with:
  - Header: Name, Party, State, Chamber
  - Stats: Total Trades, Avg Return, Win Rate, Best Trade
  - Committee Assignments (from /api/v1/signals/committees/politician/{name})
  - Trade History table
  - "Committee Conflicts" section: highlight any trades where they sit on a relevant committee (flagged trades)

---

### PAGE 3: SMART SIGNALS (/signals) ⭐ KEY PAGE

This is the crown jewel - the intelligence dashboard.

**Conviction Score Calculator** (top card, interactive):
- Input fields: Ticker, Politician Name (optional), Amount ($), Disclosure Delay (days)
- "Score This Trade" button → calls /api/v1/signals/score-trade
- Shows result as:
  - Large score number (0-100) with color ring (green >60, amber 40-60, red <40)
  - Rating badge: VERY_HIGH / HIGH / MEDIUM / LOW / VERY_LOW
  - Factor breakdown list showing each factor and its points:
    - Position Size: +18 pts
    - Committee Overlap: +30 pts (DIRECT: Armed Services → defense)
    - Disclosure Speed: +15 pts (LATE disclosure - potentially hiding trade)
    - etc.
  - Context section: cluster count, insider buying status, hedge fund holding status, politician track record

**Active Clusters** section:
- Cards from /api/v1/signals/clusters
- Each card: Ticker (large), "{count} politicians BUYING/SELLING", list of politician names, time window, signal strength badge
- Sort by strength, then politician count

**Cross-Source Convergence** section:
- Cards from /api/v1/signals/cross-source
- Each card: Ticker, sector badge, source pills ("Congress (3)", "Insiders (2)", "Hedge Fund"), signal strength
- Triple-source convergence cards get a special gold/amber border

**Committee Conflict Checker** section:
- Two inputs: Politician Name + Ticker
- Button "Check Conflict"
- Shows committee list and whether there's overlap with the stock's sector
- Flag: "HIGH - Direct sector match" in red, or "No conflict found" in green

---

### PAGE 4: HEDGE FUNDS (/hedge-funds)

**Fund Grid** (responsive 2-3 column):
- Card per fund from /api/v1/hedge-funds/
- Each card: Manager name (bold), Fund name, Portfolio value (formatted $XXB), Holdings count, Last filing date
- Card click → expands to full holdings view

**Fund Detail** (when a fund card is clicked):
- Holdings table: Rank, Issuer, Ticker (mono), Value (formatted), Shares, % of Portfolio, New Position? (green "NEW" badge), Put/Call badge
- From /api/v1/hedge-funds/{cik}/holdings
- Sortable by value, shares, % of portfolio

**Quarter-over-Quarter Changes** (from /api/v1/hedge-funds/{cik}/changes):
- Summary stats: New Positions, Closed, Increased, Decreased
- Tabs: New Positions (green), Closed (red), Increased (amber up arrow), Decreased (amber down arrow)
- Each tab shows relevant holdings with change details

**Overlap Finder** (bottom section):
- Input: "Enter a ticker to see which funds hold it"
- Results from /api/v1/hedge-funds/overlap?ticker=XXX
- Table: Fund, Manager, Value, Shares, Put/Call

---

### PAGE 5: INSIDERS (/insiders)

**Big Buys** section (top, horizontal scroll):
- Cards for largest insider purchases from /api/v1/insiders/buys?days=30&min_value=100000
- Each card: Insider name, Title (CEO/CFO/Director), Company, Ticker, Total Value (large green number)

**Insider Trades Table**:
- Filters: Ticker search, Min Value slider, Transaction Type dropdown, Days (30/90/365)
- Columns: Filing Date, Insider, Title, Company, Ticker, Type (P=Purchase green, S=Sale red, M=Exercise orange), Shares, Price, Total Value, Shares After
- From /api/v1/insiders/trades

**Most Active Tickers** sidebar:
- From /api/v1/insiders/most-active-tickers
- List: Ticker, Company, # Trades, # Insiders, Total Value
- Click ticker to filter the main table

---

### PAGE 6: TRUMP TRACKER (/trump) 🟣

Use purple/violet accents for this entire page to differentiate it.

**Overview Banner** (top):
- Stats from /api/v1/trump/: "Tracking {tracked_insiders} insiders, {tracked_companies} connected companies, {major_donors} major donors, {policy_connections} policy connections"
- Category breakdown pills: Family, Associates, Appointees, Donors

**Inner Circle** section:
- Filterable by category (tabs: All / Family / Appointees / Associates / Donors)
- Cards from /api/v1/trump/insiders
- Each card: Name (bold), Role, Category badge (purple shades), Known Interests (tags), Board Seats, Connected Tickers (mono, clickable)
- Click name → detail panel from /api/v1/trump/insiders/{name} showing connected companies

**Connected Companies** section:
- Table from /api/v1/trump/companies
- Columns: Company, Ticker, Category, Sector, Connected Insiders (avatar pills)
- Rows link to relevant financial data when clicked

**Policy Connections** section:
- Accordion/card list from /api/v1/trump/policy-connections
- Each card: Policy name (bold), Description, Winners (green tags with tickers), Losers (red tags with tickers)
- Example: "Tariffs & Trade Wars" → Winners: steel stocks, Losers: retailers

**Major Donors** section:
- Table from /api/v1/trump/donors
- Columns: Name, Amount (formatted), Entity/Company, Interests (tags)
- Sort by donation amount descending

**Conflict Map** section:
- From /api/v1/trump/conflict-map
- Cards per insider showing: Name, Role, Financial Interests, Connected Tickers, Board Seats, Policy Conflicts
- Conflict severity badge: HIGH (red), MEDIUM (amber), LOW (green)

**Trump-Connected Trades** section:
- Table from /api/v1/trump/trades
- Shows recent trades in Trump-connected companies by Congress members and insiders
- Columns: Source (Congress/Insider), Ticker, Company, Trump Connection, Trade Details

---

### PAGE 7: PREDICTION MARKETS (/prediction-markets)

**Two tabs**: Polymarket | Kalshi

**Polymarket Tab**:
- Leaderboard table from /api/v1/prediction-markets/polymarket/leaderboard
- Columns: Rank, Username (or truncated wallet), Monthly PnL (green/red), All-time PnL, Volume, Portfolio Value
- Click trader → detail panel from /api/v1/prediction-markets/polymarket/traders/{wallet}
  - Positions table: Market, Outcome, Size, Avg Price, Current Price, PnL, PnL %
  - Recent trades list

- **Whale Positions** section: /api/v1/prediction-markets/polymarket/positions?min_value=10000
- Cards: Wallet, Market title, Outcome, Current Value, PnL

**Kalshi Tab**:
- Market list from /api/v1/prediction-markets/kalshi/markets
- Search bar + sort dropdown (volume, liquidity)
- Columns: Title, Last Price (shown as probability %), Yes Bid/Ask, Volume, Open Interest, Close Date
- Color the probability: >70% = green, 30-70% = amber, <30% = red

---

### PAGE 8: LEADERBOARD (/leaderboard)

**Year Selector** (tabs or dropdown): Shows available years from API

**Leaderboard Table** from /api/v1/leaderboard/:
- Columns: Rank (#1, #2...), Politician (with party badge), State, Chamber, Total Trades, Buys, Sells, Avg Return % (green/red), Win Rate %, Best Trade %, Worst Trade %
- Sortable by any column
- Top 3 get gold/silver/bronze icons

**Party Comparison** card:
- From party_comparison in response
- Side-by-side: Democrats vs Republicans
- Stats: Avg Return, Total Politicians, Total Trades
- Bar chart comparison

**Consistent Winners** card:
- From consistent_winners in response
- Politicians who perform well across multiple years
- Columns: Name, Years Active, Avg Rank, Avg Return All Years

**Best Individual Trades** section:
- From /api/v1/leaderboard/best-trades
- Table: Rank, Politician, Ticker, Trade Date, Amount, Return %, Disclosure Delay

---

### PAGE 9: BACKTEST (/backtest) 🧪

**Configuration Panel** (top):
- Lookback Period: slider (30-1825 days, default 365)
- Forward Return Window: dropdown (30d, 90d, 180d, 365d)
- Max Trades to Analyze: slider (10-500, default 100)
- Return Mode: segmented buttons (Forward / Exit / Both)
- "Run Backtest" button (prominent, cyan)
- Warning: "This runs real price lookups via yfinance and may take 30-60 seconds"

**Results** (shown after running backtest, from /api/v1/leaderboard/backtest):

**Score Bucket Analysis** card:
- 5 horizontal bars showing performance by score range:
  - 80-100 (VERY_HIGH): avg return, win rate, count, Sharpe
  - 60-79 (HIGH): same
  - 40-59 (MEDIUM): same
  - 20-39 (LOW): same
  - 0-19 (VERY_LOW): same
- Use Recharts bar chart with green gradient for positive returns, red for negative
- Show the count, avg return %, median, std dev, win rate, Sharpe for each bucket

**Score Validation** card (prominent):
- "Does the scoring system work?" header
- Show t-test result: t-statistic, significant (yes/no with green check or red x)
- Edge: High-score avg return vs Low-score avg return
- Large text: "+X.X% edge" if positive

**Factor Attribution** card:
- Table: Factor Name, Trades With, Avg Return With, Trades Without, Avg Return Without, Edge %, Win Rate With, Win Rate Without
- Sorted by edge descending
- Green highlight for factors with positive edge >2%
- This answers "which scoring factors actually predict returns?"

**Committee Analysis** card:
- Committee overlap trades vs non-committee trades comparison
- Stats for each group + t-test significance

**Market Cap Analysis** card:
- "Small-cap + committee" vs "Mega-cap + cluster" comparison
- Shows which strategy works better with statistical significance

**Multi-Window Returns** card:
- Recharts line chart showing returns at 30d, 90d, 180d, 365d windows
- Two lines: High-score trades vs Low-score trades
- Shows when the scoring edge is strongest

**Forward vs Exit** card (if return_mode is "both"):
- "Do politicians time their exits well?"
- Avg holding days, exit beat forward %, forward returns stats, exit returns stats

**Party Analysis** card:
- Democrats vs Republicans returns with stats

**Top Scored Trades** table:
- The 20 highest-scored trades with all details
- Columns: Score (colored badge), Politician, Ticker, Date, Amount, Factors (as pills), Forward Return, Exit Return, Still Holding?

---

### PAGE 10: SETTINGS (/settings)

- API URL configuration (text input, saves to localStorage)
- Theme toggle (dark only for now, but add the toggle)
- Refresh intervals (how often to re-fetch data)
- About section with app version and data sources

---

## GLOBAL COMPONENTS

### ConvictionBadge component
Takes a score (0-100) and renders:
- 80-100: Red badge "VERY HIGH" with fire icon
- 60-79: Amber badge "HIGH"
- 40-59: Blue badge "MEDIUM"
- 20-39: Slate badge "LOW"
- 0-19: Gray badge "VERY LOW"

### PartyBadge component
- "D" = blue-600 rounded pill
- "R" = red-600 rounded pill
- "I" = gray-600 rounded pill

### TxTypeBadge component
- "purchase" = green badge "BUY"
- "sale"/"sale_full"/"sale_partial" = red badge "SELL"
- "exercise" = orange badge "EXERCISE"

### SignalStrengthBadge component
- "VERY_HIGH" = red pulsing badge
- "HIGH" = amber badge
- "MEDIUM" = blue badge

### MoneyDisplay component
- Formats numbers: $1.2B, $45.3M, $500K, $1,234
- Green if positive context, red if negative

### ReturnDisplay component
- Shows "+12.5%" in green or "-3.2%" in red
- Mono font

### Loading states
- Use shadcn Skeleton components while loading
- Pulse animation on cards

### Empty states
- Friendly message: "No data yet — the system is collecting trades. Check back soon."
- Subtle icon illustration

### Error states
- Red alert banner: "Failed to load data. The API may be starting up."
- Retry button

## HELPER FUNCTIONS (include in api.ts)

```typescript
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
  const diffDays = Math.floor((now.getTime() - date.getTime()) / 86400000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`;
  return date.toLocaleDateString();
}
```

## IMPORTANT NOTES
- ALL numbers should use mono font (font-mono class)
- Show loading skeletons while fetching, never blank screens
- Handle API errors gracefully with retry buttons
- Use React Query with 30-second stale time for most endpoints, 5-minute for backtest
- Make the sidebar current page indicator prominent (cyan left border + bg highlight)
- The app should feel like a Bloomberg terminal for retail investors
- Charts should have dark backgrounds with subtle grid lines
- Use tooltips on score badges to explain what each factor means
- The Smart Signals page and Backtest page are the most important — make them look amazing
- ALL API calls should go through the fetchApi helper function for consistency

---END---

## After Lovable generates the app

1. Set your Railway backend URL:
   ```
   VITE_API_URL=https://YOUR-APP.railway.app
   ```

2. Your Railway backend has CORS enabled (allows all origins).

3. Swagger docs at `YOUR-URL/docs` show all endpoints.

4. The existing `src/lib/api.ts` file (710 lines) already has full TypeScript interfaces for all endpoints — you can reference it or let Lovable regenerate from the prompt above.
