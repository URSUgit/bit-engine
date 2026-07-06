"use client";

import { useState } from "react";
import { TradingViewChart, type LineBar } from "@/components/charts/TradingViewChart";
import { cn } from "@/lib/utils";
import { TrendingUp, Repeat, Scale, Brain, Activity, Globe2, Play, Loader2 } from "lucide-react";
import { backtestApi, type BacktestResult } from "@/lib/backtest-api";

const strategyTemplates = [
  { id: "momentum",      name: "Momentum Breakout",   icon: TrendingUp, description: "Buy on EMA cross + ADX > 25 + volume confirm",  difficulty: "Beginner" },
  { id: "mean-rev",      name: "Mean Reversion",      icon: Repeat,     description: "Long on RSI < 30 with bullish divergence",      difficulty: "Intermediate" },
  { id: "arb",           name: "Funding Arbitrage",   icon: Scale,      description: "Harvest funding when |rate| > 0.05% / 8h",      difficulty: "Advanced" },
  { id: "sentiment",     name: "Sentiment Surge",     icon: Brain,      description: "Long on FinBERT score > 0.85 + mention spike",  difficulty: "Intermediate" },
  { id: "onchain",       name: "Whale Mirror",        icon: Activity,   description: "Mirror top-50 smart-money wallet entries",      difficulty: "Beginner" },
  { id: "macro",         name: "Macro Regime",        icon: Globe2,     description: "Trade BTC vs DXY + risk-on/off rotation",       difficulty: "Advanced" },
];

const indicatorBlocks = [
  { id: "ema", label: "EMA Cross", category: "Trend" },
  { id: "rsi", label: "RSI", category: "Momentum" },
  { id: "macd", label: "MACD", category: "Momentum" },
  { id: "bb",  label: "Bollinger Bands", category: "Volatility" },
  { id: "atr", label: "ATR", category: "Volatility" },
  { id: "vwap", label: "VWAP", category: "Volume" },
  { id: "obv", label: "OBV", category: "Volume" },
  { id: "funding", label: "Funding Rate", category: "On-chain" },
  { id: "whale", label: "Whale Flow", category: "On-chain" },
  { id: "sentiment", label: "FinBERT Score", category: "Sentiment" },
];

// Template → real signal-service strategy name
const TEMPLATE_STRATEGY: Record<string, string> = {
  momentum: "momentum",
  "mean-rev": "rsi",
  arb: "bollinger",
  sentiment: "rsi",
  onchain: "ma_cross",
  macro: "ma_cross",
};

type LabResult = {
  strategyName: string;
  totalReturnPct: number;
  annualizedReturnPct: number;
  sharpeRatio: number;
  maxDrawdownPct: number;
  winRatePct: number;
  profitFactor: number;
  totalTrades: number;
  startDate: string;
  endDate: string;
  equity: LineBar[];
};

function toLabResult(r: BacktestResult): LabResult {
  const equity: LineBar[] = (r.equity_curve ?? []).map((pt) => ({
    time: pt.t as LineBar["time"],
    value: pt.equity,
  }));
  return {
    strategyName: `${r.strategy} · ${r.symbol}`,
    totalReturnPct: r.metrics.total_return_pct,
    annualizedReturnPct: r.metrics.cagr_pct,
    sharpeRatio: r.metrics.sharpe_ratio,
    maxDrawdownPct: r.metrics.max_drawdown_pct,
    winRatePct: r.metrics.win_rate_pct,
    profitFactor: r.metrics.profit_factor,
    totalTrades: r.metrics.total_trades,
    startDate: r.start_date,
    endDate: r.end_date,
    equity,
  };
}

