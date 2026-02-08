"""
Trump & Inner Circle tracker.

Tracks Trump family members, top associates, major donors, appointees,
their financial interests, board seats, and connected companies.
Cross-references with SEC filings, government contracts, and policy actions.

Data sources:
- SEC EDGAR (13F, Form 4, Form D for connected entities)
- FEC campaign finance data (top donors)
- OpenSecrets / FEC bulk data for bundlers
- Public reporting on board seats and business interests
"""

import logging
from datetime import datetime

import httpx
from sqlalchemy import select
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.database import (
    HedgeFundHolding,
    InsiderTrade,
    Trade,
    TrumpInsider,
    TrumpConnection,
    TrumpDonor,
    async_session,
)

logger = logging.getLogger(__name__)

SEC_USER_AGENT = "SmartFlowApp admin@smartflow.app"
FEC_BASE = "https://api.open.fec.gov/v1"

# ─── TRUMP INNER CIRCLE DATABASE ───
# Comprehensive mapping of Trump family, associates, and their financial interests

TRUMP_INSIDERS = [
    # --- FAMILY ---
    {
        "name": "Donald J. Trump",
        "role": "President of the United States",
        "category": "family",
        "relationship": "Principal",
        "known_interests": [
            "Trump Media & Technology Group (DJT)",
            "Trump Organization",
            "World Liberty Financial (crypto)",
            "Trump NFTs / digital collectibles",
            "Real estate portfolio",
        ],
        "tickers": ["DJT"],
        "sec_ciks": [],
        "notes": "45th and 47th President. DJT/TMTG majority stakeholder. Launched $TRUMP meme coin Jan 2025.",
    },
    {
        "name": "Donald Trump Jr.",
        "role": "Executive VP, Trump Organization",
        "category": "family",
        "relationship": "Son",
        "known_interests": [
            "Trump Media & Technology Group (DJT)",
            "World Liberty Financial (crypto)",
            "SandBlock / blockchain ventures",
            "Timber investments",
        ],
        "board_seats": [
            "Trump Media & Technology Group (DJT) - Board Director",
        ],
        "tickers": ["DJT"],
        "sec_ciks": [],
        "notes": "Active in crypto/DeFi through World Liberty Financial. Board of TMTG.",
    },
    {
        "name": "Eric Trump",
        "role": "Executive VP, Trump Organization",
        "category": "family",
        "relationship": "Son",
        "known_interests": [
            "Trump Organization real estate",
            "World Liberty Financial (crypto)",
            "Trump Winery",
        ],
        "board_seats": [],
        "tickers": ["DJT"],
        "sec_ciks": [],
        "notes": "Manages Trump Organization day-to-day operations. Active in World Liberty Financial.",
    },
    {
        "name": "Jared Kushner",
        "role": "Founder & CEO, Affinity Partners",
        "category": "family",
        "relationship": "Son-in-law",
        "known_interests": [
            "Affinity Partners (investment firm)",
            "Saudi Arabia sovereign wealth fund ties ($2B from PIF)",
            "Middle East real estate/infrastructure deals",
            "Observer Media (formerly)",
            "Cadre (proptech startup)",
        ],
        "board_seats": [],
        "tickers": [],
        "sec_ciks": [],
        "notes": "Affinity Partners received $2B from Saudi PIF shortly after leaving White House. Major ME investment deals.",
    },
    {
        "name": "Ivanka Trump",
        "role": "Former Senior Advisor, Businesswoman",
        "category": "family",
        "relationship": "Daughter",
        "known_interests": [
            "Affinity Partners (with Kushner)",
            "Fashion/lifestyle brands",
            "Real estate investments",
        ],
        "board_seats": [],
        "tickers": [],
        "sec_ciks": [],
        "notes": "Stepped back from politics post-2022 but family financial interests remain intertwined.",
    },

    # --- KEY APPOINTEES & ASSOCIATES ---
    {
        "name": "Elon Musk",
        "role": "Head of DOGE (Dept. of Government Efficiency)",
        "category": "associate",
        "relationship": "Top ally / DOGE chief",
        "known_interests": [
            "Tesla (TSLA)",
            "SpaceX",
            "X / Twitter",
            "xAI",
            "The Boring Company",
            "Neuralink",
            "Starlink / satellite internet",
            "Government contracts (SpaceX, Starlink, Tesla)",
        ],
        "board_seats": [
            "Tesla Inc (TSLA) - CEO & Board Chair",
        ],
        "tickers": ["TSLA"],
        "sec_ciks": ["0001318605"],  # Tesla CIK
        "notes": "Spent $277M+ supporting Trump 2024. Heads DOGE cutting government spending while his companies have $15B+ in government contracts. Massive conflict of interest.",
    },
    {
        "name": "Vivek Ramaswamy",
        "role": "Former DOGE co-lead, Entrepreneur",
        "category": "associate",
        "relationship": "Political ally / DOGE",
        "known_interests": [
            "Strive Asset Management",
            "Roivant Sciences (ROIV)",
            "Biotech/pharma investments",
            "Anti-ESG investment products",
        ],
        "tickers": ["ROIV"],
        "sec_ciks": [],
        "notes": "Co-founded DOGE with Musk. Strive Asset Management competes for government pension mandates.",
    },
    {
        "name": "Peter Thiel",
        "role": "Venture capitalist, Trump backer",
        "category": "donor",
        "relationship": "Major donor / ally",
        "known_interests": [
            "Palantir Technologies (PLTR)",
            "Founders Fund",
            "Anduril Industries",
            "Valar Ventures",
            "Government surveillance/defense contracts",
        ],
        "board_seats": [
            "Palantir Technologies (PLTR) - Board Chair",
        ],
        "tickers": ["PLTR"],
        "sec_ciks": [],
        "notes": "Palantir has billions in government contracts. Thiel backed JD Vance's senate run. Deep ties to defense/surveillance.",
    },
    {
        "name": "Howard Lutnick",
        "role": "Secretary of Commerce",
        "category": "appointee",
        "relationship": "Cabinet member",
        "known_interests": [
            "Cantor Fitzgerald",
            "Newmark Group (NMRK)",
            "BGC Group (BGC)",
            "Tether/USDT (Cantor is custodian)",
            "Real estate finance",
        ],
        "board_seats": [
            "Cantor Fitzgerald - CEO & Chairman",
        ],
        "tickers": ["NMRK", "BGC"],
        "sec_ciks": [],
        "notes": "Cantor Fitzgerald is custodian for Tether's reserves. As Commerce Secretary, oversees trade policy affecting his financial interests.",
    },
    {
        "name": "Scott Bessent",
        "role": "Secretary of the Treasury",
        "category": "appointee",
        "relationship": "Cabinet member",
        "known_interests": [
            "Key Square Group (hedge fund)",
            "Macro trading / currencies",
            "Sovereign debt markets",
        ],
        "tickers": [],
        "sec_ciks": [],
        "notes": "Former Soros Fund Management CIO. His hedge fund bets on macro policy he now helps set.",
    },
    {
        "name": "Robert F. Kennedy Jr.",
        "role": "Secretary of HHS",
        "category": "appointee",
        "relationship": "Cabinet member",
        "known_interests": [
            "Anti-pharma advocacy",
            "Children's Health Defense",
            "Raw milk / health food industry",
            "Vaccine-alternative companies",
        ],
        "tickers": [],
        "sec_ciks": [],
        "notes": "HHS Secretary with well-known anti-pharma stance. Policy decisions directly affect pharma stocks (PFE, MRNA, JNJ, etc.).",
    },
    {
        "name": "JD Vance",
        "role": "Vice President",
        "category": "associate",
        "relationship": "Vice President",
        "known_interests": [
            "Narya Capital (Peter Thiel-backed VC)",
            "AppHarvest (formerly)",
            "Ohio tech/manufacturing investments",
        ],
        "tickers": [],
        "sec_ciks": [],
        "notes": "Thiel protege. Former VC. Financial interests in tech/manufacturing sectors he now helps regulate.",
    },
    {
        "name": "Steve Mnuchin",
        "role": "Former Treasury Secretary, Liberty Strategic Capital",
        "category": "associate",
        "relationship": "Former cabinet / current ally",
        "known_interests": [
            "Liberty Strategic Capital",
            "TikTok acquisition bid",
            "OneWest Bank / CIT Group",
            "Middle East sovereign wealth deals",
        ],
        "tickers": [],
        "sec_ciks": [],
        "notes": "Liberty Strategic Capital raised $2.5B from Middle East sovereign wealth funds. Leading TikTok acquisition bid.",
    },
    {
        "name": "Larry Ellison",
        "role": "Co-founder Oracle, Trump ally",
        "category": "donor",
        "relationship": "Major donor / tech ally",
        "known_interests": [
            "Oracle Corporation (ORCL)",
            "Stargate AI infrastructure project",
            "Real estate (Lanai, Hawaii)",
            "Tesla board member",
        ],
        "board_seats": [
            "Oracle Corp (ORCL) - CTO & Board Chair",
            "Tesla Inc (TSLA) - Board Director",
        ],
        "tickers": ["ORCL", "TSLA"],
        "sec_ciks": ["0001341439"],  # Oracle CIK
        "notes": "Oracle part of $500B Stargate AI project announced with Trump. Ellison is 3rd richest person.",
    },
    {
        "name": "Masayoshi Son",
        "role": "CEO SoftBank, Stargate partner",
        "category": "associate",
        "relationship": "Business ally",
        "known_interests": [
            "SoftBank Group (SFTBY)",
            "Stargate AI project ($500B)",
            "Arm Holdings (ARM)",
            "AI/tech investments",
        ],
        "tickers": ["SFTBY", "ARM"],
        "sec_ciks": [],
        "notes": "Pledged $100B to US investment alongside Trump announcement. Stargate AI project partner.",
    },
    {
        "name": "Tim Cook",
        "role": "CEO Apple",
        "category": "associate",
        "relationship": "Business relationship",
        "known_interests": [
            "Apple Inc (AAPL)",
            "Tech manufacturing in China",
            "Tariff exemption lobbying",
        ],
        "board_seats": ["Apple Inc (AAPL) - CEO"],
        "tickers": ["AAPL"],
        "sec_ciks": ["0000320193"],  # Apple CIK
        "notes": "Maintains close relationship with Trump for tariff exemptions on Apple products.",
    },
    {
        "name": "Mark Zuckerberg",
        "role": "CEO Meta Platforms",
        "category": "associate",
        "relationship": "Business relationship (shifted pro-Trump)",
        "known_interests": [
            "Meta Platforms (META)",
            "Reality Labs / VR / Metaverse",
            "WhatsApp, Instagram",
            "AI / LLMs",
        ],
        "tickers": ["META"],
        "sec_ciks": ["0001326801"],  # Meta CIK
        "notes": "Donated $1M to Trump inaugural fund. Rolled back content moderation. Pivoted to align with administration.",
    },
    {
        "name": "Sam Altman",
        "role": "CEO OpenAI, Stargate partner",
        "category": "associate",
        "relationship": "Business ally / Stargate",
        "known_interests": [
            "OpenAI",
            "Stargate AI project",
            "Worldcoin / World (crypto identity)",
            "Helion Energy (nuclear fusion)",
        ],
        "tickers": [],
        "sec_ciks": [],
        "notes": "Key partner in $500B Stargate AI infrastructure project announced at White House.",
    },
]

