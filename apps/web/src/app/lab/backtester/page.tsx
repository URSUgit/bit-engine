"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  createChart,
  ColorType,
  type IChartApi,
  type CandlestickData,
  type SeriesMarker,
  type Time,
} from "lightweight-charts";
import {
  backtestApi,
  type BacktestParams,
  type BacktestResult,
  type StrategyInfo,
  type SymbolEntry,
} from "@/lib/backtest-api";

type Preset = { label: string; days: number };
const PRESETS: Preset[] = [
  { label: "1D", days: 1 },
  { label: "1W", days: 7 },
  { label: "1M", days: 30 },
  { label: "3M", days: 90 },
  { label: "1Y", days: 365 },
  { label: "5Y", days: 365 * 5 },
  { label: "10Y", days: 365 * 10 },
];

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

export default function BacktesterPage() {
  const [symbols, setSymbols] = useState<SymbolEntry[]>([]);
  const [strategies, setStrategies] = useState<StrategyInfo[]>([]);

  const [symbol, setSymbol] = useState("BTC-USD");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [symbolSearch, setSymbolSearch] = useState("");
  const [strategyName, setStrategyName] = useState("rsi");
  const [periodDays, setPeriodDays] = useState(365 * 5);
  const [interval, setInterval] = useState("1d");
  const [initialCapital, setInitialCapital] = useState(10000);
  const [commissionBps, setCommissionBps] = useState(10);
  const [slippageBps, setSlippageBps] = useState(5);
  const [positionPct, setPositionPct] = useState(100);
  const [strategyParams, setStrategyParams] = useState<Record<string, number>>({});

  const [result, setResult] = useState<BacktestResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    backtestApi.symbols().then(setSymbols).catch(console.error);
    backtestApi.strategies().then((s) => {
      setStrategies(s);
      if (s.length > 0) setStrategyName(s[0].name);
    }).catch(console.error);
  }, []);

  useEffect(() => {
    const strat = strategies.find((s) => s.name === strategyName);
    if (!strat) return;
    const defaults: Record<string, number> = {};
    Object.entries(strat.params_schema).forEach(([k, v]) => {
      defaults[k] = v.default;
    });
    setStrategyParams(defaults);
  }, [strategyName, strategies]);

  const currentStrategy = strategies.find((s) => s.name === strategyName);

  const visibleSymbols = useMemo(() => {
    let out = symbols;
    if (categoryFilter !== "all") {
      out = out.filter((s) => s.category === categoryFilter);
    }
    if (symbolSearch.trim()) {
      const q = symbolSearch.toLowerCase();
      out = out.filter((s) => s.symbol.toLowerCase().includes(q));
    }
    return out;
  }, [symbols, categoryFilter, symbolSearch]);

  const categories = useMemo(
    () => Array.from(new Set(symbols.map((s) => s.category))),
    [symbols],
  );

  async function runBacktest() {
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const params: BacktestParams = {
        symbol,
        strategy: strategyName,
        start_date: isoDaysAgo(periodDays),
        end_date: isoDaysAgo(0),
        interval,
        initial_capital: initialCapital,
        commission_pct: commissionBps / 10000,
        slippage_pct: slippageBps / 10000,
        position_size_pct: positionPct / 100,
        strategy_params: strategyParams,
      };
      const r = await backtestApi.run(params);
      setResult(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Backtest failed");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-50 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <header className="border-b border-zinc-800 pb-4">
          <h1 className="text-3xl font-semibold">Backtester</h1>
          <p className="text-zinc-400 text-sm mt-1">
            Test strategies against 10+ years of real market data. {symbols.length} pairs available.
          </p>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6">
          <aside className="space-y-4 bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
            <SymbolPicker
              symbols={visibleSymbols}
              allCategories={categories}
              selectedCategory={categoryFilter}
              onCategoryChange={setCategoryFilter}
              search={symbolSearch}
              onSearchChange={setSymbolSearch}
              selected={symbol}
              onSelect={setSymbol}
              totalCount={symbols.length}
            />

            <PeriodPicker periodDays={periodDays} onChange={setPeriodDays} />

            <IntervalPicker interval={interval} onChange={setInterval} />

            <StrategyPicker
              strategies={strategies}
              selected={strategyName}
              onSelect={setStrategyName}
            />

            {currentStrategy && (
              <StrategyParamsForm
                strategy={currentStrategy}
                values={strategyParams}
                onChange={setStrategyParams}
              />
            )}

            <CostInputs
              capital={initialCapital}
              setCapital={setInitialCapital}
              commissionBps={commissionBps}
              setCommissionBps={setCommissionBps}
              slippageBps={slippageBps}
              setSlippageBps={setSlippageBps}
              positionPct={positionPct}
              setPositionPct={setPositionPct}
            />

            <button
              onClick={runBacktest}
              disabled={running || !symbol || !strategyName}
              className="w-full py-3 rounded-md bg-cyan-500 hover:bg-cyan-400 disabled:bg-zinc-700 disabled:text-zinc-500 text-zinc-950 font-semibold transition"
            >
              {running ? "Running…" : "Run Backtest"}
            </button>

            {error && (
              <div className="text-sm text-red-400 bg-red-950/30 border border-red-900 p-2 rounded">
                {error}
              </div>
            )}
          </aside>

          <main className="space-y-6">
            {!result && !running && <EmptyState />}

            {running && (
              <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-12 text-center text-zinc-400">
                Running backtest… first run on a new symbol takes ~10s for data fetch.
              </div>
            )}

            {result && (
              <>
                <MetricsGrid result={result} />
                <PriceChart result={result} />
                <EquityChart result={result} />
                <TradesTable trades={result.trades} />
              </>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}

function SymbolPicker(props: {
  symbols: SymbolEntry[];
  allCategories: string[];
  selectedCategory: string;
  onCategoryChange: (c: string) => void;
  search: string;
  onSearchChange: (s: string) => void;
  selected: string;
  onSelect: (s: string) => void;
  totalCount: number;
}) {
  return (
    <div className="space-y-2">
      <label className="text-xs font-medium uppercase tracking-wide text-zinc-400">
        Pair
      </label>
      <div className="flex gap-1 flex-wrap">
        <CategoryChip
          active={props.selectedCategory === "all"}
          onClick={() => props.onCategoryChange("all")}
        >
          All ({props.totalCount})
        </CategoryChip>
        {props.allCategories.map((c) => (
          <CategoryChip
            key={c}
            active={props.selectedCategory === c}
            onClick={() => props.onCategoryChange(c)}
          >
            {c}
          </CategoryChip>
        ))}
      </div>
      <input
        type="text"
        value={props.search}
        onChange={(e) => props.onSearchChange(e.target.value)}
        placeholder="Search…"
        className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-md text-sm focus:border-cyan-500 focus:outline-none"
      />
      <select
        value={props.selected}
        onChange={(e) => props.onSelect(e.target.value)}
        size={6}
        className="w-full px-2 py-2 bg-zinc-950 border border-zinc-800 rounded-md text-sm focus:border-cyan-500 focus:outline-none"
      >
        {props.symbols.map((s) => (
          <option key={s.symbol} value={s.symbol}>
            {s.symbol} · {s.category}
          </option>
        ))}
      </select>
    </div>
  );
}

function CategoryChip({
  active, onClick, children,
}: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-2 py-0.5 rounded text-xs transition ${
        active ? "bg-cyan-500 text-zinc-950" : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
      }`}
    >
      {children}
    </button>
  );
}

function PeriodPicker({ periodDays, onChange }: { periodDays: number; onChange: (d: number) => void }) {
  return (
    <div className="space-y-2">
      <label className="text-xs font-medium uppercase tracking-wide text-zinc-400">Period</label>
      <div className="grid grid-cols-4 gap-1">
        {PRESETS.map((p) => (
          <button
            key={p.label}
            onClick={() => onChange(p.days)}
            className={`px-2 py-1.5 rounded text-xs font-medium transition ${
              periodDays === p.days
                ? "bg-cyan-500 text-zinc-950"
                : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function IntervalPicker({ interval, onChange }: { interval: string; onChange: (i: string) => void }) {
  const opts = [
    { v: "1d", l: "Daily" },
    { v: "1wk", l: "Weekly" },
    { v: "1h", l: "Hourly" },
  ];
  return (
    <div className="space-y-2">
      <label className="text-xs font-medium uppercase tracking-wide text-zinc-400">Bar interval</label>
      <div className="grid grid-cols-3 gap-1">
        {opts.map((o) => (
          <button
            key={o.v}
            onClick={() => onChange(o.v)}
            className={`px-2 py-1.5 rounded text-xs font-medium transition ${
              interval === o.v
                ? "bg-cyan-500 text-zinc-950"
                : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
            }`}
          >
            {o.l}
          </button>
        ))}
      </div>
    </div>
  );
}

function StrategyPicker(props: {
  strategies: StrategyInfo[];
  selected: string;
  onSelect: (s: string) => void;
}) {
  const selected = props.strategies.find((s) => s.name === props.selected);
  return (
    <div className="space-y-2">
      <label className="text-xs font-medium uppercase tracking-wide text-zinc-400">Strategy</label>
      <select
        value={props.selected}
        onChange={(e) => props.onSelect(e.target.value)}
        className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-md text-sm focus:border-cyan-500 focus:outline-none"
      >
        {props.strategies.map((s) => (
          <option key={s.name} value={s.name}>{s.name}</option>
        ))}
      </select>
      {selected && (
        <p className="text-xs text-zinc-500 leading-relaxed">{selected.description}</p>
      )}
    </div>
  );
}

function StrategyParamsForm(props: {
  strategy: StrategyInfo;
  values: Record<string, number>;
  onChange: (v: Record<string, number>) => void;
}) {
  const entries = Object.entries(props.strategy.params_schema);
  if (entries.length === 0) return null;
  return (
    <div className="space-y-2 border-t border-zinc-800 pt-3">
      <label className="text-xs font-medium uppercase tracking-wide text-zinc-400">Parameters</label>
      <div className="space-y-2">
        {entries.map(([key, spec]) => (
          <NumberInput
            key={key}
            label={key}
            value={props.values[key] ?? spec.default}
            min={spec.min}
            max={spec.max}
            step={spec.type === "int" ? 1 : 0.1}
            onChange={(v) => props.onChange({ ...props.values, [key]: v })}
          />
        ))}
      </div>
    </div>
  );
}

function CostInputs(props: {
  capital: number; setCapital: (n: number) => void;
  commissionBps: number; setCommissionBps: (n: number) => void;
  slippageBps: number; setSlippageBps: (n: number) => void;
  positionPct: number; setPositionPct: (n: number) => void;
}) {
  return (
    <div className="space-y-2 border-t border-zinc-800 pt-3">
      <label className="text-xs font-medium uppercase tracking-wide text-zinc-400">Costs & sizing</label>
      <NumberInput label="Capital ($)" value={props.capital} min={100} max={10_000_000} step={100} onChange={props.setCapital} />
      <NumberInput label="Commission (bps)" value={props.commissionBps} min={0} max={100} step={1} onChange={props.setCommissionBps} />
      <NumberInput label="Slippage (bps)" value={props.slippageBps} min={0} max={50} step={1} onChange={props.setSlippageBps} />
      <NumberInput label="Position size (%)" value={props.positionPct} min={1} max={100} step={1} onChange={props.setPositionPct} />
    </div>
  );
}

function NumberInput(props: {
  label: string; value: number; min: number; max: number; step: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-zinc-400 flex-1">{props.label}</span>
      <input
        type="number"
        value={props.value}
        min={props.min}
        max={props.max}
        step={props.step}
        onChange={(e) => props.onChange(Number(e.target.value))}
        className="w-24 px-2 py-1 text-xs bg-zinc-950 border border-zinc-800 rounded text-right focus:border-cyan-500 focus:outline-none"
      />
    </div>
  );
}

function MetricsGrid({ result }: { result: BacktestResult }) {
  const m = result.metrics;
  const b = result.benchmark_metrics;
  const beats = b ? m.total_return_pct > b.total_return_pct : false;
  return (
    <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-4">
        <div>
          <h3 className="font-semibold">{result.symbol} · {result.strategy}</h3>
          <p className="text-xs text-zinc-500">
            {result.start_date} → {result.end_date} · {result.bars_processed} bars · {result.runtime_ms}ms
          </p>
        </div>
        {b && (
          <div className={`text-xs px-2 py-1 rounded ${beats ? "bg-emerald-900/40 text-emerald-300" : "bg-zinc-800 text-zinc-400"}`}>
            {beats ? "Beats" : "Underperforms"} buy-and-hold ({b.total_return_pct >= 0 ? "+" : ""}{b.total_return_pct.toFixed(1)}%)
          </div>
        )}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricCard label="Total return" value={`${m.total_return_pct >= 0 ? "+" : ""}${m.total_return_pct.toFixed(2)}%`} positive={m.total_return_pct >= 0} />
        <MetricCard label="CAGR" value={`${m.cagr_pct >= 0 ? "+" : ""}${m.cagr_pct.toFixed(2)}%`} positive={m.cagr_pct >= 0} />
        <MetricCard label="Sharpe" value={m.sharpe_ratio.toFixed(2)} positive={m.sharpe_ratio >= 1} />
        <MetricCard label="Sortino" value={m.sortino_ratio.toFixed(2)} positive={m.sortino_ratio >= 1} />
        <MetricCard label="Max drawdown" value={`-${m.max_drawdown_pct.toFixed(2)}%`} positive={false} muted />
        <MetricCard label="Calmar" value={m.calmar_ratio.toFixed(2)} positive={m.calmar_ratio >= 1} />
        <MetricCard label="Win rate" value={`${m.win_rate_pct.toFixed(1)}%`} positive={m.win_rate_pct >= 50} />
        <MetricCard label="Profit factor" value={m.profit_factor.toFixed(2)} positive={m.profit_factor >= 1} />
        <MetricCard label="Trades" value={`${m.total_trades}`} positive />
        <MetricCard label="Wins / Losses" value={`${m.winning_trades} / ${m.losing_trades}`} positive />
        <MetricCard label="Avg trade" value={`${m.avg_trade_pnl_pct >= 0 ? "+" : ""}${m.avg_trade_pnl_pct.toFixed(2)}%`} positive={m.avg_trade_pnl_pct >= 0} />
        <MetricCard label="Final equity" value={`$${m.final_equity.toLocaleString(undefined, { maximumFractionDigits: 0 })}`} positive={m.final_equity > m.initial_capital} />
      </div>
    </div>
  );
}

function MetricCard({ label, value, positive, muted }: { label: string; value: string; positive: boolean; muted?: boolean }) {
  const color = muted ? "text-zinc-400" : positive ? "text-emerald-400" : "text-red-400";
  return (
    <div className="bg-zinc-950 border border-zinc-800 rounded p-3">
      <div className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</div>
      <div className={`text-lg font-semibold mt-1 ${color}`}>{value}</div>
    </div>
  );
}

function PriceChart({ result }: { result: BacktestResult }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const [bars, setBars] = useState<CandlestickData[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    backtestApi
      .data(result.symbol, result.start_date, result.end_date, result.interval)
      .then((d) => {
        if (cancelled) return;
        setBars(
          d.bars.map((b) => ({
            time: b.t as Time,
            open: b.o, high: b.h, low: b.l, close: b.c,
          })),
        );
      })
      .catch((e) => console.error("PriceChart data fetch failed", e));
    return () => { cancelled = true; };
  }, [result.symbol, result.start_date, result.end_date, result.interval]);

  useEffect(() => {
    if (!containerRef.current || !bars) return;

    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: 420,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#a1a1aa",
      },
      grid: {
        vertLines: { color: "#27272a" },
        horzLines: { color: "#27272a" },
      },
      timeScale: { borderColor: "#27272a", timeVisible: true },
      rightPriceScale: { borderColor: "#27272a" },
    });
    chartRef.current = chart;

    const series = chart.addCandlestickSeries({
      upColor: "#10b981", downColor: "#ef4444",
      borderUpColor: "#10b981", borderDownColor: "#ef4444",
      wickUpColor: "#10b981", wickDownColor: "#ef4444",
    });
    series.setData(bars);

    const markers: SeriesMarker<Time>[] = [];
    for (const t of result.trades) {
      const entryTs = Math.floor(new Date(t.entry_time).getTime() / 1000) as Time;
      const exitTs = Math.floor(new Date(t.exit_time).getTime() / 1000) as Time;
      markers.push({
        time: entryTs,
        position: "belowBar",
        color: "#06b6d4",
        shape: "arrowUp",
        text: `BUY ${t.entry_price.toFixed(2)}`,
      });
      markers.push({
        time: exitTs,
        position: "aboveBar",
        color: t.pnl >= 0 ? "#10b981" : "#ef4444",
        shape: "arrowDown",
        text: `SELL ${t.exit_price.toFixed(2)} (${t.pnl_pct >= 0 ? "+" : ""}${t.pnl_pct.toFixed(1)}%)`,
      });
    }
    markers.sort((a, b) => Number(a.time) - Number(b.time));
    series.setMarkers(markers);
    chart.timeScale().fitContent();

    const onResize = () => {
      if (containerRef.current && chartRef.current) {
        chartRef.current.applyOptions({ width: containerRef.current.clientWidth });
      }
    };
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      chart.remove();
      chartRef.current = null;
    };
  }, [bars, result.trades]);

  return (
    <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
      <h3 className="font-semibold mb-3">Price + Trades</h3>
      <div ref={containerRef} className="w-full" />
      {!bars && <div className="text-zinc-500 text-sm py-8 text-center">Loading price data…</div>}
    </div>
  );
}