export default function LabPage() {
  const [selectedTemplate, setSelectedTemplate] = useState(strategyTemplates[0]!.id);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<LabResult | null>(null);
  const [config, setConfig] = useState({
    asset: "ETH-USD",
    startDate: "2024-01-01",
    endDate: "2024-06-01",
    initialCapital: 10_000,
    riskPerTrade: 2,
  });

  const runBacktest = async () => {
    setRunning(true);
    setResult(null);
    setError(null);
    try {
      const strategy = TEMPLATE_STRATEGY[selectedTemplate] ?? "rsi";
      const raw = await backtestApi.run({
        symbol: config.asset,
        strategy,
        start_date: config.startDate,
        end_date: config.endDate,
        interval: "1d",
        initial_capital: config.initialCapital,
        commission_pct: 0.1,
        slippage_pct: 0.05,
        position_size_pct: 95,
        strategy_params: {},
      });
      setResult(toLabResult(raw));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  return (
      <div className="flex flex-col gap-6 p-6 max-w-[1600px] mx-auto">
        <div>
          <h1 className="text-2xl font-bold text-slate-50 tracking-tight">Strategy Lab</h1>
          <p className="text-sm text-slate-400 mt-1">Build, backtest, and deploy automated trading strategies</p>
        </div>

        {/* Templates row */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {strategyTemplates.map((t) => {
            const Icon = t.icon;
            const active = t.id === selectedTemplate;
            return (
              <button
                key={t.id}
                onClick={() => setSelectedTemplate(t.id)}
                className={cn(
                  "card-dark p-4 text-left transition-all group",
                  active ? "border-cyan-500/40 bg-cyan-500/5" : "hover:border-slate-700"
                )}
              >
                <div className={cn("w-9 h-9 rounded-lg flex items-center justify-center mb-3 border",
                  active ? "bg-cyan-500/15 border-cyan-500/30" : "bg-slate-900 border-slate-800")}>
                  <Icon className={cn("w-4 h-4", active ? "text-cyan-400" : "text-slate-400")} />
                </div>
                <p className={cn("text-sm font-semibold mb-1", active ? "text-cyan-200" : "text-slate-100")}>{t.name}</p>
                <p className="text-[10px] text-slate-500 leading-relaxed line-clamp-2">{t.description}</p>
                <p className="text-[9px] uppercase tracking-widest text-slate-600 font-bold mt-2">{t.difficulty}</p>
              </button>
            );
          })}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
          {/* Builder canvas */}
          <div className="card-dark p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-slate-100">Signal Builder</h2>
              <button className="text-xs flex items-center gap-1 text-slate-400 hover:text-slate-200 transition-colors">
                Save Strategy
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-2">Indicators</p>
                <div className="flex flex-col gap-1.5">
                  {indicatorBlocks.map((b) => (
                    <div
                      key={b.id}
                      className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-800/60 border border-slate-700/50 hover:border-cyan-500/30 cursor-grab transition-colors"
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-cyan-500" />
                      <span className="text-sm text-slate-200 font-medium">{b.label}</span>
                      <span className="ml-auto text-[10px] text-slate-500 uppercase tracking-wide">{b.category}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-2">Active Conditions</p>
                <div className="flex flex-col gap-2 min-h-[260px] p-3 border-2 border-dashed border-slate-800 rounded-lg bg-slate-950/40">
                  <ConditionBlock when="EMA(20) crosses above EMA(50)" />
                  <ConditionBlock when="ADX(14) > 25" />
                  <ConditionBlock when="Volume > 1.5× 20-bar avg" />
                  <p className="text-xs text-slate-600 text-center mt-auto py-3">
                    Drag indicators here to add conditions
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Backtest config */}
          <div className="card-dark p-5 flex flex-col gap-4 h-fit">
            <h2 className="text-sm font-semibold text-slate-100">Backtest Configuration</h2>

            <Field label="Asset">
              <select
                value={config.asset}
                onChange={(e) => setConfig({ ...config, asset: e.target.value })}
                className="bg-slate-800 border border-slate-700 rounded-md px-2 py-1.5 text-sm text-slate-200 w-full focus:border-cyan-500 outline-none"
              >
                {["ETH-USD", "BTC-USD", "SOL-USD", "ARB-USD"].map((a) => <option key={a}>{a}</option>)}
              </select>
            </Field>

            <Field label="Start Date">
              <input type="date" value={config.startDate} onChange={(e) => setConfig({ ...config, startDate: e.target.value })}
                className="bg-slate-800 border border-slate-700 rounded-md px-2 py-1.5 text-sm text-slate-200 w-full focus:border-cyan-500 outline-none" />
            </Field>

            <Field label="End Date">
              <input type="date" value={config.endDate} onChange={(e) => setConfig({ ...config, endDate: e.target.value })}
                className="bg-slate-800 border border-slate-700 rounded-md px-2 py-1.5 text-sm text-slate-200 w-full focus:border-cyan-500 outline-none" />
            </Field>

            <Field label="Initial Capital">
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">$</span>
                <input type="number" value={config.initialCapital}
                  onChange={(e) => setConfig({ ...config, initialCapital: +e.target.value })}
                  className="bg-slate-800 border border-slate-700 rounded-md pl-6 pr-2 py-1.5 text-sm text-slate-200 w-full focus:border-cyan-500 outline-none number-font" />
              </div>
            </Field>

            <Field label="Risk per Trade (%)">
              <input type="number" step={0.1} value={config.riskPerTrade}
                onChange={(e) => setConfig({ ...config, riskPerTrade: +e.target.value })}
                className="bg-slate-800 border border-slate-700 rounded-md px-2 py-1.5 text-sm text-slate-200 w-full focus:border-cyan-500 outline-none number-font" />
            </Field>

            <button
              onClick={runBacktest}
              disabled={running}
              className="mt-2 w-full py-2.5 rounded-lg bg-cyan-500 text-slate-950 text-sm font-semibold hover:bg-cyan-400 transition-colors disabled:opacity-60 flex items-center justify-center gap-2 shadow-[0_0_20px_-5px_rgba(34,211,238,0.5)]"
            >
              {running ? <><Loader2 className="w-4 h-4 animate-spin" /> Running…</> : <><Play className="w-4 h-4" />Run Backtest</>}
            </button>
          </div>
        </div>

        {/* Results */}
        {(running || result || error) && (
          <div className="card-dark p-5 animate-fade-in">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-slate-100">
                {running ? "Running backtest…" : error ? "Backtest failed" : `Results: ${result?.strategyName}`}
              </h2>
              {result && <span className="text-xs text-slate-500 number-font">{result.totalTrades} trades · {result.startDate} → {result.endDate}</span>}
            </div>

            {error && <p className="text-sm text-red-400 bg-red-950/30 border border-red-900 p-3 rounded">{error}</p>}

            {result && (
              <>
                <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-5">
                  <ResultStat label="Total Return"  value={`${result.totalReturnPct >= 0 ? "+" : ""}${result.totalReturnPct.toFixed(1)}%`} positive={result.totalReturnPct >= 0} />
                  <ResultStat label="Annualized"    value={`${result.annualizedReturnPct >= 0 ? "+" : ""}${result.annualizedReturnPct.toFixed(1)}%`} positive={result.annualizedReturnPct >= 0} />
                  <ResultStat label="Sharpe"        value={result.sharpeRatio.toFixed(2)} />
                  <ResultStat label="Max DD"        value={`-${result.maxDrawdownPct.toFixed(1)}%`} negative />
                  <ResultStat label="Win Rate"      value={`${result.winRatePct.toFixed(1)}%`} />
                  <ResultStat label="Profit Factor" value={result.profitFactor.toFixed(2)} />
                </div>
                <TradingViewChart height={280} type="area" data={result.equity} />
              </>
            )}
            {running && (
              <div className="h-64 flex items-center justify-center">
                <Loader2 className="w-8 h-8 text-cyan-400 animate-spin" />
              </div>
            )}
          </div>
        )}
      </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">{label}</label>
      {children}
    </div>
  );
}

function ConditionBlock({ when }: { when: string }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-cyan-500/5 border border-cyan-500/20">
      <span className="text-[10px] uppercase tracking-widest text-cyan-400 font-bold">When</span>
      <span className="text-xs text-slate-200 font-mono flex-1">{when}</span>
      <button className="text-slate-600 hover:text-red-400 text-xs">×</button>
    </div>
  );
}

function ResultStat({ label, value, positive, negative }: { label: string; value: string; positive?: boolean; negative?: boolean }) {
  return (
    <div className="bg-slate-900 rounded-lg p-3 border border-slate-800">
      <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-1">{label}</p>
      <p className={cn("text-lg font-bold number-font",
        positive === true ? "text-emerald-400" : negative ? "text-red-400" : "text-slate-100")}>
        {value}
      </p>
    </div>
  );
}

