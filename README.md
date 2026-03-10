# IndiaQuant MCP

Model Context Protocol (MCP) server that provides **Indian market intelligence** (quotes, options chain, greeks, signals, and a paper portfolio) over **stdio** for clients like **Claude Desktop**.

---

## Architecture Overview

### High-level flow

1. **MCP Server (`src/server.ts`)**
   - Runs an MCP server on **stdio**.
   - Exposes a tool list and routes tool calls to the tool dispatcher.

2. **Tool Router (`src/tools/mcpTools.ts`)**
   - Defines **10 tools** (name, description, JSON schema).
   - Dispatches each tool call into one of the domain modules.

3. **5 Domain Modules (in `src/modules/`)**

These are the “core” modules and how they connect:

- **Market Data (`marketData.ts`)**
  - Fetches **live quotes** and **historical OHLC**.
  - Uses a **tiered provider strategy**: Alpha Vantage first (if configured), then Yahoo Finance as a fallback.
  - Used by: `signals`, `portfolio`, and indirectly by `greeks` (through options chain underlying).

- **Options (`options.ts`)**
  - Fetches **options chain** via Yahoo Finance and provides **unusual activity** heuristics.
  - Used by: `greeks` (to infer IV from chain) and tool endpoints directly.

- **Greeks (`greeks.ts`)**
  - Computes **Black–Scholes price + greeks** using in-house math (no heavy quant dependency).
  - Used by: tool endpoint `calculate_greeks`.

- **Signals (`signals.ts`)**
  - Generates BUY/SELL/HOLD using:
    - Technicals (RSI, MACD, Bollinger Bands via `technicalindicators`)
    - Sentiment (NewsAPI first, Alpha Vantage NEWS_SENTIMENT fallback)
  - Depends on: `marketData` (historical), `rateLimiter`, `cache`.

- **Portfolio (`portfolio.ts`)**
  - Maintains a **paper trading** portfolio backed by **SQLite**.
  - Uses market data to compute **PnL**.
  - Depends on: `db/database`, `marketData`.

### Supporting utilities

- **In-memory cache (`src/utils/cache.ts`)**
  - TTL cache used to reduce repeated calls (e.g., live quote and sentiment).

- **Simple daily rate limiter (`src/utils/rateLimiter.ts`)**
  - Guards daily API quotas (NewsAPI, Alpha Vantage).

### Why these approaches

- **Tool router + modules**: keeps MCP concerns (schemas, routing) separated from market logic.
- **Tiered providers** (Alpha Vantage → Yahoo): improves reliability when one provider fails.
- **SQLite for portfolio**: persistent state across runs without deploying an external DB.
- **In-process cache**: simple and effective for a single-user MCP server.

---

## Setup Guide

### Prerequisites

- Node.js 18+ (Node 20 recommended)
- npm
- macOS/Linux/Windows supported

### Installation

1. Install dependencies
   - `npm install`

2. Build TypeScript
   - `npm run build`

3. Run the MCP server (stdio)
   - `npm start`

For development:
- `npm run dev`

### API key setup

This project reads keys from environment variables (via `dotenv`). Create a `.env` file in the repository root:

- `ALPHA_VANTAGE_KEY` (recommended)
  - Used for: live quote fallback, historical OHLC fallback, sentiment fallback
- `NEWS_API_KEY` (optional)
  - Used for: news headlines for sentiment

Notes from the current implementation:

- Live price attempts **Alpha Vantage GLOBAL_QUOTE** first (mapped to `*.BSE`), then falls back to **Yahoo Finance**.
- Historical data uses **Yahoo Finance** first; if that fails, falls back to **Alpha Vantage** daily/weekly/monthly.
- Intraday signals are currently mapped to **daily candles** due to Alpha Vantage free-tier intraday restrictions.

### Claude Desktop config (MCP)

Add this server to Claude Desktop MCP configuration. A typical configuration looks like:

- Command: `node`
- Args: `<absolute-path>/indiaquant-mcp/dist/server.js`
- Working directory: `<absolute-path>/indiaquant-mcp`
- Environment variables: include your API keys

Example (adjust paths):

- **command**: `node`
- **args**:
  - `/Users/princeagrawal/Desktop/Assignment/subsquant/indiaquant-mcp/dist/server.js`
