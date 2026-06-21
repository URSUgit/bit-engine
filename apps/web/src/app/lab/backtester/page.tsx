"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  backtestApi,
  runBacktestStream,
  compareStream,
  type BacktestParams,
  type BacktestResult,
  type CompareResult,
  type OptimizeResult,
  type StrategyInfo,
  type SymbolEntry,
  type HistoryRow,
  type StreamProgressEvent,
  type LiveSignal,
  type Anomaly,
  type FrictionBreakdown,
  type SignalValidation,
} from "@/lib/backtest-api";
import {
  CostInputs, IntervalPicker, PeriodPicker, StrategyParamsForm,
  StrategyPicker, NumberInput, isoDaysAgo, assetClassForCategory,
} from "./components/shared";
import type { IntervalInfo } from "@/lib/backtest-api";
import { SymbolPicker, MultiSymbolPicker } from "./components/symbol-picker";
import { MetricsGrid, PriceChart, EquityChart, TradesTable, EntryAnalysisPanel } from "./components/results";
import { TradeEditor } from "./components/trade-editor";
import { MonthlyBreakdown } from "./components/monthly-breakdown";
import { MetadataPanel } from "./components/metadata-panel";
import { CompareTable } from "./components/compare-table";
import { OptimizeHeatmap } from "./components/optimize-heatmap";
import { DataStatusTab } from "./components/data-status";
import { StrategyScannerView } from "./components/strategy-scanner";
import { BacktesterChat } from "./components/chat-panel";
import { MonteCarloPanel } from "./components/monte-carlo";
import { ForwardTest } from "./components/forward-test";
import { KeyboardShortcutsLayer } from "./components/keyboard-shortcuts";
import { WalkForwardPanel } from "./components/walk-forward";
import { CustomStrategyEditor } from "./components/custom-strategy-editor";
import { ConditionBuilder } from "./components/condition-builder";
import { PortfolioView } from "./components/portfolio-view";
import { RollingAnalysisPanel } from "./components/rolling-analysis";
import { HeatCalendar } from "./components/heat-calendar";
import { KellyPanel } from "./components/kelly-panel";
import { SensitivityChart } from "./components/sensitivity-chart";
import { RegimeAnalysis } from "./components/regime-analysis";
import { StrategyLeaderboard } from "./components/strategy-leaderboard";
import { RiskAnalyticsPanel } from "./components/risk-analytics";
import { EfficientFrontier } from "./components/efficient-frontier";
import { PerformanceAttribution } from "./components/performance-attribution";
import { SymbolScanner } from "./components/symbol-scanner";
import { DrawdownAnalysis } from "./components/drawdown-analysis";
import { ConfigPresets, type BacktestConfig } from "./components/config-presets";
import { TradeJournal } from "./components/trade-journal";
import { MultiTimeframePanel } from "./components/multi-timeframe";
import { Watchlist } from "./components/watchlist";
import { StrategyRadar } from "./components/strategy-radar";
import { ResultSnapshot } from "./components/result-snapshot";
import { ParamTuner } from "./components/param-tuner";
import { useAutoSaveResults } from "@/lib/use-auto-save-results";
import { RecentHistory } from "./components/recent-history";
import { RegimeBadge } from "./components/regime-badge";
import { RobustnessTest } from "./components/robustness-test";
import { PositionSizer } from "./components/position-sizer";
import { FactorExposure } from "./components/factor-exposure";
import { TradeTimingAnalysis } from "./components/trade-timing";
import { StrategyMatrix } from "./components/strategy-matrix";
import { DiversificationPanel } from "./components/diversification";
import { ReportExport } from "./components/report-export";
import { LivePnlSimulator } from "./components/live-pnl-simulator";
import { MarketCorrelation } from "./components/market-correlation";
import { TradeStreakAnalyzer } from "./components/trade-streak";
import { ProfitDistribution } from "./components/profit-distribution";
import { StrategyBenchmark } from "./components/strategy-benchmark";
import { EnsemblePanel } from "./components/ensemble-panel";
import { IntradayHeatmap } from "./components/intraday-heatmap";
import { TradeQuality } from "./components/trade-quality";
import { BenchmarkTracker } from "./components/benchmark-tracker";
import { ScenarioComparator } from "./components/scenario-comparator";
import { TradeAutocorrelation } from "./components/trade-autocorrelation";
import { MaeMfeAnalysis } from "./components/mae-mfe-analysis";
import { PineScriptExport } from "./components/pinescript-export";
import { BreakevenAnalysis } from "./components/breakeven-analysis";

type Mode = "single" | "compare" | "optimize" | "scan" | "history" | "data" | "signals" | "forward" | "custom" | "portfolio" | "matrix";
type ResultTab = "charts" | "editor" | "trades" | "analysis" | "friction" | "anomalies" | "monthly" | "montecarlo" | "walk_forward" | "rolling" | "calendar" | "sensitivity" | "regime" | "risk" | "attribution" | "drawdown" | "journal" | "multi_tf" | "robustness" | "factor" | "timing" | "report" | "pnl_sim" | "mkt_corr" | "streaks" | "dist" | "benchmark" | "heatmap" | "quality" | "perf_track" | "scenarios" | "autocorr" | "mae_mfe" | "pine" | "breakeven";

const MODE_ORDER: Mode[] = ["single", "compare", "optimize", "scan", "signals", "history", "data", "custom", "portfolio", "matrix"];

