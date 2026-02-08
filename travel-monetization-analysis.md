# Travel-Friendly Monetization Ideas - Analysis

## Final Direction: Autopilot for Europe (Copy Trading US Politicians)

### Why this direction
- Autopilot has 3M downloads, $1B AUM, 80K paid subscribers (~$100/year) - proven demand
- Autopilot is US-only (SEC-registered RIA, US brokerages only) - no European support, no timeline
- European users have no equivalent product for auto-copying congressional trades
- The data pipeline (STOCK Act disclosures) is free and well-documented
- Multiple European brokerages support programmatic trading via API

---

## Competitive Landscape

### Direct Competitors (US-only, can't serve Europe)
| Player | What they do | Pricing | Limitation |
|---|---|---|---|
| **Autopilot** | Auto-copy politician & investor portfolios | $100/year | US-only (SEC RIA) |
| **Dub** | Copy-trading politicians | $10/month | US-only (FINRA) |

### Existing European Options
| Player | What they do | Limitation |
|---|---|---|
| **eToro Congress Smart Portfolios** | 3 pre-built portfolios (Congress-Buys, Lobby-Spending, DC-Insider) via Quiver Quantitative | No per-politician granularity, no customization |
| **NANC / GOP ETFs** | Party-based congressional trade ETFs | Blocked for EU retail investors under PRIIPs/KID rules |

### Free Tracking Tools (info only, no auto-trade)
- **Capitol Trades** - capitoltrades.com (filter by politician, party, committee)
- **Quiver Quantitative** - quiverquant.com (API + Python package)
- **Unusual Whales** - unusualwhales.com/politics (House, Senate, SCOTUS)
- **House/Senate Stock Watcher** - free API/JSON data

### The Gap
Nobody offers Autopilot-level granularity (pick specific politicians, auto-execute) for European users. eToro's Congress portfolios are the closest but they're pre-packaged with no customization.

---

## Data Pipeline: US Congressional Trades

### How it works
1. Congress member executes trade (Day 0)
2. Must file STOCK Act disclosure within 45 days (average ~14 days)
3. Filing appears on official House/Senate sites
4. Third-party APIs pick it up within 24 hours
5. App rebalances user portfolios (1-3 days after filing)
6. **Total delay: typically 2-7 weeks from actual trade**

### Available APIs
| Source | Type | Cost |
|---|---|---|
| **House Stock Watcher** | Free REST API + JSON | Free |
| **Senate Stock Watcher** | Free JSON data + GitHub repo | Free |
| **Quiver Quantitative** | Paid API + Python package | Paid tiers |
| **Finnhub** | Freemium API | Free tier available |
| **Financial Modeling Prep** | Freemium API | Free tier available |

### Important: No European Equivalent
No EU country requires trade-by-trade disclosure like the US STOCK Act. France's HATVP publishes asset snapshots (not transactions). UK Register of Members' Financial Interests covers holdings, not trades. This product would focus exclusively on US congressional trades, served to European users.

---

## European Brokerage Integration Options

### Tier 1: Best for auto-trading
| Broker | API Quality | Markets | Notes |
|---|---|---|---|
| **Interactive Brokers** | Excellent (TWS API, REST, Python, Java, C++) | 170 markets, 40+ countries | Gold standard. Free API for all clients. Paper trading available. |
| **Alpaca** | Excellent (REST + Python SDK) | US stocks only | #1 rated for algo trading in Europe (BrokerChooser 2026). Commission-free. Simplest DX. |
| **Saxo Bank** | Good (REST OpenAPI, Python wrapper) | 30K+ instruments | Full trading lifecycle API. |

### Tier 2: Emerging
| Broker | API Quality | Notes |
|---|---|---|
| **eToro** | New (launched Oct 2025) | Public API for algo trading, portfolio mgmt, social analytics. Could build on top of their existing Congress portfolios. |

### Tier 3: No API (not viable)
- DEGIRO - no official API (only fragile community wrappers)
- Trading 212 - no API
- Revolut - no trading API

### Recommendation: Start with Interactive Brokers + Alpaca
IBKR for full market access, Alpaca for simplest onboarding. Add eToro later once their API matures.

---

## Regulatory Analysis (Critical)

