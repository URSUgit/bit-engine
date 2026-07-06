"use client";

import { useEffect, useState } from "react";
import type { BacktestResult } from "@/lib/backtest-api";

// ── Types ─────────────────────────────────────────────────────────────────────

type Snapshot = {
  id: string;
  label: string;
  savedAt: string;
  result: BacktestResult;
};

const STORAGE_KEY = "bt_snapshots_v1";
const MAX_SNAPSHOTS = 10;

// ── Persistence ───────────────────────────────────────────────────────────────

function loadSnapshots(): Snapshot[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveSnapshots(snaps: Snapshot[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snaps));
  } catch {}
}

// ── Metric diff ───────────────────────────────────────────────────────────────

type DiffRow = {
  label: string;
  a: number;
  b: number;
  unit: string;
  higherIsBetter: boolean;
};

function buildDiff(a: BacktestResult, b: BacktestResult): DiffRow[] {
  const ma = a.metrics;
  const mb = b.metrics;
  return [
    { label: "Total Return",   a: ma.total_return_pct,       b: mb.total_return_pct,       unit: "%",   higherIsBetter: true },
    { label: "CAGR",           a: ma.cagr_pct,               b: mb.cagr_pct,               unit: "%",   higherIsBetter: true },
    { label: "Sharpe",         a: ma.sharpe_ratio,           b: mb.sharpe_ratio,           unit: "",    higherIsBetter: true },
    { label: "Sortino",        a: ma.sortino_ratio,          b: mb.sortino_ratio,          unit: "",    higherIsBetter: true },
    { label: "Calmar",         a: ma.calmar_ratio,           b: mb.calmar_ratio,           unit: "",    higherIsBetter: true },
    { label: "Max Drawdown",   a: ma.max_drawdown_pct,       b: mb.max_drawdown_pct,       unit: "%",   higherIsBetter: false },
    { label: "Win Rate",       a: ma.win_rate_pct,           b: mb.win_rate_pct,           unit: "%",   higherIsBetter: true },
    { label: "Profit Factor",  a: ma.profit_factor,          b: mb.profit_factor,          unit: "",    higherIsBetter: true },
    { label: "Total Trades",   a: ma.total_trades,           b: mb.total_trades,           unit: "",    higherIsBetter: false },
    { label: "Avg Trade",      a: ma.avg_trade_pnl_pct,      b: mb.avg_trade_pnl_pct,      unit: "%",   higherIsBetter: true },
    { label: "Avg Duration",   a: ma.avg_trade_duration_bars, b: mb.avg_trade_duration_bars, unit: "b", higherIsBetter: false },
  ];
}

function fmt(v: number, unit: string): string {
  if (unit === "%") return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
  if (unit === "b") return `${v.toFixed(1)}b`;
  return v.toFixed(2);
}

// ── Components ────────────────────────────────────────────────────────────────

