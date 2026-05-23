"use client";

import { useState } from "react";
import { X, Plus, RefreshCw, TrendingUp, TrendingDown, ChevronDown } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { usePaperTrading, type PaperSide } from "@/hooks/usePaperTrading";
import { cn } from "@/lib/utils";

const SYMBOLS = ["BTC","ETH","SOL","BNB","XRP","ADA","DOGE","AVAX","MATIC","DOT","LINK","LTC","ATOM","UNI","ARB","OP"];
const LEVERAGES = [1, 2, 5, 10, 20] as const;

function fmtPrice(p: number) {
  if (p >= 1000) return p.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (p >= 1) return p.toFixed(4);
  return p.toFixed(6);
}

function StatCard({ label, value, sub, positive }: { label: string; value: string; sub?: string; positive?: boolean }) {
  return (
    <div className="card-dark p-4">
      <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">{label}</p>
      <p className={cn("text-xl font-bold number-font mt-1",
        positive === true ? "text-emerald-400" : positive === false ? "text-red-400" : "text-slate-100"
      )}>{value}</p>
      {sub && <p className="text-[11px] text-slate-500 mt-0.5 number-font">{sub}</p>}
    </div>
  );
}

function OrderDialog({ prices, onClose, onPlace }: {
  prices: Record<string, number>;
  onClose: () => void;
  onPlace: (params: { symbol: string; side: PaperSide; size_usd: number; leverage: number; take_profit?: number | null; stop_loss?: number | null }) => { error?: string };
}) {
  const [symbol, setSymbol] = useState("BTC");
  const [side, setSide] = useState<PaperSide>("long");
  const [sizeUsd, setSizeUsd] = useState("100");
  const [leverage, setLeverage] = useState<number>(5);
  const [tp, setTp] = useState("");
  const [sl, setSl] = useState("");
  const [error, setError] = useState("");
  const [showSymbols, setShowSymbols] = useState(false);

  const currentPrice = prices[symbol] ?? 0;

  function submit() {
    const size = parseFloat(sizeUsd);
    if (!size || size <= 0) { setError("Enter a valid size"); return; }
    const result = onPlace({
      symbol,
      side,
      size_usd: size,
      leverage,
      take_profit: tp ? parseFloat(tp) : null,
      stop_loss: sl ? parseFloat(sl) : null,
    });
    if (result.error) { setError(result.error); return; }
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-sm mx-4 p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-bold text-slate-50">New Paper Trade</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300"><X className="w-4 h-4" /></button>
        </div>

        {/* Symbol picker */}
        <div className="mb-4 relative">
          <label className="text-[10px] uppercase tracking-widest text-slate-500 font-bold block mb-1.5">Asset</label>
          <button
            onClick={() => setShowSymbols(!showSymbols)}
            className="w-full flex items-center justify-between px-3 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-sm font-mono text-slate-100 hover:border-slate-600 transition-colors"
          >
            <span>{symbol} {currentPrice > 0 && <span className="text-slate-400">${fmtPrice(currentPrice)}</span>}</span>
            <ChevronDown className="w-4 h-4 text-slate-500" />
          </button>
          {showSymbols && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-slate-800 border border-slate-700 rounded-lg z-10 p-2 grid grid-cols-4 gap-1 max-h-40 overflow-y-auto">
              {SYMBOLS.map((s) => (
                <button key={s} onClick={() => { setSymbol(s); setShowSymbols(false); }}
                  className={cn("px-2 py-1.5 text-xs font-mono rounded hover:bg-slate-700 transition-colors",
                    s === symbol ? "bg-slate-700 text-cyan-300" : "text-slate-300")}>
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Long / Short */}
        <div className="mb-4">
          <label className="text-[10px] uppercase tracking-widest text-slate-500 font-bold block mb-1.5">Direction</label>
          <div className="flex rounded-lg overflow-hidden border border-slate-700">
            <button onClick={() => setSide("long")}
              className={cn("flex-1 py-2.5 text-sm font-bold transition-colors",
                side === "long" ? "bg-emerald-500/20 text-emerald-400" : "bg-slate-800 text-slate-500 hover:text-slate-300")}>
              Long
            </button>
            <button onClick={() => setSide("short")}
              className={cn("flex-1 py-2.5 text-sm font-bold transition-colors border-l border-slate-700",
                side === "short" ? "bg-red-500/20 text-red-400" : "bg-slate-800 text-slate-500 hover:text-slate-300")}>
              Short
            </button>
          </div>
        </div>

        {/* Size */}
        <div className="mb-4">
          <label className="text-[10px] uppercase tracking-widest text-slate-500 font-bold block mb-1.5">Size (USD)</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">$</span>
            <input value={sizeUsd} onChange={(e) => setSizeUsd(e.target.value)} type="number" min="1"
              className="w-full pl-7 pr-3 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-100 number-font focus:outline-none focus:border-cyan-500/50 transition-colors" />
          </div>
        </div>

        {/* Leverage */}
        <div className="mb-4">
          <label className="text-[10px] uppercase tracking-widest text-slate-500 font-bold block mb-1.5">Leverage</label>
          <div className="flex gap-1.5">
            {LEVERAGES.map((l) => (
              <button key={l} onClick={() => setLeverage(l)}
                className={cn("flex-1 py-2 text-xs font-bold rounded-lg transition-colors",
                  leverage === l ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40" : "bg-slate-800 text-slate-500 hover:text-slate-300 border border-slate-700")}>
                {l}×
              </button>
            ))}
          </div>
        </div>

        {/* TP / SL */}
        <div className="grid grid-cols-2 gap-3 mb-5">
          <div>
            <label className="text-[10px] uppercase tracking-widest text-slate-500 font-bold block mb-1.5">Take Profit</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-xs">$</span>
              <input value={tp} onChange={(e) => setTp(e.target.value)} type="number" placeholder="optional"
                className="w-full pl-6 pr-2 py-2 bg-slate-800 border border-slate-700 rounded-lg text-xs text-slate-100 number-font focus:outline-none focus:border-emerald-500/50 transition-colors placeholder:text-slate-600" />
            </div>
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-widest text-slate-500 font-bold block mb-1.5">Stop Loss</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-xs">$</span>
              <input value={sl} onChange={(e) => setSl(e.target.value)} type="number" placeholder="optional"
                className="w-full pl-6 pr-2 py-2 bg-slate-800 border border-slate-700 rounded-lg text-xs text-slate-100 number-font focus:outline-none focus:border-red-500/50 transition-colors placeholder:text-slate-600" />
            </div>
          </div>
        </div>

        {error && <p className="text-xs text-red-400 mb-3 bg-red-500/10 px-3 py-2 rounded-lg">{error}</p>}

        <div className="text-[11px] text-slate-500 mb-4 bg-slate-800/50 px-3 py-2 rounded-lg">
          Margin required: <span className="text-slate-300 font-mono">${(parseFloat(sizeUsd || "0") / leverage).toFixed(2)}</span>
          {currentPrice > 0 && (
            <span className="ml-3">Qty: <span className="text-slate-300 font-mono">{(parseFloat(sizeUsd || "0") * leverage / currentPrice).toFixed(4)}</span></span>
          )}
        </div>

        <button onClick={submit}
          className={cn("w-full py-3 rounded-xl text-sm font-bold transition-colors",
            side === "long"
              ? "bg-emerald-500 hover:bg-emerald-400 text-white"
              : "bg-red-500 hover:bg-red-400 text-white")}>
          Open {side === "long" ? "Long" : "Short"} · {leverage}×
        </button>
      </div>
    </div>
  );
}

export default function PositionsPage() {
  const { balance, equity, livePositions, closedPositions, prices, totalUnrealizedPnl, placeOrder, closePos, resetBalance, mounted } = usePaperTrading();
  const [tab, setTab] = useState<"open" | "closed">("open");
  const [showDialog, setShowDialog] = useState(false);

  if (!mounted) return <DashboardLayout><div className="p-6 text-slate-500 text-sm">Loading…</div></DashboardLayout>;

  const winCount = closedPositions.filter((p) => (p.pnl ?? 0) > 0).length;
  const winRate = closedPositions.length > 0 ? (winCount / closedPositions.length) * 100 : 0;
  const pnlPositive = totalUnrealizedPnl >= 0;

  return (
    <DashboardLayout>
      <div className="flex flex-col gap-6 p-6 max-w-[1400px] mx-auto">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-50 tracking-tight">Paper Trading</h1>
            <p className="text-sm text-slate-400 mt-1">Practice with $10,000 virtual balance · fills at real Binance prices</p>
          </div>
          <div className="flex gap-2">
            <button onClick={resetBalance}
              className="flex items-center gap-2 px-3 py-2 text-xs font-bold text-slate-400 hover:text-slate-200 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg transition-colors">
              <RefreshCw className="w-3.5 h-3.5" />
              Reset $10K
            </button>
            <button onClick={() => setShowDialog(true)}
              className="flex items-center gap-2 px-4 py-2 text-xs font-bold text-white bg-cyan-500 hover:bg-cyan-400 rounded-lg transition-colors">
              <Plus className="w-3.5 h-3.5" />
              New Trade
            </button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label="Paper Balance" value={`$${balance.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} />
          <StatCard label="Total Equity" value={`$${equity.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} />
          <StatCard
            label="Unrealized P&L"
            value={`${pnlPositive ? "+" : ""}$${Math.abs(totalUnrealizedPnl).toFixed(2)}`}
            positive={livePositions.length > 0 ? pnlPositive : undefined}
          />
          <StatCard
            label="Win Rate"
            value={closedPositions.length > 0 ? `${winRate.toFixed(0)}%` : "—"}
            sub={closedPositions.length > 0 ? `${winCount}/${closedPositions.length} trades` : "No closed trades"}
          />
        </div>

        {/* Tabs */}
        <div className="card-dark overflow-hidden">
          <div className="flex border-b border-slate-800">
            {(["open", "closed"] as const).map((t) => (
              <button key={t} onClick={() => setTab(t)}
                className={cn("px-5 py-3 text-xs font-bold uppercase tracking-widest transition-colors",
                  tab === t ? "text-cyan-300 border-b-2 border-cyan-400 -mb-px" : "text-slate-500 hover:text-slate-300")}>
                {t} ({t === "open" ? livePositions.length : closedPositions.length})
              </button>
            ))}
          </div>

          {tab === "open" && (
            livePositions.length === 0 ? (
              <div className="py-16 text-center text-sm text-slate-500">
                No open positions · click <span className="text-cyan-400">New Trade</span> to start
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[780px]">
                  <thead>
                    <tr className="bg-slate-900/40 border-b border-slate-800">
                      {["Asset", "Side", "Size", "Lev", "Entry", "Current", "P&L", "Liq. Price", ""].map((h) => (
                        <th key={h} className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-widest text-slate-500">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {livePositions.map((p) => {
                      const isLong = p.side === "long";
                      const isProfit = p.unrealized_pnl >= 0;
                      return (
                        <tr key={p.id} className="hover:bg-slate-800/30 transition-colors">
                          <td className="px-4 py-3.5 font-mono font-medium text-slate-100">{p.symbol}</td>
                          <td className="px-4 py-3.5">
                            <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded uppercase",
                              isLong ? "bg-emerald-500/15 text-emerald-400" : "bg-red-500/15 text-red-400")}>
                              {p.side}
                            </span>
                          </td>
                          <td className="px-4 py-3.5 text-slate-300 number-font">${p.size_usd.toLocaleString()}</td>
                          <td className="px-4 py-3.5">
                            <span className="text-[10px] text-slate-400 font-mono px-1.5 py-0.5 rounded bg-slate-800">{p.leverage}×</span>
                          </td>
                          <td className="px-4 py-3.5 text-slate-400 number-font">${fmtPrice(p.entry_price)}</td>
                          <td className="px-4 py-3.5 text-slate-200 number-font">${fmtPrice(p.current_price)}</td>
                          <td className="px-4 py-3.5">
                            <div className={cn("number-font font-semibold flex items-center gap-1 text-sm", isProfit ? "text-emerald-400" : "text-red-400")}>
                              {isProfit ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                              {isProfit ? "+" : ""}${Math.abs(p.unrealized_pnl).toFixed(2)}
                              <span className="text-[10px] opacity-70 ml-1">{isProfit ? "+" : ""}{p.unrealized_pnl_pct.toFixed(2)}%</span>
                            </div>
                          </td>
                          <td className="px-4 py-3.5 text-[11px] text-slate-600 number-font">${fmtPrice(p.liq_price)}</td>
                          <td className="px-4 py-3.5">
                            <button onClick={() => closePos(p.id)}
                              className="p-1.5 rounded hover:bg-red-500/20 text-slate-600 hover:text-red-400 transition-colors">
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )
          )}

          {tab === "closed" && (
            closedPositions.length === 0 ? (
              <div className="py-16 text-center text-sm text-slate-500">No closed trades yet</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[780px]">
                  <thead>
                    <tr className="bg-slate-900/40 border-b border-slate-800">
                      {["Asset", "Side", "Size", "Lev", "Entry", "Close", "P&L", "Opened", ""].map((h) => (
                        <th key={h} className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-widest text-slate-500">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {closedPositions.map((p) => {
                      const isLong = p.side === "long";
                      const isProfit = (p.pnl ?? 0) >= 0;
                      return (
                        <tr key={p.id} className="hover:bg-slate-800/30 transition-colors opacity-80">
                          <td className="px-4 py-3.5 font-mono font-medium text-slate-300">{p.symbol}</td>
                          <td className="px-4 py-3.5">
                            <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded uppercase",
                              isLong ? "bg-emerald-500/10 text-emerald-500" : "bg-red-500/10 text-red-500")}>
                              {p.side}
                            </span>
                          </td>
                          <td className="px-4 py-3.5 text-slate-400 number-font">${p.size_usd.toLocaleString()}</td>
                          <td className="px-4 py-3.5">
                            <span className="text-[10px] text-slate-500 font-mono px-1.5 py-0.5 rounded bg-slate-800">{p.leverage}×</span>
                          </td>
                          <td className="px-4 py-3.5 text-slate-500 number-font">${fmtPrice(p.entry_price)}</td>
                          <td className="px-4 py-3.5 text-slate-400 number-font">${fmtPrice(p.close_price ?? 0)}</td>
                          <td className="px-4 py-3.5">
                            <div className={cn("number-font font-semibold text-sm", isProfit ? "text-emerald-400" : "text-red-400")}>
                              {isProfit ? "+" : ""}${Math.abs(p.pnl ?? 0).toFixed(2)}
                              <span className="text-[10px] opacity-70 ml-1">{isProfit ? "+" : ""}{(p.pnl_pct ?? 0).toFixed(2)}%</span>
                            </div>
                          </td>
                          <td className="px-4 py-3.5 text-[11px] text-slate-600">
                            {new Date(p.opened_at).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                          </td>
                          <td />
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )
          )}
        </div>
      </div>

      {showDialog && (
        <OrderDialog
          prices={prices}
          onClose={() => setShowDialog(false)}
          onPlace={(params) => {
            const result = placeOrder(params);
            return result;
          }}
        />
      )}
    </DashboardLayout>
  );
}
