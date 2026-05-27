"use client";

import { useEffect, useMemo, useState } from "react";
import {
  backtestApi,
  type BacktestParams,
  type BacktestResult,
  type CompareResult,
  type OptimizeResult,
  type StrategyInfo,
  type SymbolEntry,
  type HistoryRow,
} from "@/lib/backtest-api";
import {
  CostInputs, IntervalPicker, PeriodPicker, StrategyParamsForm,
  StrategyPicker, NumberInput, isoDaysAgo,
} from "./components/shared";
import { SymbolPicker, MultiSymbolPicker } from "./components/symbol-picker";
import { MetricsGrid, PriceChart, EquityChart, TradesTable, EntryAnalysisPanel } from "./components/results";
import { MetadataPanel } from "./components/metadata-panel";
import { CompareTable } from "./components/compare-table";
import { OptimizeHeatmap } from "./components/optimize-heatmap";

type Mode = "single" | "compare" | "optimize" | "history";

export default function BacktesterPage() {
  const [mode, setMode] = useState<Mode>("single");

  // Shared state
  const [symbols, setSymbols] = useState<SymbolEntry[]>([]);
  const [strategies, setStrategies] = useState<StrategyInfo[]>([]);
  const [strategyName, setStrategyName] = useState("rsi");
  const [periodDays, setPeriodDays] = useState(365 * 5);
  const [interval, setIntervalValue] = useState("1d");
  const [initialCapital, setInitialCapital] = useState(10000);
  const [commissionBps, setCommissionBps] = useState(10);
  const [slippageBps, setSlippageBps] = useState(5);
  const [positionPct, setPositionPct] = useState(100);
  const [strategyParams, setStrategyParams] = useState<Record<string, number>>({});

  // Mode-specific
  const [singleSymbol, setSingleSymbol] = useState("BTC-USD");
  const [compareSymbols, setCompareSymbols] = useState<string[]>(["BTC-USD", "ETH-USD", "SOL-USD"]);
  const [optimizeSymbol, setOptimizeSymbol] = useState("BTC-USD");
  const [optimizeMetric, setOptimizeMetric] = useState("sharpe_ratio");

  // Picker UI state
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [symbolSearch, setSymbolSearch] = useState("");

  // Results
  const [singleResult, setSingleResult] = useState<BacktestResult | null>(null);
  const [compareResults, setCompareResults] = useState<CompareResult[] | null>(null);
  const [optimizeResult, setOptimizeResult] = useState<OptimizeResult | null>(null);
  const [history, setHistory] = useState<HistoryRow[]>([]);

  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load symbols + strategies on mount
  useEffect(() => {
    backtestApi.symbols().then(setSymbols).catch(console.error);
    backtestApi.strategies().then((s) => {
      setStrategies(s);
      if (s.length > 0) setStrategyName(s[0].name);
    }).catch(console.error);
  }, []);

  // Reset strategy params when strategy changes
  useEffect(() => {
    const strat = strategies.find((s) => s.name === strategyName);
    if (!strat) return;
    const defaults: Record<string, number> = {};
    Object.entries(strat.params_schema).forEach(([k, v]) => { defaults[k] = v.default; });
    setStrategyParams(defaults);
  }, [strategyName, strategies]);

  // Refresh history list when entering History tab
  useEffect(() => {
    if (mode === "history") {
      backtestApi.history(100).then((d) => setHistory(d.runs)).catch(console.error);
    }
  }, [mode]);

  const currentStrategy = strategies.find((s) => s.name === strategyName);

  const visibleSymbols = useMemo(() => {
    let out = symbols;
    if (categoryFilter !== "all") out = out.filter((s) => s.category === categoryFilter);
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

  // ─── Run handlers ──────────────────────────────────────────────────────

  async function runSingle() {
    setRunning(true);
    setError(null);
    setSingleResult(null);
    try {
      const params: BacktestParams = {
        symbol: singleSymbol, strategy: strategyName,
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
      setSingleResult(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setRunning(false); }
  }

  async function runCompare() {
    if (compareSymbols.length === 0) { setError("Pick at least one pair"); return; }
    setRunning(true);
    setError(null);
    setCompareResults(null);
    try {
      const r = await backtestApi.compare({
        symbols: compareSymbols,
        strategy: strategyName,
        start_date: isoDaysAgo(periodDays),
        end_date: isoDaysAgo(0),
        interval,
        initial_capital: initialCapital,
        commission_pct: commissionBps / 10000,
        slippage_pct: slippageBps / 10000,
        position_size_pct: positionPct / 100,
        strategy_params: strategyParams,
      });
      setCompareResults(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setRunning(false); }
  }

  async function runOptimize() {
    if (!currentStrategy || Object.keys(currentStrategy.params_schema).length === 0) {
      setError("This strategy has no parameters to optimize"); return;
    }
    setRunning(true);
    setError(null);
    setOptimizeResult(null);
    try {
      // Auto-generate param ranges from schema defaults: span ~50% around default
      const paramRanges = Object.entries(currentStrategy.params_schema).slice(0, 2).map(([name, spec]) => {
        const range = spec.max - spec.min;
        const step = spec.type === "int" ? Math.max(1, Math.round(range / 8)) : range / 8;
        const start = Math.max(spec.min, spec.default - range * 0.3);
        const stop = Math.min(spec.max, spec.default + range * 0.3);
        return { name, start, stop, step };
      });
      const r = await backtestApi.optimize({
        symbol: optimizeSymbol,
        strategy: strategyName,
        start_date: isoDaysAgo(periodDays),
        end_date: isoDaysAgo(0),
        interval,
        initial_capital: initialCapital,
        commission_pct: commissionBps / 10000,
        slippage_pct: slippageBps / 10000,
        position_size_pct: positionPct / 100,
        param_ranges: paramRanges,
        metric: optimizeMetric,
        max_combinations: 400,
      });
      setOptimizeResult(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setRunning(false); }
  }

  async function openHistoryRun(id: string) {
    setRunning(true);
    setError(null);
    try {
      const r = await backtestApi.getHistoryRun(id);
      setSingleResult(r);
      setMode("single");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setRunning(false); }
  }

  async function deleteHistoryRun(id: string) {
    try {
      await backtestApi.deleteHistoryRun(id);
      setHistory((h) => h.filter((r) => r.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function toggleCompareSymbol(sym: string) {
    setCompareSymbols((cur) =>
      cur.includes(sym) ? cur.filter((s) => s !== sym) : [...cur, sym].slice(0, 20),
    );
  }

  const onRun = () => {
    if (mode === "single") runSingle();
    else if (mode === "compare") runCompare();
    else if (mode === "optimize") runOptimize();
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-50 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <header className="border-b border-zinc-800 pb-4">
          <h1 className="text-3xl font-semibold">Backtester</h1>
          <p className="text-zinc-400 text-sm mt-1">
            {symbols.length} pairs · {strategies.length} strategies · 10+ years of daily data · second-granular for crypto
          </p>
        </header>

        <ModeTabs mode={mode} onChange={setMode} />

        {mode === "history" ? (
          <HistoryView
            rows={history}
            onOpen={openHistoryRun}
            onDelete={deleteHistoryRun}
          />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6">
            {/* ─── Control panel ─── */}
            <aside className="space-y-4 bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
              {mode === "single" && (
                <SymbolPicker
                  symbols={visibleSymbols}
                  allCategories={categories}
                  selectedCategory={categoryFilter}
                  onCategoryChange={setCategoryFilter}
                  search={symbolSearch}
                  onSearchChange={setSymbolSearch}
                  selected={singleSymbol}
                  onSelect={setSingleSymbol}
                  totalCount={symbols.length}
                />
              )}
              {mode === "compare" && (
                <MultiSymbolPicker
                  symbols={visibleSymbols}
                  allCategories={categories}
                  selectedCategory={categoryFilter}
                  onCategoryChange={setCategoryFilter}
                  search={symbolSearch}
                  onSearchChange={setSymbolSearch}
                  selected={compareSymbols}
                  onToggle={toggleCompareSymbol}
                  onClear={() => setCompareSymbols([])}
                  totalCount={symbols.length}
                />
              )}
              {mode === "optimize" && (
                <SymbolPicker
                  symbols={visibleSymbols}
                  allCategories={categories}
                  selectedCategory={categoryFilter}
                  onCategoryChange={setCategoryFilter}
                  search={symbolSearch}
                  onSearchChange={setSymbolSearch}
                  selected={optimizeSymbol}
                  onSelect={setOptimizeSymbol}
                  totalCount={symbols.length}
                />
              )}

              <PeriodPicker periodDays={periodDays} onChange={setPeriodDays} />
              <IntervalPicker interval={interval} onChange={setIntervalValue} />
              <StrategyPicker
                strategies={strategies}
                selected={strategyName}
                onSelect={setStrategyName}
              />

              {mode !== "optimize" && currentStrategy && (
                <StrategyParamsForm
                  strategy={currentStrategy}
                  values={strategyParams}
                  onChange={setStrategyParams}
                />
              )}

              {mode === "optimize" && (
                <div className="space-y-2 border-t border-zinc-800 pt-3">
                  <label className="text-xs font-medium uppercase tracking-wide text-zinc-400">
                    Optimization
                  </label>
                  <select
                    value={optimizeMetric}
                    onChange={(e) => setOptimizeMetric(e.target.value)}
                    className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-md text-sm focus:border-cyan-500 focus:outline-none"
                  >
                    <option value="sharpe_ratio">Maximize Sharpe</option>
                    <option value="sortino_ratio">Maximize Sortino</option>
                    <option value="total_return_pct">Maximize total return</option>
                    <option value="cagr_pct">Maximize CAGR</option>
                    <option value="calmar_ratio">Maximize Calmar</option>
                    <option value="profit_factor">Maximize profit factor</option>
                    <option value="win_rate_pct">Maximize win rate</option>
                  </select>
                  <p className="text-xs text-zinc-500 leading-relaxed">
                    Grid search across the first 2 strategy params · ~50 combinations
                  </p>
                </div>
              )}

              <CostInputs
                capital={initialCapital} setCapital={setInitialCapital}
                commissionBps={commissionBps} setCommissionBps={setCommissionBps}
                slippageBps={slippageBps} setSlippageBps={setSlippageBps}
                positionPct={positionPct} setPositionPct={setPositionPct}
              />

              <button
                onClick={onRun}
                disabled={running}
                className="w-full py-3 rounded-md bg-cyan-500 hover:bg-cyan-400 disabled:bg-zinc-700 disabled:text-zinc-500 text-zinc-950 font-semibold transition"
              >
                {running ? "Running…" :
                 mode === "single" ? "Run Backtest" :
                 mode === "compare" ? `Compare ${compareSymbols.length} pairs` :
                 "Optimize Parameters"}
              </button>

              {error && (
                <div className="text-sm text-red-400 bg-red-950/30 border border-red-900 p-2 rounded">
                  {error}
                </div>
              )}
            </aside>

            {/* ─── Results pane ─── */}
            <main className="space-y-6">
              {mode === "single" && (
                <SingleResultsView symbol={singleSymbol} result={singleResult} running={running} />
              )}
              {mode === "compare" && (
                <CompareResultsView results={compareResults} running={running} />
              )}
              {mode === "optimize" && (
                <OptimizeResultsView result={optimizeResult} running={running} />
              )}
            </main>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Mode tabs ────────────────────────────────────────────────────────────────

function ModeTabs({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  const tabs: { value: Mode; label: string; hint: string }[] = [
    { value: "single", label: "Single", hint: "One pair, full charts" },
    { value: "compare", label: "Compare", hint: "Up to 20 pairs side-by-side" },
    { value: "optimize", label: "Optimize", hint: "Find best parameters" },
    { value: "history", label: "History", hint: "Past runs" },
  ];
  return (
    <div className="flex gap-1 bg-zinc-900/50 border border-zinc-800 rounded-lg p-1">
      {tabs.map((t) => (
        <button
          key={t.value}
          onClick={() => onChange(t.value)}
          className={`flex-1 px-3 py-2 rounded-md text-sm font-medium transition ${
            mode === t.value
              ? "bg-cyan-500 text-zinc-950"
              : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
          }`}
        >
          {t.label}
          <span className="block text-[10px] opacity-70 font-normal">{t.hint}</span>
        </button>
      ))}
    </div>
  );
}

// ─── Result view components ───────────────────────────────────────────────────

function SingleResultsView({ symbol, result, running }: { symbol: string; result: BacktestResult | null; running: boolean }) {
  return (
    <>
      <MetadataPanel symbol={symbol} />
      {!result && !running && (
        <div className="bg-zinc-900/30 border border-dashed border-zinc-800 rounded-lg p-12 text-center">
          <h3 className="text-xl font-medium text-zinc-300 mb-2">Pick a pair and hit Run</h3>
          <p className="text-sm text-zinc-500 max-w-md mx-auto">
            Charts, 12 performance metrics, every trade marked on the candlestick chart.
          </p>
        </div>
      )}
      {running && (
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-12 text-center text-zinc-400">
          Running backtest… first run takes ~10s for data fetch.
        </div>
      )}
      {result && (
        <>
          <MetricsGrid result={result} />
          <PriceChart result={result} />
          <EquityChart result={result} />
          <TradesTable trades={result.trades} />
          {result.entry_analysis && (
            <EntryAnalysisPanel analysis={result.entry_analysis} />
          )}
        </>
      )}
    </>
  );
}

function CompareResultsView({ results, running }: { results: CompareResult[] | null; running: boolean }) {
  if (running) {
    return (
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-12 text-center text-zinc-400">
        Running parallel backtests on all selected pairs… (~15-30s total)
      </div>
    );
  }
  if (!results) {
    return (
      <div className="bg-zinc-900/30 border border-dashed border-zinc-800 rounded-lg p-12 text-center">
        <h3 className="text-xl font-medium text-zinc-300 mb-2">Select pairs and hit Compare</h3>
        <p className="text-sm text-zinc-500 max-w-md mx-auto">
          Runs the same strategy across all selected pairs in parallel.
          Results sorted by Sharpe ratio so you instantly see which pairs work best.
        </p>
      </div>
    );
  }
  return <CompareTable rows={results} />;
}

function OptimizeResultsView({ result, running }: { result: OptimizeResult | null; running: boolean }) {
  if (running) {
    return (
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-12 text-center text-zinc-400">
        Sweeping parameter grid… up to 400 combinations
      </div>
    );
  }
  if (!result) {
    return (
      <div className="bg-zinc-900/30 border border-dashed border-zinc-800 rounded-lg p-12 text-center">
        <h3 className="text-xl font-medium text-zinc-300 mb-2">Find the best parameters automatically</h3>
        <p className="text-sm text-zinc-500 max-w-md mx-auto">
          Grid-search across the first 2 strategy parameters and visualize
          which combination maximizes your chosen metric.
        </p>
      </div>
    );
  }
  return <OptimizeHeatmap result={result} />;
}

function HistoryView({
  rows, onOpen, onDelete,
}: { rows: HistoryRow[]; onOpen: (id: string) => void; onDelete: (id: string) => void }) {
  if (rows.length === 0) {
    return (
      <div className="bg-zinc-900/30 border border-dashed border-zinc-800 rounded-lg p-12 text-center">
        <h3 className="text-xl font-medium text-zinc-300 mb-2">No saved runs yet</h3>
        <p className="text-sm text-zinc-500">Every backtest you run is automatically saved here.</p>
      </div>
    );
  }
  return (
    <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
      <h3 className="font-semibold mb-3">Backtest history ({rows.length} runs)</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-zinc-500 uppercase tracking-wide border-b border-zinc-800">
              <th className="py-2 pr-3">Date</th>
              <th className="py-2 pr-3">Symbol</th>
              <th className="py-2 pr-3">Strategy</th>
              <th className="py-2 pr-3">Interval</th>
              <th className="py-2 pr-3 text-right">Return</th>
              <th className="py-2 pr-3 text-right">Sharpe</th>
              <th className="py-2 pr-3 text-right">Max DD</th>
              <th className="py-2 pr-3 text-right">Trades</th>
              <th className="py-2 text-right"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-zinc-800/60 hover:bg-zinc-800/30 cursor-pointer">
                <td className="py-2 pr-3 text-zinc-400 text-xs">
                  {new Date(r.created_at * 1000).toLocaleString()}
                </td>
                <td className="py-2 pr-3 text-zinc-200 font-medium">{r.symbol}</td>
                <td className="py-2 pr-3 text-zinc-300">{r.strategy}</td>
                <td className="py-2 pr-3 text-zinc-500 text-xs">{r.interval}</td>
                <td className={`py-2 pr-3 text-right ${r.total_return_pct >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                  {r.total_return_pct >= 0 ? "+" : ""}{r.total_return_pct.toFixed(2)}%
                </td>
                <td className="py-2 pr-3 text-right text-zinc-300">{r.sharpe.toFixed(2)}</td>
                <td className="py-2 pr-3 text-right text-red-400">-{r.max_drawdown_pct.toFixed(1)}%</td>
                <td className="py-2 pr-3 text-right text-zinc-500">{r.total_trades}</td>
                <td className="py-2 text-right">
                  <button
                    onClick={() => onOpen(r.id)}
                    className="text-cyan-400 hover:text-cyan-300 text-xs mr-3"
                  >
                    Open
                  </button>
                  <button
                    onClick={() => onDelete(r.id)}
                    className="text-zinc-500 hover:text-red-400 text-xs"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
