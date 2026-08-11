"use client";

import { useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import {
  Activity, Play, Square, Search, TrendingUp, TrendingDown,
  Minus, RefreshCw, AlertTriangle, CheckCircle2, Loader2,
  BarChart3, Wallet, Shield,
} from "lucide-react";

const SIGNAL_BASE = process.env.NEXT_PUBLIC_SIGNAL_SERVICE_URL ?? "http://localhost:8001";
const BASE = `${SIGNAL_BASE}/api/v1/polymarket`;

// ─── Types ────────────────────────────────────────────────────────────────────

interface Market { condition_id: string; question: string; volume: number; end_date: string }
interface BotStatus {
  mode: string; ticks: number; trades: number; last_price: number | null;
  last_decision: string; feeds: { feed_id: number; ticks: number; rejected: number; latency_ms: number }[];
  uptime_s: number; question?: string;
}
interface LedgerSummary {
  total_trades: number; open: number; wins: number; losses: number;
  win_rate: number; total_pnl_usdc: number; avg_expected_value: number; dry_run_trades: number;
}
interface Trade {
  id: string; market_id: string; question: string; side: string; entry_price: number;
  size_usdc: number; breakeven_wr: number; estimated_wr: number; expected_value: number;
  reason: string; status: string; pnl_usdc: number; dry_run: boolean;
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
    });
    if (!res.ok) return null;
    return res.json() as Promise<T>;
  } catch { return null; }
}

