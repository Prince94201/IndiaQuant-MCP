# IndiaQuant MCP

Production-ready **Model Context Protocol (MCP)** server that connects **Claude Desktop** to Indian market intelligence: live quotes, historical OHLC, options chain, Black–Scholes greeks, sentiment + technical signals, and a SQLite-backed paper portfolio.

---

## 🏗️ Architecture

```
┌───────────────────────────────────────────┐
│           Claude Desktop (Client)         │
└───────────────────────────┬───────────────┘
                            │ MCP over stdio
┌───────────────────────────▼───────────────┐
│            IndiaQuant MCP Server           │
│        src/server.ts  (stdio server)       │
│        src/tools/mcpTools.ts (10 tools)    │
└───────────────┬───────────────┬───────────┘
                │               │
      ┌─────────▼────────┐  ┌──▼───────────┐
      │  Market Data      │  │    Options    │
      │ src/modules/      │  │ src/modules/  │
      │ marketData.ts     │  │ options.ts    │
      └─────────┬────────┘  └──┬────────────┘
                │              │
        ┌───────▼───────┐  ┌──▼────────────┐
        │    Signals     │  │    Greeks      │
        │ signals.ts     │  │ greeks.ts      │
        └───────┬───────┘  └──┬─────────────┘
                │              │
            ┌───▼──────────────▼───┐
            │      Portfolio         │
            │ portfolio.ts + SQLite  │
            └───────────┬────────────┘
                        │
     ┌──────────────────▼───────────────────┐
     │ External data sources (free tier)     │
     │  • Yahoo Finance (prices/OHLC/options)│
     │  • Alpha Vantage (fallback + sentiment)│
     │  • NewsAPI (optional sentiment)       │
     └───────────────────────────────────────┘
```

### How the 5 modules connect

- `marketData.ts` → live quote + historical OHLC (used by signals + portfolio)
- `options.ts` → options chain + unusual activity (used directly by tools and by greeks IV inference)
- `greeks.ts` → Black–Scholes pricing + greeks (uses IV from chain when available)
- `signals.ts` → technical indicators + sentiment → BUY/SELL/HOLD (uses marketData + cache + rate limiter)
- `portfolio.ts` → paper trading + PnL using live quotes (uses SQLite + marketData)

### Why these approaches

- **Tool router + modules** keeps MCP schemas/routing separate from market logic.
- **Provider fallback** improves resilience when a provider fails or fields are missing.
- **SQLite** gives persistent paper-trading state without an external DB.
- **TTL cache + daily limiter** reduce repeated requests and protect free-tier quotas.

---

## ✨ Features (as implemented)

- **Market data**: live quotes + historical OHLC with provider fallback
- **Options**: fetch options chain and detect basic unusual activity
- **Greeks**: compute Black–Scholes theoretical price + delta/gamma/theta/vega/rho
- **Signals**: technicals (RSI/MACD/Bollinger) plus news sentiment → BUY/SELL/HOLD
- **Paper portfolio**: store virtual trades in SQLite and compute PnL from live quotes
- **Sector scan**: scan a predefined symbol set and produce a simple sector heatmap

---

## 🚀 Setup Guide / Quick Start

### Prerequisites

- Node.js 18+ (Node 20 recommended)
- npm
- macOS (Claude Desktop)

### Installation

- Install dependencies: `npm install`
- Build: `npm run build`
- Run (stdio): `npm start`

For development:
- `npm run dev`

### API key setup

Create a `.env` file in the repo root:

- `ALPHA_VANTAGE_KEY` (recommended)
- `NEWS_API_KEY` (optional)

Notes:
- Live quote attempts **Alpha Vantage** first (mapped internally), then **Yahoo Finance** fallback.
- Historical OHLC uses **Yahoo Finance** first with **Alpha Vantage** fallback.

### Claude Desktop config (macOS)

Config file path on macOS:

- `~/Library/Application Support/Claude/claude_desktop_config.json`

Example configuration (adjust absolute paths):

```json
{
  "mcpServers": {
    "indiaquant": {
      "command": "node",
      "args": [
        "/Users/princeagrawal/Desktop/Assignment/IndiaQuant-MCP/dist/server.js"
      ],
      "cwd": "/Users/princeagrawal/Desktop/Assignment/IndiaQuant-MCP",
      "env": {
        "ALPHA_VANTAGE_KEY": "...",
        "NEWS_API_KEY": "..."
      }
    }
  }
}
```

---

## 🛠️ Tool Documentation

All tools are defined in `src/tools/mcpTools.ts`. and never exposed over MCP

Conventions:
- Symbols are typically **Yahoo-style** (e.g., `RELIANCE.NS`, `TCS.NS`).

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

## 🏛️ Trade-offs & Decisions

### Why Node.js over Python

- Node/TypeScript integrates cleanly with MCP stdio servers and schema-defined tools.
- Ships as a single runtime for Claude Desktop configuration.

### Caching strategy

- Process-local TTL cache to reduce repeated calls.
- Resets on restart and is not shared across processes.

### Black–Scholes implementation approach

- Lightweight in-project implementation:
  - Normal PDF (exact)
  - Normal CDF (Abramowitz–Stegun approximation)

---

## ⚠️ Known Limitations

- **Free-tier API limits** apply (Alpha Vantage / NewsAPI). Caching + a daily limiter help, but you can still hit quotas with heavy usage.
- **Outside market hours**, providers may return stale prices or missing fields.
- **Yahoo Finance edge cases**: some symbols/expiries may have incomplete options data; newly listed stocks may have insufficient candles for indicators.

---

## 📁 Directory layout

- `src/server.ts` – MCP server entry point
- `src/tools/mcpTools.ts` – tool definitions + dispatch
- `src/modules/*` – market logic (5 modules)
- `src/db/database.ts` – SQLite init
- `src/utils/*` – cache, rate limiter, symbol formatter
- `data/portfolio.db*` – SQLite database files