# ─── TRUMP-CONNECTED COMPANIES ───
# Companies with direct financial ties to Trump orbit

TRUMP_CONNECTED_COMPANIES = [
    {
        "name": "Trump Media & Technology Group",
        "ticker": "DJT",
        "connection": "Trump majority-owned (~53%). Operates Truth Social.",
        "category": "trump_owned",
        "sector": "media/tech",
        "insiders": ["Donald J. Trump", "Donald Trump Jr."],
    },
    {
        "name": "Tesla Inc",
        "ticker": "TSLA",
        "connection": "Elon Musk (DOGE head) is CEO. $15B+ in government contracts.",
        "category": "musk_empire",
        "sector": "EV/energy",
        "insiders": ["Elon Musk", "Larry Ellison"],
    },
    {
        "name": "Palantir Technologies",
        "ticker": "PLTR",
        "connection": "Peter Thiel co-founded. Billions in government defense/intelligence contracts.",
        "category": "defense_tech",
        "sector": "defense/surveillance",
        "insiders": ["Peter Thiel"],
    },
    {
        "name": "Oracle Corporation",
        "ticker": "ORCL",
        "connection": "Larry Ellison (Trump ally). Part of $500B Stargate AI project.",
        "category": "tech_ally",
        "sector": "enterprise tech",
        "insiders": ["Larry Ellison"],
    },
    {
        "name": "SoftBank Group",
        "ticker": "SFTBY",
        "connection": "Masayoshi Son pledged $100B US investment. Stargate partner.",
        "category": "tech_ally",
        "sector": "tech investment",
        "insiders": ["Masayoshi Son"],
    },
    {
        "name": "Arm Holdings",
        "ticker": "ARM",
        "connection": "SoftBank subsidiary. Key to AI chip infrastructure.",
        "category": "tech_ally",
        "sector": "semiconductors",
        "insiders": ["Masayoshi Son"],
    },
    {
        "name": "Meta Platforms",
        "ticker": "META",
        "connection": "Zuckerberg donated $1M to Trump inaugural. Rolled back moderation.",
        "category": "tech_ally",
        "sector": "social media/AI",
        "insiders": ["Mark Zuckerberg"],
    },
    {
        "name": "Roivant Sciences",
        "ticker": "ROIV",
        "connection": "Founded by Vivek Ramaswamy (former DOGE co-lead).",
        "category": "associate_company",
        "sector": "biotech",
        "insiders": ["Vivek Ramaswamy"],
    },
    {
        "name": "Newmark Group",
        "ticker": "NMRK",
        "connection": "Howard Lutnick (Commerce Secretary) is chairman of parent Cantor Fitzgerald.",
        "category": "appointee_company",
        "sector": "real estate/finance",
        "insiders": ["Howard Lutnick"],
    },
    {
        "name": "BGC Group",
        "ticker": "BGC",
        "connection": "Cantor Fitzgerald spinoff. Lutnick (Commerce Secretary) interest.",
        "category": "appointee_company",
        "sector": "finance",
        "insiders": ["Howard Lutnick"],
    },
    {
        "name": "Apple Inc",
        "ticker": "AAPL",
        "connection": "Tim Cook maintains tariff-exemption relationship with Trump.",
        "category": "tech_ally",
        "sector": "consumer tech",
        "insiders": ["Tim Cook"],
    },
    {
        "name": "Anduril Industries",
        "ticker": None,
        "connection": "Peter Thiel-backed defense startup. Major government defense contracts.",
        "category": "defense_tech",
        "sector": "defense",
        "insiders": ["Peter Thiel"],
    },
    {
        "name": "SpaceX",
        "ticker": None,
        "connection": "Elon Musk's space company. $3B+ NASA and DOD contracts.",
        "category": "musk_empire",
        "sector": "aerospace/defense",
        "insiders": ["Elon Musk"],
    },
    {
        "name": "Rumble Inc",
        "ticker": "RUM",
        "connection": "Right-wing video platform. Peter Thiel investor. Trump-aligned media.",
        "category": "aligned_media",
        "sector": "media/tech",
        "insiders": ["Peter Thiel"],
    },
    {
        "name": "Phunware Inc",
        "ticker": "PHUN",
        "connection": "Built Trump 2020 campaign app. Known Trump-linked stock.",
        "category": "trump_linked",
        "sector": "tech",
        "insiders": [],
    },
    {
        "name": "Digital World Acquisition Corp / TMTG",
        "ticker": "DJT",
        "connection": "SPAC that merged with Trump Media. Trump is majority stakeholder.",
        "category": "trump_owned",
        "sector": "media/tech",
        "insiders": ["Donald J. Trump"],
    },
    {
        "name": "GEO Group",
        "ticker": "GEO",
        "connection": "Private prison company. Benefits from Trump immigration enforcement.",
        "category": "policy_beneficiary",
        "sector": "prisons/detention",
        "insiders": [],
    },
    {
        "name": "CoreCivic",
        "ticker": "CXW",
        "connection": "Private prison company. Benefits from Trump immigration policy.",
        "category": "policy_beneficiary",
        "sector": "prisons/detention",
        "insiders": [],
    },
]

