"use client";

import { useMemo, useState } from "react";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Cell,
} from "recharts";
import type { BacktestResult, EquityPoint, Trade } from "@/lib/backtest-api";

// ─── Types ────────────────────────────────────────────────────────────────────

interface DrawdownPeriod {
  startIdx: number;
  troughIdx: number;
  recoveryIdx: number | null;
  startDate: string;
  troughDate: string;
  recoveryDate: string | null;
  maxDDPct: number;
  durationBars: number;
  recoveryBars: number | null;
}

interface RollingPoint {
  t: number;
  label: string;
  sharpe: number;
  returnPct: number;
  volatility: number;
}

interface QuarterBucket {
  quarter: string;
  winRate: number;
  trades: number;
  netPnl: number;
}

interface DurationBucket {
  label: string;
  count: number;
  wins: number;
  losses: number;
  avgPnl: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(t: number): string {
  return new Date(t * 1000).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function fmtDateShort(t: number): string {
  return new Date(t * 1000).toLocaleDateString("en-US", {
    month: "short",
    year: "2-digit",
  });
}

function rollingAnnualizedReturn(slice: EquityPoint[]): number {
  if (slice.length < 2) return 0;
  const r =
    (slice[slice.length - 1].equity - slice[0].equity) / slice[0].equity;
  return r * (252 / slice.length) * 100;
}

function rollingVolatility(slice: EquityPoint[]): number {
  if (slice.length < 2) return 0;
  const returns: number[] = [];
  for (let i = 1; i < slice.length; i++) {
    if (slice[i - 1].equity > 0) {
      returns.push(
        (slice[i].equity - slice[i - 1].equity) / slice[i - 1].equity,
      );
    }
  }
  if (returns.length === 0) return 0;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance =
    returns.reduce((a, b) => a + (b - mean) ** 2, 0) / returns.length;
  return Math.sqrt(variance) * Math.sqrt(252) * 100;
}

function rollingSharpe(slice: EquityPoint[]): number {
  const ret = rollingAnnualizedReturn(slice) / 100;
  const vol = rollingVolatility(slice) / 100;
  return vol > 0 ? ret / vol : 0;
}

function computeRollingMetrics(
  equityCurve: EquityPoint[],
  windowBars: number,
): RollingPoint[] {
  const result: RollingPoint[] = [];
  for (let i = windowBars; i < equityCurve.length; i++) {
    const slice = equityCurve.slice(i - windowBars, i + 1);
    const pt = equityCurve[i];
    result.push({
      t: pt.t,
      label: fmtDateShort(pt.t),
      sharpe: rollingSharpe(slice),
      returnPct: rollingAnnualizedReturn(slice),
      volatility: rollingVolatility(slice),
    });
  }
  return result;
}

function computeDrawdownPeriods(equityCurve: EquityPoint[]): {
  underwaterData: { t: number; label: string; dd: number }[];
  periods: DrawdownPeriod[];
} {
  if (equityCurve.length === 0) return { underwaterData: [], periods: [] };

  let peak = equityCurve[0].equity;
  const underwaterData: { t: number; label: string; dd: number }[] = [];

  for (const pt of equityCurve) {
    if (pt.equity > peak) peak = pt.equity;
    const dd = peak > 0 ? ((peak - pt.equity) / peak) * 100 : 0;
    underwaterData.push({ t: pt.t, label: fmtDateShort(pt.t), dd: -dd });
  }

  // Find distinct drawdown periods
  const periods: DrawdownPeriod[] = [];
  let inDD = false;
  let startIdx = 0;
  let troughIdx = 0;
  let runningPeak = equityCurve[0].equity;

  for (let i = 0; i < equityCurve.length; i++) {
    const eq = equityCurve[i].equity;
    if (eq > runningPeak) {
      runningPeak = eq;
      if (inDD) {
        periods.push({
          startIdx,
          troughIdx,
          recoveryIdx: i,
          startDate: fmtDate(equityCurve[startIdx].t),
          troughDate: fmtDate(equityCurve[troughIdx].t),
          recoveryDate: fmtDate(equityCurve[i].t),
          maxDDPct:
            equityCurve[startIdx].equity > 0
              ? ((equityCurve[startIdx].equity -
                  equityCurve[troughIdx].equity) /
                  equityCurve[startIdx].equity) *
                100
              : 0,
          durationBars: troughIdx - startIdx,
          recoveryBars: i - troughIdx,
        });
        inDD = false;
      }
    } else if (eq < runningPeak) {
      if (!inDD) {
        inDD = true;
        startIdx = i > 0 ? i - 1 : 0;
        troughIdx = i;
      } else if (eq < equityCurve[troughIdx].equity) {
        troughIdx = i;
      }
    }
  }

  // Still in drawdown at end
  if (inDD) {
    periods.push({
      startIdx,
      troughIdx,
      recoveryIdx: null,
      startDate: fmtDate(equityCurve[startIdx].t),
      troughDate: fmtDate(equityCurve[troughIdx].t),
      recoveryDate: null,
      maxDDPct:
        equityCurve[startIdx].equity > 0
          ? ((equityCurve[startIdx].equity - equityCurve[troughIdx].equity) /
              equityCurve[startIdx].equity) *
            100
          : 0,
      durationBars: troughIdx - startIdx,
      recoveryBars: null,
    });
  }

  periods.sort((a, b) => b.maxDDPct - a.maxDDPct);
  return { underwaterData, periods };
}

function getQuarterKey(dateStr: string): string {
  const d = new Date(dateStr);
  const year = d.getFullYear();
  const q = Math.floor(d.getMonth() / 3) + 1;
  return `Q${q} ${year}`;
}

function computeQuarterlyWinRate(trades: Trade[]): QuarterBucket[] {
  const map = new Map<string, { wins: number; total: number; netPnl: number }>();
  for (const t of trades) {
    const key = getQuarterKey(t.exit_time);
    const existing = map.get(key) ?? { wins: 0, total: 0, netPnl: 0 };
    existing.total++;
    if (t.pnl >= 0) existing.wins++;
    existing.netPnl += t.pnl;
    map.set(key, existing);
  }
  return Array.from(map.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([quarter, { wins, total, netPnl }]) => ({
      quarter,
      winRate: total > 0 ? (wins / total) * 100 : 0,
      trades: total,
      netPnl,
    }));
}

function computeDurationDistribution(trades: Trade[]): DurationBucket[] {
  const buckets: { label: string; min: number; max: number }[] = [
    { label: "1 bar", min: 1, max: 1 },
    { label: "2–3 bars", min: 2, max: 3 },
    { label: "4–7 bars", min: 4, max: 7 },
    { label: "8–14 bars", min: 8, max: 14 },
    { label: "15–30 bars", min: 15, max: 30 },
    { label: "30+ bars", min: 31, max: Infinity },
  ];
  return buckets.map(({ label, min, max }) => {
    const matching = trades.filter(
      (t) => t.duration_bars >= min && t.duration_bars <= max,
    );
    const wins = matching.filter((t) => t.pnl >= 0);
    const losses = matching.filter((t) => t.pnl < 0);
    const totalPnl = matching.reduce((s, t) => s + t.pnl_pct, 0);
    return {
      label,
      count: matching.length,
      wins: wins.length,
      losses: losses.length,
      avgPnl: matching.length > 0 ? totalPnl / matching.length : 0,
    };
  });
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-300 mb-3">
      {children}
    </h3>
  );
}

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div className="bg-zinc-950 border border-zinc-800 rounded p-3">
      <div className="text-[10px] uppercase tracking-wide text-zinc-500 mb-1">
        {label}
      </div>
      <div className={`text-lg font-semibold ${color ?? "text-zinc-200"}`}>
        {value}
      </div>
    </div>
  );
}