### ESMA's position on copy trading (March 2023 briefing)
- **Auto-execution of trades = Portfolio Management** under MiFID II
- **Signal/alerts where user confirms each trade = Investment Advice or RTO**
- **Pure information/data = likely no MiFID II license needed**

### Four paths to market

#### Path 1: Info/Alerts Only (no auto-trade)
- **Regulatory burden:** None/minimal
- **Time to market:** 1-2 months
- **Cost:** Near zero
- **Downside:** Low value prop, free tools already exist
- **How:** Mobile app showing real-time politician trades with push notifications + analysis

#### Path 2: Build on eToro's API
- **Regulatory burden:** Reduced (eToro handles compliance)
- **Time to market:** 2-4 months
- **Cost:** Low (development only)
- **Downside:** Dependent on eToro, limited to their platform
- **How:** Enhanced signal/strategy layer on top of eToro's Congress portfolios + their new API

#### Path 3: Partner with a licensed firm
- **Regulatory burden:** Medium (partner carries the license)
- **Time to market:** 3-6 months
- **Cost:** Revenue share with partner
- **Downside:** Dependency, margin compression
- **How:** You build the tech, they provide the regulatory wrapper

#### Path 4: Get your own MiFID II license
- **Regulatory burden:** High
- **Time to market:** 6-18 months
- **Cost:** ~EUR 75K capital + EUR 50-150K legal/setup
- **Upside:** Full control, highest margins, EU-wide passporting
- **Best jurisdictions:** Lithuania (fastest, cheapest, startup-friendly) or Cyprus (CySEC, established fintech hub)

### Recommended approach: Start with Path 1 or 2, graduate to Path 4
Ship a free/freemium info + alerts app first. Validate demand with European users. Then either build on eToro's API for quick auto-trading, or pursue your own MiFID II license once you have traction and revenue.

---

## Revenue Model

### Autopilot's model (for reference)
- Free tier: 1 portfolio, no ongoing trading
- Plus: $29/quarter or $100/year per portfolio
- Minimum $500 per portfolio
- 80K paid subscribers = ~$8M ARR

### Proposed model for European version
| Tier | Price | Features |
|---|---|---|
| **Free** | $0 | Trade alerts, politician leaderboards, basic analytics |
| **Pro** | EUR 9.99/month or EUR 89/year | Real-time notifications, advanced filters, portfolio simulator, performance tracking |
| **Auto-Trade** (when licensed) | EUR 14.99/month or EUR 129/year | Automated execution via connected brokerage |

### Additional revenue streams
- Brokerage referral commissions (IBKR, Alpaca affiliate programs)
- Premium data/API for quant traders
- Prediction market signals as upsell (your other idea)

---

## Phased MVP Plan

### Phase 1: Info App (Month 1-2)
- Ingest US congressional trade data (House + Senate Stock Watcher APIs)
- Mobile app (React Native or Flutter) with politician profiles, trade feeds, filters
- Push notifications for new filings
- Performance tracking (how would copying X politician have performed?)
- Monetize with Pro subscription

### Phase 2: Smart Signals (Month 3-4)
- Add scoring/ranking of politicians by performance
- Sector/committee analysis (e.g. "Senate Armed Services members buying defense stocks")
- Combine with prediction market data for edge signals
- Social features (follow, discuss, share)

### Phase 3: Auto-Trading (Month 6+)
- Integrate with IBKR and/or Alpaca APIs for European users
- Paper trading mode first (no license needed for simulated trades)
- Pursue MiFID II license (Lithuania) or partner with licensed firm
- Auto-execute trades mirroring selected politicians

---

## Open Questions
- [ ] Company domicile? (Lithuania for MiFID II path? Or separate: Estonia e-residency + Lithuania license?)
- [ ] Target market: all of Europe or start with specific countries? (France, UK, Germany, Netherlands?)
- [ ] Solo build or looking for co-founder? (regulatory + fintech experience would help)
- [ ] Available capital for initial build + potential licensing?
- [ ] App name / brand direction?
- [ ] Technical stack preference? (React Native vs Flutter, Python backend?)

---

## Risk: Congressional Trading Ban
A bill to ban congressional stock trading passed a Senate committee in July 2025. 86% of Americans support a ban. If this passes, the core data source disappears. **Mitigation:** Also track hedge fund managers (13F filings), corporate insiders (Form 4), and lobbyist activity - diversify beyond just politicians.
