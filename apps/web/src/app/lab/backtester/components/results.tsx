"use client";

import { useEffect, useRef, useState } from "react";
import {
  createChart, ColorType,
  type IChartApi, type CandlestickData, type SeriesMarker, type Time,
} from "lightweight-charts";
import { backtestApi, type BacktestResult } from "@/lib/backtest-api";

export function MetricsGrid({ result }: { result: BacktestResult }) {
  const m = result.metrics;
  const b = result.benchmark_metrics;
  const beats = b ? m.total_return_pct > b.total_return_pct : false;
  return (
    <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-4">
        <div>
          <h3 className="font-semibold">{result.symbol} · {result.strategy}</h3>
          <p className="text-xs text-zinc-500">
            {result.start_date} → {result.end_date} · {result.bars_processed} bars · {result.runtime_ms}ms
          </p>
        </div>
        {b && (
          <div className={`text-xs px-2 py-1 rounded ${beats ? "bg-emerald-900/40 text-emerald-300" : "bg-zinc-800 text-zinc-400"}`}>
            {beats ? "Beats" : "Underperforms"} buy-and-hold ({b.total_return_pct >= 0 ? "+" : ""}{b.total_return_pct.toFixed(1)}%)
          </div>
        )}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricCard label="Total return" value={fmtPct(m.total_return_pct)} positive={m.total_return_pct >= 0} />
        <MetricCard label="CAGR" value={fmtPct(m.cagr_pct)} positive={m.cagr_pct >= 0} />
        <MetricCard label="Sharpe" value={m.sharpe_ratio.toFixed(2)} positive={m.sharpe_ratio >= 1} />
        <MetricCard label="Sortino" value={m.sortino_ratio.toFixed(2)} positive={m.sortino_ratio >= 1} />
        <MetricCard label="Max drawdown" value={`-${m.max_drawdown_pct.toFixed(2)}%`} positive={false} muted />
        <MetricCard label="Calmar" value={m.calmar_ratio.toFixed(2)} positive={m.calmar_ratio >= 1} />
        <MetricCard label="Win rate" value={`${m.win_rate_pct.toFixed(1)}%`} positive={m.win_rate_pct >= 50} />
        <MetricCard label="Profit factor" value={m.profit_factor.toFixed(2)} positive={m.profit_factor >= 1} />
        <MetricCard label="Trades" value={`${m.total_trades}`} positive />
        <MetricCard label="Wins / Losses" value={`${m.winning_trades} / ${m.losing_trades}`} positive />
        <MetricCard label="Avg trade" value={fmtPct(m.avg_trade_pnl_pct)} positive={m.avg_trade_pnl_pct >= 0} />
        <MetricCard label="Final equity" value={`$${m.final_equity.toLocaleString(undefined, { maximumFractionDigits: 0 })}`} positive={m.final_equity > m.initial_capital} />
      </div>
    </div>
  );
}

function fmtPct(n: number): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

function MetricCard({ label, value, positive, muted }: { label: string; value: string; positive: boolean; muted?: boolean }) {
  const color = muted ? "text-zinc-400" : positive ? "text-emerald-400" : "text-red-400";
  return (
    <div className="bg-zinc-950 border border-zinc-800 rounded p-3">
      <div className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</div>
      <div className={`text-lg font-semibold mt-1 ${color}`}>{value}</div>
    </div>
  );
}

export function PriceChart({ result }: { result: BacktestResult }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const [bars, setBars] = useState<CandlestickData[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    backtestApi
      .data(result.symbol, result.start_date, result.end_date, result.interval)
      .then((d) => {
        if (cancelled) return;
        setBars(
          d.bars.map((b) => ({
            time: b.t as Time,
            open: b.o, high: b.h, low: b.l, close: b.c,
          })),
        );
      })
      .catch((e) => console.error("PriceChart data fetch failed", e));
    return () => { cancelled = true; };
  }, [result.symbol, result.start_date, result.end_date, result.interval]);

  useEffect(() => {
    if (!containerRef.current || !bars) return;

    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: 420,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#a1a1aa",
      },
      grid: {
        vertLines: { color: "#27272a" },
        horzLines: { color: "#27272a" },
      },
      timeScale: { borderColor: "#27272a", timeVisible: true },
      rightPriceScale: { borderColor: "#27272a" },
    });
    chartRef.current = chart;

    const series = chart.addCandlestickSeries({
      upColor: "#10b981", downColor: "#ef4444",
      borderUpColor: "#10b981", borderDownColor: "#ef4444",
      wickUpColor: "#10b981", wickDownColor: "#ef4444",
    });
    series.setData(bars);

    const markers: SeriesMarker<Time>[] = [];
    for (const t of result.trades) {
      const entryTs = Math.floor(new Date(t.entry_time).getTime() / 1000) as Time;
      const exitTs = Math.floor(new Date(t.exit_time).getTime() / 1000) as Time;
      markers.push({
        time: entryTs,
        position: "belowBar",
        color: "#06b6d4",
        shape: "arrowUp",
        text: `BUY ${t.entry_price.toFixed(2)}`,
      });
      markers.push({
        time: exitTs,
        position: "aboveBar",
        color: t.pnl >= 0 ? "#10b981" : "#ef4444",
        shape: "arrowDown",
        text: `SELL ${t.exit_price.toFixed(2)} (${t.pnl_pct >= 0 ? "+" : ""}${t.pnl_pct.toFixed(1)}%)`,
      });
    }
    markers.sort((a, b) => Number(a.time) - Number(b.time));
    series.setMarkers(markers);
    chart.timeScale().fitContent();

    const onResize = () => {
      if (containerRef.current && chartRef.current) {
        chartRef.current.applyOptions({ width: containerRef.current.clientWidth });
      }
    };
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      chart.remove();
      chartRef.current = null;
    };
  }, [bars, result.trades]);

  return (
    <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
      <h3 className="font-semibold mb-3">Price + Trades</h3>
      <div ref={containerRef} className="w-full" />
      {!bars && <div className="text-zinc-500 text-sm py-8 text-center">Loading price data…</div>}
    </div>
  );
}

