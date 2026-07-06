#!/usr/bin/env bash
# BitPrivat — one-command local setup
# Usage: bash setup.sh
set -e

echo ""
echo "╔══════════════════════════════════════╗"
echo "║     BitPrivat — Local Setup          ║"
echo "╚══════════════════════════════════════╝"
echo ""

# 1. Node / pnpm
if ! command -v node &>/dev/null; then
  echo "❌  Node.js not found. Install from https://nodejs.org (v18+)" && exit 1
fi
if ! command -v pnpm &>/dev/null; then
  echo "Installing pnpm…"
  npm install -g pnpm
fi

# 2. Dependencies
echo "📦  Installing dependencies…"
pnpm install

# 3. .env.local for web app
ENV_FILE="apps/web/.env.local"
if [ ! -f "$ENV_FILE" ]; then
  echo "📝  Creating $ENV_FILE (fill in your API keys)…"
  cat > "$ENV_FILE" << 'EOF'
# Fill in your API keys below, then restart with: pnpm dev
ALPHA_VANTAGE_API_KEY=
FINNHUB_API_KEY=
FRED_API_KEY=
OPEN_EXCHANGE_RATES_APP_ID=
TWELVE_DATA_API_KEY=

NEXT_PUBLIC_SIGNAL_SERVICE_URL=http://localhost:8001
SIGNAL_SERVICE_URL=http://localhost:8001
EOF
  echo "⚠️   Add your API keys to $ENV_FILE before starting."
else
  echo "✅  $ENV_FILE already exists — skipping."
fi

# 4. Signal service .env
SVC_ENV="apps/signal-service/.env"
if [ ! -f "$SVC_ENV" ]; then
  cat > "$SVC_ENV" << 'EOF'
LLM_PROVIDER=anthropic
LLM_MODEL=claude-haiku-4-5-20251001
ANTHROPIC_API_KEY=

ALPHA_VANTAGE_API_KEY=
FINNHUB_API_KEY=
FRED_API_KEY=
OPEN_EXCHANGE_RATES_APP_ID=
TWELVE_DATA_API_KEY=
EOF
fi

echo ""
echo "✅  Done! Start the app with:"
echo ""
echo "    pnpm dev"
echo ""
echo "Then open: http://localhost:3000"
echo ""
