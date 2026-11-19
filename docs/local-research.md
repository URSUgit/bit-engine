# Bit Engine local research mode

The Windows research launcher starts the existing Backtester and Paper Forward API on `127.0.0.1` only. It does not load the signal service's `.env`, start the full set of workers, or register live trading or custom strategy routes. It is not a public or remote deployment configuration.

## Build and launch

Use the repo's usual Node/pnpm and Python 3.11 dependencies. Stop the local Bit Engine before running a dependency install or Prisma regeneration on Windows. With the generated Prisma client already available, build the research UI from `apps/web` in PowerShell:

```powershell
$env:NEXT_PUBLIC_BITENGINE_RESEARCH = '1'
$env:NEXT_PUBLIC_SIGNAL_SERVICE_URL = ''
node node_modules/next/dist/bin/next build
```

Install the archive separately before starting. The installer expects a local audit JSON with an `archives` array: each record supplies `symbol`, `timeframe`, `month`, `rows`, and `sha256`. For the current starter archive, provide 60 `BTCUSDT` `1h` records (`2021-01` through `2025-12`), with verified publisher ZIP hashes and observed row counts. The installer fetches the archive directly, checks the supplied hashes, reports any missing hours, and refuses to overwrite an existing research cache. No market candles or installed data are bundled in this branch. Check the provider's applicable dataset terms before downloading or sharing data.

```powershell
py -3.11 scripts/install-research-history.py --audit C:\path\to\local-audit.json
.\start-bitprivat.bat --research
```

The app opens at `http://127.0.0.1:3000/lab/backtester`. The **Data** tab shows exact coverage and missing hours. Strict breakout runs require a fully covered UTC date range; the end date is exclusive. Expand **Run evidence** or export the result as JSON to save the input candle fingerprint and resolved run settings. **Forward** simulates fills without placing orders. The research cache, results and paper state are stored separately under `%LOCALAPPDATA%\BitEngine\research`.

Use **History → Open** to reopen a saved backtest, even after refreshing the browser. Opening a run does not change the current draft or start another test. History is read-only in research mode.

The project tests use handmade candle fixtures. They are not evidence of trading performance or a prop-evaluation pass.