export function EquityChart({ result }: { result: BacktestResult }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: 260,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#a1a1aa",
      },
      grid: { vertLines: { color: "#27272a" }, horzLines: { color: "#27272a" } },
      timeScale: { borderColor: "#27272a", timeVisible: true },
      rightPriceScale: { borderColor: "#27272a" },
    });

    const equitySeries = chart.addAreaSeries({
      topColor: "rgba(6, 182, 212, 0.4)",
      bottomColor: "rgba(6, 182, 212, 0.05)",
      lineColor: "#06b6d4",
      lineWidth: 2,
      priceLineVisible: false,
    });
    equitySeries.setData(result.equity_curve.map((p) => ({ time: p.t as Time, value: p.equity })));

    const ddSeries = chart.addLineSeries({
      color: "#ef4444", lineWidth: 1, priceScaleId: "left",
    });
    chart.priceScale("left").applyOptions({ borderColor: "#27272a", visible: true });
    ddSeries.setData(result.equity_curve.map((p) => ({ time: p.t as Time, value: -p.drawdown_pct })));

    chart.timeScale().fitContent();
    const onResize = () => {
      if (containerRef.current) chart.applyOptions({ width: containerRef.current.clientWidth });
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      chart.remove();
    };
  }, [result.equity_curve]);

  return (
    <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
      <h3 className="font-semibold mb-3">
        Equity curve <span className="text-zinc-500 text-xs ml-2">(cyan: portfolio · red: drawdown %)</span>
      </h3>
      <div ref={containerRef} className="w-full" />
    </div>
  );
}

export function TradesTable({ trades }: { trades: BacktestResult["trades"] }) {
  if (trades.length === 0) {
    return (
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4 text-zinc-500 text-sm">
        No trades executed.
      </div>
    );
  }
  return (
    <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
      <h3 className="font-semibold mb-3">Trades ({trades.length})</h3>
      <div className="overflow-x-auto max-h-[420px]">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-zinc-900">
            <tr className="text-left text-xs text-zinc-500 uppercase tracking-wide border-b border-zinc-800">
              <th className="py-2 pr-3">#</th>
              <th className="py-2 pr-3">Entry</th>
              <th className="py-2 pr-3">Exit</th>
              <th className="py-2 pr-3 text-right">Entry $</th>
              <th className="py-2 pr-3 text-right">Exit $</th>
              <th className="py-2 pr-3 text-right">Bars</th>
              <th className="py-2 pr-3 text-right">P&L $</th>
              <th className="py-2 text-right">P&L %</th>
            </tr>
          </thead>
          <tbody>
            {trades.map((t, i) => {
              const win = t.pnl >= 0;
              return (
                <tr key={i} className="border-b border-zinc-800/60">
                  <td className="py-2 pr-3 text-zinc-500">{i + 1}</td>
                  <td className="py-2 pr-3 text-zinc-300">{t.entry_time.slice(0, 10)}</td>
                  <td className="py-2 pr-3 text-zinc-300">{t.exit_time.slice(0, 10)}</td>
                  <td className="py-2 pr-3 text-right text-zinc-300">{t.entry_price.toLocaleString(undefined, { maximumFractionDigits: 4 })}</td>
                  <td className="py-2 pr-3 text-right text-zinc-300">{t.exit_price.toLocaleString(undefined, { maximumFractionDigits: 4 })}</td>
                  <td className="py-2 pr-3 text-right text-zinc-500">{t.duration_bars}</td>
                  <td className={`py-2 pr-3 text-right ${win ? "text-emerald-400" : "text-red-400"}`}>
                    {win ? "+" : ""}{t.pnl.toFixed(2)}
                  </td>
                  <td className={`py-2 text-right ${win ? "text-emerald-400" : "text-red-400"}`}>
                    {win ? "+" : ""}{t.pnl_pct.toFixed(2)}%
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