// ─── Status badge ─────────────────────────────────────────────────────────────
function ModeBadge({ mode }: { mode: string }) {
  const cfg = {
    dry_run: { cls: "bg-amber-500/15 text-amber-300 border-amber-500/30", label: "Dry Run" },
    live:    { cls: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30", label: "Live" },
    stopped: { cls: "bg-slate-800 text-slate-500 border-slate-700", label: "Stopped" },
  }[mode] ?? { cls: "bg-slate-800 text-slate-500 border-slate-700", label: mode };
  return (
    <span className={cn("text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded border", cfg.cls)}>
      {cfg.label}
    </span>
  );
}

// ─── Market search ────────────────────────────────────────────────────────────
function MarketSearch({ onSelect }: { onSelect: (m: Market) => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Market[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState(false);

  const search = async () => {
    setLoading(true);
    const data = await apiFetch<Market[]>(`/markets?keyword=${encodeURIComponent(q)}&limit=10`);
    setError(data === null);
    setResults(data ?? []);
    setSearched(true);
    setLoading(false);
  };

  return (
    <div className="card-dark p-5 flex flex-col gap-4">
      <h2 className="text-sm font-semibold text-slate-100">Find a Market</h2>
      <div className="flex gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && search()}
          placeholder="Search Polymarket… e.g. Bitcoin, election, ETH"
          className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-cyan-500/50 outline-none"
        />
        <button
          onClick={search}
          disabled={loading}
          className="px-4 py-2 rounded-lg bg-cyan-500 text-slate-950 text-sm font-semibold hover:bg-cyan-400 transition-colors disabled:opacity-50 flex items-center gap-1.5"
        >
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
          Search
        </button>
      </div>
      {results.length > 0 && (
        <div className="flex flex-col gap-1.5 max-h-64 overflow-y-auto">
          {results.map((m) => (
            <button
              key={m.condition_id}
              onClick={() => onSelect(m)}
              className="text-left px-3 py-2.5 rounded-lg bg-slate-800/60 border border-slate-700/50 hover:border-cyan-500/30 hover:bg-cyan-500/5 transition-all"
            >
              <p className="text-sm text-slate-100 line-clamp-2">{m.question}</p>
              <div className="flex items-center gap-3 mt-1 text-[10px] text-slate-500">
                <span>Vol: ${m.volume.toLocaleString()}</span>
                <span>Ends: {m.end_date?.slice(0, 10) ?? "—"}</span>
                <span className="font-mono text-slate-600">{m.condition_id.slice(0, 12)}…</span>
              </div>
            </button>
          ))}
        </div>
      )}
      {!loading && searched && results.length === 0 && (
        <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-slate-800/60 border border-slate-700/50 text-xs text-slate-400">
          {error ? (
            <>
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              Search failed — the signal service is unreachable. Try again.
            </>
          ) : (
            <>No markets found for &ldquo;{q}&rdquo;.</>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Bot config ───────────────────────────────────────────────────────────────
function BotConfigurator({ market, onStart }: { market: Market; onStart: () => void }) {
  const [threshold, setThreshold] = useState(0.40);
  const [edge, setEdge] = useState(0.08);
  const [size, setSize] = useState(10);
  const [cooldown, setCooldown] = useState(60);
  const [starting, setStarting] = useState(false);

  const breakeven = threshold;
  const minWinRate = breakeven + edge;

  const start = async () => {
    setStarting(true);
    await apiFetch("/bot/start", {
      method: "POST",
      body: JSON.stringify({
        market_id: market.condition_id,
        entry_threshold: threshold,
        min_win_rate_edge: edge,
        size_usdc: size,
        cooldown_seconds: cooldown,
        mode: "dry_run",
      }),
    });
    setStarting(false);
    onStart();
  };

  return (
    <div className="card-dark p-5 flex flex-col gap-4">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-100">Configure Bot</h2>
          <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{market.question}</p>
        </div>
        <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-amber-500/10 border border-amber-500/20">
          <Shield className="w-3 h-3 text-amber-400" />
          <span className="text-[10px] text-amber-300 font-bold uppercase">Dry Run Only</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label={`Entry Threshold: ${threshold}`}>
          <input type="range" min={0.05} max={0.60} step={0.01} value={threshold}
            onChange={(e) => setThreshold(+e.target.value)}
            className="w-full accent-cyan-500" />
        </Field>
        <Field label={`Min Edge: ${(edge * 100).toFixed(0)}%`}>
          <input type="range" min={0.02} max={0.20} step={0.01} value={edge}
            onChange={(e) => setEdge(+e.target.value)}
            className="w-full accent-violet-500" />
        </Field>
        <Field label="Bet Size (USDC)">
          <input type="number" value={size} min={1} max={1000}
            onChange={(e) => setSize(+e.target.value)}
            className="bg-slate-800 border border-slate-700 rounded-md px-2 py-1.5 text-sm text-slate-200 w-full outline-none focus:border-cyan-500" />
        </Field>
        <Field label="Cooldown (seconds)">
          <input type="number" value={cooldown} min={10} max={3600}
            onChange={(e) => setCooldown(+e.target.value)}
            className="bg-slate-800 border border-slate-700 rounded-md px-2 py-1.5 text-sm text-slate-200 w-full outline-none focus:border-cyan-500" />
        </Field>
      </div>

      <div className="flex gap-3 text-xs bg-slate-900 rounded-lg p-3 border border-slate-800">
        <div className="flex-1">
          <p className="text-slate-500 uppercase tracking-widest text-[10px] font-bold">Breakeven Win Rate</p>
          <p className="text-slate-100 font-semibold number-font mt-0.5">{(breakeven * 100).toFixed(0)}%</p>
        </div>
        <div className="flex-1">
          <p className="text-slate-500 uppercase tracking-widest text-[10px] font-bold">Min Win Rate Needed</p>
          <p className="text-cyan-300 font-semibold number-font mt-0.5">{(minWinRate * 100).toFixed(0)}%</p>
        </div>
        <div className="flex-1">
          <p className="text-slate-500 uppercase tracking-widest text-[10px] font-bold">Max Bet</p>
          <p className="text-slate-100 font-semibold number-font mt-0.5">${size}</p>
        </div>
      </div>

      <button
        onClick={start}
        disabled={starting}
        className="w-full py-2.5 rounded-lg bg-cyan-500 text-slate-950 text-sm font-semibold hover:bg-cyan-400 transition-colors disabled:opacity-50 flex items-center justify-center gap-2 shadow-[0_0_20px_-5px_rgba(34,211,238,0.4)]"
      >
        {starting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
        Start Dry Run
      </button>
    </div>
  );
}

// ─── Live bot monitor ─────────────────────────────────────────────────────────
function BotMonitor({ marketId, onStop }: { marketId: string; onStop: () => void }) {
  const [status, setStatus] = useState<BotStatus | null>(null);
  const [ledger, setLedger] = useState<{ summary: LedgerSummary; recent_trades: Trade[] } | null>(null);
  const [stopping, setStopping] = useState(false);

  const refresh = useCallback(async () => {
    const [s, l] = await Promise.all([
      apiFetch<BotStatus>(`/bot/${marketId}/status`),
      apiFetch<{ summary: LedgerSummary; recent_trades: Trade[] }>("/ledger/summary").then(async (sum) => {
        const trades = await apiFetch<Trade[]>("/ledger/trades?n=10");
        return sum ? { summary: sum as unknown as LedgerSummary, recent_trades: trades ?? [] } : null;
      }),
    ]);
    setStatus(s);
    setLedger(l);
  }, [marketId]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 3000);
    return () => clearInterval(id);
  }, [refresh]);

  const stop = async () => {
    setStopping(true);
    await apiFetch(`/bot/${marketId}/stop`, { method: "POST" });
    setStopping(false);
    onStop();
  };

  if (!status) return <div className="card-dark p-6 flex items-center gap-2 text-slate-400 text-sm"><Loader2 className="w-4 h-4 animate-spin" />Loading…</div>;

  const pnl = ledger?.summary.total_pnl_usdc ?? 0;

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="card-dark p-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={cn("w-2.5 h-2.5 rounded-full", status.mode === "live" ? "bg-emerald-400 animate-pulse" : status.mode === "dry_run" ? "bg-amber-400 animate-pulse" : "bg-slate-600")} />
          <div>
            <p className="text-sm font-semibold text-slate-100 line-clamp-1">{status.question ?? marketId}</p>
            <p className="text-[10px] text-slate-500">Uptime {Math.floor(status.uptime_s / 60)}m {Math.floor(status.uptime_s % 60)}s</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ModeBadge mode={status.mode} />
          <button onClick={refresh} className="p-1.5 rounded text-slate-500 hover:text-slate-200 transition-colors">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
          <button onClick={stop} disabled={stopping}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-colors disabled:opacity-50">
            {stopping ? <Loader2 className="w-3 h-3 animate-spin" /> : <Square className="w-3 h-3" />}Stop
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Ticks" value={status.ticks.toLocaleString()} icon={Activity} />
        <Stat label="Trades" value={status.trades.toString()} icon={BarChart3} />
        <Stat label="Last Price" value={status.last_price != null ? `${(status.last_price * 100).toFixed(1)}¢` : "—"} icon={TrendingUp} />
        <Stat label="P&L" value={`${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)}`}
          icon={Wallet} accent={pnl > 0 ? "text-emerald-400" : pnl < 0 ? "text-red-400" : undefined} />
      </div>

      {/* Last decision */}
      {status.last_decision && (
        <div className="card-dark px-4 py-3 flex items-center gap-2 text-sm">
          <span className="text-slate-500 text-xs uppercase tracking-widest font-bold shrink-0">Last:</span>
          <span className="text-slate-300">{status.last_decision}</span>
        </div>
      )}

      {/* Feed health */}
      {status.feeds.length > 0 && (
        <div className="card-dark p-4">
          <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-3">Feed Health</p>
          <div className="flex gap-4">
            {status.feeds.map((f) => (
              <div key={f.feed_id} className="flex-1 bg-slate-900 rounded-lg p-3 border border-slate-800">
                <p className="text-[10px] text-slate-500 uppercase font-bold">Feed {f.feed_id}</p>
                <p className="text-sm text-slate-100 number-font mt-0.5">{f.ticks} ticks</p>
                <p className="text-[10px] text-slate-500 mt-0.5">
                  {f.rejected} rejected · {f.latency_ms}ms
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Trade log */}
      {ledger && ledger.recent_trades.length > 0 && (
        <div className="card-dark p-4">
          <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-3">Recent Trades</p>
          <div className="flex flex-col divide-y divide-slate-800/60">
            {ledger.recent_trades.map((t) => (
              <div key={t.id} className="flex items-center gap-3 py-2.5">
                <div className={cn("w-6 h-6 rounded flex items-center justify-center",
                  t.side === "YES" ? "bg-emerald-500/15" : "bg-red-500/15")}>
                  {t.side === "YES" ? <TrendingUp className="w-3 h-3 text-emerald-400" /> : <TrendingDown className="w-3 h-3 text-red-400" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-slate-200 line-clamp-1">{t.question}</p>
                  <p className="text-[10px] text-slate-500">{t.side} @ {(t.entry_price * 100).toFixed(1)}¢ · EV {t.expected_value > 0 ? "+" : ""}{t.expected_value.toFixed(3)}</p>
                </div>
                <div className="text-right shrink-0">
                  <StatusIcon status={t.status} />
                  {t.pnl_usdc !== 0 && (
                    <p className={cn("text-xs font-semibold number-font", t.pnl_usdc > 0 ? "text-emerald-400" : "text-red-400")}>
                      {t.pnl_usdc > 0 ? "+" : ""}${t.pnl_usdc.toFixed(2)}
                    </p>
                  )}
                  {t.dry_run && <p className="text-[9px] text-amber-500 uppercase">dry</p>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StatusIcon({ status }: { status: string }) {
  if (status === "resolved_win") return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 ml-auto" />;
  if (status === "resolved_loss") return <AlertTriangle className="w-3.5 h-3.5 text-red-400 ml-auto" />;
  if (status === "open" || status === "filled") return <Loader2 className="w-3.5 h-3.5 text-slate-500 animate-spin ml-auto" />;
  return <Minus className="w-3.5 h-3.5 text-slate-600 ml-auto" />;
}

function Stat({ label, value, icon: Icon, accent }: { label: string; value: string; icon: React.ElementType; accent?: string }) {
  return (
    <div className="card-dark p-3">
      <div className="flex items-center gap-1.5 mb-1">
        <Icon className="w-3 h-3 text-slate-500" />
        <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">{label}</p>
      </div>
      <p className={cn("text-xl font-bold number-font", accent ?? "text-slate-100")}>{value}</p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">{label}</label>
      {children}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PolymarketPage() {
  const [selectedMarket, setSelectedMarket] = useState<Market | null>(null);
  const [activeMarketId, setActiveMarketId] = useState<string | null>(null);
  const [view, setView] = useState<"search" | "configure" | "monitor">("search");

  const handleSelect = (m: Market) => {
    setSelectedMarket(m);
    setView("configure");
  };

  const handleStart = () => {
    if (!selectedMarket) return;
    setActiveMarketId(selectedMarket.condition_id);
    setView("monitor");
  };

  const handleStop = () => {
    setView("search");
    setActiveMarketId(null);
    setSelectedMarket(null);
  };

  return (
      <div className="flex flex-col gap-6 p-6 max-w-[1200px] mx-auto">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-50 tracking-tight">Polymarket Bot</h1>
            <p className="text-sm text-slate-400 mt-1">
              Clean-feed · EV-gated entries · Dry run first · Full trade ledger
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs">
            {(["search", "configure", "monitor"] as const).map((step, i) => (
              <div key={step} className="flex items-center gap-2">
                <div className={cn("w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold border",
                  view === step ? "bg-cyan-500/20 border-cyan-500/40 text-cyan-300" :
                  (["search", "configure", "monitor"].indexOf(view) > i) ? "bg-slate-800 border-slate-700 text-slate-400" :
                  "bg-slate-900 border-slate-800 text-slate-600")}>
                  {i + 1}
                </div>
                <span className={cn("capitalize hidden sm:block",
                  view === step ? "text-cyan-300" : "text-slate-600")}>{step}</span>
                {i < 2 && <span className="text-slate-700">→</span>}
              </div>
            ))}
          </div>
        </div>

        {view === "search" && <MarketSearch onSelect={handleSelect} />}
        {view === "configure" && selectedMarket && (
          <BotConfigurator market={selectedMarket} onStart={handleStart} />
        )}
        {view === "monitor" && activeMarketId && (
          <BotMonitor marketId={activeMarketId} onStop={handleStop} />
        )}

        {/* Always show instructions */}
        <div className="card-dark p-5 border-l-2 border-cyan-500/30">
          <p className="text-xs font-bold text-cyan-300 uppercase tracking-widest mb-2">Discipline Rules</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-xs text-slate-400">
            {[
              "Always start in Dry Run — never skip it",
              "Two parallel feeds, consensus-only ticks",
              "Every trade gated by breakeven math",
              "Start simple: one market, one signal",
              "Optimize for EV per trade, not win rate",
              "Set POLYMARKET_DRY_RUN=false only when ready",
            ].map((r) => (
              <div key={r} className="flex gap-2">
                <span className="text-cyan-500 shrink-0">·</span>
                <span>{r}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
  );
}
