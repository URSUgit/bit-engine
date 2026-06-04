"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createChart, ColorType, CrosshairMode,
  type IChartApi, type ISeriesApi, type SeriesMarker, type Time,
  type IPriceLine,
} from "lightweight-charts";
import { backtestApi, type BacktestResult, type Bar, type Trade } from "@/lib/backtest-api";
import { downloadBlob, todayIso } from "@/lib/export-utils";

// ── P&L recomputation ─────────────────────────────────────────────────────────
// Recompute a trade's P&L from edited entry/exit prices. Size is units of the
// asset; pnl_pct is relative to the entry notional. Longs profit when price
// rises, shorts when it falls.

function recomputePnl(t: EditableTrade): { pnl: number; pnl_pct: number } {
  const dir = t.side === "short" ? -1 : 1;
  const move = (t.exit_price - t.entry_price) * dir;
  const pnl = move * t.size;
  const pnl_pct = t.entry_price !== 0 ? (move / t.entry_price) * 100 : 0;
  return { pnl, pnl_pct };
}

function durationBars(entryTime: string, exitTime: string, intervalMs: number): number {
  const d = new Date(exitTime).getTime() - new Date(entryTime).getTime();
  if (!isFinite(d) || intervalMs <= 0) return 0;
  return Math.max(0, Math.round(d / intervalMs));
}

// Map an interval string to milliseconds for duration recompute.
function intervalToMs(interval: string): number {
  const m: Record<string, number> = {
    "1m": 60_000, "3m": 180_000, "5m": 300_000, "15m": 900_000, "30m": 1_800_000,
    "1h": 3_600_000, "2h": 7_200_000, "4h": 14_400_000, "6h": 21_600_000,
    "12h": 43_200_000, "1d": 86_400_000, "1w": 604_800_000,
  };
  return m[interval] ?? 86_400_000;
}

type EditableTrade = Trade & { _edited: boolean };

// Convert an ISO string to the value a <input type="datetime-local"> expects.
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ── Aggregate stats from a trade list ─────────────────────────────────────────

function aggregate(trades: EditableTrade[]) {
  const n = trades.length;
  const wins = trades.filter((t) => t.pnl >= 0);
  const grossWin = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = trades.filter((t) => t.pnl < 0).reduce((s, t) => s + Math.abs(t.pnl), 0);
  const totalPnl = trades.reduce((s, t) => s + t.pnl, 0);
  const totalPct = trades.reduce((s, t) => s + t.pnl_pct, 0);
  return {
    totalPnl,
    totalPct,
    winRate: n ? (wins.length / n) * 100 : 0,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0,
    trades: n,
    wins: wins.length,
    losses: n - wins.length,
  };
}

// ── Main component ────────────────────────────────────────────────────────────

