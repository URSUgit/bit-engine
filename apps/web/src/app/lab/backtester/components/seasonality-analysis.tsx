"use client";

import { useMemo } from "react";
import { BacktestResult } from "@/lib/backtest-api";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Cell,
  Tooltip,
} from "recharts";

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const WEEKDAYS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

function pctColor(val: number): string {
  if (val === 0) return "bg-zinc-800 text-zinc-400";
  if (val > 0) {
    if (val >= 5) return "bg-green-700 text-green-100";
    if (val >= 2) return "bg-green-800 text-green-200";
    return "bg-green-900 text-green-300";
  }
  if (val <= -5) return "bg-red-700 text-red-100";
  if (val <= -2) return "bg-red-800 text-red-200";
  return "bg-red-900 text-red-300";
}

function fmt(val: number): string {
  return (val >= 0 ? "+" : "") + val.toFixed(1) + "%";
}

export function SeasonalityAnalysis({ result }: { result: BacktestResult }) {
  const trades = result.trades ?? [];

  const monthlyGrid = useMemo(() => {
    const map: Record<string, Record<number, number>> = {};
    for (const t of trades) {
      const d = new Date(t.exit_time);
      const yr = d.getUTCFullYear().toString();
      const mo = d.getUTCMonth();
      if (!map[yr]) map[yr] = {};
      map[yr][mo] = (map[yr][mo] ?? 0) + t.pnl_pct;
    }
    const years = Object.keys(map).sort();
    const colAvgs = MONTHS.map((_, mi) => {
      const vals = years.map(y => map[y][mi]).filter(v => v !== undefined) as number[];
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    });
    return { map, years, colAvgs };
  }, [trades]);

  const dowData = useMemo(() => {
    const buckets: { pnls: number[]; wins: number[] }[] = Array.from({ length: 7 }, () => ({ pnls: [], wins: [] }));
    for (const t of trades) {
      const dow = new Date(t.exit_time).getUTCDay();
      buckets[dow].pnls.push(t.pnl_pct);
      buckets[dow].wins.push(t.pnl_pct > 0 ? 1 : 0);
    }
    return WEEKDAYS.map((name, i) => {
      const { pnls, wins } = buckets[i];
      const avg = pnls.length ? pnls.reduce((a, b) => a + b, 0) / pnls.length : 0;
      const winRate = wins.length ? (wins.reduce((a, b) => a + b, 0) / wins.length) * 100 : 0;
      return { name, avg, winRate, count: pnls.length };
    });
  }, [trades]);

  const hourData = useMemo(() => {
    const buckets: number[][] = Array.from({ length: 24 }, () => []);
    for (const t of trades) {
      const hr = new Date(t.exit_time).getUTCHours();
      buckets[hr].push(t.pnl_pct);
    }
    return buckets.map((pnls, hr) => ({
      hour: hr,
      avg: pnls.length ? pnls.reduce((a, b) => a + b, 0) / pnls.length : 0,
      count: pnls.length,
    }));
  }, [trades]);

  const hasTimeInfo = useMemo(() => {
    if (!trades.length) return false;
    const d = new Date(trades[0].exit_time);
    return d.getUTCHours() !== 0 || d.getUTCMinutes() !== 0 || d.getUTCSeconds() !== 0;
  }, [trades]);

  const summaryCards = useMemo(() => {
    let bestMonthVal = -Infinity;
    let worstMonthVal = Infinity;
    let bestMonthLabel = "-";
    let worstMonthLabel = "-";

    for (const yr of monthlyGrid.years) {
      for (let mi = 0; mi < 12; mi++) {
        const v = monthlyGrid.map[yr][mi];
        if (v === undefined) continue;
        if (v > bestMonthVal) { bestMonthVal = v; bestMonthLabel = `${MONTHS[mi]} ${yr}`; }
        if (v < worstMonthVal) { worstMonthVal = v; worstMonthLabel = `${MONTHS[mi]} ${yr}`; }
      }
    }

    const bestDow = dowData.reduce((best, d) => d.count > 0 && d.avg > best.avg ? d : best, { name: "-", avg: -Infinity, count: 0, winRate: 0 });
    const mostActiveDow = dowData.reduce((best, d) => d.count > best.count ? d : best, { name: "-", avg: 0, count: -1, winRate: 0 });

    return {
      bestMonth: { label: bestMonthLabel, val: bestMonthVal === -Infinity ? null : bestMonthVal },
      worstMonth: { label: worstMonthLabel, val: worstMonthVal === Infinity ? null : worstMonthVal },
      bestDow: bestDow.count > 0 ? bestDow : null,
      mostActiveDow: mostActiveDow.count > 0 ? mostActiveDow : null,
    };
  }, [monthlyGrid, dowData]);

  if (!trades.length) {
    return (
      <div className="flex items-center justify-center h-40 text-zinc-500 text-sm">
        No trades to analyze
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { title: "Best Month", label: summaryCards.bestMonth.label, val: summaryCards.bestMonth.val, positive: true },
          { title: "Worst Month", label: summaryCards.worstMonth.label, val: summaryCards.worstMonth.val, positive: false },
          { title: "Best Day of Week", label: summaryCards.bestDow?.name ?? "-", val: summaryCards.bestDow?.avg ?? null, positive: true },
          { title: "Most Active Day", label: summaryCards.mostActiveDow?.name ?? "-", val: summaryCards.mostActiveDow ? summaryCards.mostActiveDow.count : null, isCount: true },
        ].map(({ title, label, val, positive, isCount }) => (
          <div key={title} className="rounded-lg bg-zinc-900 border border-zinc-800 p-3">
            <p className="text-xs text-zinc-500 mb-1">{title}</p>
            <p className="text-sm font-medium text-zinc-200">{label}</p>
            {val !== null && (
              <p className={`text-xs mt-0.5 ${isCount ? "text-zinc-400" : positive ? "text-green-400" : "text-red-400"}`}>
                {isCount ? `${val} trades` : fmt(val as number)}
              </p>
            )}
          </div>
        ))}
      </div>

      <div>
        <h3 className="text-sm font-medium text-zinc-300 mb-3">Monthly Returns (%)</h3>
        <div className="overflow-x-auto">
          <table className="min-w-full text-xs border-collapse">
            <thead>
              <tr>
                <th className="text-left px-2 py-1 text-zinc-500 font-normal w-12">Year</th>
                {MONTHS.map(m => (
                  <th key={m} className="px-1 py-1 text-zinc-500 font-normal text-center w-14">{m}</th>
                ))}
                <th className="px-2 py-1 text-zinc-500 font-normal text-center w-14">Total</th>
              </tr>
            </thead>
            <tbody>
              {monthlyGrid.years.map(yr => {
                const rowTotal = Object.values(monthlyGrid.map[yr]).reduce((a, b) => a + b, 0);
                return (
                  <tr key={yr}>
                    <td className="px-2 py-0.5 text-zinc-400">{yr}</td>
                    {MONTHS.map((_, mi) => {
                      const v = monthlyGrid.map[yr][mi];
                      if (v === undefined) {
                        return (
                          <td key={mi} className="px-1 py-0.5 text-center">
                            <span className="text-zinc-700">-</span>
                          </td>
                        );
                      }
                      return (
                        <td key={mi} className="px-0.5 py-0.5">
                          <div className={`rounded px-1 py-0.5 text-center ${pctColor(v)}`}>
                            {fmt(v)}
                          </div>
                        </td>
                      );
                    })}
                    <td className="px-1 py-0.5">
                      <div className={`rounded px-1 py-0.5 text-center font-medium ${pctColor(rowTotal)}`}>
                        {fmt(rowTotal)}
                      </div>
                    </td>
                  </tr>
                );
              })}
              <tr className="border-t border-zinc-800">
                <td className="px-2 py-0.5 text-zinc-500">Avg</td>
                {monthlyGrid.colAvgs.map((v, mi) => (
                  <td key={mi} className="px-0.5 py-0.5">
                    {v !== null ? (
                      <div className={`rounded px-1 py-0.5 text-center ${pctColor(v)}`}>
                        {fmt(v)}
                      </div>
                    ) : (
                      <span className="text-zinc-700 block text-center">-</span>
                    )}
                  </td>
                ))}
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-medium text-zinc-300 mb-3">Day-of-Week Pattern</h3>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={dowData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#3f3f46" vertical={false} />
            <XAxis dataKey="name" tick={{ fill: "#a1a1aa", fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: "#a1a1aa", fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v > 0 ? "+" : ""}${v.toFixed(1)}%`} />
            <Tooltip
              contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: 6 }}
              labelStyle={{ color: "#e4e4e7", fontSize: 12 }}
              itemStyle={{ color: "#a1a1aa", fontSize: 11 }}
              formatter={(v) => [`${Number(v) > 0 ? "+" : ""}${Number(v).toFixed(2)}%`, "Avg PnL"]}
            />
            <Bar dataKey="avg" radius={[3, 3, 0, 0]}>
              {dowData.map((entry, idx) => (
                <Cell key={idx} fill={entry.avg >= 0 ? "#16a34a" : "#dc2626"} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        <div className="mt-2 grid grid-cols-7 gap-1">
          {dowData.map(d => (
            <div key={d.name} className="text-center">
              <p className="text-xs text-zinc-500">{d.count} trades</p>
              <p className="text-xs text-zinc-400">{d.winRate.toFixed(0)}% WR</p>
            </div>
          ))}
        </div>
      </div>

      {hasTimeInfo && (
        <div>
          <h3 className="text-sm font-medium text-zinc-300 mb-1">Hour-of-Day Pattern</h3>
          <p className="text-xs text-zinc-500 mb-3">Times are UTC</p>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={hourData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#3f3f46" vertical={false} />
              <XAxis dataKey="hour" tick={{ fill: "#a1a1aa", fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}h`} />
              <YAxis tick={{ fill: "#a1a1aa", fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v > 0 ? "+" : ""}${Number(v).toFixed(1)}%`} />
              <Tooltip
                contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: 6 }}
                labelStyle={{ color: "#e4e4e7", fontSize: 12 }}
                itemStyle={{ color: "#a1a1aa", fontSize: 11 }}
                labelFormatter={(v) => `Hour ${v} UTC`}
                formatter={(v) => [`${Number(v) > 0 ? "+" : ""}${Number(v).toFixed(2)}%`, "Avg PnL"]}
              />
              <Bar dataKey="avg" radius={[2, 2, 0, 0]}>
                {hourData.map((entry, idx) => (
                  <Cell key={idx} fill={entry.avg >= 0 ? "#16a34a" : "#dc2626"} opacity={entry.count > 0 ? 1 : 0.2} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
