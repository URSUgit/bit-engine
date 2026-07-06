"use client";

import { useState } from "react";
import { backtestApi, type SymbolScanEntry, type StrategyInfo } from "@/lib/backtest-api";

const DEFAULT_SYMBOLS = [
  "BTC-USD", "ETH-USD", "SOL-USD", "BNB-USD", "AVAX-USD",
  "ADA-USD", "DOT-USD", "LINK-USD", "MATIC-USD", "ATOM-USD",
  "AAPL", "TSLA", "NVDA", "SPY", "GLD",
];

const SIGNAL_STYLE: Record<string, { bg: string; text: string; label: string }> = {
  buy:   { bg: "bg-emerald-900/50", text: "text-emerald-300", label: "BUY" },
  sell:  { bg: "bg-red-900/50",     text: "text-red-300",     label: "SELL" },
  short: { bg: "bg-red-900/50",     text: "text-red-300",     label: "SHORT" },
  close: { bg: "bg-yellow-900/50",  text: "text-yellow-300",  label: "CLOSE" },
  hold:  { bg: "bg-zinc-900/30",    text: "text-zinc-500",    label: "HOLD" },
};

function fmt(n: number | null, dec = 2, prefix = ""): string {
  if (n === null) return "—";
  return `${n >= 0 ? prefix : ""}${n.toFixed(dec)}`;
}

function retColor(pct: number): string {
  if (pct > 3) return "text-emerald-300";
  if (pct > 0) return "text-emerald-500";
  if (pct > -3) return "text-red-500";
  return "text-red-400";
}

export interface SymbolScannerProps {
  strategies: StrategyInfo[];
  interval: string;
  onSelectSymbol?: (sym: string) => void;
}