export function TradeEditor({ result }: { result: BacktestResult }) {
  const [bars, setBars] = useState<Bar[] | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [trades, setTrades] = useState<EditableTrade[]>(
    () => result.trades.map((t) => ({ ...t, _edited: false })),
  );
  const [selected, setSelected] = useState<number>(0);

  const intervalMs = useMemo(() => intervalToMs(result.interval), [result.interval]);

  const chartRef = useRef<HTMLDivElement | null>(null);
  const apiRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);

  // Reset editable trades whenever a new backtest result arrives.
  useEffect(() => {
    setTrades(result.trades.map((t) => ({ ...t, _edited: false })));
    setSelected(0);
  }, [result.trades]);

  // Fetch OHLCV bars for the chart.
  useEffect(() => {
    let cancelled = false;
    setLoadErr(null);
    setBars(null);
    backtestApi
      .data(result.symbol, result.start_date, result.end_date, result.interval)
      .then((d) => { if (!cancelled) setBars(d.bars); })
      .catch((e) => { if (!cancelled) setLoadErr(String(e)); });
    return () => { cancelled = true; };
  }, [result.symbol, result.start_date, result.end_date, result.interval]);

  // Build the candlestick chart once bars are available.
  useEffect(() => {
    if (!chartRef.current || !bars || bars.length === 0) return;

    const chart = createChart(chartRef.current, {
      width: chartRef.current.clientWidth,
      height: 420,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: "#a1a1aa" },
      grid: { vertLines: { color: "#1f2937" }, horzLines: { color: "#1f2937" } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: "#374151" },
      timeScale: { borderColor: "#374151", timeVisible: true },
    });
    const candles = chart.addCandlestickSeries({
      upColor: "#10b981", downColor: "#ef4444",
      borderUpColor: "#10b981", borderDownColor: "#ef4444",
      wickUpColor: "#10b981", wickDownColor: "#ef4444",
    });
    candles.setData(bars.map((b) => ({ time: b.t as Time, open: b.o, high: b.h, low: b.l, close: b.c })));
    chart.timeScale().fitContent();

    apiRef.current = chart;
    candleRef.current = candles;

    const onResize = () => {
      if (chartRef.current) chart.applyOptions({ width: chartRef.current.clientWidth });
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      chart.remove();
      apiRef.current = null;
      candleRef.current = null;
      priceLinesRef.current = [];
    };
  }, [bars]);

  // Redraw markers + the selected trade's entry/exit price lines on every edit.
  useEffect(() => {
    const candles = candleRef.current;
    if (!candles) return;

    const markers: SeriesMarker<Time>[] = [];
    trades.forEach((t, i) => {
      const entryTs = Math.floor(new Date(t.entry_time).getTime() / 1000) as Time;
      const exitTs = Math.floor(new Date(t.exit_time).getTime() / 1000) as Time;
      const isSel = i === selected;
      markers.push({
        time: entryTs, position: "belowBar",
        color: isSel ? "#fbbf24" : "#06b6d4",
        shape: "arrowUp", size: isSel ? 3 : 1,
        text: isSel ? `#${i + 1} entry` : "",
      });
      markers.push({
        time: exitTs, position: "aboveBar",
        color: t.pnl >= 0 ? "#10b981" : "#ef4444",
        shape: "arrowDown", size: isSel ? 3 : 1,
        text: isSel ? `${t.pnl >= 0 ? "+" : ""}${t.pnl_pct.toFixed(1)}%` : "",
      });
    });
    markers.sort((a, b) => Number(a.time) - Number(b.time));
    candles.setMarkers(markers);

    // Clear old price lines, draw fresh ones for the selected trade.
    priceLinesRef.current.forEach((pl) => candles.removePriceLine(pl));
    priceLinesRef.current = [];
    const sel = trades[selected];
    if (sel) {
      priceLinesRef.current.push(
        candles.createPriceLine({
          price: sel.entry_price, color: "#fbbf24", lineWidth: 1, lineStyle: 2,
          axisLabelVisible: true, title: "entry",
        }),
        candles.createPriceLine({
          price: sel.exit_price, color: sel.pnl >= 0 ? "#10b981" : "#ef4444",
          lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: "exit",
        }),
      );
    }
  }, [trades, selected, bars]);

  // Apply an edit to one field of the selected trade and recompute derived stats.
  const editField = useCallback(
    (field: "entry_price" | "exit_price" | "entry_time" | "exit_time" | "size", raw: string) => {
      setTrades((prev) => {
        const next = [...prev];
        const t = { ...next[selected] };
        if (field === "entry_time" || field === "exit_time") {
          const d = new Date(raw);
          if (!isNaN(d.getTime())) t[field] = d.toISOString();
        } else {
          const v = parseFloat(raw);
          if (isFinite(v)) (t as unknown as Record<string, number>)[field] = v;
        }
        const { pnl, pnl_pct } = recomputePnl(t);
        t.pnl = pnl;
        t.pnl_pct = pnl_pct;
        t.duration_bars = durationBars(t.entry_time, t.exit_time, intervalMs);
        t._edited = true;
        next[selected] = t;
        return next;
      });
    },
    [selected, intervalMs],
  );

  const resetTrade = useCallback(() => {
    setTrades((prev) => {
      const next = [...prev];
      next[selected] = { ...result.trades[selected], _edited: false };
      return next;
    });
  }, [selected, result.trades]);

  const resetAll = useCallback(() => {
    setTrades(result.trades.map((t) => ({ ...t, _edited: false })));
  }, [result.trades]);

  const exportEdited = useCallback(() => {
    const header = "index,side,entry_time,exit_time,entry_price,exit_price,size,pnl,pnl_pct,duration_bars,edited\n";
    const rows = trades.map((t, i) =>
      [i + 1, t.side, t.entry_time, t.exit_time, t.entry_price, t.exit_price,
       t.size, t.pnl.toFixed(4), t.pnl_pct.toFixed(4), t.duration_bars, t._edited].join(","));
    downloadBlob(`trades-edited-${result.symbol}-${todayIso()}.csv`, header + rows.join("\n"), "text/csv");
  }, [trades, result.symbol]);

  const editedAgg = useMemo(() => aggregate(trades), [trades]);
  const originalAgg = useMemo(
    () => aggregate(result.trades.map((t) => ({ ...t, _edited: false }))),
    [result.trades],
  );
  const editedCount = trades.filter((t) => t._edited).length;
  const sel = trades[selected];

  if (result.trades.length === 0) {
    return (
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4 text-zinc-500 text-sm">
        No trades to edit — run a backtest that produces trades first.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header + what-if summary */}
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h3 className="font-semibold text-zinc-100">Trade Editor — what-if analysis</h3>
            <p className="text-xs text-zinc-500 mt-0.5">
              Override the entry/exit of any algorithm trade and watch the P&amp;L recompute live.
              {editedCount > 0 && <span className="text-amber-400"> · {editedCount} edited</span>}
            </p>
          </div>
          <div className="flex gap-2">
            <button onClick={resetAll}
              className="px-2.5 py-1 text-xs rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700">
              Reset all
            </button>
            <button onClick={exportEdited}
              className="px-2.5 py-1 text-xs rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700">
              ↓ Export edited
            </button>
          </div>
        </div>

        {/* Original vs edited aggregates */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
          <CompareCard label="Total P&L" original={`${originalAgg.totalPnl >= 0 ? "+" : ""}$${originalAgg.totalPnl.toFixed(0)}`}
            edited={`${editedAgg.totalPnl >= 0 ? "+" : ""}$${editedAgg.totalPnl.toFixed(0)}`}
            positive={editedAgg.totalPnl >= originalAgg.totalPnl} />
          <CompareCard label="Sum return %" original={`${originalAgg.totalPct >= 0 ? "+" : ""}${originalAgg.totalPct.toFixed(1)}%`}
            edited={`${editedAgg.totalPct >= 0 ? "+" : ""}${editedAgg.totalPct.toFixed(1)}%`}
            positive={editedAgg.totalPct >= originalAgg.totalPct} />
          <CompareCard label="Win rate" original={`${originalAgg.winRate.toFixed(0)}%`}
            edited={`${editedAgg.winRate.toFixed(0)}%`} positive={editedAgg.winRate >= originalAgg.winRate} />
          <CompareCard label="Profit factor" original={fmtPf(originalAgg.profitFactor)}
            edited={fmtPf(editedAgg.profitFactor)} positive={editedAgg.profitFactor >= originalAgg.profitFactor} />
        </div>
      </div>

      {/* Chart */}
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
        <div ref={chartRef} className="w-full" />
        {!bars && !loadErr && <div className="text-zinc-500 text-sm py-8 text-center">Loading price data…</div>}
        {loadErr && <div className="text-red-400 text-sm py-4 text-center">Failed to load bars: {loadErr}</div>}
        <p className="text-[11px] text-zinc-600 mt-2">
          Amber = selected trade entry · dashed lines mark the editable entry/exit prices.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Trade selector list */}
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-3 max-h-[420px] overflow-y-auto">
          <h4 className="text-xs uppercase tracking-wide text-zinc-500 mb-2 px-1">Trades ({trades.length})</h4>
          <div className="space-y-1">
            {trades.map((t, i) => (
              <button key={i} onClick={() => setSelected(i)}
                className={`w-full text-left px-2 py-1.5 rounded text-xs border transition flex items-center justify-between gap-2 ${
                  selected === i ? "border-amber-500 bg-amber-500/10" : "border-zinc-800 hover:border-zinc-700"
                }`}>
                <span className="text-zinc-400">
                  #{i + 1} {t._edited && <span className="text-amber-400">●</span>} · {t.entry_time.slice(0, 10)}
                </span>
                <span className={t.pnl >= 0 ? "text-emerald-400" : "text-red-400"}>
                  {t.pnl >= 0 ? "+" : ""}{t.pnl_pct.toFixed(1)}%
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Editor form for the selected trade */}
        <div className="lg:col-span-2 bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
          {sel && (
            <>
              <div className="flex items-center justify-between mb-4">
                <h4 className="font-semibold text-zinc-200">
                  Editing trade #{selected + 1}
                  <span className={`ml-2 text-xs px-1.5 py-0.5 rounded ${
                    sel.side === "long" ? "bg-emerald-900/40 text-emerald-300" : "bg-red-900/40 text-red-300"}`}>
                    {sel.side}
                  </span>
                </h4>
                {sel._edited && (
                  <button onClick={resetTrade}
                    className="px-2 py-0.5 text-xs rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 border border-zinc-700">
                    Reset this trade
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Entry price">
                  <input type="number" step="any" value={sel.entry_price}
                    onChange={(e) => editField("entry_price", e.target.value)} className={inputCls} />
                </Field>
                <Field label="Exit price">
                  <input type="number" step="any" value={sel.exit_price}
                    onChange={(e) => editField("exit_price", e.target.value)} className={inputCls} />
                </Field>
                <Field label="Entry time">
                  <input type="datetime-local" value={toLocalInput(sel.entry_time)}
                    onChange={(e) => editField("entry_time", e.target.value)} className={inputCls} />
                </Field>
                <Field label="Exit time">
                  <input type="datetime-local" value={toLocalInput(sel.exit_time)}
                    onChange={(e) => editField("exit_time", e.target.value)} className={inputCls} />
                </Field>
                <Field label="Size (units)">
                  <input type="number" step="any" value={sel.size}
                    onChange={(e) => editField("size", e.target.value)} className={inputCls} />
                </Field>
                <Field label="Duration (bars)">
                  <div className="px-2.5 py-1.5 rounded bg-zinc-950 border border-zinc-800 text-zinc-400 text-sm">
                    {sel.duration_bars}
                  </div>
                </Field>
              </div>

              {/* Live recomputed result for this trade */}
              <div className="grid grid-cols-2 gap-3 mt-4">
                <div className="bg-zinc-950 border border-zinc-800 rounded p-3">
                  <div className="text-[10px] uppercase tracking-wide text-zinc-500">Recomputed P&L</div>
                  <div className={`text-xl font-semibold mt-1 ${sel.pnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                    {sel.pnl >= 0 ? "+" : ""}${sel.pnl.toFixed(2)}
                  </div>
                </div>
                <div className="bg-zinc-950 border border-zinc-800 rounded p-3">
                  <div className="text-[10px] uppercase tracking-wide text-zinc-500">Return %</div>
                  <div className={`text-xl font-semibold mt-1 ${sel.pnl_pct >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                    {sel.pnl_pct >= 0 ? "+" : ""}{sel.pnl_pct.toFixed(2)}%
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const inputCls =
  "w-full px-2.5 py-1.5 rounded bg-zinc-950 border border-zinc-800 text-zinc-200 text-sm " +
  "focus:border-cyan-500 focus:outline-none";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

function fmtPf(v: number): string {
  return v === Infinity ? "∞" : v.toFixed(2);
}

function CompareCard({
  label, original, edited, positive,
}: { label: string; original: string; edited: string; positive: boolean }) {
  const changed = original !== edited;
  return (
    <div className="bg-zinc-950 border border-zinc-800 rounded p-3">
      <div className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</div>
      <div className={`text-lg font-semibold mt-1 ${changed ? (positive ? "text-emerald-400" : "text-red-400") : "text-zinc-200"}`}>
        {edited}
      </div>
      {changed && <div className="text-[10px] text-zinc-600 mt-0.5">was {original}</div>}
    </div>
  );
}
