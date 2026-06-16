"use client";

import { useMemo, useState } from "react";
import type { Trade } from "@/lib/backtest-api";

interface HeatCalendarProps {
  trades: Trade[];
  initialCapital: number;
}

function formatDateTitle(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00Z");
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function formatUSD(value: number): string {
  const abs = Math.abs(value);
  const sign = value >= 0 ? "+" : "−";
  return `${sign}$${abs.toFixed(2)}`;
}

function getCellColor(pnl: number, maxAbsPnl: number): string {
  if (maxAbsPnl === 0) return "bg-zinc-800";
  const ratio = Math.abs(pnl) / maxAbsPnl;
  if (pnl > 0) {
    if (ratio < 0.25) return "bg-emerald-900/40";
    if (ratio < 0.5) return "bg-emerald-700";
    if (ratio < 0.75) return "bg-emerald-500";
    return "bg-emerald-400";
  } else {
    if (ratio < 0.25) return "bg-red-900/40";
    if (ratio < 0.5) return "bg-red-700";
    if (ratio < 0.75) return "bg-red-500";
    return "bg-red-400";
  }
}

/** Returns Monday-based day index: Mon=0 ... Sun=6 */
function dayOfWeekMon(dateStr: string): number {
  const d = new Date(dateStr + "T00:00:00Z");
  return (d.getUTCDay() + 6) % 7;
}

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function getMonthLabel(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00Z");
  return d.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
}

function yearOf(dateStr: string): number {
  return parseInt(dateStr.slice(0, 4), 10);
}

export function HeatCalendar({ trades, initialCapital }: HeatCalendarProps) {
  const dailyMap = useMemo(() => {
    const map = new Map<string, { pnl: number; count: number }>();
    for (const t of trades) {
      const date = t.exit_time.slice(0, 10);
      const existing = map.get(date);
      if (existing) {
        existing.pnl += t.pnl;
        existing.count += 1;
      } else {
        map.set(date, { pnl: t.pnl, count: 1 });
      }
    }
    return map;
  }, [trades]);

  const allDates = useMemo(() => [...dailyMap.keys()].sort(), [dailyMap]);
  const minDate = allDates[0] ?? "";
  const maxDate = allDates[allDates.length - 1] ?? "";

  const availableYears = useMemo(() => {
    const years = new Set<number>();
    for (const d of allDates) years.add(yearOf(d));
    return [...years].sort((a, b) => b - a);
  }, [allDates]);

  const dateRangeMonths = useMemo(() => {
    if (!minDate || !maxDate) return 0;
    const minD = new Date(minDate + "T00:00:00Z");
    const maxD = new Date(maxDate + "T00:00:00Z");
    return (
      (maxD.getFullYear() - minD.getFullYear()) * 12 +
      (maxD.getMonth() - minD.getMonth())
    );
  }, [minDate, maxDate]);

  const [selectedYear, setSelectedYear] = useState<number>(
    () => availableYears[0] ?? new Date().getFullYear()
  );

  const effectiveMin = useMemo(() => {
    if (dateRangeMonths <= 12 || !minDate) return minDate;
    return `${selectedYear}-01-01`;
  }, [dateRangeMonths, minDate, selectedYear]);

  const effectiveMax = useMemo(() => {
    if (dateRangeMonths <= 12 || !maxDate) return maxDate;
    return `${selectedYear}-12-31`;
  }, [dateRangeMonths, maxDate, selectedYear]);

  const maxAbsPnl = useMemo(() => {
    let max = 0;
    for (const [, v] of dailyMap) {
      if (Math.abs(v.pnl) > max) max = Math.abs(v.pnl);
    }
    return max;
  }, [dailyMap]);

  const { weeks, monthCols } = useMemo(() => {
    if (!effectiveMin || !effectiveMax) {
      return {
        weeks: [] as string[][],
        monthCols: [] as { label: string; col: number }[],
      };
    }

    const startDow = dayOfWeekMon(effectiveMin);
    let gridStart = addDays(effectiveMin, -startDow);

    const weeksArr: string[][] = [];
    const monthColsArr: { label: string; col: number }[] = [];
    let current = gridStart;
    let weekIdx = 0;
    let lastMonth = "";

    while (true) {
      const week: string[] = [];
      for (let d = 0; d < 7; d++) {
        week.push(current);
        current = addDays(current, 1);
      }
      weeksArr.push(week);

      const firstInRange = week.find(
        (d) => d >= effectiveMin && d <= effectiveMax
      );
      if (firstInRange) {
        const m = getMonthLabel(firstInRange);
        if (m !== lastMonth) {
          monthColsArr.push({ label: m, col: weekIdx });
          lastMonth = m;
        }
      }

      weekIdx++;
      if (current > effectiveMax) break;
    }

    return { weeks: weeksArr, monthCols: monthColsArr };
  }, [effectiveMin, effectiveMax]);

  if (trades.length === 0) {
    return (
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-8 text-center text-zinc-400 text-sm">
        No trades to display.
      </div>
    );
  }

  const DAY_LABELS = ["M", "", "W", "", "F", "", "S"];

  return (
    <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">P&amp;L Heat Calendar</h3>
        {dateRangeMonths > 12 && availableYears.length > 1 && (
          <select
            value={selectedYear}
            onChange={(e) => setSelectedYear(Number(e.target.value))}
            className="bg-zinc-800 border border-zinc-700 text-zinc-200 text-sm rounded px-2 py-1"
          >
            {availableYears.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="overflow-x-auto">
        <div className="inline-block">
          {/* Month labels row */}
          <div className="flex mb-1 ml-6">
            {monthCols.map((mc, i) => {
              const nextCol = monthCols[i + 1]?.col ?? weeks.length;
              const width = (nextCol - mc.col) * 14;
              return (
                <div
                  key={`${mc.label}-${mc.col}`}
                  className="text-xs text-zinc-500 shrink-0 overflow-hidden"
                  style={{ width: `${width}px` }}
                >
                  {mc.label}
                </div>
              );
            })}
          </div>

          {/* Calendar grid */}
          <div className="flex gap-0.5">
            {/* Day-of-week labels */}
            <div className="flex flex-col gap-0.5 mr-1">
              {DAY_LABELS.map((label, i) => (
                <div
                  key={i}
                  className="w-4 h-3 text-[10px] text-zinc-500 flex items-center justify-end pr-0.5 leading-none"
                >
                  {label}
                </div>
              ))}
            </div>

            {/* Week columns */}
            {weeks.map((week, wi) => (
              <div key={wi} className="flex flex-col gap-0.5">
                {week.map((dateStr, di) => {
                  const inRange =
                    dateStr >= effectiveMin && dateStr <= effectiveMax;
                  const entry = dailyMap.get(dateStr);
                  const color = !inRange
                    ? "bg-transparent"
                    : entry
                    ? getCellColor(entry.pnl, maxAbsPnl)
                    : "bg-zinc-800";

                  const titleText =
                    entry && inRange
                      ? `${formatDateTitle(dateStr)} — ${formatUSD(entry.pnl)} (${entry.count} trade${entry.count !== 1 ? "s" : ""})`
                      : inRange
                      ? formatDateTitle(dateStr)
                      : "";

                  return (
                    <div
                      key={di}
                      className={`w-3 h-3 rounded-sm ${color} transition-colors cursor-default`}
                      title={titleText}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-2 text-xs text-zinc-400 flex-wrap">
        <span className="text-red-400">{formatUSD(-maxAbsPnl)}</span>
        <div className="flex gap-0.5 items-center">
          <div className="w-3 h-3 rounded-sm bg-red-400" title="Large loss" />
          <div className="w-3 h-3 rounded-sm bg-red-500" title="Medium loss" />
          <div className="w-3 h-3 rounded-sm bg-red-700" title="Small loss" />
          <div className="w-3 h-3 rounded-sm bg-red-900/40" title="Tiny loss" />
          <div className="w-3 h-3 rounded-sm bg-zinc-800 mx-0.5" title="No trades" />
          <div className="w-3 h-3 rounded-sm bg-emerald-900/40" title="Tiny gain" />
          <div className="w-3 h-3 rounded-sm bg-emerald-700" title="Small gain" />
          <div className="w-3 h-3 rounded-sm bg-emerald-500" title="Medium gain" />
          <div className="w-3 h-3 rounded-sm bg-emerald-400" title="Large gain" />
        </div>
        <span className="text-emerald-400">{formatUSD(maxAbsPnl)}</span>
        <span className="ml-2 text-zinc-600">
          Initial capital: ${initialCapital.toLocaleString()}
        </span>
      </div>
    </div>
  );
}
