"use client";

import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  X, Plus, RefreshCw, TrendingUp, TrendingDown, Download,
  BookOpen, ChevronDown, Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  paperApi,
  type PaperPosition,
  type PaperTrade,
  type PaperSummary,
  type OpenPositionParams,
} from "@/lib/paper-api";

// ── Constants ─────────────────────────────────────────────────────────────────

const SYMBOLS = [
  "BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT",
  "XRPUSDT", "ADAUSDT", "DOGEUSDT", "AVAXUSDT",
  "MATICUSDT", "DOTUSDT", "LINKUSDT", "LTCUSDT",
];

const STRATEGIES = [
  "Manual", "RSI", "MA Cross", "Momentum", "Scalp EMA",
  "VWAP Reversion", "Breakout Scalp", "Anomaly Fade", "Other",
];

// ── Formatters ─────────────────────────────────────────────────────────────────

function fmtPrice(p: number) {
  if (p >= 1000) return p.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (p >= 1) return p.toFixed(4);
  return p.toFixed(6);
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function fmtPct(n: number, signed = true) {
  return `${signed && n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SummaryBar({ summary }: { summary: PaperSummary }) {
  const pnlPos = summary.total_pnl >= 0;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
      <div className="card-dark p-4">
        <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">Start Balance</p>
        <p className="text-lg font-bold number-font text-slate-100 mt-1">
          ${summary.balance_start.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </p>
      </div>
      <div className="card-dark p-4">
        <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">Current Balance</p>
        <p className="text-lg font-bold number-font text-slate-100 mt-1">
          ${summary.balance_current.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </p>
      </div>
      <div className="card-dark p-4">
        <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">Total P&L</p>
        <p className={cn("text-lg font-bold number-font mt-1", pnlPos ? "text-emerald-400" : "text-red-400")}>
          {pnlPos ? "+" : ""}${Math.abs(summary.total_pnl).toFixed(2)}
        </p>
      </div>
      <div className="card-dark p-4">
        <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">Win Rate</p>
        <p className={cn("text-lg font-bold number-font mt-1", summary.win_rate >= 50 ? "text-emerald-400" : "text-slate-100")}>
          {summary.total_trades > 0 ? `${summary.win_rate.toFixed(0)}%` : "—"}
        </p>
      </div>
      <div className="card-dark p-4">
        <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">Open</p>
        <p className="text-lg font-bold number-font text-slate-100 mt-1">{summary.open_positions}</p>
      </div>
      <div className="card-dark p-4">
        <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">Closed</p>
        <p className="text-lg font-bold number-font text-slate-100 mt-1">{summary.total_trades}</p>
      </div>
    </div>
  );
}

// ── New Position Modal ─────────────────────────────────────────────────────────

function NewPositionModal({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (params: OpenPositionParams) => Promise<void>;
}) {
  const [symbol, setSymbol] = useState("BTCUSDT");
  const [customSymbol, setCustomSymbol] = useState("");
  const [side, setSide] = useState<"long" | "short">("long");
  const [entryPrice, setEntryPrice] = useState("");
  const [size, setSize] = useState("");
  const [strategy, setStrategy] = useState("Manual");
  const [notes, setNotes] = useState("");
  const [showSymbols, setShowSymbols] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const activeSymbol = customSymbol.trim().toUpperCase() || symbol;
  const ep = parseFloat(entryPrice) || 0;
  const sz = parseFloat(size) || 0;
  const notional = ep * sz;

  async function submit() {
    if (!ep || ep <= 0) { setError("Enter a valid entry price"); return; }
    if (!sz || sz <= 0) { setError("Enter a valid size"); return; }
    if (!activeSymbol) { setError("Select a symbol"); return; }
    setLoading(true);
    setError("");
    try {
      await onSubmit({
        symbol: activeSymbol,
        side,
        entry_price: ep,
        size: sz,
        strategy: strategy.toLowerCase().replace(/ /g, "_"),
        notes,
      });
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to open position");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-sm mx-4 p-6 shadow-2xl overflow-y-auto max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-bold text-slate-50">New Paper Position</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Symbol picker */}
        <div className="mb-4 relative">
          <label className="text-[10px] uppercase tracking-widest text-slate-500 font-bold block mb-1.5">Asset</label>
          <button
            onClick={() => setShowSymbols(!showSymbols)}
            className="w-full flex items-center justify-between px-3 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-sm font-mono text-slate-100 hover:border-slate-600 transition-colors"
          >
            <span>{activeSymbol}</span>
            <ChevronDown className="w-4 h-4 text-slate-500" />
          </button>
          {showSymbols && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-slate-800 border border-slate-700 rounded-lg z-10 p-2 max-h-40 overflow-y-auto">
              <div className="grid grid-cols-2 gap-1 mb-2">
                {SYMBOLS.map((s) => (
                  <button
                    key={s}
                    onClick={() => { setSymbol(s); setCustomSymbol(""); setShowSymbols(false); }}
                    className={cn(
                      "px-2 py-1.5 text-xs font-mono rounded hover:bg-slate-700 transition-colors text-left",
                      s === symbol && !customSymbol ? "bg-slate-700 text-cyan-300" : "text-slate-300"
                    )}
                  >
                    {s}
                  </button>
                ))}
              </div>
              <input
                placeholder="Custom (e.g. ARBUSDT)"
                value={customSymbol}
                onChange={(e) => setCustomSymbol(e.target.value.toUpperCase())}
                className="w-full px-2 py-1.5 bg-slate-700 border border-slate-600 rounded text-xs text-slate-100 font-mono focus:outline-none focus:border-cyan-500/50"
                onBlur={() => setShowSymbols(false)}
              />
            </div>
          )}
        </div>

        {/* Side toggle */}
        <div className="mb-4">
          <label className="text-[10px] uppercase tracking-widest text-slate-500 font-bold block mb-1.5">Direction</label>
          <div className="flex rounded-lg overflow-hidden border border-slate-700">
            <button
              onClick={() => setSide("long")}
              className={cn("flex-1 py-3 text-sm font-bold transition-colors",
                side === "long" ? "bg-emerald-500/20 text-emerald-400" : "bg-slate-800 text-slate-500 hover:text-slate-300")}
            >
              Long
            </button>
            <button
              onClick={() => setSide("short")}
              className={cn("flex-1 py-3 text-sm font-bold transition-colors border-l border-slate-700",
                side === "short" ? "bg-red-500/20 text-red-400" : "bg-slate-800 text-slate-500 hover:text-slate-300")}
            >
              Short
            </button>
          </div>
        </div>

        {/* Entry Price */}
        <div className="mb-4">
          <label className="text-[10px] uppercase tracking-widest text-slate-500 font-bold block mb-1.5">Entry Price (USD)</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">$</span>
            <input
              value={entryPrice}
              onChange={(e) => setEntryPrice(e.target.value)}
              type="number"
              min="0"
              step="any"
              placeholder="0.00"
              className="w-full pl-7 pr-3 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-100 number-font focus:outline-none focus:border-cyan-500/50 transition-colors"
            />
          </div>
        </div>

        {/* Size */}
        <div className="mb-4">
          <label className="text-[10px] uppercase tracking-widest text-slate-500 font-bold block mb-1.5">
            Size (units)
            {notional > 0 && <span className="ml-2 text-slate-400 normal-case font-normal">≈ ${notional.toLocaleString("en-US", { maximumFractionDigits: 2 })} notional</span>}
          </label>
          <input
            value={size}
            onChange={(e) => setSize(e.target.value)}
            type="number"
            min="0"
            step="any"
            placeholder="0.00"
            className="w-full px-3 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-100 number-font focus:outline-none focus:border-cyan-500/50 transition-colors"
          />
        </div>

        {/* Strategy */}
        <div className="mb-4">
          <label className="text-[10px] uppercase tracking-widest text-slate-500 font-bold block mb-1.5">Strategy</label>
          <select
            value={strategy}
            onChange={(e) => setStrategy(e.target.value)}
            className="w-full px-3 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-100 focus:outline-none focus:border-cyan-500/50 transition-colors"
          >
            {STRATEGIES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        {/* Notes */}
        <div className="mb-5">
          <label className="text-[10px] uppercase tracking-widest text-slate-500 font-bold block mb-1.5">Notes</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="e.g. RSI oversold + VWAP bounce"
            className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-100 resize-none focus:outline-none focus:border-cyan-500/50 transition-colors placeholder:text-slate-600"
          />
        </div>

        {error && (
          <p className="text-xs text-red-400 mb-3 bg-red-500/10 px-3 py-2 rounded-lg">{error}</p>
        )}

        <button
          onClick={submit}
          disabled={loading}
          className={cn(
            "w-full py-3 rounded-xl text-sm font-bold transition-colors flex items-center justify-center gap-2",
            side === "long"
              ? "bg-emerald-500 hover:bg-emerald-400 text-white disabled:opacity-60"
              : "bg-red-500 hover:bg-red-400 text-white disabled:opacity-60"
          )}
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          Open {side === "long" ? "Long" : "Short"} Position
        </button>
      </div>
    </div>
  );
}

// ── Close Position Modal ───────────────────────────────────────────────────────

function ClosePositionModal({
  position,
  onClose,
  onConfirm,
}: {
  position: PaperPosition;
  onClose: () => void;
  onConfirm: (exitPrice: number) => Promise<void>;
}) {
  const [exitPrice, setExitPrice] = useState(position.current_price.toString());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const ep = parseFloat(exitPrice) || 0;
  const pnl = position.side === "long"
    ? (ep - position.entry_price) * position.size
    : (position.entry_price - ep) * position.size;
  const pnlPos = pnl >= 0;

  async function confirm() {
    if (!ep || ep <= 0) { setError("Enter a valid exit price"); return; }
    setLoading(true);
    try {
      await onConfirm(ep);
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to close position");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-xs mx-4 p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-bold text-slate-50">Close {position.symbol}</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300"><X className="w-4 h-4" /></button>
        </div>
        <p className="text-xs text-slate-400 mb-4">
          {position.side === "long" ? "Long" : "Short"} · {position.size} units · entry ${fmtPrice(position.entry_price)}
        </p>
        <div className="mb-4">
          <label className="text-[10px] uppercase tracking-widest text-slate-500 font-bold block mb-1.5">Exit Price</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">$</span>
            <input
              value={exitPrice}
              onChange={(e) => setExitPrice(e.target.value)}
              type="number"
              min="0"
              step="any"
              className="w-full pl-7 pr-3 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-100 number-font focus:outline-none focus:border-cyan-500/50"
            />
          </div>
        </div>
        {ep > 0 && (
          <div className={cn("text-sm font-semibold number-font mb-4 px-3 py-2 rounded-lg", pnlPos ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400")}>
            Est. P&L: {pnlPos ? "+" : ""}${Math.abs(pnl).toFixed(2)}
          </div>
        )}
        {error && <p className="text-xs text-red-400 mb-3 bg-red-500/10 px-3 py-2 rounded-lg">{error}</p>}
        <button
          onClick={confirm}
          disabled={loading}
          className="w-full py-3 rounded-xl text-sm font-bold bg-red-500 hover:bg-red-400 text-white transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          Confirm Close
        </button>
      </div>
    </div>
  );
}

// ── Open Positions Tab ─────────────────────────────────────────────────────────

function OpenPositionsTab({
  positions,
  onClose,
}: {
  positions: PaperPosition[];
  onClose: (pos: PaperPosition) => void;
}) {
  if (positions.length === 0) {
    return (
      <div className="py-20 text-center text-sm text-slate-500">
        No open positions. Click <span className="text-cyan-400">New Position</span> to start paper trading.
      </div>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm min-w-[900px]">
        <thead>
          <tr className="bg-slate-900/40 border-b border-slate-800">
            {["Symbol", "Side", "Entry", "Current", "Size", "Notional", "P&L $", "P&L %", "ROE %", "Opened", "Strategy", "Actions"].map((h) => (
              <th key={h} className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-widest text-slate-500">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800/60">
          {positions.map((p) => {
            const isLong = p.side === "long";
            const isProfit = p.current_pnl >= 0;
            return (
              <tr key={p.id} className="hover:bg-slate-800/30 transition-colors">
                <td className="px-4 py-3.5 font-mono font-medium text-slate-100">{p.symbol}</td>
                <td className="px-4 py-3.5">
                  <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded uppercase",
                    isLong ? "bg-emerald-500/15 text-emerald-400" : "bg-red-500/15 text-red-400")}>
                    {p.side}
                  </span>
                </td>
                <td className="px-4 py-3.5 text-slate-400 number-font">${fmtPrice(p.entry_price)}</td>
                <td className="px-4 py-3.5 text-slate-200 number-font">${fmtPrice(p.current_price)}</td>
                <td className="px-4 py-3.5 text-slate-300 number-font">{p.size}</td>
                <td className="px-4 py-3.5 text-slate-300 number-font">${p.notional.toLocaleString("en-US", { maximumFractionDigits: 2 })}</td>
                <td className="px-4 py-3.5">
                  <div className={cn("number-font font-semibold flex items-center gap-1", isProfit ? "text-emerald-400" : "text-red-400")}>
                    {isProfit ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                    {isProfit ? "+" : ""}${Math.abs(p.current_pnl).toFixed(2)}
                  </div>
                </td>
                <td className={cn("px-4 py-3.5 number-font text-sm font-semibold", isProfit ? "text-emerald-400" : "text-red-400")}>
                  {fmtPct(p.current_pnl_pct)}
                </td>
                <td className={cn("px-4 py-3.5 number-font text-sm font-semibold", isProfit ? "text-emerald-400" : "text-red-400")}>
                  {fmtPct(p.roe_pct)}
                </td>
                <td className="px-4 py-3.5 text-[11px] text-slate-500">{fmtDate(p.opened_at)}</td>
                <td className="px-4 py-3.5 text-[11px] text-slate-400 capitalize">{p.strategy.replace(/_/g, " ")}</td>
                <td className="px-4 py-3.5">
                  <button
                    onClick={() => onClose(p)}
                    className="px-2.5 py-1 text-xs font-bold rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/25 transition-colors border border-red-500/20"
                  >
                    Close
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Trade History Tab ─────────────────────────────────────────────────────────

function TradeHistoryTab({ trades }: { trades: PaperTrade[] }) {
  function exportCsv() {
    const header = "id,symbol,side,entry_price,exit_price,size,pnl,pnl_pct,opened_at,closed_at,strategy,notes";
    const rows = trades.map((t) =>
      [t.id, t.symbol, t.side, t.entry_price, t.exit_price, t.size, t.pnl, t.pnl_pct,
        t.opened_at, t.closed_at, t.strategy, `"${t.notes.replace(/"/g, "'")}"`].join(",")
    );
    const blob = new Blob([header + "\n" + rows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `paper_trades_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (trades.length === 0) {
    return <div className="py-20 text-center text-sm text-slate-500">No closed trades yet.</div>;
  }

  return (
    <div>
      <div className="flex justify-end px-4 py-2 border-b border-slate-800">
        <button
          onClick={exportCsv}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-slate-400 hover:text-slate-200 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg transition-colors"
        >
          <Download className="w-3.5 h-3.5" /> Export CSV
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[900px]">
          <thead>
            <tr className="bg-slate-900/40 border-b border-slate-800">
              {["Symbol", "Side", "Entry", "Exit", "Size", "P&L $", "P&L %", "Result", "Opened", "Closed", "Strategy"].map((h) => (
                <th key={h} className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-widest text-slate-500">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {trades.map((t) => {
              const win = t.pnl > 0;
              const isLong = t.side === "long";
              return (
                <tr key={t.id} className="hover:bg-slate-800/30 transition-colors opacity-90">
                  <td className="px-4 py-3.5 font-mono font-medium text-slate-300">{t.symbol}</td>
                  <td className="px-4 py-3.5">
                    <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded uppercase",
                      isLong ? "bg-emerald-500/10 text-emerald-500" : "bg-red-500/10 text-red-500")}>
                      {t.side}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 text-slate-500 number-font">${fmtPrice(t.entry_price)}</td>
                  <td className="px-4 py-3.5 text-slate-400 number-font">${fmtPrice(t.exit_price)}</td>
                  <td className="px-4 py-3.5 text-slate-400 number-font">{t.size}</td>
                  <td className={cn("px-4 py-3.5 number-font font-semibold", win ? "text-emerald-400" : "text-red-400")}>
                    {win ? "+" : ""}${Math.abs(t.pnl).toFixed(2)}
                  </td>
                  <td className={cn("px-4 py-3.5 number-font font-semibold", win ? "text-emerald-400" : "text-red-400")}>
                    {fmtPct(t.pnl_pct)}
                  </td>
                  <td className="px-4 py-3.5">
                    <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded uppercase",
                      win ? "bg-emerald-500/15 text-emerald-400" : "bg-red-500/15 text-red-400")}>
                      {win ? "Win" : "Loss"}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 text-[11px] text-slate-600">{fmtDate(t.opened_at)}</td>
                  <td className="px-4 py-3.5 text-[11px] text-slate-500">{fmtDate(t.closed_at)}</td>
                  <td className="px-4 py-3.5 text-[11px] text-slate-400 capitalize">{t.strategy.replace(/_/g, " ")}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Journal Tab ────────────────────────────────────────────────────────────────

function JournalTab({ positions }: { positions: PaperPosition[] }) {
  const qc = useQueryClient();

  const noteMutation = useMutation({
    mutationFn: ({ id, notes }: { id: string; notes: string }) =>
      paperApi.updateNote(id, notes),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["paper-positions"] }),
  });

  if (positions.length === 0) {
    return (
      <div className="py-20 text-center text-sm text-slate-500">
        No open positions to journal.
      </div>
    );
  }

  return (
    <div className="divide-y divide-slate-800/60">
      {positions.map((p) => (
        <div key={p.id} className="p-5">
          <div className="flex items-center gap-3 mb-2">
            <span className="font-mono font-bold text-slate-100">{p.symbol}</span>
            <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded uppercase",
              p.side === "long" ? "bg-emerald-500/15 text-emerald-400" : "bg-red-500/15 text-red-400")}>
              {p.side}
            </span>
            <span className="text-xs text-slate-500">Entry ${fmtPrice(p.entry_price)}</span>
            <span className="text-xs text-slate-500">·</span>
            <span className="text-xs text-slate-500 capitalize">{p.strategy.replace(/_/g, " ")}</span>
            <span className={cn("text-xs font-semibold number-font ml-auto", p.current_pnl >= 0 ? "text-emerald-400" : "text-red-400")}>
              {p.current_pnl >= 0 ? "+" : ""}${p.current_pnl.toFixed(2)}
            </span>
          </div>
          <textarea
            defaultValue={p.notes}
            rows={3}
            placeholder="Record your reasoning (e.g. RSI oversold + VWAP bounce, stop at $X, target $Y)…"
            className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-200 resize-none focus:outline-none focus:border-cyan-500/50 transition-colors placeholder:text-slate-600"
            onBlur={(e) => {
              const notes = e.target.value;
              if (notes !== p.notes) noteMutation.mutate({ id: p.id, notes });
            }}
          />
          <p className="text-[10px] text-slate-600 mt-1">Auto-saves on blur</p>
        </div>
      ))}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

type Tab = "open" | "history" | "journal";

export default function PositionsPage() {
  const [tab, setTab] = useState<Tab>("open");
  const [showNew, setShowNew] = useState(false);
  const [closingPos, setClosingPos] = useState<PaperPosition | null>(null);
  const qc = useQueryClient();

  const positionsQuery = useQuery({
    queryKey: ["paper-positions"],
    queryFn: paperApi.listPositions,
    refetchInterval: 15_000,
  });

  const tradesQuery = useQuery({
    queryKey: ["paper-trades"],
    queryFn: paperApi.listTrades,
    enabled: tab === "history",
  });

  const summaryQuery = useQuery({
    queryKey: ["paper-summary"],
    queryFn: paperApi.getSummary,
    refetchInterval: 30_000,
  });

  const openMutation = useMutation({
    mutationFn: paperApi.openPosition,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["paper-positions"] });
      qc.invalidateQueries({ queryKey: ["paper-summary"] });
    },
  });

  const closeMutation = useMutation({
    mutationFn: ({ id, exitPrice }: { id: string; exitPrice: number }) =>
      paperApi.closePosition(id, exitPrice),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["paper-positions"] });
      qc.invalidateQueries({ queryKey: ["paper-trades"] });
      qc.invalidateQueries({ queryKey: ["paper-summary"] });
    },
  });

  const handleOpen = useCallback(async (params: OpenPositionParams) => {
    await openMutation.mutateAsync(params);
  }, [openMutation]);

  const handleClose = useCallback(async (exitPrice: number) => {
    if (!closingPos) return;
    await closeMutation.mutateAsync({ id: closingPos.id, exitPrice });
    setClosingPos(null);
  }, [closingPos, closeMutation]);

  const positions = positionsQuery.data ?? [];
  const trades = tradesQuery.data ?? [];
  const summary = summaryQuery.data;

  const TABS: { id: Tab; label: string; count?: number }[] = [
    { id: "open", label: "Open Positions", count: positions.length },
    { id: "history", label: "Trade History", count: trades.length || undefined },
    { id: "journal", label: "Journal", count: positions.length || undefined },
  ];

  return (
    <>
      <div className="flex flex-col gap-6 p-6 max-w-[1400px] mx-auto">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-50 tracking-tight">Paper Trading</h1>
            <p className="text-sm text-slate-400 mt-1">Simulate trades with a virtual $10,000 balance — no real money at risk</p>
          </div>
          <div className="flex gap-2 items-center">
            <button
              onClick={() => {
                qc.invalidateQueries({ queryKey: ["paper-positions"] });
                qc.invalidateQueries({ queryKey: ["paper-summary"] });
              }}
              className="flex items-center gap-2 px-3 py-2 text-xs font-bold text-slate-400 hover:text-slate-200 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg transition-colors"
            >
              {positionsQuery.isFetching
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <RefreshCw className="w-3.5 h-3.5" />}
              Refresh
            </button>
            <button
              onClick={() => setShowNew(true)}
              className="flex items-center gap-2 px-4 py-2 text-xs font-bold text-white bg-cyan-500 hover:bg-cyan-400 rounded-lg transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              New Position
            </button>
          </div>
        </div>

        {/* Summary Bar */}
        {summary && <SummaryBar summary={summary} />}

        {/* Tabs */}
        <div className="card-dark overflow-hidden">
          <div className="flex border-b border-slate-800">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  "px-5 py-3 text-xs font-bold uppercase tracking-widest transition-colors flex items-center gap-2",
                  tab === t.id
                    ? "text-cyan-300 border-b-2 border-cyan-400 -mb-px"
                    : "text-slate-500 hover:text-slate-300"
                )}
              >
                {t.id === "journal" && <BookOpen className="w-3.5 h-3.5" />}
                {t.label}
                {t.count != null && (
                  <span className="text-[10px] bg-slate-800 px-1.5 rounded">{t.count}</span>
                )}
              </button>
            ))}
          </div>

          {tab === "open" && (
            <OpenPositionsTab positions={positions} onClose={(p) => setClosingPos(p)} />
          )}
          {tab === "history" && <TradeHistoryTab trades={trades} />}
          {tab === "journal" && <JournalTab positions={positions} />}
        </div>
      </div>

      {showNew && (
        <NewPositionModal
          onClose={() => setShowNew(false)}
          onSubmit={handleOpen}
        />
      )}

      {closingPos && (
        <ClosePositionModal
          position={closingPos}
          onClose={() => setClosingPos(null)}
          onConfirm={handleClose}
        />
      )}
    </>
  );
}
