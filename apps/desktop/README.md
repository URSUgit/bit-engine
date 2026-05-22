# BitPrivat Desktop

Electron wrapper that launches all BitPrivat services and opens the UI in a native window.

## What it does

1. Starts Python signal service (`uvicorn`) automatically
2. Starts Next.js web app automatically
3. Shows splash screen while services boot
4. Opens full UI in a native window (no browser needed)
5. System tray icon with quick-access menu
6. Kills all services cleanly on exit

## Build the .exe locally

**Prerequisites:**
- Node.js ≥ 18 — https://nodejs.org
- pnpm — `npm install -g pnpm`
- Python ≥ 3.11 — https://python.org (for the signal service at runtime)

**Run the build script:**
```
apps\desktop\build-local.bat
```

Find the installer at `apps/desktop/dist/BitPrivat Setup X.X.X.exe`

## Build via GitHub Actions

Every push to `main` or a `claude/*` branch automatically builds both the Windows `.exe` and macOS `.dmg`.

Download from the **Actions** tab → latest workflow run → **Artifacts**.

## Runtime requirements on end-user machine

The `.exe` installer bundles Electron + the web build.
The user still needs:
- **Python 3.11+** with the signal service deps installed
  (`pip install fastapi uvicorn httpx pydantic`)
- Optional: OpenAI or Anthropic API key for BitAgent

## Ports used

| Service | Port |
|---|---|
| Web UI | 3000 |
| Signal Service | 8001 |
| API Gateway | 8080 |

## Environment variables

Set these before running or in a `.env` file in the repo root:

```
OPENAI_API_KEY=sk-...        # for BitAgent
LLM_MODEL=gpt-4o-mini
POLYMARKET_DRY_RUN=true      # set false to trade real money
```
