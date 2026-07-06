"use client";

import { useMemo } from "react";
import type { BacktestResult, Trade } from "@/lib/backtest-api";
import {
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

type Streak = {
  type: "win" | "loss";
  length: number;
  startIdx: number;
  endIdx: number;
};

function computeStreaks(trades: Trade[]): Streak[] {
  if (trades.length === 0) return [];
  const streaks: Streak[] = [];
  let currentType: "win" | "loss" = trades[0].pnl >= 0 ? "win" : "loss";
  let start = 0;

  for (let i = 1; i <= trades.length; i++) {
    const t = trades[i];
    const type: "win" | "loss" | null =
      t == null ? null : t.pnl >= 0 ? "win" : "loss";
    if (type !== currentType) {
      streaks.push({ type: currentType, length: i - start, startIdx: start, endIdx: i - 1 });
      if (type != null) {
        currentType = type;
        start = i;
      }
    }
  }
  return streaks;
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

export function TradeStreakAnalyzer({ result }: { result: BacktestResult }) {
  const { trades } = result;

  const streaks = useMemo(() => computeStreaks(trades), [trades]);

  const winStreaks = useMemo(() => streaks.filter((s) => s.type === "win"), [streaks]);
  const lossStreaks = useMemo(() => streaks.filter((s) => s.type === "loss"), [streaks]);

  const maxWin = useMemo(() => winStreaks.reduce((m, s) => Math.max(m, s.length), 0), [winStreaks]);
  const maxLoss = useMemo(() => lossStreaks.reduce((m, s) => Math.max(m, s.length), 0), [lossStreaks]);
  const avgWin = useMemo(() => avg(winStreaks.map((s) => s.length)), [winStreaks]);
  const avgLoss = useMemo(() => avg(lossStreaks.map((s) => s.length)), [lossStreaks]);

  // Chart data: each streak as one bar
  const chartData = useMemo(
    () =>
      streaks.map((s, i) => ({
        idx: i + 1,
        length: s.type === "win" ? s.length : -s.length,
        type: s.type,
        rawLength: s.length,
      })),
    [streaks],
  );

  // Streak length distribution
  const winDist = useMemo(() => {
    const map: Record<number, number> = {};
    for (const s of winStreaks) map[s.length] = (map[s.length] ?? 0) + 1;
    return Object.entries(map)
      .map(([len, count]) => ({ len: Number(len), count }))
      .sort((a, b) => a.len - b.len);
  }, [winStreaks]);

  const lossDist = useMemo(() => {
    const map: Record<number, number> = {};
    for (const s of lossStreaks) map[s.length] = (map[s.length] ?? 0) + 1;
    return Object.entries(map)
      .map(([len, count]) => ({ len: Number(len), count }))
      .sort((a, b) => a.len - b.len);
  }, [lossStreaks]);

  // Recovery analysis: after each loss streak, count trades to recover PnL
  const recoveryData = useMemo(() => {
    const recoveries: number[] = [];
    for (const streak of lossStreaks) {
      // Sum loss during this streak
      const lossTotal = trades
        .slice(streak.startIdx, streak.endIdx + 1)
        .reduce((s, t) => s + t.pnl, 0);
      // Count trades after the streak needed to cover those losses
      let cumRecovery = 0;
      let recoveryTrades = 0;
      for (let i = streak.endIdx + 1; i < trades.length; i++) {
        cumRecovery += trades[i].pnl;
        recoveryTrades++;
        if (cumRecovery >= -lossTotal) break;
      }
      if (cumRecovery >= -lossTotal) {
        recoveries.push(recoveryTrades);
      }
    }
    return recoveries;
  }, [trades, lossStreaks]);

  const avgRecovery = useMemo(() => avg(recoveryData), [recoveryData]);

  if (trades.length === 0) {
    return (
      <div className="text-center text-zinc-500 py-10">No trades to analyze.</div>
    );
  }

  const summaryCards = [
    { label: "Max Win Streak", value: maxWin, color: "text-emerald-400" },
    { label: "Max Loss Streak", value: maxLoss, color: "text-red-400" },
    { label: "Avg Win Streak", value: avgWin.toFixed(1), color: "text-green-400" },
    { label: "Avg Loss Streak", value: avgLoss.toFixed(1), color: "text-orange-400" },
  ];

  return (
    <div className="space-y-5">
      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {summaryCards.map((card) => (
          <div
            key={card.label}
            className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-3"
          >
            <div className="text-xs text-zinc-500 mb-1">{card.label}</div>
            <div className={`text-lg font-bold ${card.color}`}>{card.value}</div>
          </div>
        ))}
      </div>

      {/* Streak chart */}
      {chartData.length > 0 && (
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
          <h4 className="text-sm font-semibold text-zinc-300 mb-3">
            Streak timeline (green = wins, red = losses)
          </h4>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart
              data={chartData}
              margin={{ top: 4, right: 8, left: -20, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis dataKey="idx" tick={false} />
              <YAxis
                tick={{ fill: "#71717a", fontSize: 10 }}
                tickFormatter={(v) => String(Math.abs(v as number))}
              />
              <Tooltip
                contentStyle={{
                  background: "#18181b",
                  border: "1px solid #3f3f46",
                  borderRadius: 6,
                }}
                formatter={(v, _name, item) => [
                  `${item.payload.rawLength} trade${item.payload.rawLength !== 1 ? "s" : ""}`,
                  item.payload.type === "win" ? "Win streak" : "Loss streak",
                ]}
                labelFormatter={(label) => `Streak #${label}`}
              />
              <Bar dataKey="length" radius={[2, 2, 0, 0]}>
                {chartData.map((d, i) => (
                  <Cell
                    key={i}
                    fill={d.type === "win" ? "#22c55e" : "#ef4444"}
                    fillOpacity={0.85}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Streak distribution */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Win distribution */}
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
          <h4 className="text-sm font-semibold text-zinc-300 mb-3">Win streak distribution</h4>
          {winDist.length === 0 ? (
            <p className="text-xs text-zinc-500">No winning streaks.</p>
          ) : (
            <div className="space-y-1.5">
              {winDist.map(({ len, count }) => (
                <div key={len} className="flex items-center gap-2 text-xs">
                  <span className="w-20 text-zinc-400 shrink-0">
                    {len}-trade streak
                  </span>
                  <div className="flex-1 bg-zinc-800 rounded-full h-2 overflow-hidden">
                    <div
                      className="h-2 rounded-full bg-emerald-500"
                      style={{
                        width: `${(count / Math.max(...winDist.map((d) => d.count))) * 100}%`,
                      }}
                    />
                  </div>
                  <span className="text-emerald-400 w-8 text-right">{count}×</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Loss distribution */}
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
          <h4 className="text-sm font-semibold text-zinc-300 mb-3">Loss streak distribution</h4>
          {lossDist.length === 0 ? (
            <p className="text-xs text-zinc-500">No losing streaks.</p>
          ) : (
            <div className="space-y-1.5">
              {lossDist.map(({ len, count }) => (
                <div key={len} className="flex items-center gap-2 text-xs">
                  <span className="w-20 text-zinc-400 shrink-0">
                    {len}-trade streak
                  </span>
                  <div className="flex-1 bg-zinc-800 rounded-full h-2 overflow-hidden">
                    <div
                      className="h-2 rounded-full bg-red-500"
                      style={{
                        width: `${(count / Math.max(...lossDist.map((d) => d.count))) * 100}%`,
                      }}
                    />
                  </div>
                  <span className="text-red-400 w-8 text-right">{count}×</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Recovery analysis */}
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
        <h4 className="text-sm font-semibold text-zinc-300 mb-2">Recovery analysis</h4>
        {recoveryData.length === 0 ? (
          <p className="text-xs text-zinc-500">
            No loss streaks with measurable recovery in this backtest.
          </p>
        ) : (
          <div className="flex flex-wrap gap-4 text-sm">
            <div>
              <span className="text-zinc-500 text-xs">Avg trades to recover:</span>{" "}
              <span className="text-cyan-400 font-semibold">{avgRecovery.toFixed(1)}</span>
            </div>
            <div>
              <span className="text-zinc-500 text-xs">Recoveries observed:</span>{" "}
              <span className="text-zinc-300 font-semibold">
                {recoveryData.length} / {lossStreaks.length}
              </span>
            </div>
            <div>
              <span className="text-zinc-500 text-xs">Fastest recovery:</span>{" "}
              <span className="text-emerald-400 font-semibold">
                {Math.min(...recoveryData)} trade{Math.min(...recoveryData) !== 1 ? "s" : ""}
              </span>
            </div>
            <div>
              <span className="text-zinc-500 text-xs">Slowest recovery:</span>{" "}
              <span className="text-orange-400 font-semibold">
                {Math.max(...recoveryData)} trade{Math.max(...recoveryData) !== 1 ? "s" : ""}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
