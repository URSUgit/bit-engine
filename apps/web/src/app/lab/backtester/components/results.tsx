"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createChart, ColorType, CrosshairMode,
  type IChartApi, type SeriesMarker, type Time,
} from "lightweight-charts";
import { backtestApi, type BacktestResult, type EntryAnalysis, type FeatureStats, type Bar } from "@/lib/backtest-api";
import { downloadBlob, todayIso } from "@/lib/export-utils";
import { paperApi } from "@/lib/paper-api";

// ── Indicator computation ─────────────────────────────────────────────────────

type Pt = { time: Time; value: number };

function computeSMA(bars: Bar[], period: number): Pt[] {
  const result: Pt[] = [];
  let sum = 0;
  for (let i = 0; i < bars.length; i++) {
    sum += bars[i].c;
    if (i >= period) sum -= bars[i - period].c;
    if (i >= period - 1) result.push({ time: bars[i].t as Time, value: sum / period });
  }
  return result;
}

function computeRSI(bars: Bar[], period = 14): Pt[] {
  if (bars.length <= period) return [];
  const result: Pt[] = [];
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const d = bars[i].c - bars[i - 1].c;
    if (d > 0) avgGain += d; else avgLoss -= d;
  }
  avgGain /= period; avgLoss /= period;
  const rsiVal = (g: number, l: number) => l === 0 ? 100 : 100 - 100 / (1 + g / l);
  result.push({ time: bars[period].t as Time, value: rsiVal(avgGain, avgLoss) });
  for (let i = period + 1; i < bars.length; i++) {
    const d = bars[i].c - bars[i - 1].c;
    avgGain = (avgGain * (period - 1) + Math.max(d, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.abs(Math.min(d, 0))) / period;
    result.push({ time: bars[i].t as Time, value: rsiVal(avgGain, avgLoss) });
  }
  return result;
}

type BBPt = { time: Time; upper: number; middle: number; lower: number };
function computeBB(bars: Bar[], period = 20): BBPt[] {
  const result: BBPt[] = [];
  for (let i = period - 1; i < bars.length; i++) {
    const slice = bars.slice(i - period + 1, i + 1).map((b) => b.c);
    const mid = slice.reduce((s, v) => s + v, 0) / period;
    const std = Math.sqrt(slice.reduce((s, v) => s + (v - mid) ** 2, 0) / period);
    result.push({ time: bars[i].t as Time, upper: mid + 2 * std, middle: mid, lower: mid - 2 * std });
  }
  return result;
}

type MACDPt = { time: Time; macd: number; signal: number; histogram: number };
function computeMACD(bars: Bar[], fast = 12, slow = 26, sig = 9): MACDPt[] {
  if (bars.length < slow + sig) return [];
  const ema = (vals: number[], p: number): number[] => {
    const k = 2 / (p + 1);
    let e = vals.slice(0, p).reduce((s, v) => s + v, 0) / p;
    const out = [e];
    for (let i = p; i < vals.length; i++) { e = vals[i] * k + e * (1 - k); out.push(e); }
    return out;
  };
  const closes = bars.map((b) => b.c);
  const fe = ema(closes, fast);
  const se = ema(closes, slow);
  const macdLine: number[] = [];
  const times: Time[] = [];
  for (let i = 0; i < se.length; i++) {
    const fi = i + (slow - fast);
    if (fi >= fe.length) break;
    macdLine.push(fe[fi] - se[i]);
    times.push(bars[slow - 1 + i].t as Time);
  }
  const sigLine = ema(macdLine, sig);
  const result: MACDPt[] = [];
  for (let i = sig - 1; i < macdLine.length; i++) {
    const m = macdLine[i], s = sigLine[i - (sig - 1)];
    result.push({ time: times[i], macd: m, signal: s, histogram: m - s });
  }
  return result;
}

// ── Indicator toggle metadata ─────────────────────────────────────────────────

type IndicatorKey = "sma20" | "sma50" | "sma200" | "bb" | "volume" | "rsi" | "macd";

const INDICATORS: { key: IndicatorKey; label: string; color: string }[] = [
  { key: "sma20",  label: "SMA 20",  color: "#eab308" },
  { key: "sma50",  label: "SMA 50",  color: "#f97316" },
  { key: "sma200", label: "SMA 200", color: "#a855f7" },
  { key: "bb",     label: "BB(20)",  color: "#22d3ee" },
  { key: "volume", label: "Volume",  color: "#60a5fa" },
  { key: "rsi",    label: "RSI 14",  color: "#f472b6" },
  { key: "macd",   label: "MACD",    color: "#34d399" },
];