# ─── MAJOR TRUMP DONORS (2024 cycle) ───

TRUMP_MAJOR_DONORS = [
    {
        "name": "Elon Musk",
        "amount_known": 277_000_000,
        "entity": "America PAC",
        "interests": ["Tesla", "SpaceX", "Government contracts"],
    },
    {
        "name": "Tim Mellon",
        "amount_known": 200_000_000,
        "entity": "MAGA Inc. Super PAC",
        "interests": ["Pan Am Systems", "Railroad/transportation"],
    },
    {
        "name": "Miriam Adelson",
        "amount_known": 100_000_000,
        "entity": "Preserve America PAC",
        "interests": ["Las Vegas Sands (LVS)", "Casino/gambling"],
    },
    {
        "name": "Richard Uihlein",
        "amount_known": 74_000_000,
        "entity": "Restoration PAC / multiple",
        "interests": ["Uline (shipping supplies)", "Manufacturing"],
    },
    {
        "name": "Jeff Yass",
        "amount_known": 46_000_000,
        "entity": "Club for Growth / various",
        "interests": ["Susquehanna International Group", "TikTok (large ByteDance stake)", "Options trading"],
    },
    {
        "name": "Ken Griffin",
        "amount_known": 25_000_000,
        "entity": "Various Trump-aligned PACs",
        "interests": ["Citadel LLC", "Market making", "Finance"],
    },
    {
        "name": "Steve Schwarzman",
        "amount_known": 20_000_000,
        "entity": "Senate Leadership Fund / various",
        "interests": ["Blackstone Group (BX)", "Private equity", "Real estate"],
    },
    {
        "name": "Marc Andreessen",
        "amount_known": 4_500_000,
        "entity": "Various / direct",
        "interests": ["Andreessen Horowitz (a16z)", "Crypto", "AI startups"],
    },
    {
        "name": "Palmer Luckey",
        "amount_known": 1_500_000,
        "entity": "Various",
        "interests": ["Anduril Industries", "Defense tech", "VR"],
    },
]