function EquityChart({ result }: { result: BacktestResult }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: 260,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#a1a1aa",
      },
      grid: {
        vertLines: { color: "#27272a" },
        horzLines: { color: "#27272a" },
      },
      timeScale: { borderColor: "#27272a", timeVisible: true },
      rightPriceScale: { borderColor: "#27272a" },
    });

    const equitySeries = chart.addAreaSeries({
      topColor: "rgba(6, 182, 212, 0.4)",
      bottomColor: "rgba(6, 182, 212, 0.05)",
      lineColor: "#06b6d4",
      lineWidth: 2,
      priceLineVisible: false,
    });
    equitySeries.setData(
      result.equity_curve.map((p) => ({ time: p.t as Time, value: p.equity })),
    );

    const ddSeries = chart.addLineSeries({
      color: "#ef4444",
      lineWidth: 1,
      priceScaleId: "left",
    });
    chart.priceScale("left").applyOptions({ borderColor: "#27272a", visible: true });
    ddSeries.setData(
      result.equity_curve.map((p) => ({ time: p.t as Time, value: -p.drawdown_pct })),
    );

    chart.timeScale().fitContent();

    const onResize = () => {
      if (containerRef.current) {
        chart.applyOptions({ width: containerRef.current.clientWidth });
      }
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      chart.remove();
    };
  }, [result.equity_curve]);

  return (
    <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
      <h3 className="font-semibold mb-3">
        Equity curve <span className="text-zinc-500 text-xs ml-2">(cyan: portfolio · red: drawdown %)</span>
      </h3>
      <div ref={containerRef} className="w-full" />
    </div>
  );
}

