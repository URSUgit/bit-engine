/**
 * Backtest API client — routes through the Next.js /api/v1 proxy so the
 * browser never needs a direct connection to the signal service.
 * The Next.js server relays every request to SIGNAL_SERVICE_URL (localhost:8001).
 *
 * Override NEXT_PUBLIC_SIGNAL_SERVICE_URL to a full URL to bypass the proxy
 * (e.g. when pointing at a remote signal-service in production).
 */

const BACKTEST_BASE = process.env.NEXT_PUBLIC_SIGNAL_SERVICE_URL ?? "";

export type SymbolEntry = { symbol: string; category: string };

export type StrategyParamSpec = {
  type: "int" | "float" | "bool";
  default: number | boolean;
  min?: number;
  max?: number;
  label?: string;
  description?: string;
};

export type StrategyInfo = {
  name: string;
  description: string;
  params_schema: Record<string, StrategyParamSpec>;
};

export type IntervalInfo = {
  value: string;
  label: string;
  sources: string[];
  asset_classes: string[];
  yahoo_max_days?: number;
};

export type Bar = { t: number; o: number; h: number; l: number; c: number; v: number };

export type HistoricalData = {
  symbol: string;
  interval: string;
  count: number;
  bars: Bar[];
  source?: string | null;       // provenance: "coinmetrics", "binance", "synthetic_gbm", ...
  is_synthetic?: boolean;       // true when the series is GBM demo data, not real market data
};

export type BacktestParams = {
  symbol: string;
  strategy: string;
  start_date: string;
  end_date?: string;
  interval: string;
  initial_capital: number;
  commission_pct: number;
  slippage_pct: number;
  position_size_pct: number;
  strategy_params: Record<string, number>;
  // Realism upgrades
  spread_bps?: number;
  enable_market_impact?: boolean;
  execution_latency_ms?: number;
  use_funding_rates?: boolean;
  leverage?: number;
  run_anomaly_scan?: boolean;
};

export type Trade = {
  side: "long" | "short";
  entry_time: string;
  exit_time: string;
  entry_price: number;
  exit_price: number;
  size: number;
  pnl: number;
  pnl_pct: number;
  duration_bars: number;
};

export type EquityPoint = { t: number; equity: number; drawdown_pct: number };

export type Metrics = {
  total_return_pct: number;
  cagr_pct: number;
  sharpe_ratio: number;
  sortino_ratio: number;
  max_drawdown_pct: number;
  calmar_ratio: number;
  win_rate_pct: number;
  profit_factor: number;
  total_trades: number;
  winning_trades: number;
  losing_trades: number;
  avg_trade_pnl_pct: number;
  best_trade_pct: number;
  worst_trade_pct: number;
  avg_trade_duration_bars: number;
  exposure_pct: number;
  final_equity: number;
  initial_capital: number;
  // Extended risk/quality metrics (optional for backward compat with cached results)
  recovery_factor?: number;
  sqn?: number;
  avg_win_pct?: number;
  avg_loss_pct?: number;
  avg_win_loss_ratio?: number;
  max_consecutive_wins?: number;
  max_consecutive_losses?: number;
  // Risk analytics (optional for backward compat)
  var_95?: number;
  var_99?: number;
  cvar_95?: number;
  omega_ratio?: number;
  ulcer_index?: number;
  pain_index?: number;
  time_in_market_pct?: number;
  avg_bars_between_trades?: number;
  daily_returns?: number[];
};

export type FeatureStats = {
  feature: string;
  count: number;
  mean: number | null;
  std: number | null;
  min: number | null;
  max: number | null;
};

export type EntryDataPoint = {
  bar_index: number;
  timestamp: string;
  entry_price: number;
  features: Record<string, number | null>;
  series: Record<string, (number | null)[]>;
};

export type EntryAnalysis = {
  entry_count: number;
  series_length: number;
  feature_names: string[];
  entries: EntryDataPoint[];
  feature_stats: FeatureStats[];
};

export type FrictionBreakdown = {
  commission_usd: number;
  slippage_usd: number;
  spread_usd: number;
  funding_usd: number;
  total_usd: number;
  total_pct_of_gross: number;
};