# ─── POLICY-STOCK CONNECTIONS ───
# Map Trump policy actions to affected stocks/sectors

POLICY_CONNECTIONS = [
    {
        "policy": "Tariffs on China/EU",
        "description": "Broad tariffs on Chinese and European imports",
        "winners": ["domestic manufacturing", "steel/aluminum"],
        "losers": ["importers", "retail", "AAPL", "NKE"],
        "tickers_affected": ["AAPL", "NKE", "WMT", "X", "NUE", "CLF"],
    },
    {
        "policy": "DOGE government spending cuts",
        "description": "Musk-led department cutting government agencies and contracts",
        "winners": ["TSLA (Musk conflict)", "private sector alternatives"],
        "losers": ["government contractors", "federal workforce"],
        "tickers_affected": ["TSLA", "BAH", "SAIC", "LDOS", "CACI"],
    },
    {
        "policy": "Stargate AI infrastructure ($500B)",
        "description": "Joint venture with OpenAI, SoftBank, Oracle for AI data centers",
        "winners": ["ORCL", "SFTBY", "ARM", "NVDA", "AI infrastructure"],
        "losers": [],
        "tickers_affected": ["ORCL", "SFTBY", "ARM", "NVDA", "MSFT"],
    },
    {
        "policy": "Crypto deregulation",
        "description": "Pro-crypto executive orders, Bitcoin strategic reserve exploration",
        "winners": ["crypto exchanges", "DeFi", "miners"],
        "losers": ["traditional banking regulation"],
        "tickers_affected": ["COIN", "MSTR", "MARA", "RIOT", "CLSK", "DJT"],
    },
    {
        "policy": "Immigration enforcement",
        "description": "Mass deportation, border wall, ICE expansion",
        "winners": ["private prisons", "border security", "construction"],
        "losers": ["agriculture (labor costs)", "hospitality"],
        "tickers_affected": ["GEO", "CXW", "AXON", "LMT"],
    },
    {
        "policy": "RFK Jr. HHS / Anti-pharma",
        "description": "RFK at HHS - vaccine skepticism, MAHA agenda",
        "winners": ["natural health", "alternative medicine"],
        "losers": ["big pharma", "vaccine makers"],
        "tickers_affected": ["PFE", "MRNA", "JNJ", "BNTX", "NVO"],
    },
    {
        "policy": "Defense spending increase",
        "description": "Increased military budget and procurement",
        "winners": ["defense contractors", "cybersecurity"],
        "losers": [],
        "tickers_affected": ["LMT", "RTX", "NOC", "GD", "PLTR", "PANW"],
    },
    {
        "policy": "Oil & gas deregulation",
        "description": "Drill baby drill - expanded drilling leases, rolled back EPA",
        "winners": ["oil & gas producers", "pipelines"],
        "losers": ["renewables", "EVs (policy uncertainty)"],
        "tickers_affected": ["XOM", "CVX", "COP", "OXY", "SLB", "HAL"],
    },
    {
        "policy": "TikTok ban/forced sale",
        "description": "Forced divestiture of TikTok from ByteDance",
        "winners": ["META", "SNAP", "bidders (Mnuchin/Yass)"],
        "losers": ["ByteDance", "small businesses on TikTok"],
        "tickers_affected": ["META", "SNAP", "GOOGL"],
    },
]