function TradesTable({ trades }: { trades: BacktestResult["trades"] }) {
  if (trades.length === 0) {
    return (
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4 text-zinc-500 text-sm">
        No trades executed.
      </div>
    );
  }
  return (
    <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
      <h3 className="font-semibold mb-3">Trades ({trades.length})</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-zinc-500 uppercase tracking-wide border-b border-zinc-800">
              <th className="py-2 pr-3">#</th>
              <th className="py-2 pr-3">Entry</th>
              <th className="py-2 pr-3">Exit</th>
              <th className="py-2 pr-3 text-right">Entry $</th>
              <th className="py-2 pr-3 text-right">Exit $</th>
              <th className="py-2 pr-3 text-right">Bars</th>
              <th className="py-2 pr-3 text-right">P&L $</th>
              <th className="py-2 text-right">P&L %</th>
            </tr>
          </thead>
          <tbody>
            {trades.map((t, i) => {
              const win = t.pnl >= 0;
              return (
                <tr key={i} className="border-b border-zinc-800/60">
                  <td className="py-2 pr-3 text-zinc-500">{i + 1}</td>
                  <td className="py-2 pr-3 text-zinc-300">{t.entry_time.slice(0, 10)}</td>
                  <td className="py-2 pr-3 text-zinc-300">{t.exit_time.slice(0, 10)}</td>
                  <td className="py-2 pr-3 text-right text-zinc-300">{t.entry_price.toLocaleString(undefined, { maximumFractionDigits: 4 })}</td>
                  <td className="py-2 pr-3 text-right text-zinc-300">{t.exit_price.toLocaleString(undefined, { maximumFractionDigits: 4 })}</td>
                  <td className="py-2 pr-3 text-right text-zinc-500">{t.duration_bars}</td>
                  <td className={`py-2 pr-3 text-right ${win ? "text-emerald-400" : "text-red-400"}`}>
                    {win ? "+" : ""}{t.pnl.toFixed(2)}
                  </td>
                  <td className={`py-2 text-right ${win ? "text-emerald-400" : "text-red-400"}`}>
                    {win ? "+" : ""}{t.pnl_pct.toFixed(2)}%
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="bg-zinc-900/30 border border-dashed border-zinc-800 rounded-lg p-12 text-center">
      <h3 className="text-xl font-medium text-zinc-300 mb-2">Pick a pair and hit Run</h3>
      <p className="text-sm text-zinc-500 max-w-md mx-auto">
        Test any strategy against 10+ years of real market data. You&apos;ll see
        the price chart with trade entries/exits, equity curve, drawdown, and
        12 performance metrics including Sharpe, Sortino, and Calmar.
      </p>
    </div>
  );
}