export default function BacktesterPage() {
  const [mode, setMode] = useState<Mode>("single");

  // Shared state
  const [symbols, setSymbols] = useState<SymbolEntry[]>([]);
  const [intervalInfos, setIntervalInfos] = useState<IntervalInfo[]>([]);
  const [strategies, setStrategies] = useState<StrategyInfo[]>([]);
  const [strategyName, setStrategyName] = useState("rsi");
  const [periodDays, setPeriodDays] = useState(365);
  const [interval, setIntervalValue] = useState("1d");
  const [initialCapital, setInitialCapital] = useState(10000);
  const [commissionPct, setCommissionPct] = useState(0.1);
  const [slippagePct, setSlippagePct] = useState(0.05);
  const [positionPct, setPositionPct] = useState(25);
  const [strategyParams, setStrategyParams] = useState<Record<string, number>>({});

  // Mode-specific — default to BTCUSDT so demo-seeded data is used immediately
  const [singleSymbol, setSingleSymbol] = useState("BTCUSDT");
  const [compareSymbols, setCompareSymbols] = useState<string[]>(["BTCUSDT", "ETHUSDT", "SOLUSDT"]);
  const [optimizeSymbol, setOptimizeSymbol] = useState("BTCUSDT");
  const [optimizeMetric, setOptimizeMetric] = useState("sharpe_ratio");

  // Custom symbols added via Data tab
  const [customSymbols, setCustomSymbols] = useState<string[]>([]);

  // Picker UI state
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [symbolSearch, setSymbolSearch] = useState("");

  // Results
  const [singleResult, setSingleResult] = useState<BacktestResult | null>(null);
  const [compareResults, setCompareResults] = useState<CompareResult[] | null>(null);
  const [compareProgress, setCompareProgress] = useState<{ completed: number; total: number } | null>(null);
  const [optimizeResult, setOptimizeResult] = useState<OptimizeResult | null>(null);
  const [history, setHistory] = useState<HistoryRow[]>([]);

  // Strategy comparison (all strategies for one symbol)
  const [stratCompareResults, setStratCompareResults] = useState<{ strategy: string; result: BacktestResult | null; error: string | null }[] | null>(null);
  const [stratCompareRunning, setStratCompareRunning] = useState(false);

  // Realism config
  const [spreadBps, setSpreadBps] = useState(0);
  const [leverage, setLeverage] = useState(1.0);
  const [latencyMs, setLatencyMs] = useState(0);
  const [enableMarketImpact, setEnableMarketImpact] = useState(false);
  const [useFundingRates, setUseFundingRates] = useState(false);
  const [runAnomalyScan, setRunAnomalyScan] = useState(false);
  const [realismOpen, setRealismOpen] = useState(false);

  // Result tab
  const [resultTab, setResultTab] = useState<ResultTab>("charts");

  // Custom mode sub-tab
  const [customTab, setCustomTab] = useState<"code" | "builder">("builder");

  // Live signals
  const [liveSignals, setLiveSignals] = useState<LiveSignal[] | null>(null);
  const [liveSignalsLoading, setLiveSignalsLoading] = useState(false);
  const [liveSignalsError, setLiveSignalsError] = useState<string | null>(null);
  const [liveSignalsAutoRefresh, setLiveSignalsAutoRefresh] = useState(false);
  const [liveSignalsRefreshSec, setLiveSignalsRefreshSec] = useState(30);
  const [liveSignalsCountdown, setLiveSignalsCountdown] = useState(0);
  const liveSignalsTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<StreamProgressEvent | null>(null);
  const startTimeRef = useRef<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);

  // Auto-save results history
  const { history: autoHistory, push: autoSave, remove: autoRemove, clear: autoClear } = useAutoSaveResults();

  // Auto-run on param change
  const [autoRun, setAutoRun] = useState(false);
  const [autoRunPending, setAutoRunPending] = useState(false);
  const autoRunTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load symbols + strategies on mount
  useEffect(() => {
    backtestApi.symbols().then(setSymbols).catch(console.error);
    backtestApi.intervals().then((d) => setIntervalInfos(d.intervals)).catch(console.error);
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
    Object.entries(strat.params_schema).forEach(([k, v]) => {
      defaults[k] = typeof v.default === "boolean" ? (v.default ? 1 : 0) : v.default;
    });
    setStrategyParams(defaults);
  }, [strategyName, strategies]);

  // Refresh history list when entering History tab
  useEffect(() => {
    if (mode === "history") {
      backtestApi.history(100).then((d) => setHistory(d.runs)).catch(console.error);
    }
  }, [mode]);

  // Drop a stale result when the selected symbol no longer matches it, so the
  // chart never shows a previous symbol's backtest (e.g. BTC while AAPL is picked).
  useEffect(() => {
    setSingleResult((prev) => (prev && prev.symbol !== singleSymbol ? null : prev));
  }, [singleSymbol]);

  const currentStrategy = strategies.find((s) => s.name === strategyName);

  // Look up a symbol's catalog category (custom symbols have unknown source).
  const categoryOf = useMemo(() => {
    const map = new Map<string, string>();
    symbols.forEach((s) => map.set(s.symbol, s.category));
    customSymbols.forEach((s) => { if (!map.has(s)) map.set(s, "custom"); });
    return (sym: string) => map.get(sym);
  }, [symbols, customSymbols]);

  // Broad asset class driving interval availability for the active mode.
  // compare runs one interval across all picked pairs, so it must be the most
  // restrictive class (crypto-only bars fade as soon as a non-crypto pair is in).
  const activeAssetClass = useMemo<string | null>(() => {
    if (mode === "compare") {
      const classes = compareSymbols.map((s) => assetClassForCategory(categoryOf(s)));
      if (classes.some((c) => c === null)) return null;       // unknown present → don't fade
      if (classes.some((c) => c === "stocks")) return "stocks"; // most restrictive
      return classes.length > 0 ? "crypto" : null;
    }
    const sym = mode === "optimize" ? optimizeSymbol : singleSymbol;
    return assetClassForCategory(categoryOf(sym));
  }, [mode, singleSymbol, optimizeSymbol, compareSymbols, categoryOf]);

  // If the currently selected interval isn't available for the new ticker,
  // fall back to a universally-supported bar so a faded bar is never "active".
  useEffect(() => {
    if (intervalInfos.length === 0 || activeAssetClass === null) return;
    const info = intervalInfos.find((i) => i.value === interval);
    const ok = info && (info.asset_classes.includes("all") || info.asset_classes.includes(activeAssetClass));
    if (!ok) setIntervalValue("1d");
  }, [activeAssetClass, intervalInfos]);  // eslint-disable-line react-hooks/exhaustive-deps

  const visibleSymbols = useMemo(() => {
    const customEntries = customSymbols.map((sym) => ({ symbol: sym, category: "custom" }));
    let out = [...customEntries, ...symbols];
    if (categoryFilter !== "all") out = out.filter((s) => s.category === categoryFilter);
    if (symbolSearch.trim()) {
      const q = symbolSearch.toLowerCase();
      out = out.filter((s) => s.symbol.toLowerCase().includes(q));
    }
    return out;
  }, [symbols, customSymbols, categoryFilter, symbolSearch]);

  const categories = useMemo(
    () => Array.from(new Set(symbols.map((s) => s.category))),
    [symbols],
  );

  // Auto-run debounce — fires runSingle() 450ms after params change when autoRun is enabled
  useEffect(() => {
    if (!autoRun || mode !== "single" || running) return;
    setAutoRunPending(true);
    if (autoRunTimer.current) clearTimeout(autoRunTimer.current);
    autoRunTimer.current = setTimeout(() => {
      setAutoRunPending(false);
      runSingle();
    }, 450);
    return () => { if (autoRunTimer.current) clearTimeout(autoRunTimer.current); };
  }, [strategyParams, interval, periodDays, autoRun, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Run handlers ──────────────────────────────────────────────────────

  // Elapsed timer — ticks every 100ms while running
  useEffect(() => {
    if (!running) { setElapsedMs(0); return; }
    startTimeRef.current = Date.now();
    const id = setInterval(() => {
      setElapsedMs(startTimeRef.current ? Date.now() - startTimeRef.current : 0);
    }, 100);
    return () => clearInterval(id);
  }, [running]);

  async function runSingle() {
    setRunning(true);
    setError(null);
    setSingleResult(null);
    setProgress(null);
    try {
      const params: BacktestParams = {
        symbol: singleSymbol, strategy: strategyName,
        start_date: isoDaysAgo(periodDays),
        end_date: isoDaysAgo(0),
        interval,
        initial_capital: initialCapital,
        commission_pct: commissionPct / 100,
        slippage_pct: slippagePct / 100,
        position_size_pct: positionPct / 100,
        strategy_params: strategyParams,
        spread_bps: spreadBps,
        enable_market_impact: enableMarketImpact,
        execution_latency_ms: latencyMs,
        use_funding_rates: useFundingRates,
        leverage,
        run_anomaly_scan: runAnomalyScan,
      };
      for await (const event of runBacktestStream(params)) {
        if (event.type === "progress") {
          setProgress(event);
        } else if (event.type === "result") {
          setSingleResult(event.data);
          if (event.data) autoSave(event.data);
        } else if (event.type === "error") {
          setError(event.message);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
      setProgress(null);
    }
  }

  async function runCompare() {
    if (compareSymbols.length === 0) { setError("Pick at least one pair"); return; }
    setRunning(true);
    setError(null);
    setCompareResults(null);
    setCompareProgress(null);
    const partial: CompareResult[] = [];
    try {
      for await (const event of compareStream({
        symbols: compareSymbols,
        strategy: strategyName,
        start_date: isoDaysAgo(periodDays),
        end_date: isoDaysAgo(0),
        interval,
        initial_capital: initialCapital,
        commission_pct: commissionPct / 100,
        slippage_pct: slippagePct / 100,
        position_size_pct: positionPct / 100,
        strategy_params: strategyParams,
      })) {
        if (event.type === "start") {
          setCompareProgress({ completed: 0, total: event.total });
        } else if (event.type === "result") {
          partial.push({ symbol: event.symbol, success: event.success, result: event.result ?? null, error: event.error ?? null });
          setCompareResults([...partial]);
          setCompareProgress({ completed: event.completed, total: event.total });
        } else if (event.type === "done") {
          setCompareProgress(null);
        } else if (event.type === "error") {
          setError(event.message);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
      setCompareProgress(null);
    }
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
      const paramRanges = Object.entries(currentStrategy.params_schema)
        .filter(([, spec]) => spec.type !== "bool" && spec.min !== undefined && spec.max !== undefined)
        .slice(0, 2)
        .map(([name, spec]) => {
          const min = spec.min as number;
          const max = spec.max as number;
          const def = typeof spec.default === "boolean" ? (spec.default ? 1 : 0) : spec.default;
          const range = max - min;
          const step = spec.type === "int" ? Math.max(1, Math.round(range / 8)) : range / 8;
          const start = Math.max(min, def - range * 0.3);
          const stop = Math.min(max, def + range * 0.3);
          return { name, start, stop, step };
        });
      const r = await backtestApi.optimize({
        symbol: optimizeSymbol,
        strategy: strategyName,
        start_date: isoDaysAgo(periodDays),
        end_date: isoDaysAgo(0),
        interval,
        initial_capital: initialCapital,
        commission_pct: commissionPct / 100,
        slippage_pct: slippagePct / 100,
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

  async function runCompareAllStrategies() {
    const strategyNames = strategies
      .map((s) => s.name)
      .filter((n) => n !== "buy_and_hold");
    if (strategyNames.length === 0) return;
    setStratCompareRunning(true);
    setStratCompareResults(null);
    try {
      const params = {
        symbol: singleSymbol,
        start_date: isoDaysAgo(periodDays),
        end_date: isoDaysAgo(0),
        interval,
        initial_capital: initialCapital,
        commission_pct: commissionPct / 100,
        slippage_pct: slippagePct / 100,
        position_size_pct: positionPct / 100,
        strategy_params: {},
        spread_bps: spreadBps,
        enable_market_impact: enableMarketImpact,
        execution_latency_ms: latencyMs,
        use_funding_rates: useFundingRates,
        leverage,
        run_anomaly_scan: false,
      };
      const results = await backtestApi.compareStrategies(strategyNames, params);
      setStratCompareResults(results);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStratCompareRunning(false);
    }
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

  async function fetchLiveSignals() {
    setLiveSignalsLoading(true);
    setLiveSignalsError(null);
    try {
      const r = await backtestApi.liveSignals(singleSymbol, interval);
      setLiveSignals(r.signals);
    } catch (e) {
      setLiveSignalsError(e instanceof Error ? e.message : String(e));
    } finally {
      setLiveSignalsLoading(false);
    }
  }

  // Auto-refresh live signals
  useEffect(() => {
    if (liveSignalsTimerRef.current) clearInterval(liveSignalsTimerRef.current);
    if (!liveSignalsAutoRefresh || mode !== "signals") return;
    setLiveSignalsCountdown(liveSignalsRefreshSec);
    liveSignalsTimerRef.current = setInterval(() => {
      setLiveSignalsCountdown((c) => {
        if (c <= 1) { fetchLiveSignals(); return liveSignalsRefreshSec; }
        return c - 1;
      });
    }, 1000);
    return () => { if (liveSignalsTimerRef.current) clearInterval(liveSignalsTimerRef.current); };
  }, [liveSignalsAutoRefresh, liveSignalsRefreshSec, mode, singleSymbol, interval]); // eslint-disable-line react-hooks/exhaustive-deps

  function toggleCompareSymbol(sym: string) {
    setCompareSymbols((cur) =>
      cur.includes(sym) ? cur.filter((s) => s !== sym) : [...cur, sym].slice(0, 20),
    );
  }

  const onRun = () => {
    if (mode === "single") runSingle();
    else if (mode === "compare") runCompare();
    else if (mode === "optimize") runOptimize();
    else if (mode === "signals") fetchLiveSignals();
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-50 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <header className="border-b border-zinc-800 pb-4 flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-semibold">Backtester</h1>
            <p className="text-zinc-400 text-sm mt-1">
              {symbols.length} pairs · {strategies.length} strategies · 10+ years of daily data · second-granular for crypto
            </p>
          </div>
          <button
            onClick={() => {
              // Dispatch a synthetic "?" keydown so KeyboardShortcutsLayer handles it
              window.dispatchEvent(new KeyboardEvent("keydown", { key: "?", bubbles: true }));
            }}
            className="mt-1 px-2 py-1 rounded border border-zinc-700 text-xs text-zinc-500 hover:text-zinc-200 hover:border-zinc-500 transition font-mono"
            title="Keyboard shortcuts"
          >
            ?
          </button>
        </header>

        <ModeTabs mode={mode} onChange={setMode} />

        {mode === "history" ? (
          <HistoryView
            rows={history}
            onOpen={openHistoryRun}
            onDelete={deleteHistoryRun}
          />
        ) : mode === "data" ? (
          <DataStatusTab
            onSymbolAdded={(sym) => {
              setCustomSymbols((prev) =>
                prev.includes(sym) ? prev : [...prev, sym],
              );
              setSingleSymbol(sym);
              setMode("single");
            }}
          />
        ) : mode === "scan" ? (
          <div className="space-y-6">
            <StrategyScannerView
              symbol={singleSymbol}
              strategies={strategies}
              periodDays={periodDays}
              interval={interval}
              initialCapital={initialCapital}
              commissionPct={commissionPct}
              slippagePct={slippagePct}
              positionPct={positionPct}
              onSelectStrategy={(name) => {
                setStrategyName(name);
                setMode("single");
              }}
            />
            <div className="border-t border-zinc-800 pt-6">
              <StrategyLeaderboard
                symbol={singleSymbol}
                interval={interval}
                periodDays={periodDays}
                initialCapital={initialCapital}
                commissionPct={commissionPct}
                slippagePct={slippagePct}
                positionPct={positionPct}
                onSelectStrategy={(name) => {
                  setStrategyName(name);
                  setMode("single");
                }}
              />
            </div>
          </div>
        ) : mode === "signals" ? (
          <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6">
            <aside className="space-y-4 bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
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
              <IntervalPicker
                interval={interval}
                onChange={setIntervalValue}
                intervals={intervalInfos}
                assetClass={activeAssetClass}
              />
              <button
                onClick={fetchLiveSignals}
                disabled={liveSignalsLoading}
                className="w-full py-3 rounded-md bg-cyan-500 hover:bg-cyan-400 disabled:bg-zinc-700 disabled:text-zinc-500 text-zinc-950 font-semibold transition"
              >
                {liveSignalsLoading ? "Fetching…" : "Fetch Live Signals"}
              </button>
              {/* Auto-refresh controls */}
              <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-zinc-400 font-medium">Auto-refresh</span>
                  <button
                    onClick={() => setLiveSignalsAutoRefresh((v) => !v)}
                    className={`relative w-10 h-5 rounded-full transition ${liveSignalsAutoRefresh ? "bg-cyan-600" : "bg-zinc-700"}`}
                  >
                    <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${liveSignalsAutoRefresh ? "translate-x-5" : "translate-x-0.5"}`} />
                  </button>
                </div>
                {liveSignalsAutoRefresh && (
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      {[10, 30, 60].map((s) => (
                        <button
                          key={s}
                          onClick={() => setLiveSignalsRefreshSec(s)}
                          className={`flex-1 py-1 text-xs rounded transition ${liveSignalsRefreshSec === s ? "bg-cyan-700 text-white" : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"}`}
                        >
                          {s}s
                        </button>
                      ))}
                    </div>
                    <div className="text-xs text-zinc-500 text-center">
                      Refresh in <span className="text-cyan-400 font-medium">{liveSignalsCountdown}s</span>
                    </div>
                  </div>
                )}
              </div>
              {liveSignalsError && (
                <div className="text-sm text-red-400 bg-red-950/30 border border-red-900 p-2 rounded">
                  {liveSignalsError}
                </div>
              )}
            </aside>
            <main className="space-y-6">
              <LiveSignalsView
                signals={liveSignals}
                loading={liveSignalsLoading}
                symbol={singleSymbol}
                interval={interval}
              />
              <div className="border-t border-zinc-800 pt-6">
                <h3 className="font-semibold text-base mb-4">Symbol Scanner — scan all pairs for this strategy</h3>
                <SymbolScanner
                  strategies={strategies}
                  interval={interval}
                  onSelectSymbol={(sym) => { setSingleSymbol(sym); setMode("single"); }}
                />
              </div>
            </main>
          </div>
        ) : mode === "forward" ? (
          <div className="max-w-4xl mx-auto">
            <ForwardTest
              symbol={singleSymbol}
              strategy={strategyName}
              strategyParams={strategyParams}
              interval={interval}
              initialCapital={initialCapital}
              commissionPct={commissionPct}
              slippagePct={slippagePct}
              positionPct={positionPct}
            />
          </div>
        ) : mode === "custom" ? (
          <div className="max-w-5xl mx-auto space-y-4">
            {/* Sub-tab switcher */}
            <div className="flex gap-1 bg-zinc-900/50 border border-zinc-800 rounded-lg p-1">
              <button
                onClick={() => setCustomTab("builder")}
                className={`flex-1 px-4 py-2 rounded-md text-sm font-medium transition ${
                  customTab === "builder"
                    ? "bg-cyan-500 text-zinc-950"
                    : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
                }`}
              >
                Condition Builder
                <span className="block text-[10px] opacity-70 font-normal">No-code strategy builder</span>
              </button>
              <button
                onClick={() => setCustomTab("code")}
                className={`flex-1 px-4 py-2 rounded-md text-sm font-medium transition ${
                  customTab === "code"
                    ? "bg-cyan-500 text-zinc-950"
                    : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
                }`}
              >
                Code Editor
                <span className="block text-[10px] opacity-70 font-normal">Write Python directly</span>
              </button>
            </div>

            {customTab === "builder" ? (
              <ConditionBuilder
                symbol={singleSymbol}
                interval={interval}
                periodDays={periodDays}
                initialCapital={initialCapital}
                commissionPct={commissionPct}
                slippagePct={slippagePct}
                positionPct={positionPct}
              />
            ) : (
              <CustomStrategyEditor
                symbol={singleSymbol}
                strategy={strategyName}
                interval={interval}
                periodDays={periodDays}
                initialCapital={initialCapital}
                commissionPct={commissionPct}
                slippagePct={slippagePct}
                positionPct={positionPct}
                onSuccess={(result) => {
                  setSingleResult(result);
                  setMode("single");
                }}
              />
            )}
          </div>
        ) : mode === "matrix" ? (
          <div className="max-w-6xl mx-auto">
            <StrategyMatrix
              strategies={strategies}
              interval={interval}
              periodDays={periodDays}
              initialCapital={initialCapital}
              commissionPct={commissionPct}
              slippagePct={slippagePct}
              positionPct={positionPct}
              onSelectPair={(strat, sym) => {
                setStrategyName(strat);
                setSingleSymbol(sym);
                setMode("single");
              }}
            />
          </div>
        ) : mode === "portfolio" ? (
          <div className="max-w-5xl mx-auto">
            <PortfolioView
              symbol={singleSymbol}
              strategies={strategies}
              periodDays={periodDays}
              interval={interval}
              initialCapital={initialCapital}
              commissionPct={commissionPct}
              slippagePct={slippagePct}
            />
            <div className="border-t border-zinc-800 pt-6 mt-6">
              <EfficientFrontier
                symbol={singleSymbol}
                interval={interval}
                periodDays={periodDays}
                initialCapital={initialCapital}
                commissionPct={commissionPct}
                slippagePct={slippagePct}
                positionPct={positionPct}
                strategies={strategies}
              />
            </div>
            <div className="border-t border-zinc-800 pt-6 mt-6">
              <DiversificationPanel
                strategies={strategies}
                symbol={singleSymbol}
                interval={interval}
                periodDays={periodDays}
                initialCapital={initialCapital}
                commissionPct={commissionPct}
                slippagePct={slippagePct}
              />
            </div>
            <div className="border-t border-zinc-800 pt-6 mt-6">
              <EnsemblePanel
                strategies={strategies}
                symbol={singleSymbol}
                interval={interval}
                periodDays={periodDays}
                initialCapital={initialCapital}
                commissionPct={commissionPct}
                slippagePct={slippagePct}
                positionPct={positionPct}
              />
            </div>
          </div>
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

              {mode === "single" && (
                <RegimeBadge
                  symbol={singleSymbol}
                  onSelectStrategy={setStrategyName}
                />
              )}
              <PeriodPicker periodDays={periodDays} onChange={setPeriodDays} />
              <IntervalPicker
                interval={interval}
                onChange={setIntervalValue}
                intervals={intervalInfos}
                assetClass={activeAssetClass}
              />
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
                commissionPct={commissionPct} setCommissionPct={setCommissionPct}
                slippagePct={slippagePct} setSlippagePct={setSlippagePct}
                positionPct={positionPct} setPositionPct={setPositionPct}
              />

              {/* Realism config */}
              <div className="border-t border-zinc-800 pt-3 space-y-2">
                <button
                  className="w-full flex items-center justify-between text-xs font-medium uppercase tracking-wide text-zinc-400 hover:text-zinc-200 transition"
                  onClick={() => setRealismOpen((o) => !o)}
                >
                  <span>Realism</span>
                  <span className="text-zinc-600">{realismOpen ? "▲" : "▼"}</span>
                </button>
                {realismOpen && (
                  <div className="space-y-3 pt-1">
                    <div className="space-y-1">
                      <label className="text-xs text-zinc-400 flex justify-between">
                        <span>Spread</span><span className="text-zinc-300">{spreadBps} bps</span>
                      </label>
                      <input type="range" min={0} max={50} step={0.5} value={spreadBps}
                        onChange={(e) => setSpreadBps(Number(e.target.value))}
                        className="w-full accent-cyan-500" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-zinc-400 flex justify-between">
                        <span>Leverage</span><span className="text-zinc-300">{leverage}×</span>
                      </label>
                      <input type="range" min={1} max={20} step={1} value={leverage}
                        onChange={(e) => setLeverage(Number(e.target.value))}
                        className="w-full accent-cyan-500" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-zinc-400 flex justify-between">
                        <span>Fill latency</span><span className="text-zinc-300">{latencyMs} ms</span>
                      </label>
                      <input type="range" min={0} max={2000} step={50} value={latencyMs}
                        onChange={(e) => setLatencyMs(Number(e.target.value))}
                        className="w-full accent-cyan-500" />
                    </div>
                    <div className="flex flex-col gap-2">
                      {[
                        { label: "Market impact (Almgren-Chriss)", val: enableMarketImpact, set: setEnableMarketImpact },
                        { label: "Funding rates (perp futures)", val: useFundingRates, set: setUseFundingRates },
                        { label: "Scan anomalies", val: runAnomalyScan, set: setRunAnomalyScan },
                      ].map(({ label, val, set }) => (
                        <label key={label} className="flex items-center gap-2 text-xs text-zinc-400 cursor-pointer">
                          <input type="checkbox" checked={val} onChange={(e) => set(e.target.checked)}
                            className="accent-cyan-500 w-3.5 h-3.5" />
                          {label}
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {mode === "single" && (
                <label className="flex items-center gap-2 text-xs text-zinc-400 cursor-pointer select-none">
                  <div
                    onClick={() => setAutoRun(a => !a)}
                    className={`relative w-8 h-4 rounded-full transition-colors cursor-pointer ${autoRun ? 'bg-cyan-500' : 'bg-zinc-700'}`}
                  >
                    <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-all ${autoRun ? 'left-4' : 'left-0.5'}`} />
                  </div>
                  Auto-run on param change
                </label>
              )}

              <div className="relative">
                <button
                  onClick={onRun}
                  disabled={running || stratCompareRunning}
                  className={`w-full py-3 rounded-md font-semibold transition text-zinc-950 ${
                    running || stratCompareRunning
                      ? "bg-zinc-700 text-zinc-500"
                      : autoRunPending
                      ? "bg-cyan-500/80 hover:bg-cyan-400 animate-pulse"
                      : "bg-cyan-500 hover:bg-cyan-400"
                  }`}
                >
                  {running
                    ? (autoRun && mode === "single" ? "Updating…" : "Running…")
                    : mode === "single"
                    ? "Run Backtest"
                    : mode === "compare"
                    ? `Compare ${compareSymbols.length} pairs`
                    : "Optimize Parameters"}
                </button>
                {autoRun && mode === "single" && !running && (
                  <span className="absolute top-1 right-2 px-1.5 py-0.5 rounded text-[9px] font-bold bg-cyan-500/20 text-cyan-400 border border-cyan-500/40 uppercase tracking-wide">
                    Auto
                  </span>
                )}
              </div>

              {mode === "single" && (
                <button
                  onClick={runCompareAllStrategies}
                  disabled={running || stratCompareRunning}
                  className="w-full py-2 rounded-md bg-zinc-800 hover:bg-zinc-700 disabled:bg-zinc-900 disabled:text-zinc-600 text-zinc-200 text-sm font-medium transition border border-zinc-700"
                >
                  {stratCompareRunning ? "Comparing strategies…" : "Compare All Strategies"}
                </button>
              )}

              {error && (
                <div className="text-sm text-red-400 bg-red-950/30 border border-red-900 p-2 rounded">
                  {error}
                </div>
              )}

              {/* Quick Tune — only show in single mode */}
              {mode === "single" && (
                <ParamTuner
                  strategy={currentStrategy}
                  params={strategyParams}
                  onParamsChange={setStrategyParams}
                  onRunNow={runSingle}
                  running={running}
                />
              )}

              {/* Presets — only show in single mode */}
              {mode === "single" && (
                <ConfigPresets
                  current={{
                    symbol: singleSymbol,
                    strategy: strategyName,
                    interval,
                    periodDays,
                    initialCapital,
                    commissionPct,
                    slippagePct,
                    positionPct,
                    strategyParams,
                    spreadBps,
                    leverage,
                    latencyMs,
                    enableMarketImpact,
                    useFundingRates,
                  }}
                  onLoad={(cfg: BacktestConfig) => {
                    setSingleSymbol(cfg.symbol);
                    setStrategyName(cfg.strategy);
                    setIntervalValue(cfg.interval);
                    setPeriodDays(cfg.periodDays);
                    setInitialCapital(cfg.initialCapital);
                    setCommissionPct(cfg.commissionPct);
                    setSlippagePct(cfg.slippagePct);
                    setPositionPct(cfg.positionPct);
                    setStrategyParams(cfg.strategyParams);
                    setSpreadBps(cfg.spreadBps);
                    setLeverage(cfg.leverage);
                    setLatencyMs(cfg.latencyMs);
                    setEnableMarketImpact(cfg.enableMarketImpact);
                    setUseFundingRates(cfg.useFundingRates);
                  }}
                />
              )}
              {singleResult && (
                <ResultSnapshot current={singleResult} />
              )}
              <PositionSizer
                accountSize={initialCapital}
                winRatePct={singleResult?.metrics.win_rate_pct}
                avgWinPct={singleResult?.metrics.avg_win_pct}
                avgLossPct={singleResult ? Math.abs(singleResult.metrics.avg_loss_pct ?? singleResult.metrics.avg_win_pct ?? 2) : undefined}
              />
              <RecentHistory
                history={autoHistory}
                onLoad={(result) => {
                  setSingleResult(result);
                  setSingleSymbol(result.symbol);
                  setStrategyName(result.strategy);
                  setResultTab("charts");
                }}
                onRemove={autoRemove}
                onClear={autoClear}
              />
              <Watchlist onSelectSymbol={(sym) => setSingleSymbol(sym)} />
            </aside>

            {/* ─── Results pane ─── */}
            <main className="space-y-6">
              {mode === "single" && (
                <>
                  <SingleResultsView
                    symbol={singleSymbol}
                    result={singleResult}
                    running={running}
                    progress={progress}
                    elapsedMs={elapsedMs}
                    resultTab={resultTab}
                    setResultTab={setResultTab}
                    autoRunPending={autoRunPending}
                    strategy={strategyName}
                    strategies={strategies}
                    strategyParams={strategyParams}
                    periodDays={periodDays}
                    interval={interval}
                    initialCapital={initialCapital}
                    commissionPct={commissionPct}
                    slippagePct={slippagePct}
                    positionPct={positionPct}
                  />
                  {(stratCompareRunning || stratCompareResults) && (
                    <StrategyComparisonTable
                      results={stratCompareResults}
                      running={stratCompareRunning}
                      onLoad={(r) => {
                        setSingleResult(r);
                        setStrategyName(r.strategy);
                        setResultTab("charts");
                      }}
                    />
                  )}
                  <BacktesterChat
                    symbol={singleSymbol}
                    strategy={strategyName}
                    strategyParams={strategyParams}
                    periodDays={periodDays}
                    interval={interval}
                    commissionPct={commissionPct}
                    slippagePct={slippagePct}
                    result={singleResult}
                    onApplyParams={(p) => {
                      if (p.strategy) setStrategyName(p.strategy);
                      if (p.periodDays) setPeriodDays(p.periodDays);
                      if (p.interval) setIntervalValue(p.interval);
                      if (p.strategyParams) setStrategyParams(p.strategyParams);
                    }}
                  />
                </>
              )}
              {mode === "compare" && (
                <CompareResultsView results={compareResults} running={running} progress={compareProgress} />
              )}
              {mode === "optimize" && (
                <OptimizeResultsView
                  result={optimizeResult}
                  running={running}
                  onUseBestParams={(params) => {
                    setStrategyParams(params);
                    setMode("single");
                  }}
                />
              )}
            </main>
          </div>
        )}
      </div>
      <KeyboardShortcutsLayer
        onRunBacktest={() => {
          if (mode === "single") runSingle();
          else if (mode === "compare") runCompare();
          else if (mode === "optimize") runOptimize();
        }}
        onSwitchTab={(n) => {
          const m = MODE_ORDER[n - 1];
          if (m) setMode(m);
        }}
        onSwitchResultTab={(dir) => {
          const RESULT_TABS: ResultTab[] = ["charts", "editor", "trades", "monthly", "analysis", "friction", "anomalies", "rolling"];
          setResultTab((prev) => {
            const idx = RESULT_TABS.indexOf(prev);
            const next = (idx + dir + RESULT_TABS.length) % RESULT_TABS.length;
            return RESULT_TABS[next];
          });
        }}
      />
    </div>
  );
}

// ─── Progress display ────────────────────────────────────────────────────────

const PHASE_LABELS: Record<string, string> = {
  started:  "Starting…",
  loading:  "Loading historical data…",
  loaded:   "Data loaded",
  signals:  "Computing oracle signals…",
  features: "Computing entry features…",
  backtest: "Running backtest…",
  metrics:  "Computing metrics…",
};

function ProgressDisplay({
  progress,
  elapsedMs,
}: {
  progress: StreamProgressEvent;
  elapsedMs: number;
}) {
  const pct = progress.pct ?? 0;
  const label = PHASE_LABELS[progress.phase] ?? progress.phase;
  const detail =
    progress.current != null && progress.total != null && progress.total > 1
      ? ` (${progress.current.toLocaleString()} / ${progress.total.toLocaleString()})`
      : "";
  const elapsed = (elapsedMs / 1000).toFixed(1);

  return (
    <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-5 space-y-3">
      <div className="flex items-center justify-between text-sm">
        <span className="text-zinc-300 font-medium">
          {label}
          <span className="text-zinc-500 font-normal">{detail}</span>
        </span>
        <div className="flex items-center gap-3 text-zinc-500 text-xs tabular-nums">
          <span>{elapsed}s</span>
          <span className="text-zinc-300 font-semibold">{pct.toFixed(1)}%</span>
        </div>
      </div>

      {/* Track */}
      <div className="relative h-2 bg-zinc-800 rounded-full overflow-hidden">
        {/* Glowing fill */}
        <div
          className="absolute inset-y-0 left-0 rounded-full transition-all duration-300"
          style={{
            width: `${pct}%`,
            background: "linear-gradient(90deg, #06b6d4, #3b82f6)",
            boxShadow: pct > 0 ? "0 0 8px rgba(6,182,212,0.6)" : "none",
          }}
        />
        {/* Shimmer overlay */}
        {pct < 100 && (
          <div
            className="absolute inset-y-0 left-0 rounded-full animate-pulse"
            style={{
              width: `${pct}%`,
              background: "linear-gradient(90deg, transparent 60%, rgba(255,255,255,0.15) 100%)",
            }}
          />
        )}
      </div>

      {/* Phase steps */}
      <div className="flex gap-1 flex-wrap">
        {(["loading", "signals", "features", "backtest", "metrics"] as const).map((ph) => {
          const phases = ["loading", "signals", "features", "backtest", "metrics"];
          const currentIdx = phases.indexOf(progress.phase);
          const phIdx = phases.indexOf(ph);
          const done = phIdx < currentIdx;
          const active = ph === progress.phase;
          return (
            <span
              key={ph}
              className={`px-2 py-0.5 rounded text-[10px] font-medium border transition-all ${
                active
                  ? "border-cyan-500 bg-cyan-500/10 text-cyan-300"
                  : done
                  ? "border-zinc-700 bg-zinc-800 text-zinc-400"
                  : "border-zinc-800 text-zinc-600"
              }`}
            >
              {done ? "✓ " : ""}{ph}
            </span>
          );
        })}
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
    { value: "scan", label: "Scan", hint: "Best strategy finder" },
    { value: "signals", label: "Signals", hint: "Live signal feed" },
    { value: "forward", label: "Forward", hint: "Live simulation" },
    { value: "history", label: "History", hint: "Past runs" },
    { value: "data", label: "Data", hint: "Cache · Custom symbols" },
    { value: "custom", label: "Editor", hint: "Write your own strategy" },
    { value: "portfolio", label: "Portfolio", hint: "Multi-strategy allocation" },
    { value: "matrix", label: "Matrix", hint: "All strategies × symbols" },
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

type TabGroup = {
  label: string;
  tabs: { value: ResultTab; label: string }[];
};

function ResultTabs({
  active, onChange, hasFriction, hasAnomalies, hasAnalysis, hasMonthly, hasMonteCarlo, hasRolling,
}: {
  active: ResultTab; onChange: (t: ResultTab) => void;
  hasFriction: boolean; hasAnomalies: boolean; hasAnalysis: boolean; hasMonthly: boolean; hasMonteCarlo?: boolean; hasRolling?: boolean;
}) {
  const groups: TabGroup[] = [
    {
      label: "Overview",
      tabs: [
        { value: "charts", label: "Equity Curve" },
        ...(hasMonthly ? [{ value: "monthly" as ResultTab, label: "Monthly" }] : []),
        ...(hasMonthly ? [{ value: "calendar" as ResultTab, label: "Calendar" }] : []),
        { value: "heatmap" as ResultTab, label: "Intraday" },
        { value: "benchmark" as ResultTab, label: "vs. Buy-Hold" },
      ],
    },
    {
      label: "Trades",
      tabs: [
        { value: "trades", label: "Trade List" },
        ...(hasMonthly ? [{ value: "editor" as ResultTab, label: "Trade Editor" }] : []),
        { value: "streaks" as ResultTab, label: "Streaks" },
        { value: "dist" as ResultTab, label: "Distribution" },
        { value: "mae_mfe" as ResultTab, label: "MAE / MFE" },
        { value: "autocorr" as ResultTab, label: "Autocorrelation" },
        ...(hasMonthly ? [{ value: "journal" as ResultTab, label: "Journal" }] : []),
      ],
    },
    {
      label: "Risk",
      tabs: [
        { value: "risk", label: "Risk Metrics" },
        { value: "drawdown", label: "Drawdowns" },
        { value: "factor" as ResultTab, label: "Factor Exposure" },
        { value: "timing" as ResultTab, label: "Trade Timing" },
        { value: "breakeven" as ResultTab, label: "Breakeven" },
      ],
    },
    {
      label: "Performance",
      tabs: [
        ...(hasAnalysis ? [{ value: "analysis" as ResultTab, label: "Entry Analysis" }] : []),
        { value: "attribution" as ResultTab, label: "Attribution" },
        ...(hasRolling ? [{ value: "rolling" as ResultTab, label: "Rolling Metrics" }] : []),
        { value: "quality" as ResultTab, label: "Quality Score" },
        { value: "perf_track" as ResultTab, label: "Perf Tracker" },
      ],
    },
    {
      label: "Strategy",
      tabs: [
        ...(hasFriction ? [{ value: "friction" as ResultTab, label: "Friction" }] : []),
        ...(hasAnomalies ? [{ value: "anomalies" as ResultTab, label: "Anomalies" }] : []),
        { value: "regime" as ResultTab, label: "Regime" },
        { value: "robustness" as ResultTab, label: "Robustness" },
        { value: "scenarios" as ResultTab, label: "Scenarios" },
      ],
    },
    {
      label: "Optimize",
      tabs: [
        ...(hasMonteCarlo ? [{ value: "montecarlo" as ResultTab, label: "Monte Carlo" }] : []),
        { value: "walk_forward" as ResultTab, label: "Walk-Forward" },
        ...(hasMonthly ? [{ value: "sensitivity" as ResultTab, label: "Sensitivity" }] : []),
        { value: "multi_tf" as ResultTab, label: "Multi-Timeframe" },
        { value: "mkt_corr" as ResultTab, label: "Mkt Conditions" },
        { value: "pnl_sim" as ResultTab, label: "P&L Simulator" },
      ],
    },
    {
      label: "Export",
      tabs: [
        { value: "pine" as ResultTab, label: "Pine Script" },
        { value: "report" as ResultTab, label: "HTML Report" },
      ],
    },
  ];

  // Determine active group
  const activeGroup = groups.find((g) => g.tabs.some((t) => t.value === active))?.label ?? groups[0]?.label;
  const activeTabs = groups.find((g) => g.label === activeGroup)?.tabs ?? [];

  return (
    <div className="space-y-1">
      {/* Group bar */}
      <div className="flex gap-0.5 flex-wrap">
        {groups.map((g) => {
          const isActive = g.label === activeGroup;
          return (
            <button
              key={g.label}
              onClick={() => {
                const first = g.tabs[0];
                if (first) onChange(first.value);
              }}
              className={`px-3 py-1 rounded-t-md text-xs font-semibold uppercase tracking-wider transition ${
                isActive
                  ? "bg-zinc-800 text-cyan-400 border-t border-x border-zinc-700"
                  : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50"
              }`}
            >
              {g.label}
            </button>
          );
        })}
      </div>
      {/* Sub-tab bar */}
      <div className="flex gap-0.5 bg-zinc-800/60 border border-zinc-700 rounded-b-lg rounded-tr-lg p-1 flex-wrap">
        {activeTabs.map((t) => (
          <button
            key={t.value}
            onClick={() => onChange(t.value)}
            className={`px-2.5 py-1 rounded-md text-xs font-medium transition whitespace-nowrap ${
              active === t.value
                ? "bg-cyan-500 text-zinc-950"
                : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function FrictionPanel({ fb }: { fb: FrictionBreakdown }) {
  const items = [
    { label: "Commission", value: fb.commission_usd, color: "bg-blue-500" },
    { label: "Slippage", value: fb.slippage_usd, color: "bg-yellow-500" },
    { label: "Spread", value: fb.spread_usd, color: "bg-orange-500" },
    { label: "Funding", value: fb.funding_usd, color: "bg-purple-500" },
  ];
  const total = fb.total_usd;
  return (
    <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-5 space-y-4">
      <h3 className="font-semibold">Friction Breakdown</h3>
      <div className="flex gap-2 h-6 rounded overflow-hidden">
        {items.map((it) => (
          <div key={it.label}
            title={`${it.label}: $${it.value.toFixed(2)}`}
            className={`${it.color} transition-all`}
            style={{ width: total > 0 ? `${(it.value / total) * 100}%` : "25%" }}
          />
        ))}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {items.map((it) => (
          <div key={it.label} className="bg-zinc-800/60 rounded p-3">
            <div className={`w-3 h-3 rounded-sm ${it.color} mb-1`} />
            <div className="text-xs text-zinc-400">{it.label}</div>
            <div className="font-semibold">${it.value.toFixed(2)}</div>
            <div className="text-xs text-zinc-500">
              {total > 0 ? `${((it.value / total) * 100).toFixed(1)}%` : "—"}
            </div>
          </div>
        ))}
      </div>
      <div className="text-sm text-zinc-400 border-t border-zinc-800 pt-3">
        Total friction: <span className="text-zinc-200 font-semibold">${total.toFixed(2)}</span>
        {" · "}
        <span className="text-zinc-400">{fb.total_pct_of_gross.toFixed(2)}% of gross PnL</span>
      </div>
    </div>
  );
}

const ANOMALY_SEVERITY_COLOR = ["", "text-zinc-400", "text-yellow-400", "text-orange-400", "text-red-400", "text-red-500 font-bold"];

function AnomaliesPanel({ anomalies }: { anomalies: Anomaly[] }) {
  if (anomalies.length === 0) {
    return (
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-8 text-center text-zinc-400 text-sm">
        No anomalies detected in this period.
      </div>
    );
  }
  return (
    <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-5 space-y-3">
      <h3 className="font-semibold">Anomalies ({anomalies.length})</h3>
      <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
        {anomalies.map((a, i) => (
          <div key={i} className="flex items-start gap-3 bg-zinc-800/40 rounded p-3">
            <div className={`text-sm font-bold mt-0.5 ${ANOMALY_SEVERITY_COLOR[a.severity] ?? "text-zinc-300"}`}>
              S{a.severity}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-xs font-medium text-zinc-200 uppercase tracking-wide">{a.type.replace(/_/g, " ")}</span>
                <span className="text-xs text-zinc-500">${a.price.toFixed(2)}</span>
              </div>
              <div className="text-xs text-zinc-400">{a.description}</div>
              {a.suggested_action && (
                <div className="text-xs text-cyan-400 mt-0.5">→ {a.suggested_action}</div>
              )}
            </div>
            <div className="text-xs text-zinc-600 tabular-nums shrink-0">
              {new Date(a.timestamp * 1000).toLocaleDateString()}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ExportMenu({ result }: { result: BacktestResult }) {
  const [open, setOpen] = useState(false);

  function exportJSON() {
    const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `backtest_${result.symbol}_${result.strategy}_${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setOpen(false);
  }

  function exportCSV() {
    const headers = ['entry_time','exit_time','side','entry_price','exit_price','pnl','pnl_pct','reason'];
    const rows = result.trades.map(t => headers.map(h => t[h as keyof typeof t] ?? '').join(','));
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `trades_${result.symbol}_${result.strategy}_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    setOpen(false);
  }

  function copySummary() {
    const m = result.metrics;
    const text = `${result.strategy} on ${result.symbol}/${result.interval}: ${m.total_return_pct >= 0 ? '+' : ''}${m.total_return_pct.toFixed(2)}% return · Sharpe ${m.sharpe_ratio.toFixed(2)} · ${m.win_rate_pct.toFixed(1)}% win rate · ${m.total_trades} trades · Max DD -${m.max_drawdown_pct.toFixed(1)}%`;
    navigator.clipboard.writeText(text);
    setOpen(false);
  }

  return (
    <div className="relative">
      <button onClick={() => setOpen(o => !o)} className="px-3 py-1.5 rounded-md text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 transition">
        Export ▾
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-44 bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl z-10 py-1" onMouseLeave={() => setOpen(false)}>
          {[
            { label: 'Export JSON', fn: exportJSON },
            { label: 'Export trades CSV', fn: exportCSV },
            { label: 'Copy summary', fn: copySummary },
          ].map(({ label, fn }) => (
            <button key={label} onClick={fn} className="w-full text-left px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 transition">
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SingleResultsView({
  symbol, result, running, progress, elapsedMs,
  resultTab, setResultTab, autoRunPending,
  strategy, strategies, strategyParams, periodDays, interval,
  initialCapital, commissionPct, slippagePct, positionPct,
}: {
  symbol: string;
  result: BacktestResult | null;
  running: boolean;
  progress: StreamProgressEvent | null;
  elapsedMs: number;
  resultTab: ResultTab;
  setResultTab: (t: ResultTab) => void;
  autoRunPending: boolean;
  strategy: string;
  strategies: StrategyInfo[];
  strategyParams: Record<string, number>;
  periodDays: number;
  interval: string;
  initialCapital: number;
  commissionPct: number;
  slippagePct: number;
  positionPct: number;
}) {
  const hasMonteCarlo = !!(result && result.trades.length >= 5);
  const hasRolling = !!(result && result.equity_curve.length >= 20);
  const currentStrategy = strategies.find((s) => s.name === strategy);

  return (
    <>
      <MetadataPanel symbol={symbol} />
      {!result && !running && resultTab !== "multi_tf" && (
        <div className="bg-zinc-900/30 border border-dashed border-zinc-800 rounded-lg p-12 text-center">
          <h3 className="text-xl font-medium text-zinc-300 mb-2">Pick a pair and hit Run</h3>
          <p className="text-sm text-zinc-500 max-w-md mx-auto">
            Charts, 12 performance metrics, every trade marked on the candlestick chart.
          </p>
        </div>
      )}
      {!result && !running && resultTab === "multi_tf" && (
        <MultiTimeframePanel
          symbol={symbol}
          strategy={strategy}
          strategyParams={strategyParams}
          periodDays={periodDays}
          initialCapital={initialCapital}
          commissionPct={commissionPct}
          slippagePct={slippagePct}
          positionPct={positionPct}
        />
      )}
      {running && progress && (
        <ProgressDisplay progress={progress} elapsedMs={elapsedMs} />
      )}
      {running && !progress && (
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-8 text-center text-zinc-400 text-sm">
          Connecting…
        </div>
      )}
      {result && (
        <div className={autoRunPending ? "opacity-60 transition-opacity duration-300" : "transition-opacity duration-300"}>
          <div className={`rounded-lg ${autoRunPending ? "ring-1 ring-cyan-500/50 animate-pulse" : ""}`}>
            <MetricsGrid result={result} />
          </div>
          {result.metrics.total_trades >= 10 && (
            <KellyPanel metrics={result.metrics} />
          )}
          <div className="flex items-center justify-between gap-3 mt-4">
            <ResultTabs
              active={resultTab}
              onChange={setResultTab}
              hasFriction={!!result.friction_breakdown}
              hasAnomalies={!!(result.anomalies && result.anomalies.length > 0)}
              hasAnalysis={!!result.entry_analysis}
              hasMonthly={result.trades.length > 0}
              hasMonteCarlo={hasMonteCarlo}
              hasRolling={hasRolling}
            />
            <ExportMenu result={result} />
          </div>
          {resultTab === "charts" && (
            <>
              <PriceChart result={result} />
              <EquityChart result={result} />
              <StrategyRadar result={result} />
            </>
          )}
          {resultTab === "editor" && (
            <TradeEditor result={result} />
          )}
          {resultTab === "trades" && (
            <TradesTable trades={result.trades} symbol={result.symbol} />
          )}
          {resultTab === "monthly" && (
            <MonthlyBreakdown trades={result.trades} />
          )}
          {resultTab === "analysis" && result.entry_analysis && (
            <EntryAnalysisPanel analysis={result.entry_analysis} />
          )}
          {resultTab === "friction" && result.friction_breakdown && (
            <FrictionPanel fb={result.friction_breakdown} />
          )}
          {resultTab === "anomalies" && result.anomalies && (
            <AnomaliesPanel anomalies={result.anomalies} />
          )}
          {resultTab === "montecarlo" && hasMonteCarlo && (
            <MonteCarloPanel result={result} />
          )}
          {resultTab === "walk_forward" && (
            <WalkForwardPanel
              symbol={symbol}
              strategy={strategy}
              strategyParams={strategyParams}
              periodDays={periodDays}
              interval={interval}
              initialCapital={initialCapital}
              commissionPct={commissionPct}
              slippagePct={slippagePct}
              positionPct={positionPct}
            />
          )}
          {resultTab === "rolling" && hasRolling && (
            <RollingAnalysisPanel result={result} />
          )}
          {resultTab === "calendar" && result.trades.length > 0 && (
            <HeatCalendar trades={result.trades} initialCapital={result.metrics.initial_capital} />
          )}
          {resultTab === "sensitivity" && currentStrategy && (
            <SensitivityChart
              strategy={currentStrategy}
              symbol={symbol}
              periodDays={periodDays}
              interval={interval}
              initialCapital={initialCapital}
              commissionPct={commissionPct}
              slippagePct={slippagePct}
              positionPct={positionPct}
              currentParams={strategyParams}
            />
          )}
          {resultTab === "regime" && (
            <RegimeAnalysis
              symbol={symbol}
              strategy={strategy}
              strategyParams={strategyParams}
              interval={interval}
              periodDays={periodDays}
              initialCapital={initialCapital}
              commissionPct={commissionPct}
              slippagePct={slippagePct}
              positionPct={positionPct}
            />
          )}
          {resultTab === "risk" && (
            <RiskAnalyticsPanel result={result} />
          )}
          {resultTab === "attribution" && (
            <PerformanceAttribution result={result} />
          )}
          {resultTab === "drawdown" && (
            <DrawdownAnalysis result={result} />
          )}
          {resultTab === "journal" && (
            <TradeJournal result={result} />
          )}
          {resultTab === "multi_tf" && (
            <MultiTimeframePanel
              symbol={symbol}
              strategy={strategy}
              strategyParams={strategyParams}
              periodDays={periodDays}
              initialCapital={initialCapital}
              commissionPct={commissionPct}
              slippagePct={slippagePct}
              positionPct={positionPct}
            />
          )}
          {resultTab === "robustness" && (
            <RobustnessTest
              strategy={currentStrategy}
              symbol={symbol}
              params={strategyParams}
              periodDays={periodDays}
              interval={interval}
              initialCapital={initialCapital}
              commissionPct={commissionPct}
              slippagePct={slippagePct}
              positionPct={positionPct}
              baseResult={result}
            />
          )}
          {resultTab === "factor" && result && (
            <FactorExposure result={result} />
          )}
          {resultTab === "timing" && result && (
            <TradeTimingAnalysis result={result} />
          )}
          {resultTab === "mkt_corr" && (
            <MarketCorrelation
              symbol={symbol}
              strategy={strategy}
              strategyParams={strategyParams}
              interval={interval}
              periodDays={periodDays}
              initialCapital={initialCapital}
              commissionPct={commissionPct}
              slippagePct={slippagePct}
              positionPct={positionPct}
            />
          )}
          {resultTab === "pnl_sim" && (
            <LivePnlSimulator
              symbol={symbol}
              strategy={strategy}
              strategyParams={strategyParams}
              interval={interval}
              initialCapital={initialCapital}
              commissionPct={commissionPct}
              slippagePct={slippagePct}
              positionPct={positionPct}
            />
          )}
          {resultTab === "streaks" && result && (
            <TradeStreakAnalyzer result={result} />
          )}
          {resultTab === "dist" && result && (
            <ProfitDistribution result={result} />
          )}
          {resultTab === "benchmark" && result && (
            <StrategyBenchmark
              result={result}
              symbol={symbol}
              interval={interval}
              periodDays={periodDays}
              initialCapital={initialCapital}
              commissionPct={commissionPct}
              slippagePct={slippagePct}
              positionPct={positionPct}
              strategies={strategies}
            />
          )}
          {resultTab === "heatmap" && result && (
            <IntradayHeatmap result={result} />
          )}
          {resultTab === "quality" && result && (
            <TradeQuality result={result} />
          )}
          {resultTab === "perf_track" && result && (
            <BenchmarkTracker result={result} />
          )}
          {resultTab === "scenarios" && (
            <ScenarioComparator
              symbol={symbol}
              strategy={strategy}
              strategyParams={strategyParams}
              interval={interval}
              periodDays={periodDays}
              initialCapital={initialCapital}
              commissionPct={commissionPct}
              slippagePct={slippagePct}
              positionPct={positionPct}
            />
          )}
          {resultTab === "autocorr" && result && (
            <TradeAutocorrelation result={result} />
          )}
          {resultTab === "mae_mfe" && result && (
            <MaeMfeAnalysis result={result} />
          )}
          {resultTab === "pine" && result && currentStrategy && (
            <PineScriptExport result={result} strategy={currentStrategy} params={strategyParams} />
          )}
          {resultTab === "pine" && result && !currentStrategy && (
            <div className="text-center text-zinc-500 py-10">Select a strategy to generate Pine Script.</div>
          )}
          {resultTab === "breakeven" && result && (
            <BreakevenAnalysis result={result} />
          )}
          {resultTab === "report" && result && (
            <ReportExport result={result} strategy={currentStrategy} />
          )}
        </div>
      )}
    </>
  );
}

function CompareResultsView({
  results, running, progress,
}: {
  results: CompareResult[] | null;
  running: boolean;
  progress: { completed: number; total: number } | null;
}) {
  if (!results && running) {
    return (
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-12 text-center text-zinc-400">
        Starting parallel backtests…
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
  return (
    <div className="space-y-3">
      {progress && (
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg px-4 py-3 flex items-center gap-4">
          <div className="flex-1 h-2 bg-zinc-800 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${(progress.completed / progress.total) * 100}%`,
                background: "linear-gradient(90deg, #06b6d4, #3b82f6)",
              }}
            />
          </div>
          <span className="text-xs text-zinc-400 tabular-nums shrink-0">
            {progress.completed} / {progress.total} complete
          </span>
        </div>
      )}
      <CompareTable rows={results} />
    </div>
  );
}

function OptimizeResultsView({
  result, running, onUseBestParams,
}: {
  result: OptimizeResult | null;
  running: boolean;
  onUseBestParams?: (params: Record<string, number>) => void;
}) {
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
  return (
    <div className="space-y-3">
      <OptimizeHeatmap result={result} />
      {onUseBestParams && result.best_params && (
        <div className="flex justify-end">
          <button
            onClick={() => onUseBestParams(result.best_params)}
            className="px-4 py-2 rounded-md text-sm font-semibold bg-emerald-700 hover:bg-emerald-600 text-white transition flex items-center gap-2"
          >
            ✓ Use Best Params &amp; Switch to Single
          </button>
        </div>
      )}
    </div>
  );
}

const SIGNAL_COLORS: Record<string, string> = {
  buy: "text-emerald-400 bg-emerald-950/40 border-emerald-800",
  sell: "text-red-400 bg-red-950/40 border-red-800",
  short: "text-red-400 bg-red-950/40 border-red-800",
  close: "text-yellow-400 bg-yellow-950/40 border-yellow-800",
  hold: "text-zinc-400 bg-zinc-800/40 border-zinc-700",
};

function LiveSignalsView({
  signals, loading, symbol, interval,
}: {
  signals: LiveSignal[] | null;
  loading: boolean;
  symbol: string;
  interval: string;
}) {
  const [validations, setValidations] = useState<Record<string, SignalValidation | "loading" | "error">>({});

  async function handleValidate(sig: LiveSignal) {
    setValidations((prev) => ({ ...prev, [sig.strategy]: "loading" }));
    try {
      const result = await backtestApi.validateSignal({
        strategy: sig.strategy,
        symbol: sig.symbol,
        direction: sig.signal,
        interval,
      });
      setValidations((prev) => ({ ...prev, [sig.strategy]: result }));
    } catch {
      setValidations((prev) => ({ ...prev, [sig.strategy]: "error" }));
    }
  }

  if (loading) {
    return (
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-12 text-center text-zinc-400">
        Fetching live signals from all strategies…
      </div>
    );
  }
  if (!signals) {
    return (
      <div className="bg-zinc-900/30 border border-dashed border-zinc-800 rounded-lg p-12 text-center">
        <h3 className="text-xl font-medium text-zinc-300 mb-2">Live signals from all strategies</h3>
        <p className="text-sm text-zinc-500 max-w-md mx-auto">
          Click "Fetch Live Signals" to see what every strategy currently says about <span className="text-zinc-300">{symbol}</span> on the <span className="text-zinc-300">{interval}</span> timeframe.
        </p>
      </div>
    );
  }
  const [updatedAt] = useState(() => new Date());

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="font-semibold text-lg">
          Live signals · {symbol} · {interval}
        </h3>
        <div className="flex items-center gap-3 text-xs text-zinc-500">
          <span>{signals.filter((s) => s.signal !== "hold" && !s.error).length} active</span>
          <span>Updated {updatedAt.toLocaleTimeString()}</span>
        </div>
      </div>
      {/* Signal summary bar */}
      {signals.length > 0 && (() => {
        const buys = signals.filter((s) => s.signal === "buy").length;
        const sells = signals.filter((s) => s.signal === "sell").length;
        const holds = signals.filter((s) => s.signal === "hold" || s.signal === "close").length;
        const total = signals.length;
        const sentiment = buys > sells * 1.5 ? "Bullish" : sells > buys * 1.5 ? "Bearish" : "Neutral";
        const sentColor = sentiment === "Bullish" ? "text-emerald-400" : sentiment === "Bearish" ? "text-red-400" : "text-yellow-400";
        return (
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-zinc-400">Overall sentiment</span>
              <span className={`text-sm font-bold ${sentColor}`}>{sentiment}</span>
            </div>
            <div className="flex h-2 rounded-full overflow-hidden gap-px">
              {buys > 0 && <div className="bg-emerald-500 transition-all" style={{ width: `${(buys / total) * 100}%` }} title={`${buys} buy`} />}
              {sells > 0 && <div className="bg-red-500 transition-all" style={{ width: `${(sells / total) * 100}%` }} title={`${sells} sell`} />}
              {holds > 0 && <div className="bg-zinc-600 transition-all" style={{ width: `${(holds / total) * 100}%` }} title={`${holds} hold`} />}
            </div>
            <div className="flex gap-4 mt-1.5 text-xs text-zinc-500">
              <span className="text-emerald-400">{buys} buy</span>
              <span className="text-red-400">{sells} sell</span>
              <span className="text-zinc-500">{holds} hold</span>
            </div>
          </div>
        );
      })()}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {signals.map((sig) => {
          const colorClass = SIGNAL_COLORS[sig.signal] ?? SIGNAL_COLORS.hold;
          const validation = validations[sig.strategy];
          const canValidate = sig.signal !== "hold" && !sig.error;
          const confPct = sig.confidence > 0 ? Math.round(sig.confidence * 100) : 0;
          return (
            <div key={sig.strategy} className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-medium text-sm text-zinc-200">{sig.strategy.replace(/_/g, " ")}</span>
                <span className={`px-2 py-0.5 rounded border text-xs font-bold uppercase ${colorClass}`}>
                  {sig.signal}
                </span>
              </div>
              {/* Confidence bar */}
              {confPct > 0 && (
                <div>
                  <div className="flex justify-between text-xs text-zinc-500 mb-0.5">
                    <span>Confidence</span>
                    <span>{confPct}%</span>
                  </div>
                  <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${confPct >= 70 ? "bg-emerald-500" : confPct >= 40 ? "bg-yellow-500" : "bg-zinc-500"}`}
                      style={{ width: `${confPct}%` }}
                    />
                  </div>
                </div>
              )}
              {sig.error ? (
                <div className="text-xs text-red-400">{sig.error}</div>
              ) : (
                <div className="grid grid-cols-3 gap-1 text-xs">
                  {sig.entry_price != null && (
                    <div className="bg-zinc-800/60 rounded p-1.5">
                      <div className="text-zinc-500">Entry</div>
                      <div className="text-zinc-200">${sig.entry_price.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
                    </div>
                  )}
                  {sig.tp_price != null && (
                    <div className="bg-zinc-800/60 rounded p-1.5">
                      <div className="text-zinc-500">TP</div>
                      <div className="text-emerald-400">${sig.tp_price.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
                    </div>
                  )}
                  {sig.sl_price != null && (
                    <div className="bg-zinc-800/60 rounded p-1.5">
                      <div className="text-zinc-500">SL</div>
                      <div className="text-red-400">${sig.sl_price.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
                    </div>
                  )}
                </div>
              )}
              <div className="flex items-center justify-between text-xs text-zinc-600">
                <span>{sig.bar_count} bars</span>
                <span>{sig.confidence > 0 ? `${confPct}% conf.` : ""}</span>
              </div>
              {canValidate && (
                <div className="pt-1 border-t border-zinc-800">
                  {!validation && (
                    <button
                      onClick={() => handleValidate(sig)}
                      className="w-full text-xs py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors"
                    >
                      Validate historically
                    </button>
                  )}
                  {validation === "loading" && (
                    <div className="text-xs text-zinc-500 text-center py-1">Scanning history…</div>
                  )}
                  {validation === "error" && (
                    <div className="text-xs text-red-400 text-center py-1">Validation failed</div>
                  )}
                  {validation && validation !== "loading" && validation !== "error" && (
                    <div className="space-y-1.5">
                      <div className="grid grid-cols-2 gap-1 text-xs">
                        <div className="bg-zinc-800/60 rounded p-1.5">
                          <div className="text-zinc-500">Win rate</div>
                          <div className={validation.win_rate >= 0.5 ? "text-emerald-400" : "text-red-400"}>
                            {(validation.win_rate * 100).toFixed(0)}%
                            <span className="text-zinc-600 ml-1">({validation.total_signals} signals)</span>
                          </div>
                        </div>
                        <div className="bg-zinc-800/60 rounded p-1.5">
                          <div className="text-zinc-500">Exp. value</div>
                          <div className={validation.expected_value_pct >= 0 ? "text-emerald-400" : "text-red-400"}>
                            {validation.expected_value_pct >= 0 ? "+" : ""}{validation.expected_value_pct.toFixed(2)}%
                          </div>
                        </div>
                        <div className="bg-zinc-800/60 rounded p-1.5">
                          <div className="text-zinc-500">Avg win</div>
                          <div className="text-emerald-400">+{validation.avg_gain_pct.toFixed(2)}%</div>
                        </div>
                        <div className="bg-zinc-800/60 rounded p-1.5">
                          <div className="text-zinc-500">Avg loss</div>
                          <div className="text-red-400">{validation.avg_loss_pct.toFixed(2)}%</div>
                        </div>
                      </div>
                      <div className="text-xs text-zinc-600 text-center">
                        Profit factor {validation.profit_factor.toFixed(2)} · best {validation.best_pct.toFixed(1)}% / worst {validation.worst_pct.toFixed(1)}%
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
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

// ─── Strategy comparison table ───────────────────────────────────────────────

type StratCompareRow = { strategy: string; result: BacktestResult | null; error: string | null };

function StrategyComparisonTable({
  results,
  running,
  onLoad,
}: {
  results: StratCompareRow[] | null;
  running: boolean;
  onLoad: (r: BacktestResult) => void;
}) {
  if (running && !results) {
    return (
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-6 text-center text-zinc-400 text-sm">
        Running all strategies…
      </div>
    );
  }
  if (!results) return null;

  const successRows = results.filter((r) => r.result !== null);

  // Find best value per column
  const bestReturn = Math.max(...successRows.map((r) => r.result!.metrics.total_return_pct));
  const bestSharpe = Math.max(...successRows.map((r) => r.result!.metrics.sharpe_ratio));
  const bestWinRate = Math.max(...successRows.map((r) => r.result!.metrics.win_rate_pct));
  const bestTrades = Math.max(...successRows.map((r) => r.result!.metrics.total_trades));
  const bestMaxDD = Math.min(...successRows.map((r) => r.result!.metrics.max_drawdown_pct));

  return (
    <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg overflow-hidden">
      <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-zinc-200">Strategy Comparison</h3>
        <span className="text-xs text-zinc-500">{successRows.length}/{results.length} strategies succeeded</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[700px]">
          <thead>
            <tr className="text-left text-xs text-zinc-500 uppercase tracking-wide border-b border-zinc-800 bg-zinc-900/40">
              <th className="px-4 py-2">Strategy</th>
              <th className="px-4 py-2 text-right">Return %</th>
              <th className="px-4 py-2 text-right">Sharpe</th>
              <th className="px-4 py-2 text-right">Win Rate</th>
              <th className="px-4 py-2 text-right">Trades</th>
              <th className="px-4 py-2 text-right">Max DD</th>
              <th className="px-4 py-2 text-right"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/60">
            {results.map(({ strategy, result, error }) => {
              if (!result) {
                return (
                  <tr key={strategy} className="hover:bg-zinc-800/30">
                    <td className="px-4 py-2 font-medium text-zinc-400">{strategy}</td>
                    <td colSpan={5} className="px-4 py-2 text-xs text-red-400">{error ?? "Failed"}</td>
                    <td />
                  </tr>
                );
              }
              const m = result.metrics;
              const isBestReturn = m.total_return_pct === bestReturn;
              const isBestSharpe = m.sharpe_ratio === bestSharpe;
              const isBestWinRate = m.win_rate_pct === bestWinRate;
              const isBestTrades = m.total_trades === bestTrades;
              const isBestDD = m.max_drawdown_pct === bestMaxDD;
              return (
                <tr key={strategy} className="hover:bg-zinc-800/30 transition-colors">
                  <td className="px-4 py-2 font-medium text-zinc-200">{strategy}</td>
                  <td className={`px-4 py-2 text-right font-mono ${isBestReturn ? "text-emerald-400 font-bold" : m.total_return_pct >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                    {m.total_return_pct >= 0 ? "+" : ""}{m.total_return_pct.toFixed(2)}%
                  </td>
                  <td className={`px-4 py-2 text-right font-mono ${isBestSharpe ? "text-emerald-400 font-bold" : "text-zinc-300"}`}>
                    {m.sharpe_ratio.toFixed(2)}
                  </td>
                  <td className={`px-4 py-2 text-right font-mono ${isBestWinRate ? "text-emerald-400 font-bold" : "text-zinc-300"}`}>
                    {m.win_rate_pct.toFixed(1)}%
                  </td>
                  <td className={`px-4 py-2 text-right font-mono ${isBestTrades ? "text-emerald-400 font-bold" : "text-zinc-500"}`}>
                    {m.total_trades}
                  </td>
                  <td className={`px-4 py-2 text-right font-mono ${isBestDD ? "text-emerald-400 font-bold" : "text-red-400"}`}>
                    -{m.max_drawdown_pct.toFixed(1)}%
                  </td>
                  <td className="px-4 py-2 text-right">
                    <button
                      onClick={() => onLoad(result)}
                      className="text-xs text-cyan-400 hover:text-cyan-300 transition-colors"
                    >
                      Load
                    </button>
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