function DiffTable({ a, b }: { a: BacktestResult; b: BacktestResult }) {
  const rows = buildDiff(a, b);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-zinc-800 text-zinc-500 text-[10px] uppercase tracking-wide">
            <th className="px-3 py-2 text-left">Metric</th>
            <th className="px-3 py-2 text-right text-cyan-400">{a.strategy} / {a.symbol}</th>
            <th className="px-3 py-2 text-right text-violet-400">{b.strategy} / {b.symbol}</th>
            <th className="px-3 py-2 text-right">Δ</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const delta = row.a - row.b;
            const aWins = row.higherIsBetter ? row.a > row.b : row.a < row.b;
            const bWins = row.higherIsBetter ? row.b > row.a : row.b < row.a;
            return (
              <tr key={row.label} className="border-b border-zinc-800/40 hover:bg-zinc-800/20">
                <td className="px-3 py-2 text-zinc-400">{row.label}</td>
                <td className={`px-3 py-2 text-right font-mono ${aWins ? "text-cyan-300 font-semibold" : "text-zinc-400"}`}>
                  {fmt(row.a, row.unit)}
                </td>
                <td className={`px-3 py-2 text-right font-mono ${bWins ? "text-violet-300 font-semibold" : "text-zinc-400"}`}>
                  {fmt(row.b, row.unit)}
                </td>
                <td className={`px-3 py-2 text-right font-mono text-[11px] ${
                  Math.abs(delta) < 0.01 ? "text-zinc-600" :
                  (delta > 0 && row.higherIsBetter) || (delta < 0 && !row.higherIsBetter)
                    ? "text-emerald-400" : "text-red-400"
                }`}>
                  {delta > 0 ? "+" : ""}{fmt(delta, row.unit)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface ResultSnapshotProps {
  current: BacktestResult;
}

export function ResultSnapshot({ current }: ResultSnapshotProps) {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [compareId, setCompareId]   = useState<string | null>(null);
  const [nameInput, setNameInput]   = useState("");
  const [open, setOpen]             = useState(false);

  useEffect(() => { setSnapshots(loadSnapshots()); }, []);

  function saveSnapshot() {
    const label = nameInput.trim() ||
      `${current.strategy}/${current.symbol} ${new Date().toLocaleDateString()}`;
    const snap: Snapshot = {
      id: Date.now().toString(),
      label,
      savedAt: new Date().toISOString(),
      result: current,
    };
    const next = [snap, ...snapshots].slice(0, MAX_SNAPSHOTS);
    setSnapshots(next);
    saveSnapshots(next);
    setNameInput("");
  }

  function deleteSnapshot(id: string) {
    const next = snapshots.filter((s) => s.id !== id);
    setSnapshots(next);
    saveSnapshots(next);
    if (compareId === id) setCompareId(null);
  }

  const compareSnap = snapshots.find((s) => s.id === compareId);

  return (
    <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg overflow-hidden">
      {/* Toggle header */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-sm font-medium text-zinc-300 hover:bg-zinc-800/50 transition"
      >
        <span className="flex items-center gap-2">
          <span>📸</span>
          Snapshots
          {snapshots.length > 0 && (
            <span className="text-xs bg-zinc-700 text-zinc-400 px-1.5 py-0.5 rounded-full">{snapshots.length}</span>
          )}
        </span>
        <span className="text-zinc-600 text-xs">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="border-t border-zinc-800 p-3 space-y-3">
          {/* Save current */}
          <div className="flex gap-2">
            <input
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") saveSnapshot(); }}
              placeholder={`${current.strategy} / ${current.symbol}`}
              className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-2.5 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-cyan-500"
            />
            <button
              onClick={saveSnapshot}
              className="px-3 py-1.5 rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-300 text-xs font-medium transition"
            >
              Save
            </button>
          </div>

          {snapshots.length === 0 && (
            <div className="text-xs text-zinc-600 text-center py-2">No snapshots saved.</div>
          )}

          {/* Snapshot list */}
          <div className="space-y-1.5 max-h-44 overflow-y-auto">
            {snapshots.map((snap) => (
              <div
                key={snap.id}
                className={`flex items-center gap-2 rounded px-3 py-2 border transition ${
                  compareId === snap.id
                    ? "border-violet-700 bg-violet-950/20"
                    : "border-zinc-700/50 bg-zinc-800/30"
                }`}
              >
                <div className="flex-1 min-w-0 cursor-pointer" onClick={() => setCompareId(compareId === snap.id ? null : snap.id)}>
                  <div className="text-xs font-medium text-zinc-200 truncate">{snap.label}</div>
                  <div className="text-[10px] text-zinc-600">
                    {snap.result.symbol} · {snap.result.strategy} · {snap.result.interval} ·{" "}
                    {snap.result.metrics.total_return_pct >= 0 ? "+" : ""}{snap.result.metrics.total_return_pct.toFixed(1)}% ·{" "}
                    Sharpe {snap.result.metrics.sharpe_ratio.toFixed(2)}
                  </div>
                </div>
                <button
                  onClick={() => setCompareId(compareId === snap.id ? null : snap.id)}
                  className={`text-[10px] px-2 py-1 rounded border transition shrink-0 ${
                    compareId === snap.id
                      ? "bg-violet-800/50 text-violet-300 border-violet-700"
                      : "bg-zinc-700/50 text-zinc-400 border-zinc-600 hover:bg-zinc-700"
                  }`}
                >
                  {compareId === snap.id ? "✓ Comparing" : "Compare"}
                </button>
                <button
                  onClick={() => deleteSnapshot(snap.id)}
                  className="text-zinc-600 hover:text-red-400 transition text-xs px-1 shrink-0"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Inline diff table */}
      {compareSnap && open && (
        <div className="border-t border-violet-900/50 p-3 space-y-2">
          <div className="text-xs font-medium text-zinc-300 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-cyan-400 inline-block" />
            <span className="text-cyan-400">Current</span>
            <span className="text-zinc-600 mx-1">vs</span>
            <span className="w-2 h-2 rounded-full bg-violet-400 inline-block" />
            <span className="text-violet-400">{compareSnap.label}</span>
          </div>
          <DiffTable a={current} b={compareSnap.result} />
        </div>
      )}
    </div>
  );
}
