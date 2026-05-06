"use client";

import { useMemo, useState } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { TradingViewChart } from "@/components/charts/TradingViewChart";
import type { UTCTimestamp } from "lightweight-charts";
import { cn } from "@/lib/utils";
import { TrendingUp, Repeat, Scale, Brain, Activity, Globe2, Play, Save, Loader2, TrendingDown, CheckCircle, XCircle } from "lucide-react";

// ─── Strategy profiles ───────────────────────────────────────────────────────

interface StrategyProfile {
  id: string;
  name: string;
  icon: React.ComponentType<{ className?: string }>;
  description: string;
  difficulty: string;
  winRate: number;     // 0–1
  avgWinPct: number;   // gross win per trade, % of position
  avgLossPct: number;  // gross loss per trade (positive = loss magnitude)
  tradesPerMonth: number;
  seed: number;
}

const STRATEGIES: StrategyProfile[] = [
  { id: "momentum",  name: "Momentum Breakout", icon: TrendingUp, description: "Buy on EMA cross + ADX > 25 + volume confirm", difficulty: "Beginner",     winRate: 0.62, avgWinPct: 0.034, avgLossPct: 0.021, tradesPerMonth: 16, seed: 7 },
  { id: "mean-rev",  name: "Mean Reversion",    icon: Repeat,     description: "Long on RSI < 30 with bullish divergence",     difficulty: "Intermediate", winRate: 0.69, avgWinPct: 0.020, avgLossPct: 0.024, tradesPerMonth: 30, seed: 13 },
  { id: "arb",       name: "Funding Arbitrage", icon: Scale,      description: "Harvest funding when |rate| > 0.05% / 8h",     difficulty: "Advanced",     winRate: 0.74, avgWinPct: 0.012, avgLossPct: 0.009, tradesPerMonth: 42, seed: 17 },
  { id: "sentiment", name: "Sentiment Surge",   icon: Brain,      description: "Long on FinBERT score > 0.85 + mention spike", difficulty: "Intermediate", winRate: 0.58, avgWinPct: 0.052, avgLossPct: 0.028, tradesPerMonth: 11, seed: 23 },
  { id: "onchain",   name: "Whale Mirror",      icon: Activity,   description: "Mirror top-50 smart-money wallet entries",     difficulty: "Beginner",     winRate: 0.66, avgWinPct: 0.041, avgLossPct: 0.030, tradesPerMonth: 8,  seed: 31 },
  { id: "macro",     name: "Macro Regime",      icon: Globe2,     description: "Trade BTC vs DXY + risk-on/off rotation",      difficulty: "Advanced",     winRate: 0.55, avgWinPct: 0.065, avgLossPct: 0.038, tradesPerMonth: 6,  seed: 37 },
];

const INDICATORS = [
  { id: "ema",       label: "EMA Cross",     category: "Trend"     },
  { id: "rsi",       label: "RSI",           category: "Momentum"  },
  { id: "macd",      label: "MACD",          category: "Momentum"  },
  { id: "bb",        label: "Bollinger Bands", category: "Volatility" },
  { id: "atr",       label: "ATR",           category: "Volatility" },
  { id: "vwap",      label: "VWAP",          category: "Volume"    },
  { id: "obv",       label: "OBV",           category: "Volume"    },
  { id: "funding",   label: "Funding Rate",  category: "On-chain"  },
  { id: "whale",     label: "Whale Flow",    category: "On-chain"  },
  { id: "sentiment", label: "FinBERT Score", category: "Sentiment" },
];

// ─── Simulation engine ───────────────────────────────────────────────────────

function mulberry32(seed: number) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 0xffffffff;
  };
}

interface SimTrade {
  n: number;
  date: string;
  side: "Long" | "Short";
  asset: string;
  entryPrice: number;
  exitPrice: number;
  sizeUsd: number;
  pnlUsd: number;
  pnlPct: number;
  duration: string;
  win: boolean;
}

