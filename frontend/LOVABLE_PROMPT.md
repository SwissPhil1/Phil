# SmartFlow - Lovable Frontend Spec

## How to use this file
Paste the prompt below into Lovable to generate the frontend app.
After Lovable generates the app, update the API_BASE_URL in src/lib/api.ts
to point to your Railway backend URL.

---

## Lovable Prompt (paste this into Lovable)

```
Build a financial dashboard app called "SmartFlow" with the tagline "Copy the smartest money in the world". It's designed for European investors who want to track and copy trades from US politicians, hedge fund managers, corporate insiders, and prediction market whales.

DESIGN: Dark theme (dark navy/charcoal background like Bloomberg Terminal or TradingView), with green for positive returns, red for negative, and blue/cyan accents. Professional fintech feel. Mobile-first responsive design. Use shadcn/ui components.

PAGES & LAYOUT:

1. SIDEBAR NAVIGATION (left side, collapsible on mobile):
   - Dashboard (home icon)
   - Congress (capitol building icon)
   - Hedge Funds (briefcase icon)
   - Insiders (user-check icon)
   - Prediction Markets (trending-up icon)
   - Autopilot Monitor (robot icon)
   - Settings (gear icon)

2. DASHBOARD PAGE (home):
   - Top stats row: Total Trades Tracked, Active Politicians, Hedge Funds Tracked, Polymarket Whales
   - "Latest Trades" card: scrollable list of the 10 most recent congressional trades showing politician name, party badge (D=blue, R=red), ticker, type (BUY in green/SELL in red), amount range, and disclosure date
   - "Top Performing Politicians" card: leaderboard table with rank, name, party, avg return %, win rate %, total trades
   - "Most Bought by Congress" card: horizontal bar chart of top 10 tickers bought in last 30 days
   - "Hedge Fund Spotlight" card: show Buffett, Burry, and Ackman latest top 5 holdings each
   - "Polymarket Whales" card: top 5 traders by monthly PnL with username, PnL amount, portfolio value

3. CONGRESS PAGE:
   - Filter bar at top: Chamber (All/House/Senate), Party (All/D/R), State dropdown, Ticker search, Date range
   - Trades table with columns: Date, Politician, Party, State, Ticker, Type, Amount, Disclosure Delay (days)
   - Click a politician name to see their detail page with:
     - Profile header (name, party, state, total trades, avg return, win rate)
     - Trade history table
     - Performance chart (if we had price data)

4. HEDGE FUNDS PAGE:
   - Grid of fund cards, each showing: Manager name, Fund name, Portfolio value, # holdings, Last filing date
   - Featured funds: Warren Buffett, Michael Burry, Bill Ackman, Ray Dalio, Stanley Druckenmiller, Ken Griffin, Cathie Wood
   - Click a fund card to see full holdings table: Issuer, Ticker, Value, Shares, % of Portfolio, Put/Call badge
   - "Overlap Finder" section: enter a ticker to see which funds hold it

5. INSIDERS PAGE:
   - "Big Buys" section at top: largest insider purchases in last 30 days (cards showing insider name, title, company, ticker, total value)
   - Full trades table with filters: Ticker, Insider name, Transaction type, Min value
   - "Most Active Tickers" sidebar: tickers with the most insider activity

6. PREDICTION MARKETS PAGE:
   - Two tabs: "Polymarket" and "Kalshi"
   - Polymarket tab:
     - Leaderboard table: Rank, Username/Wallet, Monthly PnL, All-time PnL, Volume, Portfolio Value
     - Click a trader to see their positions (market name, outcome, size, avg price, current price, PnL, PnL%)
     - "Whale Positions" section: largest open positions across all tracked traders
   - Kalshi tab:
     - Market list with search: Title, Last Price (shown as probability %), Volume, Close Date
     - Sort by volume, liquidity, or close time

7. AUTOPILOT MONITOR PAGE:
   - Table showing all Autopilot portfolios we track
   - Columns: Portfolio Name, Category (politician/hedge_fund/ai), Replicable? (green check or red x), Our Equivalent Endpoint
   - For replicable portfolios, a "View Our Data" link that navigates to the corresponding page in our app
   - Explanation banner: "We replicate Autopilot's politician and hedge fund portfolios using the same public data sources (STOCK Act, SEC 13F). AI portfolios are proprietary and cannot be replicated."

API INTEGRATION:
The app connects to a REST API. Create an api.ts client file with a configurable BASE_URL (default: "http://localhost:8000"). All endpoints are under /api/v1/:
- GET /api/v1/trades?politician=&party=&ticker=&days=90&page=1
- GET /api/v1/trades/recent?limit=20
- GET /api/v1/politicians?sort_by=total_trades&limit=50
- GET /api/v1/politicians/rankings?min_trades=5&limit=20
- GET /api/v1/politicians/{name}
- GET /api/v1/tickers/most-traded?days=30
- GET /api/v1/stats
- GET /api/v1/hedge-funds/
- GET /api/v1/hedge-funds/{cik}/holdings
- GET /api/v1/hedge-funds/overlap?ticker=NVDA
- GET /api/v1/insiders/trades?ticker=&min_value=100000&days=90
- GET /api/v1/insiders/buys?days=30&min_value=100000
- GET /api/v1/insiders/most-active-tickers
- GET /api/v1/prediction-markets/polymarket/leaderboard?sort_by=pnl_month
- GET /api/v1/prediction-markets/polymarket/traders/{wallet}
- GET /api/v1/prediction-markets/polymarket/positions?min_value=10000
- GET /api/v1/prediction-markets/kalshi/markets?search=&sort_by=volume
- GET /api/v1/autopilot/portfolios

IMPORTANT DETAILS:
- Show loading skeletons while API calls are in progress
- Handle empty states gracefully ("No data yet - ingestion in progress")
- Format large numbers with K/M/B suffixes ($1.2M, $500K)
- Format dates as relative time ("2 days ago") for recent, absolute for older
- Party badges: D = blue background, R = red background, I = gray
- Transaction type badges: Purchase/Buy = green, Sale/Sell = red, Exercise = orange
- Make the app feel like a Bloomberg terminal for retail investors
```

---

## After Lovable generates the app

1. Find `src/lib/api.ts` (or create it) and set your Railway URL:
   ```
   const API_BASE_URL = "https://YOUR-RAILWAY-URL.railway.app"
   ```

2. Your Railway backend needs CORS enabled (already configured - allows all origins)

3. The Swagger docs at YOUR-RAILWAY-URL/docs show all endpoints for reference