async def run_trump_data_ingestion() -> dict:
    """Store/update all Trump insider and connection data."""
    new_insiders = 0
    new_connections = 0
    new_donors = 0

    async with async_session() as session:
        # Store insiders
        for insider in TRUMP_INSIDERS:
            record = {
                "name": insider["name"],
                "role": insider["role"],
                "category": insider["category"],
                "relationship": insider["relationship"],
                "known_interests": "; ".join(insider.get("known_interests", [])),
                "board_seats": "; ".join(insider.get("board_seats", [])),
                "tickers": ",".join(insider.get("tickers", [])),
                "sec_ciks": ",".join(insider.get("sec_ciks", [])),
                "notes": insider.get("notes", ""),
                "updated_at": datetime.utcnow(),
            }
            stmt = (
                sqlite_insert(TrumpInsider)
                .values(**record)
                .on_conflict_do_update(
                    index_elements=["name"],
                    set_={
                        "role": record["role"],
                        "known_interests": record["known_interests"],
                        "board_seats": record["board_seats"],
                        "tickers": record["tickers"],
                        "notes": record["notes"],
                        "updated_at": record["updated_at"],
                    },
                )
            )
            result = await session.execute(stmt)
            if result.rowcount > 0:
                new_insiders += 1

        # Store connected companies
        for company in TRUMP_CONNECTED_COMPANIES:
            record = {
                "company_name": company["name"],
                "ticker": company.get("ticker"),
                "connection_description": company["connection"],
                "category": company["category"],
                "sector": company.get("sector", ""),
                "connected_insiders": ",".join(company.get("insiders", [])),
                "updated_at": datetime.utcnow(),
            }
            stmt = (
                sqlite_insert(TrumpConnection)
                .values(**record)
                .on_conflict_do_update(
                    index_elements=["company_name"],
                    set_={
                        "ticker": record["ticker"],
                        "connection_description": record["connection_description"],
                        "connected_insiders": record["connected_insiders"],
                        "updated_at": record["updated_at"],
                    },
                )
            )
            result = await session.execute(stmt)
            if result.rowcount > 0:
                new_connections += 1

        # Store donors
        for donor in TRUMP_MAJOR_DONORS:
            record = {
                "name": donor["name"],
                "amount_known": donor["amount_known"],
                "entity": donor["entity"],
                "interests": "; ".join(donor.get("interests", [])),
                "updated_at": datetime.utcnow(),
            }
            stmt = (
                sqlite_insert(TrumpDonor)
                .values(**record)
                .on_conflict_do_update(
                    index_elements=["name"],
                    set_={
                        "amount_known": record["amount_known"],
                        "interests": record["interests"],
                        "updated_at": record["updated_at"],
                    },
                )
            )
            result = await session.execute(stmt)
            if result.rowcount > 0:
                new_donors += 1

        await session.commit()

    return {
        "timestamp": datetime.utcnow().isoformat(),
        "insiders_stored": new_insiders,
        "connections_stored": new_connections,
        "donors_stored": new_donors,
    }


