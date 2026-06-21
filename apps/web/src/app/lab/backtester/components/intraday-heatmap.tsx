"use client";

import { useMemo } from "react";
import type { BacktestResult, Trade } from "@/lib/backtest-api";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Cell {
  count: number;
  wins: number;
  totalPnl: number;
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const HOURS = Array.from({ length: 24 }, (_, i) => i);

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildMatrix(trades: Trade[]): Cell[][] {
  // [day][hour]
  const matrix: Cell[][] = Array.from({ length: 7 }, () =>
    Array.from({ length: 24 }, () => ({ count: 0, wins: 0, totalPnl: 0 })),
  );
  for (const t of trades) {
    const d = new Date(t.entry_time);
    const day = d.getUTCDay();
    const hour = d.getUTCHours();
    matrix[day]![hour]!.count++;
    matrix[day]![hour]!.totalPnl += t.pnl_pct;
    if (t.pnl_pct > 0) matrix[day]![hour]!.wins++;
  }
  return matrix;
}

function cellColor(cell: Cell): string {
  if (cell.count === 0) return "#18181b";
  const avg = cell.totalPnl / cell.count;
  const intensity = Math.min(1, Math.abs(avg) / 3); // saturate at ±3%
  if (avg > 0) {
    const g = Math.round(74 + intensity * (217 - 74));
    const r = Math.round(15 + intensity * (20 - 15));
    const b = Math.round(50 + intensity * (93 - 50));
    return `rgb(${r},${g},${b})`;
  } else {
    const r = Math.round(127 + intensity * (248 - 127));
    const g = Math.round(29 + intensity * (113 - 29));
    const b = Math.round(29 + intensity * (113 - 29));
    return `rgb(${r},${g},${b})`;
  }
}

function textColor(cell: Cell): string {
  if (cell.count === 0) return "#52525b";
  return cell.totalPnl / cell.count >= 0 ? "#d1fae5" : "#fee2e2";
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SummaryCard({
  label, h, day, cell,
}: { label: string; h?: number; day?: number; cell: Cell }) {
  const avg = cell.count > 0 ? cell.totalPnl / cell.count : 0;
  const wr = cell.count > 0 ? (cell.wins / cell.count) * 100 : 0;
  const id = h !== undefined ? `${h.toString().padStart(2, "0")}:00 UTC` : DAYS[day!];
  return (
    <div className="bg-zinc-800/50 border border-zinc-700/50 rounded-lg p-3">
      <div className="text-[10px] text-zinc-500 uppercase">{label}</div>
      <div className="text-xl font-bold text-zinc-100 font-mono">{id}</div>
      <div className="text-xs text-zinc-400 mt-0.5">
        {avg >= 0 ? "+" : ""}{avg.toFixed(2)}% avg · {wr.toFixed(0)}% WR · {cell.count}t
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export interface IntradayHeatmapProps {
  result: BacktestResult;
}

export function IntradayHeatmap({ result }: IntradayHeatmapProps) {
  const trades = result.trades ?? [];
  const matrix = useMemo(() => buildMatrix(trades), [trades]);

  // Flatten per-hour and per-day aggregates
  const hourTotals = useMemo(
    () =>
      HOURS.map((h) =>
        DAYS.reduce(
          (acc, _, d) => {
            const c = matrix[d]![h]!;
            acc.count += c.count;
            acc.wins += c.wins;
            acc.totalPnl += c.totalPnl;
            return acc;
          },
          { count: 0, wins: 0, totalPnl: 0 },
        ),
      ),
    [matrix],
  );

  const dayTotals = useMemo(
    () =>
      DAYS.map((_, d) =>
        HOURS.reduce(
          (acc, h) => {
            const c = matrix[d]![h]!;
            acc.count += c.count;
            acc.wins += c.wins;
            acc.totalPnl += c.totalPnl;
            return acc;
          },
          { count: 0, wins: 0, totalPnl: 0 },
        ),
      ),
    [matrix],
  );

  const bestHour = useMemo(() => {
    let best = { h: -1, cell: { count: 0, wins: 0, totalPnl: 0 } as Cell };
    hourTotals.forEach((c, h) => {
      if (c.count > 0 && (best.h === -1 || c.totalPnl / c.count > best.cell.totalPnl / best.cell.count)) {
        best = { h, cell: c };
      }
    });
    return best;
  }, [hourTotals]);

  const bestDay = useMemo(() => {
    let best = { d: -1, cell: { count: 0, wins: 0, totalPnl: 0 } as Cell };
    dayTotals.forEach((c, d) => {
      if (c.count > 0 && (best.d === -1 || c.totalPnl / c.count > best.cell.totalPnl / best.cell.count)) {
        best = { d, cell: c };
      }
    });
    return best;
  }, [dayTotals]);

  const worstHour = useMemo(() => {
    let worst = { h: -1, cell: { count: 0, wins: 0, totalPnl: 0 } as Cell };
    hourTotals.forEach((c, h) => {
      if (c.count > 0 && (worst.h === -1 || c.totalPnl / c.count < worst.cell.totalPnl / worst.cell.count)) {
        worst = { h, cell: c };
      }
    });
    return worst;
  }, [hourTotals]);

  if (trades.length === 0) {
    return (
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-8 text-center text-zinc-500">
        No trades to display.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3">
        {bestHour.h >= 0 && <SummaryCard label="Best Hour" h={bestHour.h} cell={bestHour.cell} />}
        {worstHour.h >= 0 && <SummaryCard label="Worst Hour" h={worstHour.h} cell={worstHour.cell} />}
        {bestDay.d >= 0 && <SummaryCard label="Best Day" day={bestDay.d} cell={bestDay.cell} />}
      </div>

      {/* 2D heatmap */}
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-4 overflow-x-auto">
        <h3 className="text-sm font-semibold text-zinc-300 mb-3">
          Avg P&L % — Day × Hour (UTC)
        </h3>
        <div className="min-w-[640px]">
          {/* Hour header */}
          <div className="flex gap-px mb-px">
            <div className="w-10 flex-shrink-0" />
            {HOURS.map((h) => (
              <div
                key={h}
                className="flex-1 text-center text-[9px] text-zinc-600 pb-1"
                title={`${h.toString().padStart(2, "0")}:00 UTC`}
              >
                {h % 4 === 0 ? h : ""}
              </div>
            ))}
          </div>

          {/* Day rows */}
          {DAYS.map((day, d) => (
            <div key={d} className="flex gap-px mb-px">
              <div className="w-10 flex-shrink-0 text-[10px] text-zinc-500 flex items-center pr-1 font-medium">
                {day}
              </div>
              {HOURS.map((h) => {
                const cell = matrix[d]![h]!;
                const avg = cell.count > 0 ? cell.totalPnl / cell.count : null;
                const wr = cell.count > 0 ? (cell.wins / cell.count) * 100 : null;
                return (
                  <div
                    key={h}
                    className="flex-1 aspect-square rounded-[2px] flex items-center justify-center text-[7px] font-bold transition"
                    style={{ background: cellColor(cell), color: textColor(cell) }}
                    title={
                      cell.count === 0
                        ? `${day} ${h.toString().padStart(2, "0")}:00 — no trades`
                        : `${day} ${h.toString().padStart(2, "0")}:00 — ${cell.count}t, ${avg!.toFixed(2)}% avg, ${wr!.toFixed(0)}% WR`
                    }
                  >
                    {cell.count > 0 && avg !== null ? (avg >= 0 ? "+" : "") + avg.toFixed(1) : ""}
                  </div>
                );
              })}
            </div>
          ))}

          {/* Hour aggregates row */}
          <div className="flex gap-px mt-1">
            <div className="w-10 flex-shrink-0 text-[8px] text-zinc-600 flex items-center">avg</div>
            {hourTotals.map((c, h) => {
              const avg = c.count > 0 ? c.totalPnl / c.count : null;
              const fakeCell = { ...c, wins: c.wins };
              return (
                <div
                  key={h}
                  className="flex-1 rounded-[2px] py-0.5 text-center text-[7px] font-bold"
                  style={{ background: cellColor(fakeCell), color: textColor(fakeCell) }}
                  title={c.count > 0 ? `Hour ${h}: ${avg!.toFixed(2)}% avg over ${c.count} trades` : "No trades"}
                >
                  {avg !== null ? (avg >= 0 ? "+" : "") + avg.toFixed(1) : ""}
                </div>
              );
            })}
          </div>
        </div>

        {/* Color legend */}
        <div className="flex items-center gap-3 mt-3 text-[10px] text-zinc-500 flex-wrap">
          <span>Color scale:</span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded inline-block" style={{ background: "rgb(20,217,93)" }} /> Strong +
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded inline-block" style={{ background: "rgb(15,74,50)" }} /> Mild +
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded inline-block bg-zinc-900 border border-zinc-700" /> No trades
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded inline-block" style={{ background: "rgb(127,29,29)" }} /> Mild −
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded inline-block" style={{ background: "rgb(248,113,113)" }} /> Strong −
          </span>
        </div>
      </div>

      {/* Day-of-week summary bars */}
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-4">
        <h3 className="text-sm font-semibold text-zinc-300 mb-3">Performance by Day of Week</h3>
        <div className="grid grid-cols-7 gap-2">
          {dayTotals.map((c, d) => {
            const avg = c.count > 0 ? c.totalPnl / c.count : null;
            const wr = c.count > 0 ? (c.wins / c.count) * 100 : null;
            const isPos = avg !== null && avg >= 0;
            return (
              <div
                key={d}
                className={`border rounded-lg p-2 text-center ${
                  c.count === 0
                    ? "border-zinc-800 bg-zinc-900/30"
                    : isPos
                    ? "border-emerald-700/50 bg-emerald-900/20"
                    : "border-red-700/50 bg-red-900/20"
                }`}
              >
                <div className="text-xs text-zinc-400">{DAYS[d]}</div>
                <div className={`text-base font-bold ${c.count === 0 ? "text-zinc-600" : isPos ? "text-emerald-300" : "text-red-300"}`}>
                  {avg !== null ? `${avg >= 0 ? "+" : ""}${avg.toFixed(1)}%` : "—"}
                </div>
                <div className="text-[9px] text-zinc-500 mt-0.5">
                  {c.count > 0 ? `${wr!.toFixed(0)}% · ${c.count}t` : "no trades"}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