export type Anomaly = {
  timestamp: number;
  type: string;
  severity: number;
  price: number;
  description: string;
  suggested_action: string;
  bar_index: number;
};

export type LiveSignal = {
  strategy: string;
  symbol: string;
  signal: string;
  confidence: number;
  entry_price: number | null;
  tp_price: number | null;
  sl_price: number | null;
  timestamp: string;
  bar_count: number;
  error: string | null;
};

export type SignalValidation = {
  strategy: string;
  symbol: string;
  direction: string;
  lookback_days: number;
  total_signals: number;
  win_rate: number;
  avg_gain_pct: number;
  avg_loss_pct: number;
  expected_value_pct: number;
  profit_factor: number;
  best_pct: number;
  worst_pct: number;
};

export type CorrelationResult = {
  symbols: string[];
  start_date: string;
  end_date: string;
  bars_per_symbol: Record<string, number>;
  matrix: Record<string, Record<string, number | null>>;
};

export type DatasetEntry = {
  datasource: string;
  key: string;
  first_ts: number | null;
  last_ts: number | null;
  count: number;
  last_updated: number | null;
};

// ── Data warehouse: quality, cross-validation, live ingest ──────────────────

export type QualityIssue = {
  kind: string;
  severity: number;
  ts: number;
  detail: string;
  iso: string;
};

export type QualityReport = {
  symbol: string;
  interval: string;
  bar_count: number;
  expected_count: number;
  completeness_pct: number;
  quality_score: number;
  gap_count: number;
  spike_count: number;
  ohlc_violation_count: number;
  zero_volume_count: number;
  duplicate_count: number;
  earliest_iso: string | null;
  latest_iso: string | null;
  issues: QualityIssue[];
};

export type QualityOverviewRow = {
  symbol: string;
  interval: string;
  bar_count: number;
  completeness_pct: number;
  quality_score: number;
  gap_count: number;
  spike_count: number;
  ohlc_violation_count: number;
  earliest_iso: string | null;
  latest_iso: string | null;
};

export type CrossValidationReport = {
  symbol: string;
  interval: string;
  sources: { source: string; ok: boolean; bar_count: number; error: string | null }[];
  compared_bars: number;
  matching_bars: number;
  max_divergence_pct: number;
  mean_divergence_pct: number;
  divergent_timestamps: {
    ts: number; iso: string; ref_source: string; ref_close: number;
    peer_source: string; divergence_pct: number;
  }[];
  agreement_pct: number;
  verdict: "trusted" | "minor_drift" | "conflict" | "insufficient" | "unknown";
  recommended_source: string;
};

export type IngestStream = {
  symbol: string;
  interval: string;
  enabled: boolean;
  last_poll_ts: number | null;
  last_bar_ts: number | null;
  bars_written_total: number;
  last_write_count: number;
  error: string | null;
  polls: number;
  last_poll_iso: string | null;
  last_bar_iso: string | null;
};

export type IngestStatus = {
  running: boolean;
  poll_seconds: number;
  stream_count: number;
  streams: IngestStream[];
};

export type BacktestResult = {
  id: string;
  symbol: string;
  strategy: string;
  interval: string;
  start_date: string;
  end_date: string;
  params_used: Record<string, number>;
  metrics: Metrics;
  benchmark_metrics: Metrics | null;
  trades: Trade[];
  equity_curve: EquityPoint[];
  bars_processed: number;
  runtime_ms: number;
  entry_analysis: EntryAnalysis | null;
  // Realism additions
  friction_breakdown: FrictionBreakdown | null;
  anomalies: Anomaly[] | null;
  short_trades: number;
  benchmark?: BacktestResult | null;
};

export type CompareResult = {
  symbol: string;
  success: boolean;
  result: BacktestResult | null;
  error: string | null;
};

export type CompareStreamEvent =
  | { type: "start"; total: number }
  | { type: "result"; symbol: string; success: boolean; result: BacktestResult | null; error: string | null; completed: number; total: number }
  | { type: "done"; total: number }
  | { type: "error"; message: string };

export type ParamRange = { name: string; start: number; stop: number; step: number };