- **env**:
  - `ALPHA_VANTAGE_KEY`: `...`
  - `NEWS_API_KEY`: `...`

If you prefer running without a build step, point Claude Desktop to a node runner (e.g., `tsx`) and `src/server.ts`, but the default deployment is `dist/server.js`.

---

## Tool Documentation

All tools are defined in `src/tools/mcpTools.ts` and exposed over MCP.

Conventions:
- Symbols are typically **NSE Yahoo-style** (e.g., `RELIANCE.NS`, `TCS.NS`).
- Some upstream calls map to BSE tickers for Alpha Vantage (internal detail).

### 1) `get_live_price`
Fetch a live quote.

**Input**
```json
{ "symbol": "RELIANCE.NS" }
```

**Output (example)**
```json
{
  "symbol": "RELIANCE.NS",
  "price": 2985.5,
  "change": 12.3,
  "changePercent": 0.41,
  "volume": 1234567,
  "timestamp": "2026-03-11T10:05:00.000Z"
}
```

### 2) `get_options_chain`
Fetch the full call/put chain for an underlying and (optionally) an expiry.

**Input**
```json
{ "symbol": "TCS.NS", "expiry": "2026-03-26" }
```

**Output (example)**
```json
{
  "expiry": "2026-03-26T00:00:00.000Z",
  "underlyingPrice": 4120.0,
  "calls": [{ "strike": 4100, "lastPrice": 120, "bid": 118, "ask": 122, "volume": 5400, "openInterest": 90000, "impliedVolatility": 0.21 }],
  "puts": [{ "strike": 4100, "lastPrice": 95, "bid": 93, "ask": 97, "volume": 4300, "openInterest": 87000, "impliedVolatility": 0.22 }]
}
```

### 3) `analyze_sentiment`
Fetches recent headlines and computes a simple polarity score.

**Input**
```json
{ "symbol": "INFY.NS" }
```

**Output (example)**
```json
{
  "score": 0.15,
  "signal": "NEUTRAL",
  "headlines": ["...", "..."]
}
```

### 4) `generate_signal`
Combines technical indicators and sentiment into a BUY/SELL/HOLD.

**Input**
```json
{ "symbol": "HDFCBANK.NS", "timeframe": "short-term" }
```

**Output (example)**
```json
{
  "signal": "BUY",
  "confidence": 71.2,
  "reasoning": "...",
  "rsi": 42.7,
  "macd": { "macdLine": -8.1, "signalLine": -10.2, "histogram": 2.1, "crossover": "BULLISH" },
  "bollinger": { "upper": 1680.1, "middle": 1640.3, "lower": 1600.5, "isSqueeze": false },
  "sentiment": { "score": 0.1, "signal": "NEUTRAL", "headlines": [] }
}
```

### 5) `get_portfolio_pnl`
Returns current virtual positions and portfolio PnL (priced using live quotes).

**Input**
```json
{}
```

**Output (example)**
```json
{
  "positions": [{
    "symbol": "TCS.NS",
    "quantity": 10,
    "avgPrice": 4000,
    "currentPrice": 4120,
    "invested": 40000,
    "currentValue": 41200,
    "pnl": 1200,
    "pnlPercent": 3
  }],
  "totalInvested": 40000,
  "currentValue": 41200,
  "totalPnL": 1200,
  "totalPnLPercent": 3,
  "cashBalance": 960000
}
```

### 6) `place_virtual_trade`
Places a paper BUY/SELL and persists it to SQLite.

**Input**
```json
{ "symbol": "TCS.NS", "quantity": 5, "side": "BUY" }
```

**Output (example)**
```json
{
  "orderId": "ORD_...",
  "symbol": "TCS.NS",
  "executedPrice": 4120,
  "quantity": 5,
  "side": "BUY",
  "status": "FILLED",
  "timestamp": "2026-03-11T10:12:00.000Z"
}
```

### 7) `calculate_greeks`
Computes Black–Scholes theoretical price and greeks. If `impliedVolatility` is not provided, it is inferred from the options chain for the given strike (fallback default 0.20).

**Input**
```json
{ "symbol": "RELIANCE.NS", "strike": 3000, "expiry": "2026-03-26", "optionType": "CE" }
```