export function MetricsGrid({ result }: { result: BacktestResult }) {
  const m = result.metrics;
  const b = result.benchmark_metrics;
  const beats = b ? m.total_return_pct > b.total_return_pct : false;
  const [paperStatus, setPaperStatus] = useState<"idle" | "loading" | "ok" | "err">("idle");

  async function handlePaperTrade() {
    const trades = result.trades;
    if (!trades || trades.length === 0) return;
    const lastTrade = trades[trades.length - 1];
    setPaperStatus("loading");
    try {
      await paperApi.openPosition({
        symbol: result.symbol,
        side: lastTrade.side,
        entry_price: lastTrade.entry_price,
        size: lastTrade.size,
        strategy: result.strategy,
        notes: `From backtest: ${result.strategy} ${result.interval} ${result.start_date}→${result.end_date}`,
      });
      setPaperStatus("ok");
      setTimeout(() => setPaperStatus("idle"), 2500);
    } catch {
      setPaperStatus("err");
      setTimeout(() => setPaperStatus("idle"), 2500);
    }
  }

  return (
    <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-4">
        <div>
          <h3 className="font-semibold">{result.symbol} · {result.strategy}</h3>
          <p className="text-xs text-zinc-500">
            {result.start_date} → {result.end_date} · {result.bars_processed} bars · {result.runtime_ms}ms
          </p>
        </div>
        <div className="flex items-center gap-2">
          {result.trades && result.trades.length > 0 && (
            <button
              onClick={handlePaperTrade}
              disabled={paperStatus === "loading"}
              className={`text-xs px-2.5 py-1 rounded flex items-center gap-1 border transition-colors ${
                paperStatus === "ok"
                  ? "bg-emerald-900/40 text-emerald-300 border-emerald-700"
                  : paperStatus === "err"
                  ? "bg-red-900/40 text-red-300 border-red-700"
                  : "bg-zinc-800 text-zinc-300 border-zinc-700 hover:bg-zinc-700"
              }`}
            >
              {paperStatus === "loading" ? "Opening…" : paperStatus === "ok" ? "Opened!" : paperStatus === "err" ? "Failed" : "Paper Trade"}
            </button>
          )}
          {b && (
            <div className={`text-xs px-2 py-1 rounded ${beats ? "bg-emerald-900/40 text-emerald-300" : "bg-zinc-800 text-zinc-400"}`}>
              {beats ? "Beats" : "Underperforms"} buy-and-hold ({b.total_return_pct >= 0 ? "+" : ""}{b.total_return_pct.toFixed(1)}%)
            </div>
          )}
        </div>
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
  const priceRef   = useRef<HTMLDivElement | null>(null);
  const volumeRef  = useRef<HTMLDivElement | null>(null);
  const rsiRef     = useRef<HTMLDivElement | null>(null);
  const macdRef    = useRef<HTMLDivElement | null>(null);

  // Callback refs so conditional-render mounts/unmounts update the ref before the effect fires
  const volumeCb = useCallback((el: HTMLDivElement | null) => { volumeRef.current  = el; }, []);
  const rsiCb    = useCallback((el: HTMLDivElement | null) => { rsiRef.current     = el; }, []);
  const macdCb   = useCallback((el: HTMLDivElement | null) => { macdRef.current    = el; }, []);

  const [bars, setBars]       = useState<Bar[] | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [active, setActive]   = useState<Set<IndicatorKey>>(
    new Set(["sma20", "sma50", "volume", "rsi"] as IndicatorKey[]),
  );

  const toggle = useCallback((key: IndicatorKey) => {
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  // Fetch OHLCV bars
  useEffect(() => {
    let cancelled = false;
    setLoadErr(null);
    setBars(null); // clear stale bars so a failed fetch can't show the prior symbol's chart
    backtestApi
      .data(result.symbol, result.start_date, result.end_date, result.interval)
      .then((d) => { if (!cancelled) setBars(d.bars); })
      .catch((e) => { if (!cancelled) setLoadErr(String(e)); });
    return () => { cancelled = true; };
  }, [result.symbol, result.start_date, result.end_date, result.interval]);

  // Build + sync charts
  useEffect(() => {
    if (!priceRef.current || !bars || bars.length === 0) return;

    const charts: IChartApi[] = [];
    const containerMap = new Map<IChartApi, HTMLDivElement>();

    const mkChart = (el: HTMLDivElement, height: number, timeVisible: boolean) =>
      createChart(el, {
        width: el.clientWidth,
        height,
        layout: {
          background: { type: ColorType.Solid, color: "transparent" },
          textColor: "#a1a1aa",
        },
        grid: { vertLines: { color: "#1f2937" }, horzLines: { color: "#1f2937" } },
        crosshair: { mode: CrosshairMode.Normal },
        rightPriceScale: { borderColor: "#374151" },
        timeScale: { borderColor: "#374151", timeVisible, visible: timeVisible },
        handleScroll: true,
        handleScale: true,
      });

    const hasVolume = active.has("volume") && volumeRef.current !== null;
    const hasRsi    = active.has("rsi")    && rsiRef.current    !== null;
    const hasMacd   = active.has("macd")   && macdRef.current   !== null;
    const hasSubpanels = hasVolume || hasRsi || hasMacd;

    // ── Price chart ───────────────────────────────────────────────────────────
    const pc = mkChart(priceRef.current, 400, !hasSubpanels);
    charts.push(pc);
    containerMap.set(pc, priceRef.current);

    const candles = pc.addCandlestickSeries({
      upColor: "#10b981", downColor: "#ef4444",
      borderUpColor: "#10b981", borderDownColor: "#ef4444",
      wickUpColor: "#10b981", wickDownColor: "#ef4444",
    });
    candles.setData(bars.map((b) => ({ time: b.t as Time, open: b.o, high: b.h, low: b.l, close: b.c })));

    // Moving averages
    if (active.has("sma20")) {
      const s = pc.addLineSeries({ color: "#eab308", lineWidth: 1, lastValueVisible: false, priceLineVisible: false });
      s.setData(computeSMA(bars, 20));
    }
    if (active.has("sma50")) {
      const s = pc.addLineSeries({ color: "#f97316", lineWidth: 1, lastValueVisible: false, priceLineVisible: false });
      s.setData(computeSMA(bars, 50));
    }
    if (active.has("sma200")) {
      const s = pc.addLineSeries({ color: "#a855f7", lineWidth: 2, lastValueVisible: false, priceLineVisible: false });
      s.setData(computeSMA(bars, 200));
    }

    // Bollinger Bands
    if (active.has("bb")) {
      const bbData = computeBB(bars);
      const opts = { lastValueVisible: false, priceLineVisible: false, lineWidth: 1 as const, lineStyle: 1 as const };
      pc.addLineSeries({ ...opts, color: "rgba(34,211,238,0.65)" }).setData(bbData.map((p) => ({ time: p.time, value: p.upper })));
      pc.addLineSeries({ ...opts, color: "rgba(34,211,238,0.30)", lineStyle: 2 as const }).setData(bbData.map((p) => ({ time: p.time, value: p.middle })));
      pc.addLineSeries({ ...opts, color: "rgba(34,211,238,0.65)" }).setData(bbData.map((p) => ({ time: p.time, value: p.lower })));
    }

    // Entry / Exit trade markers
    const markers: SeriesMarker<Time>[] = [];
    for (const t of result.trades) {
      const entryTs = Math.floor(new Date(t.entry_time).getTime() / 1000) as Time;
      const exitTs  = Math.floor(new Date(t.exit_time).getTime()  / 1000) as Time;
      markers.push({
        time: entryTs, position: "belowBar",
        color: "#06b6d4", shape: "arrowUp", size: 2,
        text: `▲ ${t.entry_price.toLocaleString(undefined, { maximumFractionDigits: 2 })}`,
      });
      markers.push({
        time: exitTs, position: "aboveBar",
        color: t.pnl >= 0 ? "#10b981" : "#ef4444",
        shape: "arrowDown", size: 2,
        text: `${t.pnl >= 0 ? "+" : ""}${t.pnl_pct.toFixed(1)}%`,
      });
    }
    markers.sort((a, b) => Number(a.time) - Number(b.time));
    candles.setMarkers(markers);
    pc.timeScale().fitContent();

    // ── Volume chart ──────────────────────────────────────────────────────────
    if (hasVolume) {
      const isLast = !hasRsi && !hasMacd;
      const vc = mkChart(volumeRef.current!, 100, isLast);
      charts.push(vc);
      containerMap.set(vc, volumeRef.current!);
      vc.priceScale("right").applyOptions({ scaleMargins: { top: 0.1, bottom: 0 } });
      vc.addHistogramSeries({
        priceFormat: { type: "volume" },
        lastValueVisible: false,
        priceLineVisible: false,
      }).setData(
        bars.map((b) => ({
          time: b.t as Time,
          value: b.v,
          color: b.c >= b.o ? "rgba(16,185,129,0.5)" : "rgba(239,68,68,0.45)",
        })),
      );
    }

    // ── RSI chart ─────────────────────────────────────────────────────────────
    if (hasRsi) {
      const isLast = !hasMacd;
      const rc = mkChart(rsiRef.current!, 130, isLast);
      charts.push(rc);
      containerMap.set(rc, rsiRef.current!);
      rc.priceScale("right").applyOptions({ scaleMargins: { top: 0.1, bottom: 0.1 } });

      const rsiData = computeRSI(bars);
      if (rsiData.length >= 2) {
        const t0 = rsiData[0].time, tN = rsiData[rsiData.length - 1].time;
        const refOpts = { lastValueVisible: false, priceLineVisible: false, lineWidth: 1 as const, lineStyle: 2 as const };
        rc.addLineSeries({ ...refOpts, color: "rgba(239,68,68,0.45)"  }).setData([{ time: t0, value: 70 }, { time: tN, value: 70 }]);
        rc.addLineSeries({ ...refOpts, color: "rgba(16,185,129,0.45)" }).setData([{ time: t0, value: 30 }, { time: tN, value: 30 }]);
        rc.addLineSeries({ ...refOpts, color: "rgba(255,255,255,0.1)" }).setData([{ time: t0, value: 50 }, { time: tN, value: 50 }]);
      }
      rc.addLineSeries({ color: "#f472b6", lineWidth: 2, lastValueVisible: true, priceLineVisible: false }).setData(rsiData);
    }

    // ── MACD chart ────────────────────────────────────────────────────────────
    if (hasMacd) {
      const mc = mkChart(macdRef.current!, 120, true);
      charts.push(mc);
      containerMap.set(mc, macdRef.current!);
      const macdData = computeMACD(bars);
      if (macdData.length > 0) {
        mc.addLineSeries({ color: "#34d399", lineWidth: 2, lastValueVisible: false, priceLineVisible: false })
          .setData(macdData.map((p) => ({ time: p.time, value: p.macd })));
        mc.addLineSeries({ color: "#f97316", lineWidth: 2, lastValueVisible: false, priceLineVisible: false })
          .setData(macdData.map((p) => ({ time: p.time, value: p.signal })));
        mc.addHistogramSeries({ lastValueVisible: false, priceLineVisible: false })
          .setData(macdData.map((p) => ({
            time: p.time, value: p.histogram,
            color: p.histogram >= 0 ? "rgba(16,185,129,0.6)" : "rgba(239,68,68,0.55)",
          })));
      }
    }

    // ── Sync all charts on scroll/zoom ────────────────────────────────────────
    let syncing = false;
    const syncRange = (source: IChartApi) => {
      if (syncing) return;
      syncing = true;
      const range = source.timeScale().getVisibleLogicalRange();
      if (range !== null) {
        charts.forEach((c) => { if (c !== source) c.timeScale().setVisibleLogicalRange(range); });
      }
      syncing = false;
    };
    charts.forEach((c) => c.timeScale().subscribeVisibleLogicalRangeChange(() => syncRange(c)));

    // ── Resize ────────────────────────────────────────────────────────────────
    const onResize = () => {
      containerMap.forEach((el, c) => { if (el) c.applyOptions({ width: el.clientWidth }); });
    };
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      charts.forEach((c) => c.remove());
    };
  }, [bars, active, result.trades]);

  return (
    <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
      {/* Header + indicator toggles */}
      <div className="flex items-start justify-between gap-3 mb-3 flex-wrap">
        <div>
          <h3 className="font-semibold text-zinc-100">Price · Signals · Indicators</h3>
          <div className="flex gap-3 mt-1 flex-wrap text-[11px] text-zinc-500">
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 inline-block" />Entry (buy)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 inline-block" />Exit (win)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-red-400 inline-block" />Exit (loss)
            </span>
          </div>
        </div>
        <div className="flex gap-1 flex-wrap">
          {INDICATORS.map(({ key, label, color }) => (
            <button
              key={key}
              onClick={() => toggle(key)}
              style={active.has(key) ? { color, borderColor: color } : undefined}
              className={`px-2 py-0.5 rounded text-[11px] font-semibold border transition-all ${
                active.has(key)
                  ? "bg-current/10"
                  : "border-zinc-700 text-zinc-600 hover:border-zinc-500 hover:text-zinc-400"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Price chart (always present) */}
      <div ref={priceRef} className="w-full" />

      {/* Sub-panels rendered conditionally; callback refs update before effects fire */}
      {active.has("volume") && (
        <div ref={volumeCb} className="w-full border-t border-zinc-800/70" />
      )}
      {active.has("rsi") && (
        <div ref={rsiCb} className="w-full border-t border-zinc-800/70" />
      )}
      {active.has("macd") && (
        <div ref={macdCb} className="w-full border-t border-zinc-800/70" />
      )}

      {/* Inline legend for active overlays */}
      <div className="flex gap-3 mt-2 text-[11px] flex-wrap text-zinc-500">
        {active.has("sma20")  && <span style={{ color: "#eab308" }}>SMA 20</span>}
        {active.has("sma50")  && <span style={{ color: "#f97316" }}>SMA 50</span>}
        {active.has("sma200") && <span style={{ color: "#a855f7" }}>SMA 200</span>}
        {active.has("bb")     && <span style={{ color: "#22d3ee" }}>BB±2σ (20)</span>}
        {active.has("rsi")    && <span style={{ color: "#f472b6" }}>RSI 14 — 70/30 levels</span>}
        {active.has("macd")   && <span><span style={{ color: "#34d399" }}>MACD</span> / <span style={{ color: "#f97316" }}>Signal</span> / histogram</span>}
      </div>

      {!bars && !loadErr && (
        <div className="text-zinc-500 text-sm py-8 text-center">Loading price data…</div>
      )}
      {loadErr && (
        <div className="text-red-400 text-sm py-4 text-center">Failed to load bars: {loadErr}</div>
      )}
    </div>
  );
}

function exportEquityCurveCSV(result: BacktestResult): void {
  const header = "date,equity,drawdown_pct\n";
  const rows = result.equity_curve.map((p) => {
    const date = new Date(p.t * 1000).toISOString().slice(0, 10);
    return `${date},${p.equity.toFixed(4)},${p.drawdown_pct.toFixed(4)}`;
  });
  downloadBlob(
    `equity-${result.symbol}-${todayIso()}.csv`,
    header + rows.join("\n"),
    "text/csv",
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
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold">
          Equity curve <span className="text-zinc-500 text-xs ml-2">(cyan: portfolio · red: drawdown %)</span>
        </h3>
        <button
          onClick={() => exportEquityCurveCSV(result)}
          className="px-2.5 py-1 text-xs rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 border border-zinc-700 transition"
        >
          ↓ CSV
        </button>
      </div>
      <div ref={containerRef} className="w-full" />
    </div>
  );
}

// ─── Oracle Entry Analysis ────────────────────────────────────────────────────

const FEATURE_LABELS: Record<string, string> = {
  rsi_7: "RSI 7", rsi_14: "RSI 14", rsi_21: "RSI 21",
  sma_10_dist_pct: "SMA 10 dist %", sma_20_dist_pct: "SMA 20 dist %",
  sma_50_dist_pct: "SMA 50 dist %", sma_100_dist_pct: "SMA 100 dist %",
  sma_200_dist_pct: "SMA 200 dist %",
  ema_9_dist_pct: "EMA 9 dist %", ema_21_dist_pct: "EMA 21 dist %",
  ema_55_dist_pct: "EMA 55 dist %",
  bb_position: "BB position (0-1)", bb_width_pct: "BB width %",
  atr_14_pct: "ATR 14 %",
  volume_ratio_20: "Volume ratio (20MA)",
  roc_5: "ROC 5", roc_10: "ROC 10", roc_20: "ROC 20",
  macd_pct: "MACD %",
  stoch_k_14: "Stochastic %K",
  volatility_20: "Volatility 20",
  dist_from_14bar_high: "Dist 14-bar high %", dist_from_14bar_low: "Dist 14-bar low %",
  dist_from_50bar_high: "Dist 50-bar high %", dist_from_50bar_low: "Dist 50-bar low %",
};

function Sparkline({ values }: { values: (number | null)[] }) {
  const available = values.filter((v): v is number => v !== null);
  if (available.length < 2) return <span className="text-zinc-600 text-xs">—</span>;

  const min = Math.min(...available);
  const max = Math.max(...available);
  const range = max - min || 1;
  const w = 80;
  const h = 24;

  const points = values
    .map((v, i) => {
      if (v === null) return null;
      const x = (i / (values.length - 1)) * w;
      const y = h - ((v - min) / range) * (h - 2) - 1;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .filter(Boolean);

  const color = available[available.length - 1] > available[0] ? "#10b981" : "#ef4444";

  return (
    <svg width={w} height={h} className="inline-block">
      <polyline
        points={points.join(" ")}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function AvgSeriesSparkline({
  analysis,
  feature,
}: {
  analysis: EntryAnalysis;
  feature: string;
}) {
  const length = analysis.series_length;
  const avgSeries: (number | null)[] = Array.from({ length }, (_, i) => {
    const vals = analysis.entries
      .map((e) => (e.series[feature] ?? [])[i])
      .filter((v): v is number => v !== null && isFinite(v));
    return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  });
  return <Sparkline values={avgSeries} />;
}

export function EntryAnalysisPanel({ analysis }: { analysis: EntryAnalysis }) {
  const [activeTab, setActiveTab] = useState<"stats" | "entries">("stats");
  const [selectedEntry, setSelectedEntry] = useState<number>(0);

  const sortedStats = [...analysis.feature_stats].sort((a, b) => {
    if (a.count === 0 && b.count === 0) return 0;
    if (a.count === 0) return 1;
    if (b.count === 0) return -1;
    const cvA = a.std != null && a.mean != null && a.mean !== 0 ? Math.abs(a.std / a.mean) : Infinity;
    const cvB = b.std != null && b.mean != null && b.mean !== 0 ? Math.abs(b.std / b.mean) : Infinity;
    return cvA - cvB;
  });

  return (
    <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold">Oracle Entry Analysis</h3>
          <p className="text-xs text-zinc-500 mt-0.5">
            {analysis.entry_count} entry signals · {analysis.series_length}-bar time series per entry ·{" "}
            {analysis.feature_names.length} features
          </p>
        </div>
        <div className="flex gap-1 bg-zinc-950 border border-zinc-800 rounded p-0.5">
          {(["stats", "entries"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setActiveTab(t)}
              className={`px-3 py-1 rounded text-xs font-medium transition ${
                activeTab === t
                  ? "bg-cyan-500 text-zinc-950"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {t === "stats" ? "Feature Stats" : "Individual Entries"}
            </button>
          ))}
        </div>
      </div>

      {activeTab === "stats" && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-zinc-500 uppercase tracking-wide border-b border-zinc-800">
                <th className="py-2 pr-4">Feature</th>
                <th className="py-2 pr-4 text-right">N</th>
                <th className="py-2 pr-4 text-right">Mean</th>
                <th className="py-2 pr-4 text-right">Std</th>
                <th className="py-2 pr-4 text-right">Min</th>
                <th className="py-2 pr-4 text-right">Max</th>
                <th className="py-2">Avg trajectory (last {analysis.series_length} bars)</th>
              </tr>
            </thead>
            <tbody>
              {sortedStats.filter((s) => s.count > 0).map((s) => (
                <tr key={s.feature} className="border-b border-zinc-800/40 hover:bg-zinc-800/20">
                  <td className="py-1.5 pr-4 text-zinc-300 font-mono text-xs">
                    {FEATURE_LABELS[s.feature] ?? s.feature}
                  </td>
                  <td className="py-1.5 pr-4 text-right text-zinc-500 text-xs">{s.count}</td>
                  <td className="py-1.5 pr-4 text-right text-zinc-200 text-xs">
                    {s.mean?.toFixed(3) ?? "—"}
                  </td>
                  <td className="py-1.5 pr-4 text-right text-zinc-400 text-xs">
                    ±{s.std?.toFixed(3) ?? "—"}
                  </td>
                  <td className="py-1.5 pr-4 text-right text-zinc-500 text-xs">
                    {s.min?.toFixed(3) ?? "—"}
                  </td>
                  <td className="py-1.5 pr-4 text-right text-zinc-500 text-xs">
                    {s.max?.toFixed(3) ?? "—"}
                  </td>
                  <td className="py-1.5">
                    <AvgSeriesSparkline analysis={analysis} feature={s.feature} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs text-zinc-600 mt-2">
            Sorted by coefficient of variation (most consistent signals first).
            Green = rising into entry · Red = falling.
          </p>
        </div>
      )}

      {activeTab === "entries" && analysis.entries.length > 0 && (
        <div className="space-y-3">
          <div className="flex gap-2 flex-wrap">
            {analysis.entries.map((e, i) => (
              <button
                key={i}
                onClick={() => setSelectedEntry(i)}
                className={`px-2 py-1 rounded text-xs border transition ${
                  selectedEntry === i
                    ? "border-cyan-500 bg-cyan-500/10 text-cyan-300"
                    : "border-zinc-700 text-zinc-500 hover:border-zinc-600"
                }`}
              >
                #{i + 1} · {new Date(e.timestamp).toLocaleDateString()}
              </button>
            ))}
          </div>

          {(() => {
            const entry = analysis.entries[selectedEntry];
            if (!entry) return null;
            return (
              <div className="space-y-3">
                <div className="text-xs text-zinc-400">
                  Bar {entry.bar_index} · {new Date(entry.timestamp).toLocaleString()} ·
                  close <span className="text-zinc-200">${entry.entry_price.toLocaleString(undefined, { maximumFractionDigits: 4 })}</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-zinc-500 uppercase tracking-wide border-b border-zinc-800">
                        <th className="py-2 pr-4">Feature</th>
                        <th className="py-2 pr-4 text-right">Value</th>
                        <th className="py-2 pr-4 text-right">vs. Avg</th>
                        <th className="py-2">20-bar trajectory</th>
                      </tr>
                    </thead>
                    <tbody>
                      {analysis.feature_names.map((feat) => {
                        const val = entry.features[feat];
                        const avg = analysis.feature_stats.find((s) => s.feature === feat)?.mean;
                        const diff = val != null && avg != null ? val - avg : null;
                        const seriesVals = entry.series[feat] ?? [];
                        return (
                          <tr key={feat} className="border-b border-zinc-800/40 hover:bg-zinc-800/20">
                            <td className="py-1.5 pr-4 text-zinc-300 font-mono text-xs">
                              {FEATURE_LABELS[feat] ?? feat}
                            </td>
                            <td className="py-1.5 pr-4 text-right text-zinc-200 text-xs">
                              {val?.toFixed(3) ?? "—"}
                            </td>
                            <td className={`py-1.5 pr-4 text-right text-xs ${diff == null ? "text-zinc-600" : diff > 0 ? "text-emerald-400" : "text-red-400"}`}>
                              {diff == null ? "—" : `${diff > 0 ? "+" : ""}${diff.toFixed(3)}`}
                            </td>
                            <td className="py-1.5">
                              <Sparkline values={seriesVals} />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}

function exportTradesCSV(trades: BacktestResult["trades"], symbol: string): void {
  const header = "index,side,entry_time,exit_time,entry_price,exit_price,size,pnl,pnl_pct,duration_bars\n";
  const rows = trades.map((t, i) =>
    [i + 1, t.side, t.entry_time, t.exit_time,
     t.entry_price, t.exit_price, t.size,
     t.pnl.toFixed(4), t.pnl_pct.toFixed(4), t.duration_bars].join(",")
  );
  downloadBlob(`trades-${symbol}-${todayIso()}.csv`, header + rows.join("\n"), "text/csv");
}

function exportTradesJSON(trades: BacktestResult["trades"], symbol: string): void {
  downloadBlob(
    `trades-${symbol}-${todayIso()}.json`,
    JSON.stringify(trades, null, 2),
    "application/json",
  );
}

export function TradesTable({
  trades,
  symbol = "export",
}: {
  trades: BacktestResult["trades"];
  symbol?: string;
}) {
  if (trades.length === 0) {
    return (
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4 text-zinc-500 text-sm">
        No trades executed.
      </div>
    );
  }
  return (
    <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold">Trades ({trades.length})</h3>
        <div className="flex gap-2">
          <button
            onClick={() => exportTradesCSV(trades, symbol)}
            className="px-2.5 py-1 text-xs rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 border border-zinc-700 transition"
          >
            ↓ CSV
          </button>
          <button
            onClick={() => exportTradesJSON(trades, symbol)}
            className="px-2.5 py-1 text-xs rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 border border-zinc-700 transition"
          >
            ↓ JSON
          </button>
        </div>
      </div>
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