export type OptimizeRequest = {
  symbol: string;
  strategy: string;
  start_date: string;
  end_date?: string;
  interval: string;
  initial_capital: number;
  commission_pct: number;
  slippage_pct: number;
  position_size_pct: number;
  param_ranges: ParamRange[];
  metric: string;
  max_combinations: number;
};

export type OptimizeCell = {
  params: Record<string, number>;
  metric_value: number;
  total_return_pct: number;
  sharpe_ratio: number;
  max_drawdown_pct: number;
  total_trades: number;
};

export type OptimizeResult = {
  symbol: string;
  strategy: string;
  metric: string;
  combinations_run: number;
  best_params: Record<string, number>;
  best_metric_value: number;
  best_total_return_pct: number;
  cells: OptimizeCell[];
  param_names: string[];
  runtime_ms: number;
};

export type AssetMetadata = {
  metadata: {
    asset_class?: string;
    name?: string;
    symbol?: string;
    description?: string;
    homepage?: string;
    market_cap_usd?: number;
    market_cap_rank?: number;
    current_price_usd?: number;
    ath_usd?: number;
    ath_change_pct?: number;
    ath_date?: string;
    atl_usd?: number;
    circulating_supply?: number;
    max_supply?: number;
    total_volume_24h_usd?: number;
    price_change_24h_pct?: number;
    price_change_7d_pct?: number;
    price_change_30d_pct?: number;
    price_change_1y_pct?: number;
    trailing_pe?: number;
    forward_pe?: number;
    price_to_book?: number;
    dividend_yield_pct?: number;
    trailing_eps?: number;
    beta?: number;
    fifty_two_week_high?: number;
    fifty_two_week_low?: number;
    exchange?: string;
    currency?: string;
    twitter_followers?: number;
    reddit_subscribers?: number;
  } | null;
  fear_greed: {
    value: number;
    value_classification: string;
    timestamp: string;
    history_30d: { t: number; value: number; label: string }[];
  } | null;
  source: string;
};

export type CachedSeries = {
  symbol: string;
  interval: string;
  earliest: string | null;
  latest: string | null;
  bar_count: number;
  last_fetched_at: number | null;  // unix seconds
  source: string | null;  // e.g. "coinmetrics", "binance", "synthetic_gbm"
};

export type CacheStatus = {
  total_series: number;
  total_bars: number;
  series: CachedSeries[];
};

export type WalkForwardFold = {
  fold: number;
  train_start: string;
  train_end: string;
  test_start: string;
  test_end: string;
  in_sample_return: number;
  out_sample_return: number;
  in_sample_sharpe: number;
  out_sample_sharpe: number;
  in_sample_trades: number;
  out_sample_trades: number;
};

export type WalkForwardResult = {
  folds: WalkForwardFold[];
  avg_in_sample_sharpe: number;
  avg_out_sample_sharpe: number;
  avg_in_sample_return: number;
  avg_out_sample_return: number;
  degradation_ratio: number;
  consistency_score: number;
  overfitting_warning: boolean;
};

export type HistoryRow = {
  id: string;
  created_at: number;
  symbol: string;
  strategy: string;
  interval: string;
  start_date: string;
  end_date: string;
  total_return_pct: number;
  sharpe: number;
  max_drawdown_pct: number;
  total_trades: number;
};

export type StreamProgressEvent = {
  type: "progress";
  phase: "started" | "loading" | "loaded" | "signals" | "features" | "backtest" | "metrics";
  current?: number;
  total?: number;
  pct: number;
};

export type StreamResultEvent = {
  type: "result";
  data: BacktestResult;
};

export type StreamErrorEvent = {
  type: "error";
  message: string;
};

