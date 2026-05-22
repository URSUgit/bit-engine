/**
 * Backtest API client — talks directly to the signal-service on port 8001.
 */

const BACKTEST_BASE =
  process.env.NEXT_PUBLIC_SIGNAL_SERVICE_URL ?? "http://localhost:8001";

export type SymbolEntry = { symbol: string; category: string };

export type StrategyParamSpec = {
  type: "int" | "float";
  default: number;
  min: number;
  max: number;
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
};

export type CompareResult = {
  symbol: string;
  success: boolean;
  result: BacktestResult | null;
  error: string | null;
};

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
  cache: () => call<{ total_series: number; total_bars: number; series: unknown[] }>(
    "/api/v1/backtest/cache",
  ),
};
