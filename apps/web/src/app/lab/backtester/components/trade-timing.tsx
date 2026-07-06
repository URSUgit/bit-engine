"use client";

import { useState, useMemo } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
} from "recharts";
import type { BacktestResult, Trade } from "@/lib/backtest-api";

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

interface HourCell {
  count: number;
  wins: number;
  totalPnlPct: number;
  avgPnlPct: number;
  winRate: number;
}

function buildHourMatrix(trades: Trade[]): HourCell[] {
  const cells: HourCell[] = HOURS.map(() => ({ count: 0, wins: 0, totalPnlPct: 0, avgPnlPct: 0, winRate: 0 }));
  for (const t of trades) {
    // entry_time can be ISO string or unix ms (both work with new Date())
    const d = new Date(t.entry_time as string | number);
    const h = d.getUTCHours();
    cells[h]!.count++;
    cells[h]!.totalPnlPct += t.pnl_pct;
    if (t.pnl_pct > 0) cells[h]!.wins++;
  }
  for (const c of cells) {
    if (c.count > 0) {
      c.avgPnlPct = c.totalPnlPct / c.count;
      c.winRate = (c.wins / c.count) * 100;
    }
  }
  return cells;
}

function buildDayMatrix(trades: Trade[]): HourCell[] {
  const cells: HourCell[] = DAYS.map(() => ({ count: 0, wins: 0, totalPnlPct: 0, avgPnlPct: 0, winRate: 0 }));
  for (const t of trades) {
    const d = new Date(t.entry_time as string | number);
    const day = d.getUTCDay();
    cells[day]!.count++;
    cells[day]!.totalPnlPct += t.pnl_pct;
    if (t.pnl_pct > 0) cells[day]!.wins++;
  }
  for (const c of cells) {
    if (c.count > 0) {
      c.avgPnlPct = c.totalPnlPct / c.count;
      c.winRate = (c.wins / c.count) * 100;
    }
  }
  return cells;
}

type MetricKey = "avgPnlPct" | "winRate" | "count";

interface HourBarDatum {
  h: number;
  val: number;
  count: number;
  winRate: number;
  avgPnlPct: number;
}