export type StreamEvent = StreamProgressEvent | StreamResultEvent | StreamErrorEvent;

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BACKTEST_BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status}: ${body || res.statusText}`);
  }
  return (await res.json()) as T;
}

export async function* compareStream(
  req: {
    symbols: string[]; strategy: string; start_date: string; end_date?: string;
    interval: string; initial_capital: number; commission_pct: number;
    slippage_pct: number; position_size_pct: number;
    strategy_params: Record<string, number>;
  },
): AsyncGenerator<CompareStreamEvent> {
  const res = await fetch(`${BACKTEST_BASE}/api/v1/backtest/compare/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`${res.status}: ${text}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.startsWith("data: ")) {
        const payload = line.slice(6).trim();
        if (payload) yield JSON.parse(payload) as CompareStreamEvent;
      }
    }
  }
}

export async function* runBacktestStream(
  params: BacktestParams,
): AsyncGenerator<StreamEvent> {
  const res = await fetch(`${BACKTEST_BASE}/api/v1/backtest/run/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`${res.status}: ${text}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.startsWith("data: ")) {
        const payload = line.slice(6).trim();
        if (payload) yield JSON.parse(payload) as StreamEvent;
      }
    }
  }
}

export type MonteCarloResult = {
  n_simulations: number;
  initial_capital: number;
  p5_equity: number;
  p25_equity: number;
  p50_equity: number;
  p75_equity: number;
  p95_equity: number;
  p5_max_dd: number;
  p50_max_dd: number;
  p95_max_dd: number;
  ruin_probability: number;
  positive_probability: number;
  equity_band: {
    step: number;
    p5: number;
    p25: number;
    p50: number;
    p75: number;
    p95: number;
  }[];
  expected_final_equity: number;
  std_final_equity: number;
};

export const backtestApi = {
  symbols: (category?: string) => {
    const q = category ? `?category=${category}` : "";
    return call<SymbolEntry[]>(`/api/v1/backtest/symbols${q}`);
  },
  strategies: () => call<StrategyInfo[]>("/api/v1/backtest/strategies"),
  intervals: () => call<{ intervals: IntervalInfo[] }>("/api/v1/backtest/intervals"),
  data: (symbol: string, start_date: string, end_date?: string, interval = "1d") => {
    const q = new URLSearchParams({ start_date, interval });
    if (end_date) q.set("end_date", end_date);
    return call<HistoricalData>(`/api/v1/backtest/data/${symbol}?${q}`);
  },
  run: (params: BacktestParams) =>
    call<BacktestResult>("/api/v1/backtest/run", {
      method: "POST",
      body: JSON.stringify(params),
    }),
  compare: (req: {
    symbols: string[]; strategy: string; start_date: string; end_date?: string;
    interval: string; initial_capital: number; commission_pct: number;
    slippage_pct: number; position_size_pct: number;
    strategy_params: Record<string, number>;
  }) =>
    call<CompareResult[]>("/api/v1/backtest/compare", {
      method: "POST",
      body: JSON.stringify(req),
    }),
  optimize: (req: OptimizeRequest) =>
    call<OptimizeResult>("/api/v1/backtest/optimize", {
      method: "POST",
      body: JSON.stringify(req),
    }),
  metadata: (symbol: string) =>
    call<AssetMetadata>(`/api/v1/backtest/metadata/${symbol}`),
  history: (limit = 50, symbol?: string) => {
    const q = new URLSearchParams({ limit: String(limit) });
    if (symbol) q.set("symbol", symbol);
    return call<{ runs: HistoryRow[] }>(`/api/v1/backtest/history?${q}`);
  },
  getHistoryRun: (id: string) =>
    call<BacktestResult>(`/api/v1/backtest/history/${id}`),
  deleteHistoryRun: (id: string) =>
    call<{ deleted: boolean; id: string }>(`/api/v1/backtest/history/${id}`, {
      method: "DELETE",
    }),
  cache: () => call<CacheStatus>("/api/v1/backtest/cache"),
  clearCache: (symbol: string, interval?: string) =>
    call<{ cleared: boolean; symbol: string; interval?: string }>(
      `/api/v1/backtest/cache/${symbol}${interval ? `?interval=${interval}` : ""}`,
      { method: "DELETE" },
    ),
  refreshData: (symbol: string, start_date: string, end_date: string | undefined, interval: string) => {
    const q = new URLSearchParams({ start_date, interval, force_refresh: "true" });
    if (end_date) q.set("end_date", end_date);
    return call<HistoricalData>(`/api/v1/backtest/data/${symbol}?${q}`);
  },
  anomalies: (req: {
    symbol: string; start_date: string; end_date?: string; interval?: string;
    volume_spike_z?: number; price_gap_pct?: number; flash_move_pct?: number;
  }) =>
    call<{ anomalies: Anomaly[]; symbol: string; bars_scanned: number; runtime_ms: number }>(
      "/api/v1/backtest/anomalies",
      { method: "POST", body: JSON.stringify(req) },
    ),
  correlations: (req: { symbols: string[]; start_date: string; end_date?: string; interval?: string }) =>
    call<CorrelationResult>("/api/v1/backtest/correlations", {
      method: "POST",
      body: JSON.stringify(req),
    }),
  datasets: () =>
    call<{ datasets: DatasetEntry[]; total: number }>("/api/v1/backtest/datasets"),
  liveSignals: (symbol: string, interval = "1d") => {
    const q = new URLSearchParams({ symbol, interval });
    return call<{ signals: LiveSignal[]; symbol: string; interval: string; timestamp: string }>(
      `/api/v1/backtest/signals/live?${q}`,
    );
  },
  validateSignal: (req: {
    strategy: string; symbol: string; direction: string;
    interval?: string; lookback_days?: number;
  }) =>
    call<SignalValidation>("/api/v1/backtest/signals/validate", {
      method: "POST",
      body: JSON.stringify(req),
    }),

  // ── Strategy comparison ───────────────────────────────────────────────────
  compareStrategies: async (
    strategies: string[],
    params: Omit<BacktestParams, "strategy">,
  ): Promise<{ strategy: string; result: BacktestResult | null; error: string | null }[]> => {
    const results = await Promise.all(
      strategies.map(async (strategy) => {
        try {
          const result = await call<BacktestResult>("/api/v1/backtest/run", {
            method: "POST",
            body: JSON.stringify({ ...params, strategy }),
          });
          return { strategy, result, error: null };
        } catch (e) {
          return { strategy, result: null, error: e instanceof Error ? e.message : String(e) };
        }
      }),
    );
    return results;
  },

  // ── Data warehouse ────────────────────────────────────────────────────────
  dataQuality: (symbol: string, interval = "1d") => {
    const q = new URLSearchParams({ symbol, interval });
    return call<QualityReport>(`/api/v1/backtest/data/quality?${q}`);
  },
  dataQualityOverview: () =>
    call<{ count: number; datasets: QualityOverviewRow[] }>(
      "/api/v1/backtest/data/quality/overview",
    ),
  crossValidate: (req: { symbol: string; interval?: string; limit?: number; tolerance_pct?: number }) =>
    call<CrossValidationReport>("/api/v1/backtest/data/cross-validate", {
      method: "POST",
      body: JSON.stringify(req),
    }),
  ingestStatus: () => call<IngestStatus>("/api/v1/backtest/data/ingest/status"),
  ingestControl: (req: { symbol: string; interval?: string; enabled: boolean }) =>
    call<IngestStatus>("/api/v1/backtest/data/ingest/control", {
      method: "POST",
      body: JSON.stringify(req),
    }),

  // ── Export ────────────────────────────────────────────────────────────────
  exportParquet: async (): Promise<void> => {
    const res = await fetch(`${BACKTEST_BASE}/api/v1/backtest/export-parquet`, {
      method: "POST",
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`${res.status}: ${body || res.statusText}`);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "bars.parquet";
    a.click();
    URL.revokeObjectURL(url);
  },

  // ── Demo data ─────────────────────────────────────────────────────────────
  seedDemo: (req?: {
    symbols?: string[];
    intervals?: string[];
    days?: number;
  }) =>
    call<{ seeded: { symbol: string; interval: string; bar_count: number }[]; total_bars: number }>(
      "/api/v1/backtest/seed-demo",
      { method: "POST", body: JSON.stringify(req ?? {}) },
    ),

  // ── Real data from GitHub-hosted datasets (Coin Metrics) ──────────────────
  realDataSources: () =>
    call<{ source: string; granularity: string; note: string; symbols: string[] }>(
      "/api/v1/backtest/data/real/sources",
    ),
  importRealData: (req?: { symbols?: string[]; clear_existing?: boolean }) =>
    call<{
      source: string;
      imported: {
        symbol: string; asset: string; interval: string; source: string;
        bars_written: number; earliest: string; latest: string; real: boolean;
        granularity_note: string;
      }[];
      errors: { symbol: string; error: string }[];
      total_bars: number;
      real: boolean;
    }>("/api/v1/backtest/data/real/import", {
      method: "POST",
      body: JSON.stringify(req ?? {}),
    }),

  // ── yfinance real data ────────────────────────────────────────────────────
  fetchRealData: (req: { symbol: string; interval?: string; days?: number }) =>
    call<{
      symbol: string;
      interval: string;
      bars_fetched: number;
      bars_stored: number;
      start: string;
      end: string;
      source: string;
    }>("/api/v1/backtest/data/fetch_real", {
      method: "POST",
      body: JSON.stringify(req),
    }),
  yfinanceSymbols: () =>
    call<{ symbol: string; yf_ticker: string; category: string }[]>(
      "/api/v1/backtest/data/yfinance_symbols",
    ),

  // ── Monte Carlo ───────────────────────────────────────────────────────────
  monteCarlo: (
    trades: Trade[],
    initial_capital: number,
    n_simulations = 1000,
  ) =>
    call<MonteCarloResult>("/api/v1/backtest/monte_carlo", {
      method: "POST",
      body: JSON.stringify({ trades, initial_capital, n_simulations }),
    }),

  // ── Walk-forward validation ────────────────────────────────────────────────
  walkForward: (params: BacktestParams & {
    n_splits?: number;
    train_pct?: number;
    anchored?: boolean;
  }) =>
    call<WalkForwardResult>("/api/v1/backtest/walk_forward", {
      method: "POST",
      body: JSON.stringify(params),
    }),

  // ── Custom strategy (in-browser editor) ──────────────────────────────────
  runCustomStrategy: (code: string, params: {
    symbol: string;
    start_date: string;
    end_date: string;
    interval: string;
    initial_capital: number;
    commission_pct: number;
    slippage_pct: number;
    position_size_pct: number;
    strategy_params?: Record<string, number>;
  }) =>
    call<BacktestResult>("/api/v1/backtest/run_custom", {
      method: "POST",
      body: JSON.stringify({ strategy_code: code, ...params }),
    }),

  // ── Portfolio multi-strategy run ──────────────────────────────────────────
  portfolioRun: (req: PortfolioRunRequest) =>
    call<PortfolioResult>("/api/v1/backtest/portfolio_run", {
      method: "POST",
      body: JSON.stringify(req),
    }),

  // ── Multi-symbol signal scanner ────────────────────────────────────────────
  scanSymbols: (params: { strategy: string; interval: string; symbols: string[]; bars?: number }) =>
    call<SymbolScanResult>(`/api/v1/backtest/signals/scan?strategy=${encodeURIComponent(params.strategy)}&interval=${encodeURIComponent(params.interval)}&symbols=${encodeURIComponent(params.symbols.join(","))}&bars=${params.bars ?? 200}`),
};

// ── Portfolio types ────────────────────────────────────────────────────────────

export type PortfolioAllocation = { strategy: string; allocation_pct: number };

export type PortfolioRunRequest = {
  symbol: string;
  allocations: PortfolioAllocation[];
  start_date: string;
  end_date?: string;
  interval: string;
  initial_capital: number;
  commission_pct: number;
  slippage_pct: number;
  rebalance?: boolean;
};

export type PortfolioStrategyResult = {
  strategy: string;
  allocation_pct: number;
  allocated_capital: number;
  metrics: Partial<Metrics>;
  equity_curve: { t: number; equity: number }[];
};

export type PortfolioResult = {
  symbol: string;
  strategies: PortfolioStrategyResult[];
  combined_equity_curve: { t: number; equity: number }[];
  combined_metrics: {
    total_return_pct: number;
    sharpe_ratio: number;
    max_drawdown_pct: number;
    final_equity: number;
    initial_capital: number;
  };
  correlation_matrix: Record<string, Record<string, number | null>>;
  diversification_benefit: number;
};

export type SymbolScanEntry = {
  symbol: string;
  signal: string;
  confidence: number;
  entry_price: number | null;
  tp_price: number | null;
  sl_price: number | null;
  bar_count: number;
  error: string | null;
  close: number | null;
  ret_5d: number;
  ret_20d: number;
  volume: number;
};

export type SymbolScanResult = {
  strategy: string;
  interval: string;
  timestamp: string;
  results: SymbolScanEntry[];
};
