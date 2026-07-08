"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createChart,
  ColorType,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
  type SeriesMarker,
  type Time,
} from "lightweight-charts";
import {
  Check,
  X,
  Plus,
  Trash2,
  Power,
  Activity,
  Maximize2,
  MessageSquareText,
  TrendingUp,
  Award,
  Zap,
  Eye,
  Info,
  ChevronRight,
  ChevronDown,
  BarChart3,
} from "lucide-react";

// ─── Types (mirror /api/v1/forecast payloads) ─────────────────────────────────

interface TickPoint {
  ts: number;
  price: number;
}

interface ForecastRec {
  id: number;
  symbol: string;
  composition: string;
  horizon_s: number;
  created_ts: number;
  due_ts: number;
  base_price: number;
  predicted_price: number;
  realized_price: number | null;
  abs_error: number | null;
  pct_error: number | null;
  direction_hit: boolean | null;
}

interface LivePayload {
  symbol: string;
  ticks: TickPoint[];
  pending: ForecastRec[];
  latest: Record<string, ForecastRec>;
  resolved_recent: ForecastRec[];
  horizons_s: number[];
  voided: number;
}

interface StrategyInfo {
  name: string;
  description: string;
  params_schema: Record<string, { type: string; default: number; label: string }>;
}

interface CompositionInfo {
  name: string;
  active: boolean;
  members: { strategy: string; weight: number; params: Record<string, number> }[];
}

interface AccuracyRow {
  symbol: string;
  composition: string;
  horizon_s: number;
  n: number;
  mae: number;
  rmse: number;
  mape_pct: number;
  bias_pct: number;
  direction_calls: number;
  direction_hit_rate: number | null;
}

// ─── Palette (validated categorical slots; fixed order, never cycled) ────────
// Compositions and indicators are different identity classes but share one
// chart, so they draw from disjoint slots of the validated palette.

const COMP_COLORS = ["#3987e5", "#199e70", "#c98500", "#e66767"];
const OTHER_COLOR = "#8a8a86";
const HIT_COLOR = "#199e70";
const MISS_COLOR = "#e66767";

const HORIZONS = [5, 30, 60, 300, 600] as const;
const HORIZON_LABELS: Record<number, string> = {
  5: "5s",
  30: "30s",
  60: "1m",
  300: "5m",
  600: "10m",
};

// ─── Indicators (computed client-side from the tick stream) ──────────────────

type IndicatorId = "ema60" | "ema300" | "sma60" | "bb300";

interface IndicatorDef {
  id: IndicatorId;
  label: string;
  color: string;
}

const INDICATORS: IndicatorDef[] = [
  { id: "ema60", label: "EMA 1m", color: "#d95926" },
  { id: "ema300", label: "EMA 5m", color: "#d55181" },
  { id: "sma60", label: "SMA 1m", color: "#9085e9" },
  { id: "bb300", label: "Bollinger 5m", color: "#71717a" },
];

function emaSeries(ticks: TickPoint[], tauS: number): { time: UTCTimestamp; value: number }[] {
  if (!ticks.length) return [];
  const out: { time: UTCTimestamp; value: number }[] = [];
  let ema = ticks[0].price;
  let prevT = ticks[0].ts;
  for (const t of ticks) {
    const dt = Math.max(t.ts - prevT, 0.001);
    ema += (1 - Math.exp(-dt / tauS)) * (t.price - ema);
    prevT = t.ts;
    out.push({ time: t.ts as UTCTimestamp, value: ema });
  }
  return out;
}

function smaSeries(ticks: TickPoint[], windowS: number): { time: UTCTimestamp; value: number }[] {
  const out: { time: UTCTimestamp; value: number }[] = [];
  let start = 0;
  let sum = 0;
  for (let i = 0; i < ticks.length; i++) {
    sum += ticks[i].price;
    while (ticks[start].ts < ticks[i].ts - windowS) {
      sum -= ticks[start].price;
      start++;
    }
    out.push({ time: ticks[i].ts as UTCTimestamp, value: sum / (i - start + 1) });
  }
  return out;
}

function bollinger(ticks: TickPoint[], windowS: number, k = 2) {
  const upper: { time: UTCTimestamp; value: number }[] = [];
  const mid: { time: UTCTimestamp; value: number }[] = [];
  const lower: { time: UTCTimestamp; value: number }[] = [];
  let start = 0;
  for (let i = 0; i < ticks.length; i++) {
    while (ticks[start].ts < ticks[i].ts - windowS) start++;
    const w = ticks.slice(start, i + 1);
    const m = w.reduce((s, t) => s + t.price, 0) / w.length;
    const sd = Math.sqrt(w.reduce((s, t) => s + (t.price - m) ** 2, 0) / w.length);
    const time = ticks[i].ts as UTCTimestamp;
    mid.push({ time, value: m });
    upper.push({ time, value: m + k * sd });
    lower.push({ time, value: m - k * sd });
  }
  return { upper, mid, lower };
}

