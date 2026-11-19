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

For new breakout runs, select **Trades → Why this trade?** to see the signal candle, breakout threshold, fill prices, and fees. The JSON export includes these details. Older runs did not record them and still open normally.

### Import a strategy from a public YouTube video

Under **Video strategy → Find a YouTube video**, search by keyword, open a result with **Watch**, or click **Select video** to fill the URL. Selection does not analyze the video or begin a backtest. In-app search uses a server-side `YOUTUBE_API_KEY` for the YouTube Data API v3 and does not need an OAuth connection or a Gemini key. Searches and additional result pages use your YouTube project quota. If the key is missing, use **Open YouTube search** and paste the link from the video you choose.

Open **Video strategy** in the research Backtester and enter one public video URL. If `GEMINI_API_KEY` is set in the environment of the local launcher, **Analyze with Gemini** sends the public link directly to the Gemini Interactions API as video input. No YouTube Data API key, account connection, or transcript download is needed for analysis. The default is Gemini 3.8 Flash (`gemini-3.8-flash`); use a free-tier project to stay within [Google's free-tier limits](https://aistudio.google.com/docs/pricing#gemini-3.8-flash). The app does not fall back to another model on quota errors. `BITENGINE_GEMINI_MODEL` overrides the default. Keep the key server-side and out of source control, browser fields, exports and chat. Do not expose this loopback feature over a network.

Without a key, copy the prompt, use it with the video in Gemini, and use **Paste Gemini JSON → Validate draft**. Bit Engine makes no Gemini API request in that mode. Check the linked timestamps before confirming the draft. Only the existing BTCUSDT hourly, long-only previous-day breakout is runnable; unsupported or ambiguous rules stay as notes requiring review. The importer does not execute generated code, place orders, or start a backtest. After loading a draft, explicitly run the test; **Run evidence** records the source and the difference between the proposed and tested offset.

**Windows first-time setup:** Create a key for a free-tier project in [Google AI Studio](https://aistudio.google.com/apikey). Search Start for **Edit environment variables for your account** and add `GEMINI_API_KEY` as a **user** variable. Stop Bit Engine and reopen the desktop shortcut so the backend receives the new value. Do not paste the key into Bit Engine, chat, or Git. Under **Video strategy**, paste a public YouTube link and click **Analyze with Gemini**. Browse YouTube directly if you do not want to configure a separate search key.

### Create a named paper bot from a backtest

Confirm or enter the trader and strategy names while reviewing a compatible draft. They follow the strategy into the tester, run evidence, History and each paper bot. Run the backtest and choose **Create paper bot** on the result, or reopen the saved result in **History** first. The bot uses the tested breakout offset, starting capital, allocation, commission, slippage and spread; it does not copy an open historical position or use the current unsaved editor settings. Backtests with market impact or extra execution latency cannot be promoted because those options are not supported by the paper simulator.

In **Paper bots**, the new bot is **ready**. Click **Start bot** to begin a simulated forward test with its own cash and positions. The simulator observes fresh Binance hourly candles while the backend is running. If it misses a candle or eligible opening price, it pauses rather than backdating a fill. **Stop bot** freezes the test. Create a new bot from the saved run to start again. No exchange account or real orders are involved.

The project tests use handmade candle fixtures. They are not evidence of trading performance or a prop-evaluation pass.
