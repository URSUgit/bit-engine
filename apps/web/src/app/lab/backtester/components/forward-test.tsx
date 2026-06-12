"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ResponsiveContainer, Dot,
} from "recharts";

// ── Types ─────────────────────────────────────────────────────────────────────

interface BarEvent {
  type: "bar";
  bar_num: number;
  timestamp: number;
  close: number;
  signal: "buy" | "close" | "sell" | "hold";
  equity: number;
  position: {
    entry_price: number;
    size: number;
    pnl: number;
    pnl_pct: number;
  } | null;
  total_return_pct: number;
}

type ForwardEvent = BarEvent | { type: "done" };

interface EquityDataPoint {
  bar: number;
  equity: number;
  signal?: "buy" | "close" | "sell";
}

export interface ForwardTestProps {
  symbol: string;
  strategy: string;
  strategyParams: Record<string, number>;
  interval: string;
  initialCapital: number;
  commissionPct: number;
  slippagePct: number;
  positionPct: number;
}

const SIGNAL_SERVICE_URL = process.env.NEXT_PUBLIC_SIGNAL_SERVICE_URL ?? "";

// ── Signal flash badge ────────────────────────────────────────────────────────

function SignalFlash({ signal }: { signal: "buy" | "close" | "sell" | null }) {
  const [visible, setVisible] = useState(false);
  const [current, setCurrent] = useState<typeof signal>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!signal) return;
    setCurrent(signal);
    setVisible(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setVisible(false), 2000);
  }, [signal]);

  if (!visible || !current) return null;

  const isBuy = current === "buy";
  return (
    <div
      className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-full font-bold text-sm border animate-pulse ${
        isBuy
          ? "bg-emerald-500/20 border-emerald-500 text-emerald-400"
          : "bg-red-500/20 border-red-500 text-red-400"
      }`}
    >
      <span>{isBuy ? "▲" : "▼"}</span>
      <span>{isBuy ? "BUY" : "CLOSE"}</span>
    </div>
  );
}

// ── Equity chart with signal dots ─────────────────────────────────────────────

function EquityChart({
  data,
  initialCapital,
}: {
  data: EquityDataPoint[];
  initialCapital: number;
}) {
  // Keep last 100 points visible
  const visible = data.slice(-100);

  const renderDot = (props: {
    cx?: number;
    cy?: number;
    payload?: EquityDataPoint;
    index?: number;
  }) => {
    const { cx, cy, payload } = props;
    if (!payload?.signal || cx == null || cy == null) return <g key={`empty-${props.index}`} />;
    const isBuy = payload.signal === "buy";
    return (
      <Dot
        key={`dot-${payload.bar}`}
        cx={cx}
        cy={cy}
        r={5}
        fill={isBuy ? "#10b981" : "#ef4444"}
        stroke={isBuy ? "#34d399" : "#f87171"}
        strokeWidth={2}
      />
    );
  };

  const minEquity = visible.length > 0
    ? Math.min(...visible.map((d) => d.equity)) * 0.998
    : initialCapital * 0.9;
  const maxEquity = visible.length > 0
    ? Math.max(...visible.map((d) => d.equity)) * 1.002
    : initialCapital * 1.1;

  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={visible} margin={{ top: 8, right: 16, left: 8, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
        <XAxis
          dataKey="bar"
          tick={{ fill: "#71717a", fontSize: 10 }}
          tickLine={false}
          axisLine={false}
          label={{ value: "Bar #", position: "insideRight", fill: "#52525b", fontSize: 10 }}
        />
        <YAxis
          domain={[minEquity, maxEquity]}
          tick={{ fill: "#71717a", fontSize: 10 }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v: number) =>
            v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${v.toFixed(0)}`
          }
          width={56}
        />
        <Tooltip
          contentStyle={{
            background: "#18181b",
            border: "1px solid #3f3f46",
            borderRadius: 6,
            fontSize: 12,
          }}
          labelStyle={{ color: "#a1a1aa" }}
          formatter={(value: unknown) => [`$${(value as number).toFixed(2)}`, "Equity"]}
          labelFormatter={(label: unknown) => `Bar ${label}`}
        />
        <ReferenceLine
          y={initialCapital}
          stroke="#52525b"
          strokeDasharray="6 3"
          label={{
            value: "Capital",
            position: "insideTopRight",
            fill: "#52525b",
            fontSize: 10,
          }}
        />
        <Line
          type="monotone"
          dataKey="equity"
          stroke="#06b6d4"
          strokeWidth={2}
          dot={renderDot}
          activeDot={{ r: 4, fill: "#06b6d4" }}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

