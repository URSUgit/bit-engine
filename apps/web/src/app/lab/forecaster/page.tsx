"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ComposedChart,
  Line,
  Scatter,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from "recharts";
import { Check, X, Plus, Trash2, Power, Activity } from "lucide-react";

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

// ─── Categorical palette (validated, dark mode, fixed order — never cycled) ──

const SERIES_COLORS = ["#3987e5", "#199e70", "#c98500", "#9085e9", "#e66767", "#d55181"];
const OTHER_COLOR = "#8a8a86";
// Status colors (reserved for hit/miss, shown with ✓/✕ glyphs, never color-alone)
const HIT_COLOR = "#199e70";
const MISS_COLOR = "#e66767";

const HORIZON_LABELS: Record<number, string> = {
  5: "5s",
  30: "30s",
  60: "1m",
  300: "5m",
  600: "10m",
};

const fmtTime = (ts: number) =>
  new Date(ts * 1000).toLocaleTimeString([], { hour12: false });

const fmtPrice = (p: number) =>
  p >= 1000 ? p.toLocaleString([], { maximumFractionDigits: 0 }) : p.toPrecision(5);

// ─── Small fetch helper against the API proxy ────────────────────────────────

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/v1/forecast${path}`, init);
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
}

// ─── Chart marks ──────────────────────────────────────────────────────────────

/** Pending forecast: hollow circle in the composition's hue. */
function PendingDot(props: { cx?: number; cy?: number; fill?: string }) {
  const { cx, cy, fill } = props;
  if (cx == null || cy == null) return null;
  return (
    <circle cx={cx} cy={cy} r={4} fill="#1a1a19" stroke={fill} strokeWidth={2} />
  );
}

/** Resolved forecast: ✓ (hit) or ✕ (miss) — shape carries the state, not color alone. */
function ResolvedGlyph(props: { cx?: number; cy?: number; hit?: boolean }) {
  const { cx, cy, hit } = props;
  if (cx == null || cy == null) return null;
  const c = hit ? HIT_COLOR : MISS_COLOR;
  if (hit) {
    return (
      <path
        d={`M ${cx - 4} ${cy} l 3 3 l 5 -6`}
        stroke={c}
        strokeWidth={2}
        fill="none"
        strokeLinecap="round"
      />
    );
  }
  return (
    <g stroke={c} strokeWidth={2} strokeLinecap="round">
      <line x1={cx - 3.5} y1={cy - 3.5} x2={cx + 3.5} y2={cy + 3.5} />
      <line x1={cx - 3.5} y1={cy + 3.5} x2={cx + 3.5} y2={cy - 3.5} />
    </g>
  );
}

interface TooltipEntry {
  name?: string;
  value?: number | string;
  payload?: Record<string, unknown>;
}

function ChartTooltip({ active, payload }: { active?: boolean; payload?: TooltipEntry[] }) {
  if (!active || !payload?.length) return null;
  const rows = payload.filter((e) => e.value != null);
  if (!rows.length) return null;
  const first = rows[0].payload as { ts?: number } | undefined;
  return (
    <div className="rounded-md border border-zinc-700 bg-zinc-900/95 px-3 py-2 text-xs shadow-lg">
      {first?.ts != null && (
        <div className="mb-1 text-zinc-400">{fmtTime(first.ts)}</div>
      )}
      {rows.map((e, i) => {
        const p = e.payload as Record<string, unknown> | undefined;
        const comp = p?.composition as string | undefined;
        const h = p?.horizon_s as number | undefined;
        return (
          <div key={i} className="text-zinc-100">
            {comp ? `${comp} · ${HORIZON_LABELS[h ?? 0] ?? h}` : e.name}:{" "}
            <span className="font-mono">{fmtPrice(Number(e.value))}</span>
            {p?.pct_error != null && (
              <span className="ml-1 text-zinc-400">
                (err {(p.pct_error as number).toFixed(3)}%)
              </span>
            )}
          </div>
        );
      })}
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
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const create = async () => {
    const members = Object.entries(weights)
      .filter(([, w]) => w > 0)
      .map(([strategy, weight]) => ({ strategy, weight }));
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
      <div className="mb-3 space-y-2">
        {strategies.map((s) => (
          <div key={s.name} className="flex items-center gap-2">
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
            <span className="text-xs text-zinc-300" title={s.description}>
              {s.name}
            </span>
          </div>
        ))}
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
        Active compositions
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
            <span className="text-zinc-500">
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
  colorFor,
}: {
  rows: AccuracyRow[];
  colorFor: (name: string) => string;
}) {
  if (!rows.length) {
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
          {rows.map((r) => (
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

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ForecasterPage() {
  const [symbol, setSymbol] = useState("BTCUSDT");
  const [symbols, setSymbols] = useState<string[]>(["BTCUSDT", "ETHUSDT"]);
  const [live, setLive] = useState<LivePayload | null>(null);
  const [strategies, setStrategies] = useState<StrategyInfo[]>([]);
  const [compositions, setCompositions] = useState<CompositionInfo[]>([]);
  const [accuracy, setAccuracy] = useState<AccuracyRow[]>([]);
  const [offline, setOffline] = useState(false);
  const compOrder = useRef<string[]>([]);

  // Stable categorical slot per composition — first-seen order, never repainted.
  const colorFor = useCallback((name: string) => {
    let idx = compOrder.current.indexOf(name);
    if (idx === -1) {
      compOrder.current.push(name);
      idx = compOrder.current.length - 1;
    }
    return idx < SERIES_COLORS.length ? SERIES_COLORS[idx] : OTHER_COLOR;
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
      /* meta refresh is retried on the next cycle */
    }
  }, []);

  useEffect(() => {
    refreshMeta();
  }, [refreshMeta]);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const data = await api<LivePayload>(`/live?symbol=${symbol}&tick_tail=600`);
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
    const t1 = setInterval(poll, 2000);
    const t2 = setInterval(pollAccuracy, 10000);
    return () => {
      cancelled = true;
      clearInterval(t1);
      clearInterval(t2);
    };
  }, [symbol]);

  const chart = useMemo(() => {
    if (!live?.ticks.length) return null;
    const ticks = live.ticks;
    const now = ticks[ticks.length - 1].ts;
    const byComp = new Map<string, ForecastRec[]>();
    for (const f of live.pending) {
      if (!byComp.has(f.composition)) byComp.set(f.composition, []);
      byComp.get(f.composition)!.push(f);
    }
    const resolvedHits = live.resolved_recent
      .filter((f) => f.direction_hit === true && f.due_ts >= now - 900)
      .map((f) => ({ ts: f.due_ts, price: f.predicted_price, ...f }));
    const resolvedMisses = live.resolved_recent
      .filter((f) => f.direction_hit === false && f.due_ts >= now - 900)
      .map((f) => ({ ts: f.due_ts, price: f.predicted_price, ...f }));
    const prices = [
      ...ticks.map((t) => t.price),
      ...live.pending.map((f) => f.predicted_price),
    ];
    return {
      ticks,
      now,
      byComp,
      resolvedHits,
      resolvedMisses,
      domain: [ticks[0].ts, now + 620] as [number, number],
      yDomain: [Math.min(...prices) * 0.9995, Math.max(...prices) * 1.0005] as [number, number],
    };
  }, [live]);

  return (
    <div className="space-y-4 p-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="flex items-center gap-2 text-lg font-semibold text-zinc-100">
          <Activity size={18} /> Live price forecaster
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
        <span className="text-xs text-zinc-500">
          horizons: {(live?.horizons_s ?? [5, 30, 60, 300, 600]).map((h) => HORIZON_LABELS[h]).join(" · ")}
        </span>
        {offline && (
          <span className="rounded bg-red-950 px-2 py-0.5 text-xs text-red-300">
            signal-service unreachable — is it running with the forecast module?
          </span>
        )}
        <span className="ml-auto flex items-center gap-3 text-xs text-zinc-400">
          <span className="flex items-center gap-1">
            <Check size={12} color={HIT_COLOR} /> direction hit
          </span>
          <span className="flex items-center gap-1">
            <X size={12} color={MISS_COLOR} /> miss
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded-full border-2 border-zinc-400" />{" "}
            open forecast
          </span>
        </span>
      </div>

      <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-2">
        {chart ? (
          <ResponsiveContainer width="100%" height={420}>
            <ComposedChart margin={{ top: 8, right: 16, bottom: 4, left: 8 }}>
              <CartesianGrid stroke="#27272a" strokeDasharray="2 4" vertical={false} />
              <XAxis
                dataKey="ts"
                type="number"
                domain={chart.domain}
                tickFormatter={fmtTime}
                stroke="#52525b"
                fontSize={11}
                allowDataOverflow
              />
              <YAxis
                dataKey="price"
                type="number"
                domain={chart.yDomain}
                tickFormatter={fmtPrice}
                stroke="#52525b"
                fontSize={11}
                width={70}
              />
              <Tooltip content={<ChartTooltip />} />
              <Legend
                wrapperStyle={{ fontSize: 11, color: "#a1a1aa" }}
                iconSize={10}
                formatter={(v: string) => <span style={{ color: "#d4d4d8" }}>{v}</span>}
              />
              <ReferenceLine
                x={chart.now}
                stroke="#71717a"
                strokeDasharray="4 4"
                label={{ value: "now", fill: "#a1a1aa", fontSize: 10, position: "top" }}
              />
              <Line
                data={chart.ticks}
                dataKey="price"
                name={symbol}
                stroke="#e4e4e7"
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
              {[...chart.byComp.entries()].map(([comp, recs]) => (
                <Scatter
                  key={comp}
                  data={recs.map((f) => ({ ts: f.due_ts, price: f.predicted_price, ...f }))}
                  dataKey="price"
                  name={comp}
                  fill={colorFor(comp)}
                  shape={<PendingDot />}
                  isAnimationActive={false}
                />
              ))}
              <Scatter
                data={chart.resolvedHits}
                dataKey="price"
                name="resolved ✓"
                fill={HIT_COLOR}
                shape={<ResolvedGlyph hit />}
                isAnimationActive={false}
              />
              <Scatter
                data={chart.resolvedMisses}
                dataKey="price"
                name="resolved ✕"
                fill={MISS_COLOR}
                shape={<ResolvedGlyph />}
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-[420px] items-center justify-center text-sm text-zinc-500">
            {offline
              ? "Waiting for the signal-service…"
              : "Collecting live ticks — the chart appears within a few seconds."}
          </div>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_1.6fr]">
        <ComposerPanel
          strategies={strategies}
          compositions={compositions}
          colorFor={colorFor}
          onChanged={refreshMeta}
        />
        <AccuracyTable rows={accuracy} colorFor={colorFor} />
      </div>
    </div>
  );
}