**Output (example)**
```json
{
  "delta": 0.52,
  "gamma": 0.0004,
  "theta": -2.1,
  "vega": 0.18,
  "rho": 0.09,
  "theoreticalPrice": 65.3
}
```

### 8) `detect_unusual_activity`
Scans the options chain for basic anomalies:
- volume > 2× average (and volume > 100)
- volume/openInterest ratio > 0.5 (and volume > 100)

**Input**
```json
{ "symbol": "NIFTY" }
```

**Output (example)**
```json
{
  "alerts": ["Unusual volume: Call Strike 22500 ..."],
  "anomalies": [{ "type": "Call", "strike": 22500, "volume": 12000, "openInterest": 18000, "reason": "High Volume (2x Avg)" }],
  "summary": "Found 1 unusual options activities."
}
```

### 9) `scan_market`
Scans a predefined sector symbol list and returns symbols whose generated signal matches filters.

**Input**
```json
{ "sector": "IT", "signal": "BUY", "limit": 3 }
```

**Output (example)**
```json
{
  "sector": "IT",
  "results": [
    { "symbol": "TCS.NS", "signal": { "signal": "BUY", "confidence": 68.1, "reasoning": "..." } }
  ]
}
```

### 10) `get_sector_heatmap`
Aggregates average % change per sector and tracks top gainer/loser within each sector.

**Input**
```json
{}
```

**Output (example)**
```json
{
  "sectors": [
    {
      "name": "BANKING",
      "changePercent": 0.32,
      "topGainer": { "symbol": "ICICIBANK.NS", "change": 1.2 },
      "topLoser": { "symbol": "SBIN.NS", "change": -0.4 },
      "symbols": [{ "symbol": "HDFCBANK.NS", "changePercent": 0.1 }]
    }
  ]
}
```

---

## Trade-offs & Decisions

### Why Node.js over Python

- **MCP SDK first-class support** in the Node ecosystem and simpler packaging for stdio servers.
- **Single binary-like runtime** (Node) for Claude Desktop integration.
- The codebase already uses mature JS libraries for:
  - technical indicators (`technicalindicators`)
  - finance data (`yahoo-finance2`)
  - HTTP (`axios`)

Python would be a strong choice for quant workflows, but for an MCP tool server (stdio, schema-driven tools, quick iteration) Node/TypeScript is pragmatic.

### Caching strategy

- Uses a **process-local TTL cache**.
  - Live quotes: 60s TTL
  - OHLC: 300s TTL
  - Sentiment: 1h TTL

Benefits:
- reduces provider calls (fewer rate-limit issues)
- improves latency for repeated queries

Trade-off:
- cache is **not shared across processes** and resets on restart.

### Black–Scholes implementation approach

- Greeks are computed using a lightweight, in-project implementation:
  - Normal PDF (exact)
  - Normal CDF (Abramowitz–Stegun approximation)

Reasons:
- avoids pulling in large quant libraries
- keeps the server deterministic and easy to audit

Trade-offs:
- approximation error in CDF for extreme tails
- assumes European options and constant parameters (sigma, r)

---

## Known Limitations

### API rate limits

- **Alpha Vantage** free tier is rate-limited (and intraday often restricted). This code uses a basic daily limiter and caching, but high-volume use may still hit limits.
- **NewsAPI** has daily quotas; sentiment headlines may be empty when quotas are exhausted.

### Market hours behavior

- Outside market hours, providers may:
  - return stale prices
  - return 0 or missing fields
  - delay updates

Signals and PnL will reflect whatever the upstream data source returns.

### Yahoo Finance / `yahoo-finance2` edge cases

- Some Indian instruments (especially indices / certain derivatives) can intermittently fail or return incomplete options data.
- Options chain availability varies by symbol and expiry.
- Historical data for very new listings may be insufficient (signal generation requires at least ~26 data points for MACD).

---

## Directory layout (for reference)

- `src/server.ts` – MCP server entry point
- `src/tools/mcpTools.ts` – tool definitions + dispatch
- `src/modules/*` – market logic (5 modules)
- `src/db/database.ts` – SQLite init + migrations
- `src/utils/*` – cache, rate limiter, formatting helpers
- `data/portfolio.db*` – SQLite database files