// ─── Section 1: Drawdown Deep-Dive ───────────────────────────────────────────

function DrawdownSection({ equityCurve }: { equityCurve: EquityPoint[] }) {
  const { underwaterData, periods } = useMemo(
    () => computeDrawdownPeriods(equityCurve),
    [equityCurve],
  );

  const top5 = periods.slice(0, 5);
  const currentDD = underwaterData[underwaterData.length - 1]?.dd ?? 0;
  const avgDD =
    periods.length > 0
      ? periods.reduce((s, p) => s + p.maxDDPct, 0) / periods.length
      : 0;
  const maxDD = periods.length > 0 ? periods[0].maxDDPct : 0;
  const recoveredPeriods = periods.filter((p) => p.recoveryBars !== null);
  const avgRecovery =
    recoveredPeriods.length > 0
      ? recoveredPeriods.reduce((s, p) => s + p.recoveryBars!, 0) /
        recoveredPeriods.length
      : 0;

  return (
    <div className="space-y-4">
      <SectionHeader>Drawdown Deep-Dive</SectionHeader>

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard
          label="Max Drawdown"
          value={`-${maxDD.toFixed(2)}%`}
          color="text-red-400"
        />
        <StatCard
          label="Avg Drawdown"
          value={`-${avgDD.toFixed(2)}%`}
          color="text-orange-400"
        />
        <StatCard
          label="Avg Recovery"
          value={avgRecovery > 0 ? `${avgRecovery.toFixed(1)} bars` : "—"}
          color="text-zinc-300"
        />
        <StatCard
          label="Current DD"
          value={`${currentDD.toFixed(2)}%`}
          color={currentDD < -0.1 ? "text-red-400" : "text-emerald-400"}
        />
      </div>

      {/* Underwater equity curve */}
      <div>
        <p className="text-xs text-zinc-500 mb-2">
          Underwater equity curve — depth of drawdown over time
        </p>
        <ResponsiveContainer width="100%" height={180}>
          <AreaChart
            data={underwaterData}
            margin={{ top: 4, right: 8, left: 8, bottom: 0 }}
          >
            <defs>
              <linearGradient id="ddGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#ef4444" stopOpacity={0.5} />
                <stop offset="100%" stopColor="#ef4444" stopOpacity={0.05} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 10, fill: "#71717a" }}
              interval="preserveStartEnd"
              tickLine={false}
            />
            <YAxis
              tick={{ fontSize: 10, fill: "#71717a" }}
              tickLine={false}
              tickFormatter={(v: number) => `${v.toFixed(0)}%`}
              width={48}
            />
            <Tooltip
              contentStyle={{
                background: "#18181b",
                border: "1px solid #3f3f46",
                borderRadius: 6,
                fontSize: 12,
              }}
              formatter={(v) => [typeof v === "number" ? `${v.toFixed(2)}%` : "—", "Drawdown"]}
              labelStyle={{ color: "#a1a1aa" }}
            />
            <Area
              type="monotone"
              dataKey="dd"
              stroke="none"
              fill="url(#ddGrad)"
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Top 5 drawdowns table */}
      {top5.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wide text-zinc-500 border-b border-zinc-800">
                <th className="py-2 pr-3">Rank</th>
                <th className="py-2 pr-3">Start</th>
                <th className="py-2 pr-3">Trough</th>
                <th className="py-2 pr-3">Recovery</th>
                <th className="py-2 pr-3 text-right">Max DD %</th>
                <th className="py-2 pr-3 text-right">Duration</th>
                <th className="py-2 text-right">Recovery</th>
              </tr>
            </thead>
            <tbody>
              {top5.map((p, i) => (
                <tr
                  key={i}
                  className="border-b border-zinc-800/50 hover:bg-zinc-800/20"
                >
                  <td className="py-1.5 pr-3 text-zinc-500">#{i + 1}</td>
                  <td className="py-1.5 pr-3 text-zinc-300">{p.startDate}</td>
                  <td className="py-1.5 pr-3 text-red-400">{p.troughDate}</td>
                  <td className="py-1.5 pr-3 text-zinc-400">
                    {p.recoveryDate ?? (
                      <span className="text-yellow-500">Not yet</span>
                    )}
                  </td>
                  <td className="py-1.5 pr-3 text-right text-red-400 font-semibold">
                    -{p.maxDDPct.toFixed(2)}%
                  </td>
                  <td className="py-1.5 pr-3 text-right text-zinc-400">
                    {p.durationBars} bars
                  </td>
                  <td className="py-1.5 text-right text-zinc-400">
                    {p.recoveryBars !== null ? `${p.recoveryBars} bars` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Section 2: Rolling Metrics ───────────────────────────────────────────────

const WINDOW_OPTIONS = [20, 30, 60] as const;
type WindowSize = (typeof WINDOW_OPTIONS)[number];

function RollingMetricsSection({
  equityCurve,
}: {
  equityCurve: EquityPoint[];
}) {
  const [windowSize, setWindowSize] = useState<WindowSize>(30);

  const rollingData = useMemo(
    () => computeRollingMetrics(equityCurve, windowSize),
    [equityCurve, windowSize],
  );

  if (rollingData.length === 0) {
    return (
      <div className="text-zinc-500 text-sm py-6 text-center">
        Not enough data points for rolling metrics.
      </div>
    );
  }

  const tooltipStyle = {
    background: "#18181b",
    border: "1px solid #3f3f46",
    borderRadius: 6,
    fontSize: 12,
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <SectionHeader>Rolling Metrics</SectionHeader>
        <div className="flex gap-1">
          {WINDOW_OPTIONS.map((w) => (
            <button
              key={w}
              onClick={() => setWindowSize(w)}
              className={`px-2.5 py-1 rounded text-xs font-medium border transition ${
                windowSize === w
                  ? "bg-cyan-500 text-zinc-950 border-cyan-500"
                  : "border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
              }`}
            >
              {w} bars
            </button>
          ))}
        </div>
      </div>

      {/* Rolling Sharpe */}
      <div>
        <p className="text-xs text-zinc-500 mb-1">
          Rolling {windowSize}-bar Sharpe Ratio
        </p>
        <ResponsiveContainer width="100%" height={140}>
          <LineChart
            data={rollingData}
            margin={{ top: 4, right: 16, left: 0, bottom: 0 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 10, fill: "#71717a" }}
              interval="preserveStartEnd"
              tickLine={false}
            />
            <YAxis
              tick={{ fontSize: 10, fill: "#71717a" }}
              tickLine={false}
              tickFormatter={(v: number) => v.toFixed(1)}
              width={36}
            />
            <Tooltip
              contentStyle={tooltipStyle}
              formatter={(v) => [typeof v === "number" ? v.toFixed(2) : "—", "Sharpe"]}
              labelStyle={{ color: "#a1a1aa" }}
            />
            <ReferenceLine
              y={1}
              stroke="#22d3ee"
              strokeDasharray="4 3"
              strokeOpacity={0.5}
              label={{
                value: "1.0",
                fill: "#22d3ee",
                fontSize: 9,
                position: "right",
              }}
            />
            <ReferenceLine
              y={0}
              stroke="#71717a"
              strokeDasharray="4 3"
              strokeOpacity={0.5}
            />
            <Line
              type="monotone"
              dataKey="sharpe"
              stroke="#22d3ee"
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Rolling Return */}
      <div>
        <p className="text-xs text-zinc-500 mb-1">
          Rolling {windowSize}-bar Annualized Return %
        </p>
        <ResponsiveContainer width="100%" height={140}>
          <AreaChart
            data={rollingData}
            margin={{ top: 4, right: 16, left: 0, bottom: 0 }}
          >
            <defs>
              <linearGradient id="retGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#10b981" stopOpacity={0.3} />
                <stop offset="100%" stopColor="#10b981" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 10, fill: "#71717a" }}
              interval="preserveStartEnd"
              tickLine={false}
            />
            <YAxis
              tick={{ fontSize: 10, fill: "#71717a" }}
              tickLine={false}
              tickFormatter={(v: number) => `${v.toFixed(0)}%`}
              width={44}
            />
            <Tooltip
              contentStyle={tooltipStyle}
              formatter={(v) => [typeof v === "number" ? `${v.toFixed(2)}%` : "—", "Ann. Return"]}
              labelStyle={{ color: "#a1a1aa" }}
            />
            <ReferenceLine
              y={0}
              stroke="#71717a"
              strokeDasharray="4 3"
              strokeOpacity={0.6}
            />
            <Area
              type="monotone"
              dataKey="returnPct"
              stroke="#10b981"
              strokeWidth={1.5}
              fill="url(#retGrad)"
              dot={false}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Rolling Volatility */}
      <div>
        <p className="text-xs text-zinc-500 mb-1">
          Rolling {windowSize}-bar Annualized Volatility %
        </p>
        <ResponsiveContainer width="100%" height={140}>
          <LineChart
            data={rollingData}
            margin={{ top: 4, right: 16, left: 0, bottom: 0 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 10, fill: "#71717a" }}
              interval="preserveStartEnd"
              tickLine={false}
            />
            <YAxis
              tick={{ fontSize: 10, fill: "#71717a" }}
              tickLine={false}
              tickFormatter={(v: number) => `${v.toFixed(0)}%`}
              width={44}
            />
            <Tooltip
              contentStyle={tooltipStyle}
              formatter={(v) => [typeof v === "number" ? `${v.toFixed(2)}%` : "—", "Volatility"]}
              labelStyle={{ color: "#a1a1aa" }}
            />
            <Line
              type="monotone"
              dataKey="volatility"
              stroke="#f59e0b"
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ─── Section 3: Quarterly Win Rate ────────────────────────────────────────────

function QuarterlyWinRateSection({ trades }: { trades: Trade[] }) {
  const data = useMemo(() => computeQuarterlyWinRate(trades), [trades]);

  if (data.length === 0) {
    return (
      <div className="text-zinc-500 text-sm py-6 text-center">
        No trades to analyze.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <SectionHeader>Win Rate Over Time (Quarterly)</SectionHeader>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart
          data={data}
          margin={{ top: 8, right: 8, left: 8, bottom: 40 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
          <XAxis
            dataKey="quarter"
            tick={{ fontSize: 10, fill: "#71717a" }}
            angle={-35}
            textAnchor="end"
            tickLine={false}
            height={50}
          />
          <YAxis
            tick={{ fontSize: 10, fill: "#71717a" }}
            tickLine={false}
            tickFormatter={(v: number) => `${v.toFixed(0)}%`}
            domain={[0, 100]}
            width={40}
          />
          <Tooltip
            contentStyle={{
              background: "#18181b",
              border: "1px solid #3f3f46",
              borderRadius: 6,
              fontSize: 12,
            }}
            formatter={(v, _name, entry) => {
              if (typeof v !== "number") return ["—", "Win rate"];
              const payload = entry.payload as QuarterBucket;
              const { trades: t, netPnl } = payload;
              return [
                `${v.toFixed(1)}% (${t} trades · $${netPnl.toFixed(0)} net)`,
                "Win rate",
              ];
            }}
            labelStyle={{ color: "#a1a1aa" }}
          />
          <ReferenceLine
            y={50}
            stroke="#71717a"
            strokeDasharray="6 3"
            strokeOpacity={0.7}
            label={{
              value: "50%",
              fill: "#71717a",
              fontSize: 9,
              position: "right",
            }}
          />
          <Bar dataKey="winRate" radius={[3, 3, 0, 0]} isAnimationActive={false}>
            {data.map((entry, i) => (
              <Cell
                key={`cell-${i}`}
                fill={entry.winRate >= 50 ? "#10b981" : "#ef4444"}
                fillOpacity={0.75}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── Section 4: Trade Duration Distribution ───────────────────────────────────

function TradeDurationSection({ trades }: { trades: Trade[] }) {
  const allBuckets = useMemo(
    () => computeDurationDistribution(trades),
    [trades],
  );
  const data = allBuckets.filter((b) => b.count > 0);

  if (data.length === 0) {
    return (
      <div className="text-zinc-500 text-sm py-6 text-center">
        No trades to analyze.
      </div>
    );
  }

  const maxCount = Math.max(...data.map((d) => d.count), 1);
  const winners = trades.filter((t) => t.pnl >= 0);
  const losers = trades.filter((t) => t.pnl < 0);
  const avgWinDur =
    winners.length > 0
      ? winners.reduce((s, t) => s + t.duration_bars, 0) / winners.length
      : 0;
  const avgLossDur =
    losers.length > 0
      ? losers.reduce((s, t) => s + t.duration_bars, 0) / losers.length
      : 0;
  const totalDur =
    trades.length > 0
      ? trades.reduce((s, t) => s + t.duration_bars, 0) / trades.length
      : 0;
  const maxDur = trades.length > 0 ? Math.max(...trades.map((t) => t.duration_bars)) : 0;

  return (
    <div className="space-y-3">
      <SectionHeader>Trade Duration Distribution</SectionHeader>
      <div className="space-y-2">
        {data.map((bucket) => {
          const barPct = (bucket.count / maxCount) * 100;
          const winPct =
            bucket.count > 0 ? (bucket.wins / bucket.count) * 100 : 0;
          const positive = bucket.avgPnl >= 0;
          return (
            <div
              key={bucket.label}
              className="grid items-center gap-3"
              style={{ gridTemplateColumns: "90px 1fr 72px 56px" }}
            >
              <div className="text-xs text-zinc-400 text-right">
                {bucket.label}
              </div>
              <div className="relative h-5 bg-zinc-800 rounded overflow-hidden">
                <div
                  className="absolute inset-y-0 left-0 rounded"
                  style={{
                    width: `${barPct}%`,
                    background: "linear-gradient(90deg, #06b6d4, #3b82f6)",
                  }}
                />
                <span className="absolute inset-y-0 left-2 text-[10px] text-zinc-200 leading-5">
                  {bucket.count} · {winPct.toFixed(0)}% win
                </span>
              </div>
              <div
                className={`text-xs text-right font-mono ${positive ? "text-emerald-400" : "text-red-400"}`}
              >
                {positive ? "+" : ""}
                {bucket.avgPnl.toFixed(2)}%
              </div>
              <div className="text-[10px] text-zinc-600 text-right">avg P&L</div>
            </div>
          );
        })}
      </div>
      <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard
          label="Avg Duration"
          value={`${totalDur.toFixed(1)} bars`}
          color="text-zinc-300"
        />
        <StatCard
          label="Avg Winner Duration"
          value={`${avgWinDur.toFixed(1)} bars`}
          color="text-emerald-400"
        />
        <StatCard
          label="Avg Loser Duration"
          value={`${avgLossDur.toFixed(1)} bars`}
          color="text-red-400"
        />
        <StatCard
          label="Longest Trade"
          value={`${maxDur} bars`}
          color="text-zinc-300"
        />
      </div>
    </div>
  );
}

// ─── Main export ──────────────────────────────────────────────────────────────

interface RollingAnalysisPanelProps {
  result: BacktestResult;
}

export function RollingAnalysisPanel({ result }: RollingAnalysisPanelProps) {
  const { equity_curve, trades } = result;

  return (
    <div className="space-y-6">
      {/* Section 1: Drawdown */}
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-5">
        <DrawdownSection equityCurve={equity_curve} />
      </div>

      {/* Section 2: Rolling Metrics */}
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-5">
        <RollingMetricsSection equityCurve={equity_curve} />
      </div>

      {/* Section 3: Quarterly Win Rate */}
      {trades.length > 0 && (
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-5">
          <QuarterlyWinRateSection trades={trades} />
        </div>
      )}

      {/* Section 4: Trade Duration */}
      {trades.length > 0 && (
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-5">
          <TradeDurationSection trades={trades} />
        </div>
      )}
    </div>
  );
}