// ── Main ForwardTest component ────────────────────────────────────────────────

export function ForwardTest({
  symbol,
  strategy,
  strategyParams,
  interval,
  initialCapital,
  commissionPct,
  slippagePct,
  positionPct,
}: ForwardTestProps) {
  const [status, setStatus] = useState<"idle" | "running" | "paused" | "done">("idle");
  const [speed, setSpeed] = useState(1);
  const [barNum, setBarNum] = useState(0);
  const [currentTime, setCurrentTime] = useState<number | null>(null);
  const [equity, setEquity] = useState(initialCapital);
  const [totalReturnPct, setTotalReturnPct] = useState(0);
  const [position, setPosition] = useState<BarEvent["position"]>(null);
  const [lastSignal, setLastSignal] = useState<"buy" | "close" | "sell" | null>(null);
  const [equityData, setEquityData] = useState<EquityDataPoint[]>([]);
  const [error, setError] = useState<string | null>(null);

  const sseRef = useRef<EventSource | null>(null);
  const pausedRef = useRef(false);
  const eventBufferRef = useRef<ForwardEvent[]>([]);
  const processingRef = useRef(false);

  // Process buffered events when unpaused
  const drainBuffer = useCallback(() => {
    if (processingRef.current) return;
    processingRef.current = true;

    const drain = () => {
      if (pausedRef.current || eventBufferRef.current.length === 0) {
        processingRef.current = false;
        return;
      }
      const evt = eventBufferRef.current.shift();
      if (!evt) { processingRef.current = false; return; }

      if (evt.type === "done") {
        setStatus("done");
        processingRef.current = false;
        return;
      }

      setBarNum(evt.bar_num);
      setCurrentTime(evt.timestamp);
      setEquity(evt.equity);
      setTotalReturnPct(evt.total_return_pct);
      setPosition(evt.position);
      if (evt.signal !== "hold") {
        setLastSignal(evt.signal as "buy" | "close" | "sell");
      }
      setEquityData((prev) => {
        const point: EquityDataPoint = { bar: evt.bar_num, equity: evt.equity };
        if (evt.signal === "buy" || evt.signal === "close" || evt.signal === "sell") {
          point.signal = evt.signal;
        }
        return [...prev, point];
      });

      requestAnimationFrame(drain);
    };

    drain();
  }, []);

  function buildUrl(): string {
    const base = `${SIGNAL_SERVICE_URL}/api/v1/backtest/forward_test_stream`;
    const q = new URLSearchParams({
      symbol,
      strategy,
      interval,
      speed: String(speed),
      initial_capital: String(initialCapital),
      commission_pct: String(commissionPct / 100),
      slippage_pct: String(slippagePct / 100),
      position_size_pct: String(positionPct / 100),
      params_json: JSON.stringify(strategyParams),
    });
    return `${base}?${q.toString()}`;
  }

  function start() {
    // Reset state
    setStatus("running");
    setBarNum(0);
    setCurrentTime(null);
    setEquity(initialCapital);
    setTotalReturnPct(0);
    setPosition(null);
    setLastSignal(null);
    setEquityData([]);
    setError(null);
    pausedRef.current = false;
    eventBufferRef.current = [];

    const url = buildUrl();
    const sse = new EventSource(url);
    sseRef.current = sse;

    sse.onmessage = (e: MessageEvent) => {
      try {
        const evt = JSON.parse(e.data) as ForwardEvent;
        if (pausedRef.current) {
          // Buffer events while paused
          eventBufferRef.current.push(evt);
        } else {
          if (evt.type === "done") {
            setStatus("done");
            sse.close();
            return;
          }
          const barEvt = evt as BarEvent;
          setBarNum(barEvt.bar_num);
          setCurrentTime(barEvt.timestamp);
          setEquity(barEvt.equity);
          setTotalReturnPct(barEvt.total_return_pct);
          setPosition(barEvt.position);
          if (barEvt.signal !== "hold") {
            setLastSignal(barEvt.signal as "buy" | "close" | "sell");
          }
          setEquityData((prev) => {
            const point: EquityDataPoint = { bar: barEvt.bar_num, equity: barEvt.equity };
            if (barEvt.signal === "buy" || barEvt.signal === "close" || barEvt.signal === "sell") {
              point.signal = barEvt.signal;
            }
            return [...prev, point];
          });
        }
      } catch {
        // ignore parse errors
      }
    };

    sse.onerror = () => {
      setError("Connection error — the stream ended unexpectedly.");
      setStatus("idle");
      sse.close();
    };
  }

  function pause() {
    pausedRef.current = true;
    setStatus("paused");
  }

  function resume() {
    pausedRef.current = false;
    setStatus("running");
    drainBuffer();
  }

  function stop() {
    if (sseRef.current) {
      sseRef.current.close();
      sseRef.current = null;
    }
    pausedRef.current = false;
    eventBufferRef.current = [];
    setStatus("idle");
  }

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (sseRef.current) {
        sseRef.current.close();
        sseRef.current = null;
      }
    };
  }, []);

  const isRunning = status === "running";
  const isPaused = status === "paused";
  const isActive = isRunning || isPaused;
  const isPositionOpen = position !== null;
  const returnPositive = totalReturnPct >= 0;

  const formatPrice = (p: number) =>
    p >= 1000
      ? p.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : p.toFixed(6).replace(/\.?0+$/, "");

  const formatTs = (ts: number | null) => {
    if (ts == null) return "—";
    return new Date(ts * 1000).toLocaleDateString("en-US", {
      month: "short", day: "numeric", year: "numeric",
    });
  };

  return (
    <div className="space-y-5">
      {/* ─── Control bar ──────────────────────────────────────────────── */}
      <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-4 flex flex-wrap items-center gap-4">
        {/* Config badges */}
        <div className="flex gap-2 flex-wrap">
          <span className="px-2.5 py-1 text-xs font-medium bg-zinc-800 text-zinc-200 rounded-full border border-zinc-700">
            {symbol}
          </span>
          <span className="px-2.5 py-1 text-xs font-medium bg-zinc-800 text-zinc-400 rounded-full border border-zinc-700">
            {strategy.replace(/_/g, " ")}
          </span>
          <span className="px-2.5 py-1 text-xs font-medium bg-zinc-800 text-zinc-400 rounded-full border border-zinc-700">
            {interval}
          </span>
        </div>

        {/* Speed selector */}
        <div className="flex items-center gap-1.5 ml-auto">
          <span className="text-xs text-zinc-500 mr-1">Speed</span>
          {[1, 5, 10].map((s) => (
            <button
              key={s}
              onClick={() => setSpeed(s)}
              disabled={isActive}
              className={`px-2.5 py-1 rounded-full text-xs font-semibold transition border ${
                speed === s
                  ? "bg-cyan-500 text-zinc-950 border-cyan-400"
                  : "border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 disabled:opacity-40"
              }`}
            >
              {s}×
            </button>
          ))}
        </div>

        {/* Play/Pause/Stop */}
        <div className="flex items-center gap-2">
          {!isActive && (
            <button
              onClick={start}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-zinc-950 font-semibold text-sm transition"
            >
              <span>▶</span> {status === "done" ? "Restart" : "Start"}
            </button>
          )}
          {isRunning && (
            <button
              onClick={pause}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-yellow-500/20 hover:bg-yellow-500/30 border border-yellow-500/50 text-yellow-400 font-semibold text-sm transition"
            >
              <span>⏸</span> Pause
            </button>
          )}
          {isPaused && (
            <button
              onClick={resume}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/50 text-emerald-400 font-semibold text-sm transition"
            >
              <span>▶</span> Resume
            </button>
          )}
          {isActive && (
            <button
              onClick={stop}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-400 font-semibold text-sm transition"
            >
              <span>⏹</span>
            </button>
          )}
        </div>

        {/* Bar count + time */}
        {barNum > 0 && (
          <div className="text-xs text-zinc-500 tabular-nums">
            Bar <span className="text-zinc-300 font-medium">{barNum}</span>
            {currentTime != null && (
              <span className="ml-2 text-zinc-600">{formatTs(currentTime)}</span>
            )}
            {status === "done" && (
              <span className="ml-2 text-zinc-500 italic">Done</span>
            )}
            {isPaused && (
              <span className="ml-2 text-yellow-500 italic">Paused</span>
            )}
          </div>
        )}
      </div>

      {/* ─── Equity display ───────────────────────────────────────────── */}
      <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-6">
        <div className="flex items-start justify-between mb-6">
          {/* Large equity number */}
          <div>
            <div className="text-xs text-zinc-500 uppercase tracking-wide mb-1">Equity</div>
            <div className="flex items-baseline gap-3">
              <span className="text-4xl font-bold tabular-nums text-zinc-50">
                ${equity.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
              <span
                className={`text-lg font-semibold tabular-nums ${
                  returnPositive ? "text-emerald-400" : "text-red-400"
                }`}
              >
                {returnPositive ? "+" : ""}{totalReturnPct.toFixed(2)}%
              </span>
            </div>
          </div>

          {/* Signal flash + position indicator */}
          <div className="flex items-center gap-3">
            <SignalFlash signal={lastSignal} />
            {isPositionOpen && (
              <div className="flex items-center gap-1.5">
                <span
                  className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse"
                  title="Position open"
                />
                <span className="text-xs text-emerald-400 font-medium">In trade</span>
              </div>
            )}
          </div>
        </div>

        {/* Position card */}
        {isPositionOpen && position && (
          <div className="mb-5 bg-emerald-950/30 border border-emerald-800/50 rounded-lg p-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <div className="text-xs text-zinc-500 mb-0.5">Entry price</div>
              <div className="text-sm font-semibold text-zinc-200">${formatPrice(position.entry_price)}</div>
            </div>
            <div>
              <div className="text-xs text-zinc-500 mb-0.5">Size</div>
              <div className="text-sm font-semibold text-zinc-200">{position.size.toFixed(6)}</div>
            </div>
            <div>
              <div className="text-xs text-zinc-500 mb-0.5">Unrealized P&L</div>
              <div className={`text-sm font-semibold ${position.pnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                {position.pnl >= 0 ? "+" : ""}${position.pnl.toFixed(2)}
              </div>
            </div>
            <div>
              <div className="text-xs text-zinc-500 mb-0.5">P&L %</div>
              <div className={`text-sm font-semibold ${position.pnl_pct >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                {position.pnl_pct >= 0 ? "+" : ""}{position.pnl_pct.toFixed(2)}%
              </div>
            </div>
          </div>
        )}

        {/* Live equity chart */}
        {equityData.length > 1 ? (
          <EquityChart data={equityData} initialCapital={initialCapital} />
        ) : (
          <div className="h-60 flex items-center justify-center text-zinc-600 text-sm">
            {status === "idle"
              ? "Press Start to begin the forward simulation"
              : "Waiting for bars…"}
          </div>
        )}
      </div>

      {/* ─── Error ────────────────────────────────────────────────────── */}
      {error && (
        <div className="text-sm text-red-400 bg-red-950/30 border border-red-900 rounded-lg p-3">
          {error}
        </div>
      )}

      {/* ─── Legend ───────────────────────────────────────────────────── */}
      {equityData.length > 0 && (
        <div className="flex items-center gap-4 text-xs text-zinc-500">
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-full bg-emerald-500" />
            <span>Buy signal</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-full bg-red-500" />
            <span>Close signal</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-5 h-0.5 border-t border-dashed border-zinc-600" />
            <span>Initial capital</span>
          </div>
        </div>
      )}
    </div>
  );
}
