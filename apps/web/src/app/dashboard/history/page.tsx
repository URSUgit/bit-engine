"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Search, TrendingUp, TrendingDown, Download, RefreshCw,
  ChevronDown, ChevronUp, Trash2, AlertCircle, RotateCcw,
} from "lucide-react";
import { usePaperTrading } from "@/hooks/usePaperTrading";
import { cn } from "@/lib/utils";

const SIGNAL_BASE =
  (typeof process !== "undefined" && process.env.NEXT_PUBLIC_SIGNAL_SERVICE_URL) ??
  "http://localhost:8001";

// ── Types ──────────────────────────────────────────────────────────────────────

interface BacktestRow {
  id: string;
  created_at: number;
  symbol: string;
  strategy: string;
  interval: string;
  start_date: string | null;
  end_date: string | null;
  total_return_pct: number | null;
  sharpe: number | null;
  max_drawdown_pct: number | null;
  total_trades: number | null;
}

// ── Formatters ─────────────────────────────────────────────────────────────────

function fmtPrice(p: number) {
  if (p >= 1000) return p.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (p >= 1) return p.toFixed(4);
  return p.toFixed(6);
}

function duration(openedAt: string, closedAt: string | null): string {
  const ms = new Date(closedAt ?? Date.now()).getTime() - new Date(openedAt).getTime();
  const h = ms / 3_600_000;
  if (h < 1) return `${Math.round(h * 60)}m`;
  if (h < 24) return `${h.toFixed(1)}h`;
  return `${(h / 24).toFixed(1)}d`;
}

function fmtTs(unixSec: number): string {
  return new Date(unixSec * 1000).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
}