async def get_trump_insider_trades() -> list[dict]:
    """
    Cross-reference Trump-connected tickers with insider trades and congressional trades.
    Find when insiders at Trump-connected companies are buying/selling.
    """
    connected_tickers = [
        c["ticker"] for c in TRUMP_CONNECTED_COMPANIES if c.get("ticker")
    ]

    results = []
    async with async_session() as session:
        # Check insider trades for connected tickers
        for ticker in connected_tickers:
            stmt = (
                select(InsiderTrade)
                .where(InsiderTrade.ticker == ticker)
                .order_by(InsiderTrade.filing_date.desc())
                .limit(10)
            )
            result = await session.execute(stmt)
            trades = result.scalars().all()

            company_info = next(
                (c for c in TRUMP_CONNECTED_COMPANIES if c.get("ticker") == ticker), {}
            )

            for t in trades:
                results.append({
                    "source": "insider_trade",
                    "ticker": ticker,
                    "company": company_info.get("name", ""),
                    "trump_connection": company_info.get("connection", ""),
                    "insider_name": t.insider_name,
                    "insider_title": t.insider_title,
                    "tx_type": t.tx_type,
                    "tx_date": t.tx_date.isoformat() if t.tx_date else None,
                    "shares": t.shares,
                    "total_value": t.total_value,
                    "price_per_share": t.price_per_share,
                })

        # Check congressional trades for connected tickers
        for ticker in connected_tickers:
            stmt = (
                select(Trade)
                .where(Trade.ticker == ticker)
                .order_by(Trade.disclosure_date.desc())
                .limit(10)
            )
            result = await session.execute(stmt)
            trades = result.scalars().all()

            company_info = next(
                (c for c in TRUMP_CONNECTED_COMPANIES if c.get("ticker") == ticker), {}
            )

            for t in trades:
                results.append({
                    "source": "congress_trade",
                    "ticker": ticker,
                    "company": company_info.get("name", ""),
                    "trump_connection": company_info.get("connection", ""),
                    "politician": t.politician,
                    "party": t.party,
                    "tx_type": t.tx_type,
                    "tx_date": t.tx_date.isoformat() if t.tx_date else None,
                    "amount_low": t.amount_low,
                    "amount_high": t.amount_high,
                })

    results.sort(key=lambda x: x.get("tx_date", "") or "", reverse=True)
    return results


async def get_trump_hedge_fund_overlap() -> list[dict]:
    """Check which tracked hedge funds hold Trump-connected stocks."""
    connected_tickers = [
        c["ticker"] for c in TRUMP_CONNECTED_COMPANIES if c.get("ticker")
    ]

    results = []
    async with async_session() as session:
        for ticker in connected_tickers:
            stmt = (
                select(HedgeFundHolding)
                .where(HedgeFundHolding.ticker == ticker)
                .order_by(HedgeFundHolding.value.desc())
            )
            result = await session.execute(stmt)
            holdings = result.scalars().all()

            company_info = next(
                (c for c in TRUMP_CONNECTED_COMPANIES if c.get("ticker") == ticker), {}
            )

            for h in holdings:
                results.append({
                    "ticker": ticker,
                    "company": company_info.get("name", ""),
                    "trump_connection": company_info.get("connection", ""),
                    "fund_cik": h.fund_cik,
                    "value": h.value,
                    "shares": h.shares,
                    "is_new_position": h.is_new_position,
                    "shares_change_pct": h.shares_change_pct,
                    "report_date": h.report_date,
                })

    return results