function HourBars({ cells, metric }: { cells: HourCell[]; metric: MetricKey }) {
  const data: HourBarDatum[] = cells.map((c, h) => ({
    h,
    val: metric === "count" ? c.count : c[metric],
    count: c.count,
    winRate: c.winRate,
    avgPnlPct: c.avgPnlPct,
  }));

  return (
    <ResponsiveContainer width="100%" height={140}>
      <BarChart data={data} margin={{ top: 4, right: 4, bottom: 20, left: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
        <XAxis
          dataKey="h"
          stroke="#52525b"
          tick={{ fill: "#71717a", fontSize: 9 }}
          tickFormatter={(v: number) => (v % 4 === 0 ? `${v}h` : "")}
        />
        <YAxis stroke="#52525b" tick={{ fill: "#71717a", fontSize: 9 }} />
        <Tooltip
          content={({ payload }) => {
            if (!payload?.length) return null;
            const d = payload[0]?.payload as HourBarDatum;
            return (
              <div className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs">
                <div className="font-bold">{d.h.toString().padStart(2, "0")}:00 UTC</div>
                <div>{d.count} trades</div>
                {d.count > 0 && (
                  <>
                    <div>Win rate: {d.winRate.toFixed(0)}%</div>
                    <div>Avg P&L: {d.avgPnlPct.toFixed(2)}%</div>
                  </>
                )}
              </div>
            );
          }}
        />
        <Bar dataKey="val" isAnimationActive={false} radius={[2, 2, 0, 0]}>
          {data.map((d, i) => (
            <Cell
              key={i}
              fill={
                d.count === 0
                  ? "#27272a"
                  : metric === "count"
                  ? "#06b6d4"
                  : d.val > 0
                  ? "#34d399"
                  : "#f87171"
              }
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function TradeTimingAnalysis({ result }: { result: BacktestResult }) {
  const trades = result.trades ?? [];
  const [metric, setMetric] = useState<MetricKey>("avgPnlPct");

  const hourCells = useMemo(() => buildHourMatrix(trades), [trades]);
  const dayCells = useMemo(() => buildDayMatrix(trades), [trades]);

  const bestHour = useMemo(
    () =>
      hourCells.reduce(
        (best, c, i) =>
          c.count > 0 && c.avgPnlPct > (best.cell?.avgPnlPct ?? -Infinity)
            ? { cell: c, i }
            : best,
        { cell: null as HourCell | null, i: -1 },
      ),
    [hourCells],
  );

  const worstHour = useMemo(
    () =>
      hourCells.reduce(
        (worst, c, i) =>
          c.count > 0 && c.avgPnlPct < (worst.cell?.avgPnlPct ?? Infinity)
            ? { cell: c, i }
            : worst,
        { cell: null as HourCell | null, i: -1 },
      ),
    [hourCells],
  );

  const bestDay = useMemo(
    () =>
      dayCells.reduce(
        (best, c, i) =>
          c.count > 0 && c.avgPnlPct > (best.cell?.avgPnlPct ?? -Infinity)
            ? { cell: c, i }
            : best,
        { cell: null as HourCell | null, i: -1 },
      ),
    [dayCells],
  );

  if (trades.length === 0) {
    return (
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-8 text-center text-zinc-500">
        No trades to analyze.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3">
        {bestHour.cell && (
          <div className="bg-emerald-900/20 border border-emerald-800/50 rounded-lg p-3">
            <div className="text-xs text-zinc-400 mb-1">Best Hour (UTC)</div>
            <div className="text-2xl font-bold text-emerald-300">
              {bestHour.i.toString().padStart(2, "0")}:00
            </div>
            <div className="text-xs text-zinc-400 mt-0.5">
              {bestHour.cell.avgPnlPct.toFixed(2)}% avg · {bestHour.cell.winRate.toFixed(0)}% WR · {bestHour.cell.count}t
            </div>
          </div>
        )}
        {worstHour.cell && (
          <div className="bg-red-900/20 border border-red-800/50 rounded-lg p-3">
            <div className="text-xs text-zinc-400 mb-1">Worst Hour (UTC)</div>
            <div className="text-2xl font-bold text-red-300">
              {worstHour.i.toString().padStart(2, "0")}:00
            </div>
            <div className="text-xs text-zinc-400 mt-0.5">
              {worstHour.cell.avgPnlPct.toFixed(2)}% avg · {worstHour.cell.winRate.toFixed(0)}% WR
            </div>
          </div>
        )}
        {bestDay.cell && (
          <div className="bg-cyan-900/20 border border-cyan-800/50 rounded-lg p-3">
            <div className="text-xs text-zinc-400 mb-1">Best Day</div>
            <div className="text-2xl font-bold text-cyan-300">{DAYS[bestDay.i]}</div>
            <div className="text-xs text-zinc-400 mt-0.5">
              {bestDay.cell.avgPnlPct.toFixed(2)}% avg · {bestDay.cell.winRate.toFixed(0)}% WR · {bestDay.cell.count}t
            </div>
          </div>
        )}
      </div>

      {/* Metric selector */}
      <div className="flex gap-1 bg-zinc-900/50 border border-zinc-800 rounded-lg p-1 w-fit">
        {(["avgPnlPct", "winRate", "count"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMetric(m)}
            className={`px-3 py-1 rounded text-xs font-medium transition ${
              metric === m ? "bg-cyan-500 text-zinc-950" : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            {m === "avgPnlPct" ? "Avg P&L %" : m === "winRate" ? "Win Rate" : "Trade Count"}
          </button>
        ))}
      </div>

      {/* Hourly bar chart */}
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
        <h3 className="text-sm font-semibold mb-3 text-zinc-300">
          By Hour of Day (UTC) —{" "}
          {metric === "avgPnlPct"
            ? "Avg P&L %"
            : metric === "winRate"
            ? "Win Rate %"
            : "Trade Count"}
        </h3>
        <HourBars cells={hourCells} metric={metric} />
      </div>

      {/* Day of week grid */}
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
        <h3 className="text-sm font-semibold mb-3 text-zinc-300">By Day of Week</h3>
        <div className="grid grid-cols-7 gap-2">
          {dayCells.map((c, i) => {
            const border =
              c.count === 0
                ? "border-zinc-800 bg-zinc-900/30"
                : c.avgPnlPct > 0
                ? "border-emerald-700/50 bg-emerald-900/20"
                : "border-red-700/50 bg-red-900/20";
            const textColor =
              c.count === 0
                ? "text-zinc-600"
                : c.avgPnlPct > 0
                ? "text-emerald-300"
                : "text-red-300";
            return (
              <div key={i} className={`border rounded-lg p-2 text-center ${border}`}>
                <div className="text-xs text-zinc-400">{DAYS[i]}</div>
                <div className={`text-base font-bold ${textColor}`}>
                  {c.count === 0
                    ? "—"
                    : `${c.avgPnlPct > 0 ? "+" : ""}${c.avgPnlPct.toFixed(1)}%`}
                </div>
                <div className="text-[10px] text-zinc-500 mt-0.5">
                  {c.count > 0
                    ? `${c.winRate.toFixed(0)}% · ${c.count}t`
                    : "no trades"}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