export function SymbolScanner({ strategies, interval, onSelectSymbol }: SymbolScannerProps) {
  const [selectedStrategy, setSelectedStrategy] = useState("rsi");
  const [symbolsInput, setSymbolsInput] = useState(DEFAULT_SYMBOLS.join(", "));
  const [results, setResults] = useState<SymbolScanEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [filterSignal, setFilterSignal] = useState<"all" | "buy" | "sell">("all");
  const [sortBy, setSortBy] = useState<"symbol" | "ret5d" | "ret20d" | "signal">("signal");

  async function run() {
    const syms = symbolsInput.split(",").map((s) => s.trim()).filter(Boolean);
    if (syms.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      const r = await backtestApi.scanSymbols({ strategy: selectedStrategy, interval, symbols: syms });
      setResults(r.results);
      setLastUpdated(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  const displayed = results
    ? results
        .filter((r) => filterSignal === "all" || r.signal === filterSignal)
        .sort((a, b) => {
          if (sortBy === "signal") {
            const order = { buy: 0, sell: 1, short: 2, close: 3, hold: 4 };
            return (order[a.signal as keyof typeof order] ?? 5) - (order[b.signal as keyof typeof order] ?? 5);
          }
          if (sortBy === "ret5d") return b.ret_5d - a.ret_5d;
          if (sortBy === "ret20d") return b.ret_20d - a.ret_20d;
          return a.symbol.localeCompare(b.symbol);
        })
    : null;

  const buyCount = results?.filter((r) => r.signal === "buy").length ?? 0;
  const sellCount = results?.filter((r) => r.signal === "sell" || r.signal === "short").length ?? 0;

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-zinc-500 mb-1 block">Strategy</label>
            <select
              value={selectedStrategy}
              onChange={(e) => setSelectedStrategy(e.target.value)}
              className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-cyan-500"
            >
              {strategies
                .filter((s) => s.name !== "buy_and_hold")
                .map((s) => (
                  <option key={s.name} value={s.name}>{s.name.replace(/_/g, " ")}</option>
                ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-zinc-500 mb-1 block">Symbols (comma-separated)</label>
            <input
              value={symbolsInput}
              onChange={(e) => setSymbolsInput(e.target.value)}
              className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-cyan-500 font-mono"
              placeholder="BTC-USD, ETH-USD, AAPL..."
            />
          </div>
        </div>
        <button
          onClick={run}
          disabled={loading}
          className="w-full py-2.5 rounded-md bg-cyan-600 hover:bg-cyan-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white font-semibold text-sm transition"
        >
          {loading ? "Scanning…" : "Scan Symbols"}
        </button>
        {error && <div className="text-sm text-red-400 bg-red-950/30 border border-red-900 p-2 rounded">{error}</div>}
      </div>

      {/* Results */}
      {displayed && (
        <div className="space-y-3">
          {/* Summary row */}
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3 text-sm">
              <span className="text-emerald-400 font-medium">{buyCount} buy</span>
              <span className="text-red-400 font-medium">{sellCount} sell</span>
              <span className="text-zinc-500">{(results?.length ?? 0) - buyCount - sellCount} hold</span>
              {lastUpdated && <span className="text-xs text-zinc-600">· {lastUpdated.toLocaleTimeString()}</span>}
            </div>
            <div className="flex items-center gap-2">
              <div className="flex rounded-md overflow-hidden border border-zinc-700 text-xs">
                {(["all", "buy", "sell"] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setFilterSignal(f)}
                    className={`px-3 py-1.5 capitalize transition ${filterSignal === f ? "bg-zinc-700 text-zinc-100" : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800"}`}
                  >
                    {f}
                  </button>
                ))}
              </div>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-300 focus:outline-none focus:border-cyan-500"
              >
                <option value="signal">Sort: Signal</option>
                <option value="ret5d">Sort: 5d Return</option>
                <option value="ret20d">Sort: 20d Return</option>
                <option value="symbol">Sort: Symbol</option>
              </select>
            </div>
          </div>

          {/* Grid */}
          <div className="grid gap-2 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {displayed.map((r) => {
              const style = SIGNAL_STYLE[r.signal] ?? SIGNAL_STYLE.hold;
              const isActive = r.signal === "buy" || r.signal === "sell" || r.signal === "short";
              return (
                <div
                  key={r.symbol}
                  className={`${style.bg} border ${isActive ? "border-zinc-600" : "border-zinc-800/50"} rounded-lg p-3 space-y-2 ${onSelectSymbol ? "cursor-pointer hover:border-zinc-500 transition" : ""}`}
                  onClick={() => onSelectSymbol?.(r.symbol)}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono font-semibold text-sm text-zinc-200">{r.symbol}</span>
                    <span className={`text-xs font-bold px-2 py-0.5 rounded border ${style.text} border-current/30`}>
                      {style.label}
                    </span>
                  </div>
                  {r.error ? (
                    <div className="text-xs text-zinc-600 truncate">{r.error}</div>
                  ) : (
                    <div className="grid grid-cols-3 gap-1 text-xs">
                      <div>
                        <div className="text-zinc-600">Price</div>
                        <div className="text-zinc-300">{r.close != null ? `$${r.close.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : "—"}</div>
                      </div>
                      <div>
                        <div className="text-zinc-600">5d</div>
                        <div className={retColor(r.ret_5d)}>{r.ret_5d >= 0 ? "+" : ""}{r.ret_5d.toFixed(1)}%</div>
                      </div>
                      <div>
                        <div className="text-zinc-600">20d</div>
                        <div className={retColor(r.ret_20d)}>{r.ret_20d >= 0 ? "+" : ""}{r.ret_20d.toFixed(1)}%</div>
                      </div>
                    </div>
                  )}
                  {isActive && r.entry_price != null && (
                    <div className="flex gap-2 text-xs border-t border-zinc-800/50 pt-1.5">
                      <span className="text-zinc-500">Entry</span>
                      <span className="text-zinc-300 font-mono">${r.entry_price.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                      {r.tp_price != null && <span className="text-emerald-500 font-mono">TP ${r.tp_price.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
