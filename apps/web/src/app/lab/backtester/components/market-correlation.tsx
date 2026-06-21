"use client";

import { useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, ReferenceLine,
} from "recharts";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ConditionBucket {
  label: string;
  trade_count: number;
  win_rate: number;
  avg_pnl_pct: number;
  total_pnl: number;
}

interface MarketCorrelationResult {
  fear_greed: ConditionBucket[];
  hour_of_day: ConditionBucket[];
  btc_return_buckets: ConditionBucket[];
  btc_return_correlation: number;
  insights: string[];
}

// ── API call ──────────────────────────────────────────────────────────────────

async function fetchMarketCorrelation(params: {
  symbol: string;
  strategy: string;
  strategy_params: Record<string, number>;
  interval: string;
  period_days: number;
  initial_capital: number;
  commission_pct: number;
  slippage_pct: number;
  position_size_pct: number;
}): Promise<MarketCorrelationResult> {
  const res = await fetch("/api/v1/backtest/market_correlation", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ── Color helpers ─────────────────────────────────────────────────────────────

function pnlColor(v: number): string {
  if (v > 1) return "#4ade80";
  if (v > 0) return "#86efac";
  if (v > -1) return "#fca5a5";
  return "#f87171";
}

function pnlBg(v: number): string {
  if (v > 1) return "bg-emerald-900/30 border-emerald-700/40";
  if (v > 0) return "bg-emerald-900/20 border-emerald-800/30";
  if (v > -1) return "bg-red-900/20 border-red-800/30";
  return "bg-red-900/30 border-red-700/40";
}

// ── Sub-components ────────────────────────────────────────────────────────────

function BucketTable({ title, buckets }: { title: string; buckets: ConditionBucket[] }) {
  return (
    <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-4">
      <h4 className="text-xs font-semibold text-zinc-400 uppercase tracking-widest mb-3">{title}</h4>
      <div className="grid gap-2">
        {buckets.map((b) => (
          <div
            key={b.label}
            className={`border rounded-lg px-3 py-2 flex items-center justify-between ${pnlBg(b.avg_pnl_pct)}`}
          >
            <div>
              <div className="text-sm font-medium text-zinc-200">{b.label}</div>
              <div className="text-[11px] text-zinc-500 mt-0.5">
                {b.trade_count} trades · {b.win_rate.toFixed(0)}% WR
              </div>
            </div>
            <div className="text-right">
              <div className="font-bold font-mono text-sm" style={{ color: pnlColor(b.avg_pnl_pct) }}>
                {b.avg_pnl_pct >= 0 ? "+" : ""}{b.avg_pnl_pct.toFixed(2)}%
              </div>
              <div className="text-[10px] text-zinc-600">avg P&L</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function HourBarChart({ buckets }: { buckets: ConditionBucket[] }) {
  const data = buckets.map((b) => ({
    label: b.label,
    avgPnl: b.avg_pnl_pct,
    count: b.trade_count,
    winRate: b.win_rate,
  }));

  return (
    <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-4">
      <h4 className="text-xs font-semibold text-zinc-400 uppercase tracking-widest mb-3">Performance by Hour of Day (UTC)</h4>
      <ResponsiveContainer width="100%" height={140}>
        <BarChart data={data} margin={{ top: 4, right: 4, bottom: 20, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
          <XAxis
            dataKey="label"
            stroke="#52525b"
            tick={{ fill: "#71717a", fontSize: 8 }}
            tickFormatter={(v: string) => (v.length <= 3 ? v : "")}
          />
          <YAxis stroke="#52525b" tick={{ fill: "#71717a", fontSize: 9 }} tickFormatter={(v: number) => `${v.toFixed(1)}%`} />
          <ReferenceLine y={0} stroke="#52525b" />
          <Tooltip
            content={({ payload }) => {
              if (!payload?.length) return null;
              const d = payload[0]?.payload as typeof data[0];
              return (
                <div className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs">
                  <div className="font-bold text-zinc-300">{d.label}</div>
                  <div>{d.count} trades</div>
                  {d.count > 0 && (
                    <>
                      <div>Win rate: {d.winRate.toFixed(0)}%</div>
                      <div>Avg P&L: {d.avgPnl.toFixed(2)}%</div>
                    </>
                  )}
                </div>
              );
            }}
          />
          <Bar dataKey="avgPnl" isAnimationActive={false} radius={[2, 2, 0, 0]}>
            {data.map((d, i) => (
              <Cell key={i} fill={d.count === 0 ? "#27272a" : d.avgPnl >= 0 ? "#4ade80" : "#f87171"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export interface MarketCorrelationProps {
  symbol: string;
  strategy: string;
  strategyParams: Record<string, number>;
  interval: string;
  periodDays: number;
  initialCapital: number;
  commissionPct: number;
  slippagePct: number;
  positionPct: number;
}

export function MarketCorrelation({
  symbol, strategy, strategyParams, interval, periodDays,
  initialCapital, commissionPct, slippagePct, positionPct,
}: MarketCorrelationProps) {
  const [result, setResult] = useState<MarketCorrelationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchMarketCorrelation({
        symbol,
        strategy,
        strategy_params: strategyParams,
        interval,
        period_days: periodDays,
        initial_capital: initialCapital,
        commission_pct: commissionPct / 100,
        slippage_pct: slippagePct / 100,
        position_size_pct: positionPct / 100,
      });
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  const corrColor =
    result == null ? "text-zinc-400"
      : Math.abs(result.btc_return_correlation) < 0.2 ? "text-emerald-300"
      : result.btc_return_correlation > 0 ? "text-orange-300"
      : "text-cyan-300";

  return (
    <div className="space-y-4">
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-4">
        <h3 className="text-sm font-semibold text-zinc-200 mb-1">Market Condition Analysis</h3>
        <p className="text-xs text-zinc-500 mb-4">
          Break down strategy performance by market conditions: simulated Fear/Greed regime, BTC return quartiles, and time-of-day liquidity.
        </p>
        <button
          onClick={run}
          disabled={loading}
          className="px-4 py-2 bg-cyan-500 text-zinc-950 rounded-lg text-sm font-bold hover:bg-cyan-400 transition disabled:opacity-60 flex items-center gap-2"
        >
          {loading ? (
            <>
              <span className="w-3.5 h-3.5 border-2 border-zinc-950/30 border-t-zinc-950 rounded-full animate-spin" />
              Analyzing…
            </>
          ) : (
            "Analyze Market Conditions"
          )}
        </button>

        {error && (
          <div className="mt-3 text-xs text-red-400 bg-red-900/20 border border-red-800/50 rounded px-3 py-2">
            {error}
          </div>
        )}
      </div>

      {result && (
        <>
          {/* BTC correlation badge */}
          <div className="flex items-center gap-4 bg-zinc-900/50 border border-zinc-800 rounded-xl px-4 py-3">
            <div className="text-center min-w-[80px]">
              <div className={`text-3xl font-bold font-mono ${corrColor}`}>
                {result.btc_return_correlation >= 0 ? "+" : ""}{result.btc_return_correlation.toFixed(3)}
              </div>
              <div className="text-[10px] text-zinc-500 uppercase tracking-wide mt-0.5">BTC Correlation</div>
            </div>
            <div className="flex-1 text-xs text-zinc-400">
              {Math.abs(result.btc_return_correlation) < 0.2
                ? "Near-zero correlation — this strategy behaves independently of BTC's daily moves."
                : result.btc_return_correlation > 0
                ? "Positive correlation — strategy tends to win when BTC rises and lose when BTC falls."
                : "Negative correlation — strategy tends to profit when BTC falls (potential hedge)."}
            </div>
          </div>

          {/* Insights */}
          {result.insights.length > 0 && (
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-4">
              <h4 className="text-xs font-semibold text-zinc-400 uppercase tracking-widest mb-2">Key Insights</h4>
              <ul className="space-y-1.5">
                {result.insights.map((ins, i) => (
                  <li key={i} className="flex gap-2 text-xs text-zinc-300">
                    <span className="text-cyan-400 flex-shrink-0">→</span>
                    {ins}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Fear & Greed breakdown */}
          <BucketTable title="By Simulated Fear/Greed Regime" buckets={result.fear_greed} />

          {/* BTC return quartile breakdown */}
          <BucketTable title="By BTC Daily Return Quartile" buckets={result.btc_return_buckets} />

          {/* Hour-of-day chart */}
          {result.hour_of_day.some((b) => b.trade_count > 0) && (
            <HourBarChart buckets={result.hour_of_day} />
          )}
        </>
      )}
    </div>
  );
}
