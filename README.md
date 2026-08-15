# BitPrivat Platform

A professional, full-stack crypto trading platform for copy-trading elite DeFi traders, running AI signal intelligence, and deploying automated strategies.

## Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 14 (App Router), TypeScript, Tailwind CSS, shadcn/ui |
| API Gateway | Go + Gin |
| Trading Engine | Rust + Tokio |
| Signal Service | Python + FastAPI + FinBERT |
| Time-series DB | TimescaleDB (Postgres extension) |
| Document DB | MongoDB |
| Cache | Redis |
| Message Queue | Kafka |
| Auth | NextAuth.js v4 + JWT |
| Wallet | wagmi v2 + viem + WalletConnect |
| Charts | TradingView Lightweight Charts |
| State | Zustand + React Query |
| Monorepo | Turborepo + pnpm workspaces |

## Repo Structure

```
bitprivat-platform/
├── apps/
│   ├── web/             # Next.js 14 frontend
│   ├── api-gateway/     # Go API gateway
│   ├── trading-engine/  # Rust trading engine
│   └── signal-service/  # Python signal + analytics
├── packages/
│   ├── shared-types/    # Shared TypeScript types
│   ├── ui/              # Shared UI component library
│   └── config/          # ESLint + TSConfig presets
├── infra/               # Docker Compose + K8s manifests
└── docs/                # Architecture docs
```

## Prerequisites

- **Node.js** ≥ 18.17.0
- **pnpm** ≥ 8.0.0 (`npm install -g pnpm`)
- **Go** ≥ 1.22
- **Rust** ≥ 1.78 (via `rustup`)
- **Python** ≥ 3.11 (`pyenv` recommended)
- **Docker** + **Docker Compose** v2

## Quick Start (frontend-only — no backend required)

The Next.js app's API client falls back to seeded mock data when the gateway is offline, so you can play with the full UI immediately:

```bash
cd apps/web
pnpm install     # only needed once at the repo root
pnpm dev
# open http://localhost:3000
```

Routes available:
- `/landing` — public marketing page
- `/dashboard` — command center
- `/dashboard/leaderboard` — sortable / filterable trader table
- `/dashboard/markets` — markets grid with sparklines
- `/dashboard/markets/[symbol]` — market detail with live-style order book
- `/dashboard/positions` — full positions table
- `/dashboard/copy` — copy-trading management with sliders
- `/lab` — strategy builder + backtester

Connect any wallet (MetaMask / WalletConnect / Coinbase) and click **Sign In** in the navbar to run the full SIWE flow against the gateway, or sign a message locally if the gateway is offline.

## Full-stack Quick Start

### 1. Clone and install

```bash
git clone https://github.com/URSUgit/bit-engine.git
cd bit-engine

cp .env.example .env
# edit .env with your secrets

pnpm install
```

### 2. Start infrastructure (TimescaleDB, MongoDB, Redis, Kafka)

```bash
docker compose -f infra/docker-compose.yml up -d
```

### 3. Install backend deps

```bash
# Go API Gateway
cd apps/api-gateway && go mod tidy && cd ../..

# Rust Trading Engine
cd apps/trading-engine && cargo build && cd ../..

# Python Signal Service
cd apps/signal-service
python -m venv .venv && source .venv/bin/activate   # or .venv\Scripts\activate on Windows
pip install -e ".[dev]"
cd ../..
```

### 4. Start all services

```bash
# All JS/TS apps via Turborepo
pnpm dev

# In separate terminals:
cd apps/api-gateway && go run main.go
cd apps/trading-engine && cargo run
cd apps/signal-service && uvicorn main:app --reload --reload-dir app --port 8001
```

### 5. Open

- Frontend: http://localhost:3000
- API Gateway: http://localhost:8080
- Signal Service: http://localhost:8001/docs (Swagger UI)
- Trading Engine: http://localhost:9090

## Development Scripts

```bash
pnpm build          # Build all apps
pnpm dev            # Dev mode (all JS/TS apps)
pnpm lint           # Lint all apps
pnpm type-check     # TypeScript type-check all apps
pnpm test           # Run all tests
pnpm clean          # Clean all build artifacts
```

## Environment Variables

Copy `.env.example` to `.env` and fill in the required values. See comments in `.env.example` for details.

**Required before first run:**
- `NEXTAUTH_SECRET` — generate with `openssl rand -base64 32`
- `JWT_SECRET` — generate with `openssl rand -base64 64`
- `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` — get from [WalletConnect Cloud](https://cloud.walletconnect.com)

## Architecture

See [docs/architecture.md](./docs/architecture.md) for the full system design.

## Deployment

- **Frontend**: Vercel (`apps/web`)
- **Backend services**: Kubernetes (see `infra/k8s/`)
- **Infrastructure**: Managed TimescaleDB + MongoDB Atlas + Upstash Redis

## License

Proprietary — BitPrivat © 2024
