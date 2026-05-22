/**
 * Backtest API client — talks directly to the signal-service on port 8001.
 * The backtest engine is heavy-data so it bypasses the API gateway and the
 * mock-fallback wrapper.
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
  cache: () => call<{ total_series: number; total_bars: number; series: unknown[] }>(
    "/api/v1/backtest/cache",
  ),
};