// ─── API helper ───────────────────────────────────────────────────────────────

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/v1/forecast${path}`, init);
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
}

// ─── Chart component (imperative lightweight-charts wrapper) ─────────────────

interface ChartHandles {
  chart: IChartApi;
  price: ISeriesApi<"Area">;
  indicators: Map<string, ISeriesApi<"Line">>;
  forecasts: Map<string, ISeriesApi<"Line">>;
  lastTickTs: number;
}

function ForecastChart({
  live,
  horizons,
  indicators,
  colorFor,
  fitSignal,
}: {
  live: LivePayload | null;
  horizons: Set<number>;
  indicators: Set<IndicatorId>;
  colorFor: (name: string) => string;
  fitSignal: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const h = useRef<ChartHandles | null>(null);

  // Create the chart once.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#a1a1aa",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: "#27272a", style: LineStyle.Dotted },
        horzLines: { color: "#27272a", style: LineStyle.Dotted },
      },
      crosshair: { mode: 0 },
      timeScale: {
        timeVisible: true,
        secondsVisible: true,
        borderColor: "#3f3f46",
        rightOffset: 12,
      },
      rightPriceScale: { borderColor: "#3f3f46" },
      handleScroll: true,
      handleScale: true, // wheel + pinch + drag zoom
    });
    const price = chart.addAreaSeries({
      lineColor: "#e4e4e7",
      lineWidth: 2,
      topColor: "rgba(228, 228, 231, 0.12)",
      bottomColor: "rgba(228, 228, 231, 0.0)",
      priceLineVisible: true,
      lastValueVisible: true,
      priceFormat: { type: "price", precision: 2, minMove: 0.01 },
    });
    h.current = { chart, price, indicators: new Map(), forecasts: new Map(), lastTickTs: 0 };
    return () => {
      chart.remove();
      h.current = null;
    };
  }, []);

  // Feed ticks: full set on symbol change / first load, incremental after —
  // incremental update() keeps the user's zoom and makes the price "move".
  useEffect(() => {
    const handles = h.current;
    if (!handles || !live?.ticks.length) return;
    const ticks = live.ticks;
    if (handles.lastTickTs === 0 || ticks[0].ts > handles.lastTickTs) {
      handles.price.setData(
        ticks.map((t) => ({ time: t.ts as UTCTimestamp, value: t.price }))
      );
      handles.chart.timeScale().fitContent();
    } else {
      for (const t of ticks) {
        if (t.ts > handles.lastTickTs) {
          handles.price.update({ time: t.ts as UTCTimestamp, value: t.price });
        }
      }
    }
    handles.lastTickTs = ticks[ticks.length - 1].ts;
  }, [live]);

  // Indicator overlays: add/remove series to match the toggled set.
  useEffect(() => {
    const handles = h.current;
    if (!handles || !live?.ticks.length) return;
    const want = new Set<string>();
    for (const def of INDICATORS) {
      if (!indicators.has(def.id)) continue;
      if (def.id === "bb300") {
        want.add("bb300:upper").add("bb300:mid").add("bb300:lower");
      } else {
        want.add(def.id);
      }
    }
    // Remove stale
    for (const [key, series] of handles.indicators) {
      if (!want.has(key)) {
        handles.chart.removeSeries(series);
        handles.indicators.delete(key);
      }
    }
    // Ensure + set data
    const ensure = (key: string, color: string, dashed = false) => {
      let s = handles.indicators.get(key);
      if (!s) {
        s = handles.chart.addLineSeries({
          color,
          lineWidth: 1,
          lineStyle: dashed ? LineStyle.Dashed : LineStyle.Solid,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        });
        handles.indicators.set(key, s);
      }
      return s;
    };
    if (indicators.has("ema60"))
      ensure("ema60", INDICATORS[0].color).setData(emaSeries(live.ticks, 60));
    if (indicators.has("ema300"))
      ensure("ema300", INDICATORS[1].color).setData(emaSeries(live.ticks, 300));
    if (indicators.has("sma60"))
      ensure("sma60", INDICATORS[2].color).setData(smaSeries(live.ticks, 60));
    if (indicators.has("bb300")) {
      const bb = bollinger(live.ticks, 300);
      ensure("bb300:upper", INDICATORS[3].color, true).setData(bb.upper);
      ensure("bb300:mid", INDICATORS[3].color, true).setData(bb.mid);
      ensure("bb300:lower", INDICATORS[3].color, true).setData(bb.lower);
    }
  }, [live, indicators]);

  // Forecast paths (latest forecast per composition through the selected
  // horizons, projected into the future) + resolved hit/miss markers.
  useEffect(() => {
    const handles = h.current;
    if (!handles || !live?.ticks.length) return;
    const now = live.ticks[live.ticks.length - 1];

    const byComp = new Map<string, ForecastRec[]>();
    for (const rec of Object.values(live.latest)) {
      if (!horizons.has(rec.horizon_s)) continue;
      if (!byComp.has(rec.composition)) byComp.set(rec.composition, []);
      byComp.get(rec.composition)!.push(rec);
    }

    for (const [key, series] of handles.forecasts) {
      if (!byComp.has(key)) {
        handles.chart.removeSeries(series);
        handles.forecasts.delete(key);
      }
    }
    for (const [comp, recs] of byComp) {
      let s = handles.forecasts.get(comp);
      if (!s) {
        s = handles.chart.addLineSeries({
          color: colorFor(comp),
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          pointMarkersVisible: true,
          pointMarkersRadius: 3.5,
          priceLineVisible: false,
          lastValueVisible: false,
        });
        handles.forecasts.set(comp, s);
      }
      const pts = recs
        .sort((a, b) => a.due_ts - b.due_ts)
        .map((r) => ({ time: Math.round(r.due_ts) as UTCTimestamp, value: r.predicted_price }));
      // Anchor the path at the live price so it reads as a projection.
      const data = [{ time: now.ts as UTCTimestamp, value: now.price }, ...pts].filter(
        (p, i, arr) => i === 0 || p.time > arr[i - 1].time
      );
      s.setData(data);
    }

    // Resolved forecasts: ✓ / ✕ markers on the price series (shape + text
    // carry the state — never color alone).
    const markers: SeriesMarker<Time>[] = live.resolved_recent
      .filter((r) => horizons.has(r.horizon_s) && r.direction_hit !== null)
      .slice(-60)
      .map((r) => ({
        time: Math.round(r.due_ts) as UTCTimestamp,
        position: r.direction_hit ? ("belowBar" as const) : ("aboveBar" as const),
        color: r.direction_hit ? HIT_COLOR : MISS_COLOR,
        shape: "circle" as const,
        text: r.direction_hit ? "✓" : "✕",
        size: 0.6,
      }))
      .sort((a, b) => (a.time as number) - (b.time as number));
    handles.price.setMarkers(markers);
  }, [live, horizons, colorFor]);

  // Fit button
  useEffect(() => {
    if (fitSignal > 0) h.current?.chart.timeScale().fitContent();
  }, [fitSignal]);

  return <div ref={containerRef} className="h-[460px] w-full" />;
}

// ─── Narrator panel ───────────────────────────────────────────────────────────

interface NarratorMsg {
  ts: number;
  kind: string;
  text: string;
}

const KIND_ICON: Record<string, typeof Info> = {
  price: TrendingUp,
  volatility: Activity,
  leader: Award,
  event: Zap,
  outlook: Eye,
  status: Info,
};

function NarratorPanel({ symbol }: { symbol: string }) {
  const [messages, setMessages] = useState<(NarratorMsg & { key: string })[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMessages([]);
    let cancelled = false;
    const poll = async () => {
      try {
        const data = await api<{ messages: NarratorMsg[] }>(`/narrate?symbol=${symbol}`);
        if (cancelled) return;
        setMessages((prev) => {
          const seen = new Set(prev.slice(-40).map((m) => m.text));
          const fresh = data.messages
            .filter((m) => !seen.has(m.text))
            .map((m) => ({ ...m, key: `${m.ts}-${m.kind}-${m.text.slice(0, 40)}` }));
          if (!fresh.length) return prev;
          return [...prev, ...fresh].slice(-80);
        });
      } catch {
        /* retried next cycle */
      }
    };
    poll();
    const t = setInterval(poll, 15000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [symbol]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  return (
    <div className="flex h-[27rem] flex-col rounded-lg border border-zinc-800 bg-zinc-900/50">
      <div className="flex items-center gap-2 border-b border-zinc-800 px-4 py-2">
        <MessageSquareText size={14} className="text-zinc-400" />
        <h2 className="text-sm font-semibold text-zinc-200">Narrator</h2>
        <span className="text-xs text-zinc-500">live commentary on {symbol}</span>
      </div>
      <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto p-3">
        {messages.length === 0 && (
          <div className="text-xs text-zinc-500">Listening — commentary starts once data flows…</div>
        )}
        {messages.map((m) => {
          const Icon = KIND_ICON[m.kind] ?? Info;
          return (
            <div key={m.key} className="flex items-start gap-2">
              <span className="mt-0.5 rounded bg-zinc-800 p-1 text-zinc-400">
                <Icon size={11} />
              </span>
              <div className="rounded-md rounded-tl-none bg-zinc-800/60 px-2.5 py-1.5 text-xs leading-relaxed text-zinc-200">
                {m.text}
                <span className="ml-2 text-[10px] text-zinc-500">
                  {new Date(m.ts * 1000).toLocaleTimeString([], { hour12: false })}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Benford panel ────────────────────────────────────────────────────────────

interface BenfordResult {
  position: number;
  n: number;
  rows: { digit: number; observed: number; observed_pct: number; expected_pct: number }[];
  chi2: number;
  chi2_critical_p05: number;
  conforms: boolean | null;
  source: string;
  window_s: number;
  windows_tried?: { window_s: number; n: number; chi2: number }[];
}

const BENFORD_WINDOWS: { label: string; value: number | "auto" }[] = [
  { label: "Auto", value: "auto" },
  { label: "1m", value: 60 },
  { label: "5m", value: 300 },
  { label: "10m", value: 600 },
  { label: "20m", value: 1200 },
  { label: "All", value: 0 },
];

const fmtWindow = (s: number) =>
  s === 0 ? "all ticks" : s < 60 ? `${s}s` : `${Math.round(s / 60)}m`;

/** Mirror of the backend's significant-digit extraction (analysis.py). */
function sigDigitString(value: number): string {
  const v = Math.abs(value);
  if (v === 0 || !Number.isFinite(v)) return "";
  const [mantissa] = v.toExponential(14).split("e");
  return mantissa.replace(".", "").replace(/0+$/, "");
}

function kthSigDigit(value: number, k: number): number | null {
  const s = sigDigitString(value);
  return k <= s.length ? Number(s[k - 1]) : null;
}

/** Decimal rendering of |value| that shows all-and-only significant digits
 *  (plus structural zeros), so the arrowed digit is exactly the collected one. */
function formatMoveDigits(value: number, maxSig = 6): { text: string; sigIndexes: number[] } {
  const v = Math.abs(value);
  if (v === 0 || !Number.isFinite(v)) return { text: "0", sigIndexes: [] };
  const s = sigDigitString(v).slice(0, maxSig);
  const e = Math.floor(Math.log10(v));
  let text: string;
  if (e >= 0) {
    const intPart = s.length > e ? s.slice(0, e + 1) : s.padEnd(e + 1, "0");
    const frac = s.length > e + 1 ? s.slice(e + 1) : "";
    text = frac ? `${intPart}.${frac}` : intPart;
  } else {
    text = `0.${"0".repeat(-e - 1)}${s}`;
  }
  // Indexes (into text) of each significant digit, in order.
  const sigIndexes: number[] = [];
  let started = false;
  for (let i = 0; i < text.length && sigIndexes.length < s.length; i++) {
    const ch = text[i];
    if (ch === ".") continue;
    if (!started && ch === "0") continue;
    started = true;
    sigIndexes.push(i);
  }
  return { text, sigIndexes };
}

/** Live view of the number being collected right now, arrow on the k-th digit. */
function CollectorStrip({
  ticks,
  position,
  source,
}: {
  ticks: TickPoint[];
  position: number;
  source: "price" | "delta";
}) {
  if (ticks.length < 2) {
    return (
      <div className="border-b border-zinc-800/60 px-4 py-2 text-xs text-zinc-500">
        Waiting for live ticks…
      </div>
    );
  }
  const prev = ticks[ticks.length - 2];
  const last = ticks[ticks.length - 1];
  const delta = last.price - prev.price;
  const value = source === "price" ? last.price : delta;
  const bin = kthSigDigit(value, position);
  const { text, sigIndexes } = formatMoveDigits(value, source === "price" ? 7 : 6);
  const arrowIdx = sigIndexes[position - 1];
  const ordinal = position === 1 ? "1st" : position === 2 ? "2nd" : "3rd";

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-zinc-800/60 px-4 py-2 text-xs">
      <span className="flex items-center gap-1.5 text-zinc-500">
        <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-sky-400" />
        {source === "price"
          ? `collecting ${ordinal} digit of the live price`
          : `collecting ${ordinal} digit of each tick move`}
      </span>
      <span className="font-mono text-sm tabular-nums" key={last.ts}>
        {source === "delta" && (
          <span className={delta > 0 ? "text-emerald-400" : delta < 0 ? "text-red-400" : "text-zinc-500"}>
            {delta > 0 ? "+" : delta < 0 ? "−" : "±"}
          </span>
        )}
        {value === 0 ? (
          <span className="text-zinc-500">0</span>
        ) : (
          text.split("").map((ch, i) => (
            <span key={i} className="relative inline-block">
              {i === arrowIdx && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 text-[9px] leading-none text-sky-300">
                  ▼
                </span>
              )}
              <span
                className={
                  i === arrowIdx
                    ? "rounded-sm bg-sky-500/25 px-0.5 font-bold text-sky-300"
                    : "text-zinc-400"
                }
              >
                {ch}
              </span>
            </span>
          ))
        )}
      </span>
      {source === "delta" && delta === 0 ? (
        <span className="text-zinc-500">price unchanged — nothing collected</span>
      ) : bin == null ? (
        <span className="text-amber-400/80">
          no {ordinal} significant digit here — skipped
        </span>
      ) : (
        <span className="text-sky-300">
          → bin <span className="font-mono font-bold">{bin}</span>
        </span>
      )}
      <span className="ml-auto text-zinc-600">1 nr / second</span>
    </div>
  );
}

/** A freshly collected sample visibly "landing" in its digit bin. */
interface BenfordDrop {
  id: number;
  digit: number;
  count: number;
}

function FallingDot({ targetPct, count }: { targetPct: number; count: number }) {
  const [landed, setLanded] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setLanded(true));
    return () => cancelAnimationFrame(raf);
  }, []);
  const big = count > 1;
  return (
    <span
      className="pointer-events-none absolute left-1/2 z-10 -translate-x-1/2"
      style={{
        top: landed ? `calc(${100 - targetPct}% - 14px)` : "-6px",
        opacity: landed ? 0 : 1,
        transition: "top 650ms cubic-bezier(0.45, 0, 1, 1), opacity 400ms 700ms",
      }}
    >
      <span
        className={`flex items-center justify-center rounded-full bg-sky-300 font-bold text-zinc-900 shadow-[0_0_8px_rgba(57,135,229,0.9)] ${
          big ? "h-3.5 w-3.5 text-[9px]" : "h-2.5 w-2.5 text-[8px]"
        }`}
      >
        {big ? count : ""}
      </span>
    </span>
  );
}

function BenfordPanel({ symbol, ticks }: { symbol: string; ticks: TickPoint[] }) {
  const [position, setPosition] = useState(1);
  const [source, setSource] = useState<"price" | "delta">("price");
  const [window_, setWindow] = useState<number | "auto">("auto");
  const [data, setData] = useState<BenfordResult | null>(null);
  const [drops, setDrops] = useState<BenfordDrop[]>([]);
  const prevCounts = useRef<{ key: string; counts: Map<number, number> } | null>(null);
  const dropId = useRef(1);

  useEffect(() => {
    let cancelled = false;
    const timeouts: ReturnType<typeof setTimeout>[] = [];
    const poll = async () => {
      try {
        const qs =
          window_ === "auto"
            ? "&auto_window=true"
            : `&window_s=${window_}`;
        const d = await api<BenfordResult>(
          `/benford?symbol=${symbol}&position=${position}&source=${source}${qs}`
        );
        if (cancelled) return;
        // Diff per-digit counts against the previous poll of the SAME
        // sample (symbol/position/source/window): new samples become
        // falling dots that visibly land in their digit bin.
        const key = `${symbol}:${position}:${source}:${d.window_s}`;
        const counts = new Map(d.rows.map((r) => [r.digit, r.observed]));
        if (prevCounts.current?.key === key) {
          const fresh: BenfordDrop[] = [];
          for (const [digit, obs] of counts) {
            const delta = obs - (prevCounts.current.counts.get(digit) ?? 0);
            if (delta > 0) fresh.push({ id: dropId.current++, digit, count: delta });
          }
          if (fresh.length) {
            setDrops((prev) => [...prev.slice(-20), ...fresh]);
            const ids = new Set(fresh.map((f) => f.id));
            timeouts.push(
              setTimeout(() => setDrops((prev) => prev.filter((x) => !ids.has(x.id))), 1400)
            );
          }
        } else {
          setDrops([]);
        }
        prevCounts.current = { key, counts };
        setData(d);
      } catch {
        /* retried next cycle */
      }
    };
    poll();
    const t = setInterval(poll, 3000); // live: watch the distribution take shape
    return () => {
      cancelled = true;
      clearInterval(t);
      timeouts.forEach(clearTimeout);
    };
  }, [symbol, position, source, window_]);

  const maxPct = data
    ? Math.max(...data.rows.map((r) => Math.max(r.observed_pct, r.expected_pct)), 1) * 1.2
    : 1;
  const gridLines = [0.25, 0.5, 0.75, 1.0].map((f) => ({
    frac: f,
    pct: maxPct * f,
  }));

  return (
    <div className="flex h-[27rem] flex-col rounded-lg border border-zinc-800 bg-zinc-900/50">
      {/* Header: title + digit position + window length */}
      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-800 px-4 py-2">
        <BarChart3 size={14} className="text-zinc-400" />
        <h2 className="text-sm font-semibold text-zinc-200">Benford&apos;s law</h2>
        <span className="text-xs text-zinc-600">·</span>
        {[1, 2, 3].map((p) => (
          <Chip key={p} on={position === p} onClick={() => setPosition(p)}>
            {p === 1 ? "1st" : p === 2 ? "2nd" : "3rd"} digit
          </Chip>
        ))}
        <span className="ml-2 text-xs uppercase tracking-wide text-zinc-600">Source</span>
        <Chip on={source === "price"} onClick={() => setSource("price")}>
          price digits
        </Chip>
        <Chip on={source === "delta"} onClick={() => setSource("delta")}>
          move digits
        </Chip>
        <span className="ml-2 text-xs uppercase tracking-wide text-zinc-600">Window</span>
        {BENFORD_WINDOWS.map((w) => (
          <Chip key={w.label} on={window_ === w.value} onClick={() => setWindow(w.value)}>
            {w.label}
          </Chip>
        ))}
      </div>

      {/* Live collector: the exact digit being harvested every second */}
      <CollectorStrip ticks={ticks} position={position} source={source} />

      {/* Verdict strip: window used, sample count, chi-square */}
      {data && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-zinc-800/60 px-4 py-1.5 text-xs text-zinc-400">
          <span>
            window: <span className="font-mono text-zinc-200">{fmtWindow(data.window_s)}</span>
            {window_ === "auto" && <span className="text-zinc-500"> (auto best-fit)</span>}
          </span>
          <span>
            samples: <span className="font-mono text-zinc-200">{data.n}</span> tick moves
          </span>
          <span>
            χ² <span className="font-mono text-zinc-200">{data.chi2.toFixed(1)}</span>
            <span className="text-zinc-500"> / crit {data.chi2_critical_p05.toFixed(1)}</span>
          </span>
          {data.conforms == null ? (
            <span className="text-zinc-500">collecting — need ≥100 samples for a verdict</span>
          ) : data.conforms ? (
            <span className="flex items-center gap-1 text-emerald-400">
              <Check size={12} /> conforms to Benford
            </span>
          ) : (
            <span className="flex items-center gap-1 text-red-400">
              <X size={12} /> deviates from Benford
            </span>
          )}
        </div>
      )}

      {/* Chart: CSS bars with % labels, % gridlines, digit identification */}
      <div className="flex-1 pb-8 pl-12 pr-4 pt-5">
        {data && data.n > 0 ? (
          /* Single coordinate system: gridlines, bars and expected dashes all
             position against this plot area, so the % axis is exact. */
          <div className="relative h-full border-b border-l border-zinc-700">
            {gridLines.map((g) => (
              <div
                key={g.frac}
                className="pointer-events-none absolute left-0 right-0 border-t border-dashed border-zinc-800"
                style={{ bottom: `${g.frac * 100}%` }}
              >
                <span className="absolute -top-2 right-full pr-1.5 text-[10px] tabular-nums text-zinc-500">
                  {g.pct.toFixed(1)}%
                </span>
              </div>
            ))}
            <span className="absolute -bottom-2 right-full pr-1.5 text-[10px] tabular-nums text-zinc-500">
              0%
            </span>
            <div className="relative flex h-full items-end gap-[3%] px-[2%]">
              {data.rows.map((r) => {
                const barPct = (r.observed_pct / maxPct) * 100;
                const expPct = (r.expected_pct / maxPct) * 100;
                return (
                  <div
                    key={r.digit}
                    className="relative h-full flex-1"
                    title={`digit ${r.digit}: observed ${r.observed_pct.toFixed(2)}% (${r.observed} of ${data.n}), Benford expects ${r.expected_pct.toFixed(2)}%`}
                  >
                    {/* observed bar — anchored to the axis, height animates live */}
                    <div
                      className="absolute bottom-0 left-1/2 w-3/5 -translate-x-1/2 rounded-t-sm bg-[#3987e5] transition-[height] duration-700 ease-out"
                      style={{ height: `${barPct}%` }}
                    />
                    {/* observed % label riding on top of the bar */}
                    <span
                      className="absolute left-1/2 -translate-x-1/2 text-[10px] font-medium tabular-nums text-zinc-300 transition-[bottom] duration-700 ease-out"
                      style={{ bottom: `calc(${barPct}% + 2px)` }}
                    >
                      {r.observed_pct.toFixed(1)}
                    </span>
                    {/* expected Benford level at its exact % height */}
                    <div
                      className="pointer-events-none absolute left-[8%] right-[8%] border-t-2 border-dashed border-zinc-200"
                      style={{ bottom: `${expPct}%` }}
                    />
                    {/* digit identification */}
                    <span className="absolute -bottom-6 left-1/2 -translate-x-1/2 text-xs font-semibold tabular-nums text-zinc-300">
                      {r.digit}
                    </span>
                    {/* freshly collected samples landing in this bin */}
                    {drops
                      .filter((dr) => dr.digit === r.digit)
                      .map((dr) => (
                        <FallingDot key={dr.id} targetPct={barPct} count={dr.count} />
                      ))}
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-zinc-500">
            Collecting tick moves…
          </div>
        )}
      </div>

      {/* Legend + axis caption */}
      <div className="flex items-center gap-4 border-t border-zinc-800 px-4 py-1.5 text-[11px] text-zinc-500">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-sm bg-[#3987e5]" /> observed
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0 w-3 border-t-2 border-dashed border-zinc-200" /> Benford
          expected
        </span>
        <span className="ml-auto">
          x: {position === 1 ? "1st" : position === 2 ? "2nd" : "3rd"} significant digit of{" "}
          {source === "price" ? "the live price (1/s)" : "tick-to-tick moves"}
          {position === 1 && " (1–9; a leading digit can't be 0)"} · y: share of samples
        </span>
      </div>
    </div>
  );
}

// ─── Benford backtest panel ───────────────────────────────────────────────────

interface BenfordBTResult {
  combos_tested: number;
  n_closes: number;
  symbol: string;
  interval: string;
  start: string;
  end: string;
  results: {
    source: string;
    position: number;
    window_n: number;
    n: number;
    chi2: number;
    chi2_critical_p05: number;
    conforms: boolean | null;
  }[];
  best:
    | (BenfordResult & { source: string; position: number; window_n: number })
    | null;
  rolling: { index: number; chi2: number }[];
}

/** Static observed-vs-expected distribution chart (winner's "ideal" graph). */
function BenfordDistChart({ rows }: { rows: BenfordResult["rows"] }) {
  const maxPct = Math.max(...rows.map((r) => Math.max(r.observed_pct, r.expected_pct)), 1) * 1.2;
  return (
    <div className="relative h-44 border-b border-l border-zinc-700 pl-1">
      {[0.5, 1.0].map((f) => (
        <div
          key={f}
          className="pointer-events-none absolute left-0 right-0 border-t border-dashed border-zinc-800"
          style={{ bottom: `${f * 100}%` }}
        >
          <span className="absolute -top-2 right-full pr-1 text-[9px] tabular-nums text-zinc-600">
            {(maxPct * f).toFixed(0)}%
          </span>
        </div>
      ))}
      <div className="flex h-full items-end gap-[3%] px-[2%]">
        {rows.map((r) => (
          <div
            key={r.digit}
            className="relative h-full flex-1"
            title={`digit ${r.digit}: observed ${r.observed_pct.toFixed(2)}%, Benford ${r.expected_pct.toFixed(2)}%`}
          >
            <div
              className="absolute bottom-0 left-1/2 w-3/5 -translate-x-1/2 rounded-t-sm bg-[#3987e5]"
              style={{ height: `${(r.observed_pct / maxPct) * 100}%` }}
            />
            <div
              className="pointer-events-none absolute left-[8%] right-[8%] border-t-2 border-dashed border-zinc-200"
              style={{ bottom: `${(r.expected_pct / maxPct) * 100}%` }}
            />
            <span className="absolute -bottom-5 left-1/2 -translate-x-1/2 text-[10px] font-semibold tabular-nums text-zinc-400">
              {r.digit}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Rolling chi-square line: how Benford conformity evolved over the history. */
function RollingChi2Chart({
  rolling,
  critical,
}: {
  rolling: { index: number; chi2: number }[];
  critical: number;
}) {
  if (rolling.length < 2) return null;
  const maxChi = Math.max(...rolling.map((p) => p.chi2), critical) * 1.15;
  const minIdx = rolling[0].index;
  const spanIdx = rolling[rolling.length - 1].index - minIdx || 1;
  const pts = rolling
    .map((p) => `${(((p.index - minIdx) / spanIdx) * 100).toFixed(2)},${(100 - (p.chi2 / maxChi) * 100).toFixed(2)}`)
    .join(" ");
  const critY = 100 - (critical / maxChi) * 100;
  return (
    <div className="relative h-44">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full">
        <line
          x1={0}
          x2={100}
          y1={critY}
          y2={critY}
          stroke="#e66767"
          strokeWidth={0.8}
          strokeDasharray="2 1.5"
          vectorEffect="non-scaling-stroke"
        />
        <polyline
          points={pts}
          fill="none"
          stroke="#3987e5"
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <span className="absolute right-1 text-[9px] text-red-400" style={{ top: `calc(${critY}% - 12px)` }}>
        χ² critical {critical.toFixed(1)} — above = deviates
      </span>
    </div>
  );
}

function BenfordBacktestPanel({ symbols }: { symbols: string[] }) {
  const [symbol, setSymbol] = useState("BTC-USD");
  const [interval_, setInterval_] = useState("1d");
  const [startDate, setStartDate] = useState("2022-01-01");
  const [data, setData] = useState<BenfordBTResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const d = await api<BenfordBTResult>(
        `/benford/backtest?symbol=${encodeURIComponent(symbol)}&interval=${interval_}&start_date=${startDate}`
      );
      setData(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const ordinal = (p: number) => (p === 1 ? "1st" : p === 2 ? "2nd" : "3rd");

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/50">
      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-800 px-4 py-2">
        <BarChart3 size={14} className="text-zinc-400" />
        <h2 className="text-sm font-semibold text-zinc-200">Benford backtest</h2>
        <span className="text-xs text-zinc-500">
          scan history for the ideal digit distribution
        </span>
        <span className="ml-4 flex flex-wrap items-center gap-2">
          <input
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            list="benford-bt-symbols"
            className="w-28 rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-zinc-100"
            aria-label="Symbol"
          />
          <datalist id="benford-bt-symbols">
            {["BTC-USD", "ETH-USD", "SOL-USD", ...symbols].map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
          {["15m", "1h", "4h", "1d"].map((iv) => (
            <Chip key={iv} on={interval_ === iv} onClick={() => setInterval_(iv)}>
              {iv}
            </Chip>
          ))}
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-zinc-100"
            aria-label="Start date"
          />
          <button
            onClick={run}
            disabled={busy}
            className="rounded bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-900 hover:bg-white disabled:opacity-50"
          >
            {busy ? "Scanning…" : "Run backtest"}
          </button>
        </span>
      </div>
      {error && <div className="px-4 py-2 text-xs text-red-400">{error}</div>}

      {data?.best && (
        <>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-zinc-800/60 px-4 py-2 text-xs text-zinc-300">
            <span className="font-semibold text-zinc-100">Ideal configuration:</span>
            <span>
              {ordinal(data.best.position)} digit of{" "}
              {data.best.source === "delta" ? "bar-to-bar moves" : "closing prices"}
            </span>
            <span>
              window: <span className="font-mono">{data.best.window_n}</span> samples
            </span>
            <span>
              χ² <span className="font-mono">{data.best.chi2.toFixed(1)}</span>
              <span className="text-zinc-500"> / crit {data.best.chi2_critical_p05.toFixed(1)}</span>
            </span>
            {data.best.conforms ? (
              <span className="flex items-center gap-1 text-emerald-400">
                <Check size={12} /> conforms
              </span>
            ) : (
              <span className="flex items-center gap-1 text-red-400">
                <X size={12} /> deviates
              </span>
            )}
            <span className="ml-auto text-zinc-500">
              {data.n_closes} bars · {data.combos_tested} combos · {data.symbol} {data.interval}
            </span>
          </div>

          <div className="grid gap-6 px-4 pb-8 pt-3 lg:grid-cols-2">
            <div>
              <div className="mb-2 text-[11px] uppercase tracking-wide text-zinc-500">
                Ideal distribution — observed vs Benford
                {data.best.position === 1 && (
                  <span className="ml-2 normal-case text-zinc-600">
                    digits 1–9 — a leading digit can&apos;t be 0
                  </span>
                )}
              </div>
              <BenfordDistChart rows={data.best.rows} />
            </div>
            <div>
              <div className="mb-2 text-[11px] uppercase tracking-wide text-zinc-500">
                Conformity over history (rolling χ², lower is better)
              </div>
              <RollingChi2Chart rolling={data.rolling} critical={data.best.chi2_critical_p05} />
            </div>
          </div>

          <div className="overflow-x-auto border-t border-zinc-800/60">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-zinc-800 text-zinc-500">
                  <th className="px-3 py-1.5 font-medium">#</th>
                  <th className="px-3 py-1.5 font-medium">Source</th>
                  <th className="px-3 py-1.5 font-medium">Digit</th>
                  <th className="px-3 py-1.5 text-right font-medium">Window</th>
                  <th className="px-3 py-1.5 text-right font-medium">n</th>
                  <th className="px-3 py-1.5 text-right font-medium">χ²</th>
                  <th className="px-3 py-1.5 font-medium">Verdict</th>
                </tr>
              </thead>
              <tbody>
                {data.results.slice(0, 10).map((r, i) => (
                  <tr key={i} className="border-b border-zinc-800/40 text-zinc-300">
                    <td className="px-3 py-1 text-zinc-500">{i + 1}</td>
                    <td className="px-3 py-1">{r.source === "delta" ? "moves" : "prices"}</td>
                    <td className="px-3 py-1">{ordinal(r.position)}</td>
                    <td className="px-3 py-1 text-right font-mono">{r.window_n}</td>
                    <td className="px-3 py-1 text-right font-mono">{r.n}</td>
                    <td className="px-3 py-1 text-right font-mono">{r.chi2.toFixed(1)}</td>
                    <td className="px-3 py-1">
                      {r.conforms == null ? "—" : r.conforms ? (
                        <span className="text-emerald-400">conforms</span>
                      ) : (
                        <span className="text-red-400">deviates</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {!data && !error && (
        <div className="px-4 py-6 text-center text-xs text-zinc-500">
          Pick a symbol, interval and start date, then run — every (source × digit × window)
          combination is ranked by χ² fit to Benford; the winner&apos;s distribution and its
          conformity over time are charted.
        </div>
      )}
    </div>
  );
}

// ─── Composer panel ───────────────────────────────────────────────────────────

function ComposerPanel({
  strategies,
  compositions,
  colorFor,
  onChanged,
}: {
  strategies: StrategyInfo[];
  compositions: CompositionInfo[];
  colorFor: (name: string) => string;
  onChanged: () => void;
}) {
  const [name, setName] = useState("");
  const [weights, setWeights] = useState<Record<string, number>>({});
  const [params, setParams] = useState<Record<string, Record<string, number>>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const setParam = (strategy: string, key: string, value: number) =>
    setParams((p) => ({ ...p, [strategy]: { ...(p[strategy] ?? {}), [key]: value } }));

  const create = async () => {
    const members = Object.entries(weights)
      .filter(([, w]) => w > 0)
      .map(([strategy, weight]) => ({
        strategy,
        weight,
        params: params[strategy] ?? {},
      }));
    if (!name.trim() || members.length === 0) {
      setError("Name the composition and give at least one strategy a positive weight.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api("/compositions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), members }),
      });
      setName("");
      setWeights({});
      setParams({});
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (comp: CompositionInfo) => {
    await api(`/compositions/${encodeURIComponent(comp.name)}/active?active=${!comp.active}`, {
      method: "POST",
    });
    onChanged();
  };

  const remove = async (comp: CompositionInfo) => {
    await api(`/compositions/${encodeURIComponent(comp.name)}`, { method: "DELETE" });
    onChanged();
  };

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
      <h2 className="mb-3 text-sm font-semibold text-zinc-200">Compose a forecaster</h2>
      <div className="mb-3 space-y-1.5">
        {strategies.map((s) => {
          const isOpen = expanded[s.name] ?? false;
          const hasParams = Object.keys(s.params_schema).length > 0;
          const included = (weights[s.name] ?? 0) > 0;
          return (
            <div
              key={s.name}
              className={`rounded border ${
                included ? "border-zinc-700 bg-zinc-950/60" : "border-zinc-800/60"
              } px-2 py-1.5`}
            >
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={0}
                  step={0.25}
                  value={weights[s.name] ?? 0}
                  onChange={(e) =>
                    setWeights((w) => ({ ...w, [s.name]: Number(e.target.value) }))
                  }
                  className="w-16 rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-zinc-100"
                  aria-label={`Weight for ${s.name}`}
                />
                <span className="text-xs font-medium text-zinc-200">{s.name}</span>
                <button
                  onClick={() => setExpanded((x) => ({ ...x, [s.name]: !isOpen }))}
                  className="ml-auto flex items-center gap-1 rounded p-1 text-zinc-500 hover:text-zinc-200"
                  title="Details & parameters"
                >
                  {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                </button>
              </div>
              {isOpen && (
                <div className="mt-1.5 space-y-1.5 border-t border-zinc-800 pt-1.5">
                  <p className="text-[11px] leading-relaxed text-zinc-400">{s.description}</p>
                  {hasParams ? (
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                      {Object.entries(s.params_schema).map(([key, schema]) => (
                        <label key={key} className="flex items-center justify-between gap-2 text-[11px] text-zinc-400">
                          <span title={key}>{schema.label ?? key}</span>
                          <input
                            type="number"
                            value={params[s.name]?.[key] ?? schema.default}
                            onChange={(e) => setParam(s.name, key, Number(e.target.value))}
                            className="w-16 rounded border border-zinc-700 bg-zinc-950 px-1.5 py-0.5 text-right text-[11px] text-zinc-100"
                          />
                        </label>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[11px] text-zinc-500">No parameters.</p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="composition name"
          className="flex-1 rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-zinc-100"
        />
        <button
          onClick={create}
          disabled={busy}
          className="flex items-center gap-1 rounded bg-zinc-100 px-2 py-1 text-xs font-medium text-zinc-900 hover:bg-white disabled:opacity-50"
        >
          <Plus size={12} /> Create
        </button>
      </div>
      {error && <div className="mt-2 text-xs text-red-400">{error}</div>}

      <h3 className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-zinc-500">
        Compositions
      </h3>
      <ul className="space-y-1">
        {compositions.map((c) => (
          <li key={c.name} className="flex items-center gap-2 text-xs">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ background: colorFor(c.name) }}
            />
            <span className={c.active ? "text-zinc-200" : "text-zinc-500 line-through"}>
              {c.name}
            </span>
            <span
              className="text-zinc-500"
              title={c.members
                .map((m) => {
                  const p = Object.entries(m.params ?? {})
                    .map(([k, v]) => `${k}=${v}`)
                    .join(", ");
                  return `${m.strategy} (weight ${m.weight}${p ? `; ${p}` : ""})`;
                })
                .join("\n")}
            >
              {c.members.map((m) => `${m.strategy}×${m.weight}`).join(" + ")}
            </span>
            <span className="ml-auto flex gap-1">
              <button
                onClick={() => toggle(c)}
                title={c.active ? "Deactivate" : "Activate"}
                className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
              >
                <Power size={12} />
              </button>
              {c.name !== "baseline" && (
                <button
                  onClick={() => remove(c)}
                  title="Delete"
                  className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-red-400"
                >
                  <Trash2 size={12} />
                </button>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── Accuracy (error-validation) table ────────────────────────────────────────

function AccuracyTable({
  rows,
  horizons,
  colorFor,
}: {
  rows: AccuracyRow[];
  horizons: Set<number>;
  colorFor: (name: string) => string;
}) {
  const visible = rows.filter((r) => horizons.has(r.horizon_s));
  if (!visible.length) {
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 text-xs text-zinc-500">
        Error validation appears here once forecasts start resolving (first rows within ~30s
        of the service running).
      </div>
    );
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-900/50">
      <table className="w-full text-left text-xs">
        <thead>
          <tr className="border-b border-zinc-800 text-zinc-500">
            <th className="px-3 py-2 font-medium">Composition</th>
            <th className="px-3 py-2 font-medium">Horizon</th>
            <th className="px-3 py-2 text-right font-medium">N</th>
            <th className="px-3 py-2 text-right font-medium">MAE</th>
            <th className="px-3 py-2 text-right font-medium">RMSE</th>
            <th className="px-3 py-2 text-right font-medium">MAPE %</th>
            <th className="px-3 py-2 text-right font-medium">Bias %</th>
            <th className="px-3 py-2 text-right font-medium">Direction hit</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((r) => (
            <tr
              key={`${r.composition}-${r.horizon_s}`}
              className="border-b border-zinc-800/50 text-zinc-300"
            >
              <td className="px-3 py-1.5">
                <span
                  className="mr-2 inline-block h-2 w-2 rounded-full"
                  style={{ background: colorFor(r.composition) }}
                />
                {r.composition}
              </td>
              <td className="px-3 py-1.5">{HORIZON_LABELS[r.horizon_s] ?? `${r.horizon_s}s`}</td>
              <td className="px-3 py-1.5 text-right font-mono">{r.n}</td>
              <td className="px-3 py-1.5 text-right font-mono">{r.mae.toFixed(2)}</td>
              <td className="px-3 py-1.5 text-right font-mono">{r.rmse.toFixed(2)}</td>
              <td className="px-3 py-1.5 text-right font-mono">{r.mape_pct.toFixed(4)}</td>
              <td className="px-3 py-1.5 text-right font-mono">{r.bias_pct.toFixed(4)}</td>
              <td className="px-3 py-1.5 text-right font-mono">
                {r.direction_hit_rate == null
                  ? "—"
                  : `${(r.direction_hit_rate * 100).toFixed(0)}% (${r.direction_calls})`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Toggle chip ──────────────────────────────────────────────────────────────

function Chip({
  on,
  onClick,
  color,
  children,
}: {
  on: boolean;
  onClick: () => void;
  color?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs transition-colors ${
        on
          ? "border-zinc-500 bg-zinc-800 text-zinc-100"
          : "border-zinc-800 bg-transparent text-zinc-500 hover:text-zinc-300"
      }`}
    >
      {color && (
        <span
          className="inline-block h-2 w-2 rounded-full"
          style={{ background: on ? color : "#52525b" }}
        />
      )}
      {children}
    </button>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ForecasterPage() {
  const [symbol, setSymbol] = useState("BTCUSDT");
  const [symbols, setSymbols] = useState<string[]>(["BTCUSDT", "ETHUSDT"]);
  const [live, setLive] = useState<LivePayload | null>(null);
  const [strategies, setStrategies] = useState<StrategyInfo[]>([]);
  const [compositions, setCompositions] = useState<CompositionInfo[]>([]);
  const [accuracy, setAccuracy] = useState<AccuracyRow[]>([]);
  const [offline, setOffline] = useState(false);
  const [horizons, setHorizons] = useState<Set<number>>(new Set(HORIZONS));
  const [indicators, setIndicators] = useState<Set<IndicatorId>>(new Set(["ema60"]));
  const [fitSignal, setFitSignal] = useState(0);
  const compOrder = useRef<string[]>([]);

  const colorFor = useCallback((name: string) => {
    let idx = compOrder.current.indexOf(name);
    if (idx === -1) {
      compOrder.current.push(name);
      idx = compOrder.current.length - 1;
    }
    return idx < COMP_COLORS.length ? COMP_COLORS[idx] : OTHER_COLOR;
  }, []);

  const refreshMeta = useCallback(async () => {
    try {
      const [strats, comps, syms] = await Promise.all([
        api<StrategyInfo[]>("/strategies"),
        api<CompositionInfo[]>("/compositions"),
        api<{ symbols: string[] }>("/symbols"),
      ]);
      setStrategies(strats);
      setCompositions(comps);
      setSymbols(syms.symbols);
    } catch {
      /* retried on the next cycle */
    }
  }, []);

  useEffect(() => {
    refreshMeta();
  }, [refreshMeta]);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const data = await api<LivePayload>(`/live?symbol=${symbol}&tick_tail=1200`);
        if (!cancelled) {
          setLive(data);
          setOffline(false);
        }
      } catch {
        if (!cancelled) setOffline(true);
      }
    };
    const pollAccuracy = async () => {
      try {
        const rows = await api<AccuracyRow[]>(`/accuracy?symbol=${symbol}`);
        if (!cancelled) setAccuracy(rows);
      } catch {
        /* retried next cycle */
      }
    };
    poll();
    pollAccuracy();
    const t1 = setInterval(poll, 1000); // 1s — matches server tick sampling
    const t2 = setInterval(pollAccuracy, 10000);
    return () => {
      cancelled = true;
      clearInterval(t1);
      clearInterval(t2);
    };
  }, [symbol]);

  const toggleHorizon = (h: number) =>
    setHorizons((prev) => {
      const next = new Set(prev);
      if (next.has(h)) {
        if (next.size > 1) next.delete(h); // never allow an empty selection
      } else {
        next.add(h);
      }
      return next;
    });

  const toggleIndicator = (id: IndicatorId) =>
    setIndicators((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const lastPrice = live?.ticks.length ? live.ticks[live.ticks.length - 1].price : null;
  const priceDelta = useMemo(() => {
    if (!live?.ticks.length || live.ticks.length < 2) return 0;
    return lastPrice! - live.ticks[live.ticks.length - 2].price;
  }, [live, lastPrice]);

  return (
    <div className="space-y-4 p-6">
      {/* Header row: symbol, live price, status */}
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="flex items-center gap-2 text-lg font-semibold text-zinc-100">
          <Activity size={18} /> Forecaster
        </h1>
        <select
          value={symbol}
          onChange={(e) => setSymbol(e.target.value)}
          className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm text-zinc-100"
        >
          {symbols.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        {lastPrice != null && (
          <span
            className={`font-mono text-lg tabular-nums ${
              priceDelta > 0
                ? "text-emerald-400"
                : priceDelta < 0
                  ? "text-red-400"
                  : "text-zinc-200"
            }`}
          >
            {lastPrice.toLocaleString([], { maximumFractionDigits: 2 })}
          </span>
        )}
        {offline && (
          <span className="rounded bg-red-950 px-2 py-0.5 text-xs text-red-300">
            signal-service unreachable — is it running with the forecast module?
          </span>
        )}
        <span className="ml-auto flex items-center gap-3 text-xs text-zinc-400">
          <span className="flex items-center gap-1">
            <Check size={12} color={HIT_COLOR} /> hit
          </span>
          <span className="flex items-center gap-1">
            <X size={12} color={MISS_COLOR} /> miss
          </span>
          <button
            onClick={() => setFitSignal((n) => n + 1)}
            title="Fit chart to data"
            className="flex items-center gap-1 rounded border border-zinc-700 px-2 py-0.5 text-zinc-300 hover:bg-zinc-800"
          >
            <Maximize2 size={11} /> Fit
          </button>
        </span>
      </div>

      {/* Filter rows: horizons + indicators (one filter bar above the chart) */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs uppercase tracking-wide text-zinc-600">Horizon</span>
        {HORIZONS.map((hz) => (
          <Chip key={hz} on={horizons.has(hz)} onClick={() => toggleHorizon(hz)}>
            {HORIZON_LABELS[hz]}
          </Chip>
        ))}
        <span className="ml-4 text-xs uppercase tracking-wide text-zinc-600">Indicators</span>
        {INDICATORS.map((ind) => (
          <Chip
            key={ind.id}
            on={indicators.has(ind.id)}
            onClick={() => toggleIndicator(ind.id)}
            color={ind.color}
          >
            {ind.label}
          </Chip>
        ))}
        <span className="ml-4 text-xs uppercase tracking-wide text-zinc-600">Forecasts</span>
        {compositions
          .filter((c) => c.active)
          .map((c) => (
            <span key={c.name} className="flex items-center gap-1.5 text-xs text-zinc-300">
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ background: colorFor(c.name) }}
              />
              {c.name}
            </span>
          ))}
      </div>

      {/* Chart: native wheel/drag zoom, live-updating price */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-2">
        {live?.ticks.length ? (
          <ForecastChart
            live={live}
            horizons={horizons}
            indicators={indicators}
            colorFor={colorFor}
            fitSignal={fitSignal}
          />
        ) : (
          <div className="flex h-[460px] items-center justify-center text-sm text-zinc-500">
            {offline
              ? "Waiting for the signal-service…"
              : "Collecting live ticks — the chart appears within a few seconds."}
          </div>
        )}
      </div>

      {/* Narrator + Benford analysis */}
      <div className="grid gap-4 lg:grid-cols-2">
        <NarratorPanel symbol={symbol} />
        <BenfordPanel symbol={symbol} ticks={live?.ticks ?? []} />
      </div>

      {/* Historical Benford scan */}
      <BenfordBacktestPanel symbols={symbols} />

      <div className="grid gap-4 lg:grid-cols-[1fr_1.6fr]">
        <ComposerPanel
          strategies={strategies}
          compositions={compositions}
          colorFor={colorFor}
          onChanged={refreshMeta}
        />
        <AccuracyTable rows={accuracy} horizons={horizons} colorFor={colorFor} />
      </div>
    </div>
  );
}
