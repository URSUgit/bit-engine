# BitPrivat Platform — Architecture

## Overview

BitPrivat is a professional copy-trading and signal intelligence platform for DeFi markets (Hyperliquid perpetuals, Polymarket prediction markets). The system is designed for low-latency execution, real-time analytics, and non-custodial wallet integration.

## System Diagram

```
User Browser
     │
     │ HTTPS / WSS
     ▼
┌────────────────────────────────┐
│         apps/web               │
│  Next.js 14 · App Router       │
│  Tailwind · shadcn/ui          │
│  wagmi · NextAuth              │
└───────────┬────────────────────┘
            │ REST / SSE
            ▼
┌────────────────────────────────┐
│      apps/api-gateway          │
│  Go · Gin                      │
│  JWT auth · rate limiting      │
│  CORS · request routing        │
└──┬─────────┬─────────┬─────────┘
   │         │         │
   ▼         ▼         ▼
Trading   Signal    TimescaleDB
Engine    Service   MongoDB
(Rust)    (Python)  Redis
   │         │
   └────┬────┘
        │
        ▼
     Kafka
   (event bus)
```

## Services

### apps/web — Next.js 14 Frontend

- **Routing**: App Router with Server Components by default; Client Components where interactivity is needed
- **Auth**: NextAuth.js v4 with EIP-191 wallet signature verification (SIWE-like flow)
- **Wallet**: wagmi v2 + viem + WalletConnect v2; supports MetaMask, Coinbase Wallet, and 300+ wallets via WalletConnect
- **State**: Zustand for client state; React Query for server state with automatic background refresh
- **Charts**: TradingView Lightweight Charts (candles, area series, volume)
- **UI**: Tailwind CSS dark theme with CSS variables; shadcn/ui component patterns

### apps/api-gateway — Go + Gin

- **Purpose**: Single entry point for all client traffic; handles auth, rate limiting, and routing to backend services
- **Auth**: JWT (HS256) issued after wallet signature verification; 7-day expiry
- **Middleware**: CORS, request ID, JWT validation, rate limiting (Redis-backed)
- **Routing**: `/api/v1/` with public and protected route groups
- **Kafka**: Produces trade and copy-trading events; consumed by trading engine

### apps/trading-engine — Rust + Tokio

- **Purpose**: High-performance order execution engine; core latency target is <400ms end-to-end
- **Async runtime**: Tokio with full feature set
- **Connectors**: `ExchangeConnector` trait with implementations for Hyperliquid (EIP-712 signing) and Polymarket (CLOB API)
- **Risk**: `RiskEngine` enforces per-order, per-portfolio, and daily loss limits with circuit breakers
- **WebSocket**: Axum-based WS server for real-time position/fill streaming to clients
- **Kafka**: Consumes copy-trade commands, produces fill events

### apps/signal-service — Python + FastAPI

- **Purpose**: AI-powered signal generation, trader analytics, and sentiment analysis
- **FinBERT**: `ProsusAI/finbert` model for financial sentiment classification (positive/negative/neutral → buy/sell/hold + confidence)
- **Scrapers**: Twitter v2 API, Reddit API, Telegram Bot API — scrape crypto-relevant text for FinBERT scoring
- **Trader analytics**: Aggregates on-chain trade data into leaderboard stats (ROI, Sharpe, win rate, drawdown)
- **MongoDB**: Stores signals, scraped text, and trader profiles
- **Kafka**: Produces scored signals; consumed by API gateway and frontend via SSE

## Data Layer

| Store | Purpose | Data |
|---|---|---|
| TimescaleDB | Time-series trade data | OHLCV candles, tick data, portfolio snapshots |
| MongoDB | Document store | Signals, trader profiles, copy configs, scraper output |
| Redis | Cache + pub/sub | Live prices, session tokens, rate limits, WS fan-out |
| Kafka | Event streaming | Trade commands, fills, signal events, portfolio updates |

## Key Design Decisions

### Non-Custodial Architecture
BitPrivat never holds private keys. Wallet connections are read-only until the user signs a trade transaction in their own wallet. The platform submits transactions on the user's behalf only when explicitly delegated via a session signature.

### Copy Trading Flow
1. User selects a trader and configures copy parameters (allocation, stop-loss, max drawdown)
2. Config is stored in MongoDB via API gateway
3. Trading engine subscribes to the copied trader's on-chain positions via WebSocket (Hyperliquid) or polling (Polymarket)
4. On position change detection, engine runs risk checks, sizes the copy order, and submits to exchange
5. Fill events are published to Kafka → picked up by API gateway → pushed to frontend via SSE

### Signal Pipeline
1. Scrapers collect text from Twitter/Reddit/Telegram on configurable keywords (asset tickers, influencer accounts)
2. Text is queued in Kafka topic `raw-text`
3. FinBERT consumer scores each item and produces a `Signal` with direction + confidence
4. High-confidence signals (≥0.8) trigger real-time notifications via WebSocket
5. All signals are stored in MongoDB for historical analysis and backtesting

## Latency Budget (Copy Trading)
| Step | Target |
|---|---|
| Detect position change (WS) | <50ms |
| Risk check | <5ms |
| Order construction + signing | <50ms |
| Exchange submission | <200ms |
| Fill confirmation | <100ms |
| **Total** | **<400ms** |