function pct(v: number | null, decimals = 1): string {
  if (v === null || v === undefined) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(decimals)}%`;
}

function exportCsv(rows: ReturnType<typeof usePaperTrading>["closedPositions"]) {
  const header = "id,symbol,side,size_usd,leverage,entry_price,close_price,pnl,pnl_pct,opened_at,closed_at";
  const lines = rows.map((p) =>
    [p.id, p.symbol, p.side, p.size_usd, p.leverage, p.entry_price, p.close_price, p.pnl, p.pnl_pct, p.opened_at, p.closed_at].join(",")
  );
  const blob = new Blob([[header, ...lines].join("\n")], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "paper-trade-history.csv";
  a.click();
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function Stat({ label, value, positive }: { label: string; value: string; positive?: boolean }) {
  return (
    <div className="card-dark p-4">
      <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">{label}</p>
      <p className={cn("text-xl font-bold number-font mt-1",
        positive === true ? "text-emerald-400" : positive === false ? "text-red-400" : "text-slate-100")}>
        {value}
      </p>
    </div>
  );
}

function FilterChips({ label, options, value, onChange }: { label: string; options: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">{label}</span>
      <div className="flex gap-1 bg-slate-900 rounded-lg p-1 border border-slate-800">
        {options.map((o) => (
          <button key={o} onClick={() => onChange(o)} className={cn(
            "px-2.5 py-1 text-xs font-semibold rounded transition-colors capitalize",
            value === o ? "bg-slate-800 text-cyan-300" : "text-slate-500 hover:text-slate-300"
          )}>
            {o}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Backtest History Tab ───────────────────────────────────────────────────────

function BacktestHistoryTab() {
  const router = useRouter();
  const [rows, setRows] = useState<BacktestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [stratFilter, setStratFilter] = useState("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const fetchHistory = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${SIGNAL_BASE}/api/v1/backtest/history?limit=200`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRows(data.runs ?? []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load backtest history");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchHistory(); }, [fetchHistory]);

  const strategies = useMemo(() => {
    const s = new Set(rows.map((r) => r.strategy));
    return ["all", ...Array.from(s).sort()];
  }, [rows]);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (search && !r.symbol.toLowerCase().includes(search.toLowerCase()) &&
          !r.strategy.toLowerCase().includes(search.toLowerCase())) return false;
      if (stratFilter !== "all" && r.strategy !== stratFilter) return false;
      return true;
    });
  }, [rows, search, stratFilter]);

  const handleReRun = (row: BacktestRow) => {
    const params = new URLSearchParams({
      symbol: row.symbol,
      strategy: row.strategy,
      interval: row.interval,
      ...(row.start_date ? { start_date: row.start_date } : {}),
      ...(row.end_date ? { end_date: row.end_date } : {}),
    });
    router.push(`/lab/backtester?${params.toString()}`);
  };

  const handleDelete = async (id: string) => {
    setDeleting(id);
    try {
      await fetch(`${SIGNAL_BASE}/api/v1/backtest/history/${id}`, { method: "DELETE" });
      setRows((prev) => prev.filter((r) => r.id !== id));
      if (expandedId === id) setExpandedId(null);
    } catch {
      // ignore
    } finally {
      setDeleting(null);
    }
  };

  const handleClearAll = async () => {
    for (const row of rows) {
      try {
        await fetch(`${SIGNAL_BASE}/api/v1/backtest/history/${row.id}`, { method: "DELETE" });
      } catch {
        // ignore individual failures
      }
    }
    setRows([]);
    setConfirmClear(false);
  };

  if (loading) {
    return (
      <div className="py-16 text-center text-sm text-slate-500">Loading backtest history…</div>
    );
  }

  if (error) {
    return (
      <div className="card-dark p-6 flex flex-col items-center gap-3">
        <AlertCircle className="w-8 h-8 text-red-400" />
        <p className="text-sm text-slate-400">{error}</p>
        <button
          onClick={fetchHistory}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300 text-sm hover:bg-slate-700 transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" /> Retry
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 flex-1 min-w-[220px] max-w-md">
          <Search className="w-3.5 h-3.5 text-slate-500" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter symbol or strategy…"
            className="bg-transparent outline-none text-sm text-slate-200 placeholder:text-slate-600 w-full"
          />
        </div>
        <FilterChips label="Strategy" options={strategies} value={stratFilter} onChange={setStratFilter} />
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={fetchHistory}
            className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg bg-slate-900 text-slate-400 border border-slate-800 hover:bg-slate-800 transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
          {rows.length > 0 && (
            confirmClear ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400">Clear all {rows.length} runs?</span>
                <button
                  onClick={handleClearAll}
                  className="px-2.5 py-1.5 rounded-lg bg-red-500/20 text-red-400 text-xs font-semibold hover:bg-red-500/30 transition-colors"
                >
                  Confirm
                </button>
                <button
                  onClick={() => setConfirmClear(false)}
                  className="px-2.5 py-1.5 rounded-lg bg-slate-800 text-slate-400 text-xs hover:bg-slate-700 transition-colors"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmClear(true)}
                className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg bg-slate-900 text-red-400 border border-slate-800 hover:bg-slate-800 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" /> Clear History
              </button>
            )
          )}
        </div>
      </div>

      {/* Table */}
      <div className="card-dark overflow-hidden">
        {filtered.length === 0 ? (
          <div className="py-16 text-center text-sm text-slate-500">
            {rows.length === 0
              ? "No backtest runs yet — run your first backtest in the Lab."
              : "No runs match your filters."}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[900px]">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-900/40 text-[10px] font-bold uppercase tracking-widest text-slate-500">
                  <th className="px-4 py-3 text-left">Symbol</th>
                  <th className="px-4 py-3 text-left">Strategy</th>
                  <th className="px-4 py-3 text-left">Interval</th>
                  <th className="px-4 py-3 text-right">Return</th>
                  <th className="px-4 py-3 text-right">Sharpe</th>
                  <th className="px-4 py-3 text-right">Drawdown</th>
                  <th className="px-4 py-3 text-right">Trades</th>
                  <th className="px-4 py-3 text-right">Date Run</th>
                  <th className="px-4 py-3 text-right"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {filtered.map((row) => {
                  const isPos = (row.total_return_pct ?? 0) >= 0;
                  const expanded = expandedId === row.id;
                  return (
                    <>
                      <tr
                        key={row.id}
                        onClick={() => setExpandedId(expanded ? null : row.id)}
                        className="hover:bg-slate-900/40 transition-colors cursor-pointer"
                      >
                        <td className="px-4 py-3.5 font-mono text-slate-100 font-medium">{row.symbol}</td>
                        <td className="px-4 py-3.5">
                          <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 text-xs font-mono">
                            {row.strategy}
                          </span>
                        </td>
                        <td className="px-4 py-3.5 text-slate-400 font-mono text-xs">{row.interval}</td>
                        <td className="px-4 py-3.5 text-right">
                          <span className={cn("font-semibold number-font", isPos ? "text-emerald-400" : "text-red-400")}>
                            {pct(row.total_return_pct, 2)}
                          </span>
                        </td>
                        <td className="px-4 py-3.5 text-right text-slate-300 number-font">
                          {row.sharpe !== null ? row.sharpe.toFixed(2) : "—"}
                        </td>
                        <td className="px-4 py-3.5 text-right text-red-400 number-font">
                          {row.max_drawdown_pct !== null ? `${row.max_drawdown_pct.toFixed(1)}%` : "—"}
                        </td>
                        <td className="px-4 py-3.5 text-right text-slate-400 number-font">
                          {row.total_trades ?? "—"}
                        </td>
                        <td className="px-4 py-3.5 text-right text-slate-500 text-xs">
                          {fmtTs(row.created_at)}
                        </td>
                        <td className="px-4 py-3.5 text-right">
                          {expanded ? <ChevronUp className="w-4 h-4 text-slate-500 ml-auto" /> : <ChevronDown className="w-4 h-4 text-slate-500 ml-auto" />}
                        </td>
                      </tr>
                      {expanded && (
                        <tr key={`${row.id}-detail`} className="bg-slate-900/30">
                          <td colSpan={9} className="px-6 py-4">
                            <div className="flex flex-wrap items-start gap-6">
                              <div className="flex flex-col gap-1 text-sm">
                                <span className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">Period</span>
                                <span className="text-slate-300 font-mono text-xs">
                                  {row.start_date ?? "—"} → {row.end_date ?? "today"}
                                </span>
                              </div>
                              <div className="flex flex-col gap-1 text-sm">
                                <span className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">Run ID</span>
                                <span className="text-slate-500 font-mono text-xs">{row.id.slice(0, 12)}…</span>
                              </div>
                              <div className="flex flex-col gap-1 text-sm">
                                <span className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">Total Return</span>
                                <span className={cn("font-semibold number-font", isPos ? "text-emerald-400" : "text-red-400")}>
                                  {pct(row.total_return_pct, 2)}
                                </span>
                              </div>
                              <div className="flex flex-col gap-1 text-sm">
                                <span className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">Sharpe</span>
                                <span className="text-slate-300 number-font">{row.sharpe?.toFixed(3) ?? "—"}</span>
                              </div>
                              <div className="flex flex-col gap-1 text-sm">
                                <span className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">Max Drawdown</span>
                                <span className="text-red-400 number-font">{row.max_drawdown_pct?.toFixed(2) ?? "—"}%</span>
                              </div>
                              <div className="flex flex-col gap-1 text-sm">
                                <span className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">Trades</span>
                                <span className="text-slate-300 number-font">{row.total_trades ?? "—"}</span>
                              </div>
                              <div className="flex items-end gap-2 ml-auto">
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleReRun(row); }}
                                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-500/15 text-cyan-400 text-xs font-semibold hover:bg-cyan-500/25 transition-colors"
                                >
                                  <RotateCcw className="w-3.5 h-3.5" /> Re-run
                                </button>
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleDelete(row.id); }}
                                  disabled={deleting === row.id}
                                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 text-red-400 text-xs hover:bg-slate-700 transition-colors disabled:opacity-50"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                  {deleting === row.id ? "Deleting…" : "Delete"}
                                </button>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Paper Trading Tab ──────────────────────────────────────────────────────────

function PaperTradeTab() {
  const { closedPositions, mounted } = usePaperTrading();
  const [search, setSearch] = useState("");
  const [side, setSide] = useState<"all" | "long" | "short">("all");

  const filtered = useMemo(() => {
    return closedPositions.filter((p) => {
      if (search && !p.symbol.toLowerCase().includes(search.toLowerCase())) return false;
      if (side !== "all" && p.side !== side) return false;
      return true;
    });
  }, [closedPositions, search, side]);

  const totalPnl = filtered.reduce((s, p) => s + (p.pnl ?? 0), 0);
  const wins = filtered.filter((p) => (p.pnl ?? 0) > 0).length;
  const winRate = filtered.length ? (wins / filtered.length) * 100 : 0;
  const totalVolume = filtered.reduce((s, p) => s + p.size_usd, 0);

  return (
    <div className="flex flex-col gap-4">
      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Trades" value={`${filtered.length}`} />
        <Stat label="Win Rate" value={filtered.length ? `${winRate.toFixed(1)}%` : "—"} />
        <Stat label="Total Volume" value={totalVolume >= 1000 ? `$${(totalVolume / 1000).toFixed(1)}K` : `$${totalVolume.toFixed(0)}`} />
        <Stat label="Realized P&L" value={filtered.length ? `${totalPnl >= 0 ? "+" : ""}$${totalPnl.toFixed(2)}` : "—"} positive={filtered.length > 0 ? totalPnl >= 0 : undefined} />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 flex-1 min-w-[260px] max-w-md">
          <Search className="w-3.5 h-3.5 text-slate-500" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search asset…"
            className="bg-transparent outline-none text-sm text-slate-200 placeholder:text-slate-600 w-full" />
        </div>
        <FilterChips label="Side" options={["all", "long", "short"]} value={side} onChange={(v) => setSide(v as typeof side)} />
        <button
          onClick={() => exportCsv(filtered)}
          className="ml-auto flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg bg-slate-900 text-slate-300 border border-slate-800 hover:bg-slate-800 transition-colors">
          <Download className="w-3.5 h-3.5" /> Export CSV
        </button>
      </div>

      {/* Table */}
      <div className="card-dark overflow-hidden">
        {!mounted || filtered.length === 0 ? (
          <div className="py-16 text-center text-sm text-slate-500">
            {!mounted ? "Loading…" : `No closed trades${search || side !== "all" ? " matching filters" : ""} · open a paper trade to get started`}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[900px]">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-900/40 text-[10px] font-bold uppercase tracking-widest text-slate-500">
                  <th className="px-4 py-3 text-left">Asset</th>
                  <th className="px-4 py-3 text-left">Side</th>
                  <th className="px-4 py-3 text-right">Size</th>
                  <th className="px-4 py-3 text-right">Entry → Exit</th>
                  <th className="px-4 py-3 text-right">P&L</th>
                  <th className="px-4 py-3 text-right">Duration</th>
                  <th className="px-4 py-3 text-right">Closed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {filtered.map((p) => {
                  const isProfit = (p.pnl ?? 0) >= 0;
                  const isLong = p.side === "long";
                  return (
                    <tr key={p.id} className="hover:bg-slate-900/40 transition-colors">
                      <td className="px-4 py-3.5 font-mono text-slate-100 font-medium">{p.symbol}</td>
                      <td className="px-4 py-3.5">
                        <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded uppercase",
                          isLong ? "bg-emerald-500/15 text-emerald-400" : "bg-red-500/15 text-red-400")}>
                          {p.side}
                        </span>
                        <span className="ml-1.5 text-[10px] text-slate-500 font-mono">{p.leverage}×</span>
                      </td>
                      <td className="px-4 py-3.5 text-right text-slate-300 number-font">${p.size_usd.toLocaleString()}</td>
                      <td className="px-4 py-3.5 text-right text-slate-400 number-font text-xs">
                        ${fmtPrice(p.entry_price)} → ${fmtPrice(p.close_price ?? 0)}
                      </td>
                      <td className="px-4 py-3.5 text-right">
                        <div className={cn("number-font font-semibold flex items-center justify-end gap-1", isProfit ? "text-emerald-400" : "text-red-400")}>
                          {isProfit ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                          {isProfit ? "+" : ""}${Math.abs(p.pnl ?? 0).toFixed(2)}
                        </div>
                        <div className="text-[10px] opacity-70 number-font">{isProfit ? "+" : ""}{(p.pnl_pct ?? 0).toFixed(2)}%</div>
                      </td>
                      <td className="px-4 py-3.5 text-right text-slate-400 number-font">
                        {duration(p.opened_at, p.closed_at)}
                      </td>
                      <td className="px-4 py-3.5 text-right text-slate-500 text-xs">
                        {new Date(p.closed_at ?? p.opened_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────

type Tab = "paper" | "backtests";

export default function HistoryPage() {
  const [tab, setTab] = useState<Tab>("backtests");

  return (
    <div className="flex flex-col gap-6 p-6 max-w-[1600px] mx-auto">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-50 tracking-tight">History</h1>
          <p className="text-sm text-slate-400 mt-1">Backtest runs · paper trade fills</p>
        </div>
      </div>

      {/* Tab switcher */}
      <div className="flex gap-1 p-1 bg-slate-900 rounded-xl border border-slate-800 w-fit">
        {(["backtests", "paper"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "px-4 py-1.5 text-sm font-semibold rounded-lg transition-colors capitalize",
              tab === t ? "bg-slate-800 text-cyan-300" : "text-slate-500 hover:text-slate-300"
            )}
          >
            {t === "backtests" ? "Backtest Runs" : "Paper Trades"}
          </button>
        ))}
      </div>

      {tab === "backtests" ? <BacktestHistoryTab /> : <PaperTradeTab />}
    </div>
  );
}