interface SimResult {
  strategyName: string;
  asset: string;
  startDate: string;
  endDate: string;
  initialCapital: number;
  finalCapital: number;
  totalReturnPct: number;
  annualizedReturnPct: number;
  sharpeRatio: number;
  maxDrawdownPct: number;
  winRatePct: number;
  totalTrades: number;
  profitFactor: number;
  equityData: Array<{ time: number; value: number }>;
  sampleTrades: SimTrade[];
}

function runSimulation(
  profile: StrategyProfile,
  asset: string,
  startDate: string,
  endDate: string,
  initialCapital: number,
  riskPerTrade: number,
): SimResult {
  const rng = mulberry32(profile.seed ^ (initialCapital | 0) ^ Date.parse(startDate));

  const start = new Date(startDate);
  const end = new Date(endDate);
  const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000));
  const months = days / 30.44;
  const totalTrades = Math.round(profile.tradesPerMonth * months);

  // generate equity curve day-by-day
  const equityData: Array<{ time: number; value: number }> = [];
  let equity = initialCapital;
  let peak = equity;
  let maxDD = 0;
  let sumReturns = 0;
  let sumSqReturns = 0;

  const dailyTradesAvg = profile.tradesPerMonth / 30.44;
  let tradesSoFar = 0;
  const sampleTrades: SimTrade[] = [];

  const BASE_PRICE: Record<string, number> = {
    "ETH-USD": 3400, "BTC-USD": 68000, "SOL-USD": 180, "ARB-USD": 1.24
  };
  let assetPrice = BASE_PRICE[asset] ?? 3400;

  for (let d = 0; d < days; d++) {
    const dayTs = start.getTime() / 1000 + d * 86400;
    const prevEquity = equity;

    // simulate trades for this day
    const tradesThisDay = rng() < dailyTradesAvg - Math.floor(dailyTradesAvg)
      ? Math.ceil(dailyTradesAvg) : Math.floor(dailyTradesAvg);

    for (let t = 0; t < tradesThisDay && tradesSoFar < totalTrades; t++) {
      const win = rng() < profile.winRate;
      const returnPct = win
        ? profile.avgWinPct * (0.5 + rng())
        : -profile.avgLossPct * (0.5 + rng());
      const tradeSize = equity * (riskPerTrade / 100) / profile.avgLossPct;
      const pnlUsd = tradeSize * returnPct;
      equity += pnlUsd;

      if (equity > peak) peak = equity;
      const dd = (peak - equity) / peak;
      if (dd > maxDD) maxDD = dd;

      // collect first 8 sample trades
      if (sampleTrades.length < 8) {
        const tradeDate = new Date(start.getTime() + d * 86_400_000);
        const priceDrift = 1 + (rng() - 0.5) * 0.04;
        const ep = assetPrice * priceDrift;
        const side: "Long" | "Short" = rng() > 0.4 ? "Long" : "Short";
        const exitMult = side === "Long"
          ? (win ? 1 + Math.abs(returnPct) : 1 - Math.abs(returnPct))
          : (win ? 1 - Math.abs(returnPct) : 1 + Math.abs(returnPct));
        const xp = ep * exitMult;
        const hours = Math.round(2 + rng() * 46);
        sampleTrades.push({
          n: tradesSoFar + 1,
          date: tradeDate.toISOString().slice(0, 10),
          side,
          asset: asset.replace("-USD", ""),
          entryPrice: ep,
          exitPrice: xp,
          sizeUsd: Math.round(tradeSize),
          pnlUsd,
          pnlPct: returnPct * 100,
          duration: hours < 24 ? `${hours}h` : `${Math.round(hours / 24)}d`,
          win,
        });
      }

      assetPrice *= 1 + (rng() - 0.49) * 0.003;
      tradesSoFar++;
    }

    const dayReturn = (equity - prevEquity) / prevEquity;
    sumReturns += dayReturn;
    sumSqReturns += dayReturn * dayReturn;

    equityData.push({ time: Math.floor(dayTs), value: Math.round(equity * 100) / 100 });
  }

  const mean = sumReturns / days;
  const variance = sumSqReturns / days - mean * mean;
  const sharpe = variance > 0 ? (mean / Math.sqrt(variance)) * Math.sqrt(365) : 0;

  const totalReturn = (equity - initialCapital) / initialCapital;
  const annualized = Math.pow(1 + totalReturn, 365 / days) - 1;

  // profit factor from profile ratios * win rate
  const grossProfit = profile.winRate * profile.avgWinPct * totalTrades;
  const grossLoss = (1 - profile.winRate) * profile.avgLossPct * totalTrades;
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : 9.99;

  return {
    strategyName: profile.name,
    asset,
    startDate,
    endDate,
    initialCapital,
    finalCapital: equity,
    totalReturnPct: totalReturn * 100,
    annualizedReturnPct: annualized * 100,
    sharpeRatio: sharpe,
    maxDrawdownPct: maxDD * 100,
    winRatePct: profile.winRate * 100,
    totalTrades: tradesSoFar,
    profitFactor,
    equityData,
    sampleTrades,
  };
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function LabPage() {
  const [selectedId, setSelectedId] = useState(STRATEGIES[0]!.id);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<SimResult | null>(null);
  const [config, setConfig] = useState({
    asset: "ETH-USD",
    startDate: "2024-01-01",
    endDate: "2024-06-01",
    initialCapital: 10_000,
    riskPerTrade: 2,
  });

  const profile = STRATEGIES.find((s) => s.id === selectedId)!;

  const handleRun = async () => {
    setRunning(true);
    setResult(null);
    // small delay so spinner is visible
    await new Promise((r) => setTimeout(r, 900 + Math.random() * 600));
    const sim = runSimulation(
      profile,
      config.asset,
      config.startDate,
      config.endDate,
      config.initialCapital,
      config.riskPerTrade,
    );
    setResult(sim);
    setRunning(false);
  };

  const chartData = useMemo(
    () => result?.equityData.map((d) => ({ time: d.time as UTCTimestamp, value: d.value })),
    [result],
  );

  return (
    <DashboardLayout>
      <div className="flex flex-col gap-6 p-6 max-w-[1600px] mx-auto">
        <div>
          <h1 className="text-2xl font-bold text-slate-50 tracking-tight">Strategy Lab</h1>
          <p className="text-sm text-slate-400 mt-1">Build, backtest, and deploy automated trading strategies</p>
        </div>

        {/* Template picker */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {STRATEGIES.map((s) => {
            const Icon = s.icon;
            const active = s.id === selectedId;
            return (
              <button
                key={s.id}
                onClick={() => setSelectedId(s.id)}
                className={cn(
                  "card-dark p-4 text-left transition-all",
                  active ? "border-cyan-500/40 bg-cyan-500/5" : "hover:border-slate-700"
                )}
              >
                <div className={cn(
                  "w-9 h-9 rounded-lg flex items-center justify-center mb-3 border",
                  active ? "bg-cyan-500/15 border-cyan-500/30" : "bg-slate-900 border-slate-800"
                )}>
                  <Icon className={cn("w-4 h-4", active ? "text-cyan-400" : "text-slate-400")} />
                </div>
                <p className={cn("text-sm font-semibold mb-1", active ? "text-cyan-200" : "text-slate-100")}>{s.name}</p>
                <p className="text-[10px] text-slate-500 leading-relaxed line-clamp-2">{s.description}</p>
                <p className="text-[9px] uppercase tracking-widest text-slate-600 font-bold mt-2">{s.difficulty}</p>
              </button>
            );
          })}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
          {/* Signal builder canvas */}
          <div className="card-dark p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-slate-100">Signal Builder</h2>
              <button className="text-xs flex items-center gap-1 text-slate-400 hover:text-slate-200 transition-colors">
                <Save className="w-3 h-3" /> Save Strategy
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-2">Indicators</p>
                <div className="flex flex-col gap-1.5">
                  {INDICATORS.map((b) => (
                    <div key={b.id} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-800/60 border border-slate-700/50 hover:border-cyan-500/30 cursor-grab transition-colors">
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
                  <p className="text-xs text-slate-600 text-center mt-auto py-3">Drag indicators here to add conditions</p>
                </div>
              </div>
            </div>
          </div>

          {/* Config panel */}
          <div className="card-dark p-5 flex flex-col gap-4 h-fit">
            <h2 className="text-sm font-semibold text-slate-100">Backtest Configuration</h2>

            <Field label="Asset">
              <select value={config.asset} onChange={(e) => setConfig({ ...config, asset: e.target.value })}
                className="bg-slate-800 border border-slate-700 rounded-md px-2 py-1.5 text-sm text-slate-200 w-full focus:border-cyan-500 outline-none">
                {["ETH-USD", "BTC-USD", "SOL-USD", "ARB-USD"].map((a) => <option key={a}>{a}</option>)}
              </select>
            </Field>

            <Field label="Start Date">
              <input type="date" value={config.startDate}
                onChange={(e) => setConfig({ ...config, startDate: e.target.value })}
                className="bg-slate-800 border border-slate-700 rounded-md px-2 py-1.5 text-sm text-slate-200 w-full focus:border-cyan-500 outline-none" />
            </Field>

            <Field label="End Date">
              <input type="date" value={config.endDate}
                onChange={(e) => setConfig({ ...config, endDate: e.target.value })}
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
              <input type="number" step={0.1} min={0.1} max={10} value={config.riskPerTrade}
                onChange={(e) => setConfig({ ...config, riskPerTrade: +e.target.value })}
                className="bg-slate-800 border border-slate-700 rounded-md px-2 py-1.5 text-sm text-slate-200 w-full focus:border-cyan-500 outline-none number-font" />
            </Field>

            {/* Expected stats preview */}
            <div className="rounded-lg bg-slate-950/60 border border-slate-800 p-3 flex flex-col gap-1.5">
              <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-0.5">Strategy Profile</p>
              <StatRow label="Win Rate"      value={`${(profile.winRate * 100).toFixed(0)}%`} />
              <StatRow label="Avg Win"       value={`+${(profile.avgWinPct * 100).toFixed(1)}%`} />
              <StatRow label="Avg Loss"      value={`-${(profile.avgLossPct * 100).toFixed(1)}%`} />
              <StatRow label="Trades / mo"   value={String(profile.tradesPerMonth)} />
            </div>

            <button onClick={handleRun} disabled={running}
              className="mt-1 w-full py-2.5 rounded-lg bg-cyan-500 text-slate-950 text-sm font-semibold hover:bg-cyan-400 transition-colors disabled:opacity-60 flex items-center justify-center gap-2 shadow-[0_0_20px_-5px_rgba(34,211,238,0.5)]">
              {running
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Simulating…</>
                : <><Play className="w-4 h-4" /> Run Backtest</>}
            </button>
          </div>
        </div>

        {/* Results */}
        {(running || result) && (
          <div className="card-dark p-5 animate-fade-in">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-slate-100">
                {running ? "Simulating backtest…" : `Results — ${result?.strategyName} on ${result?.asset}`}
              </h2>
              {result && (
                <span className="text-xs text-slate-500 number-font">
                  {result.totalTrades} trades · {result.startDate} → {result.endDate}
                </span>
              )}
            </div>

            {running && (
              <div className="h-64 flex items-center justify-center">
                <Loader2 className="w-8 h-8 text-cyan-400 animate-spin" />
              </div>
            )}

            {result && (
              <>
                <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-5">
                  <ResultStat label="Total Return"  value={`${result.totalReturnPct >= 0 ? "+" : ""}${result.totalReturnPct.toFixed(1)}%`}  color={result.totalReturnPct >= 0 ? "emerald" : "red"} />
                  <ResultStat label="Annualized"    value={`${result.annualizedReturnPct >= 0 ? "+" : ""}${result.annualizedReturnPct.toFixed(0)}%`} color={result.annualizedReturnPct >= 0 ? "emerald" : "red"} />
                  <ResultStat label="Sharpe"        value={result.sharpeRatio.toFixed(2)}  color="cyan" />
                  <ResultStat label="Max Drawdown"  value={`-${result.maxDrawdownPct.toFixed(1)}%`} color="red" />
                  <ResultStat label="Win Rate"      value={`${result.winRatePct.toFixed(1)}%`} color="slate" />
                  <ResultStat label="Profit Factor" value={result.profitFactor.toFixed(2)} color={result.profitFactor >= 1.5 ? "emerald" : "amber"} />
                </div>

                <TradingViewChart
                  data={chartData}
                  height={280}
                  type="area"
                />

                {/* Trade history */}
                <div className="mt-5">
                  <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">Sample Trades</h3>
                  <div className="overflow-x-auto -mx-1">
                    <table className="w-full text-xs min-w-[680px]">
                      <thead>
                        <tr className="border-b border-slate-800 text-[10px] font-bold uppercase tracking-widest text-slate-500">
                          {["#", "Date", "Side", "Asset", "Entry", "Exit", "Size", "P&L", "Duration"].map((h) => (
                            <th key={h} className="pb-2 text-left px-1">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/50">
                        {result.sampleTrades.map((t) => (
                          <tr key={t.n} className="hover:bg-slate-800/30 transition-colors">
                            <td className="py-2.5 px-1 text-slate-600 number-font">{t.n}</td>
                            <td className="py-2.5 px-1 text-slate-400 number-font">{t.date}</td>
                            <td className="py-2.5 px-1">
                              <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-bold uppercase",
                                t.side === "Long" ? "bg-emerald-500/15 text-emerald-400" : "bg-red-500/15 text-red-400"
                              )}>{t.side}</span>
                            </td>
                            <td className="py-2.5 px-1 font-mono text-slate-200">{t.asset}</td>
                            <td className="py-2.5 px-1 text-slate-400 number-font">${t.entryPrice >= 100 ? t.entryPrice.toFixed(2) : t.entryPrice.toFixed(4)}</td>
                            <td className="py-2.5 px-1 text-slate-300 number-font">${t.exitPrice >= 100 ? t.exitPrice.toFixed(2) : t.exitPrice.toFixed(4)}</td>
                            <td className="py-2.5 px-1 text-slate-400 number-font">${t.sizeUsd.toLocaleString()}</td>
                            <td className="py-2.5 px-1">
                              <div className={cn("flex items-center gap-1 font-semibold number-font",
                                t.win ? "text-emerald-400" : "text-red-400"
                              )}>
                                {t.win ? <CheckCircle className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                                {t.pnlUsd >= 0 ? "+" : ""}${Math.abs(t.pnlUsd).toFixed(0)}
                                <span className="opacity-60 text-[10px]">({t.pnlPct >= 0 ? "+" : ""}{t.pnlPct.toFixed(1)}%)</span>
                              </div>
                            </td>
                            <td className="py-2.5 px-1 text-slate-500 number-font">{t.duration}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">{label}</label>
      {children}
    </div>
  );
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-xs text-slate-500">{label}</span>
      <span className="text-xs text-slate-200 font-mono number-font">{value}</span>
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

type StatColor = "emerald" | "red" | "cyan" | "amber" | "slate";

function ResultStat({ label, value, color }: { label: string; value: string; color: StatColor }) {
  const colorMap: Record<StatColor, string> = {
    emerald: "text-emerald-400",
    red: "text-red-400",
    cyan: "text-cyan-400",
    amber: "text-amber-400",
    slate: "text-slate-100",
  };
  return (
    <div className="bg-slate-900 rounded-lg p-3 border border-slate-800">
      <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-1">{label}</p>
      <p className={cn("text-lg font-bold number-font", colorMap[color])}>{value}</p>
    </div>
  );
}
