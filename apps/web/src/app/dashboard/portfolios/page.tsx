"use client";

import { useEffect, useState, useCallback } from "react";
import { Plus, MoreHorizontal, TrendingUp, TrendingDown, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Types ───────────────────────────────────────────────────────────────────

interface Holding {
  symbol: string;
  quantity: number;
  avg_cost: number;
}

interface Portfolio {
  id: string;
  name: string;
  description: string;
  strategyType: "manual" | "copy" | "automated";
  riskLevel: "low" | "medium" | "high";
  holdings: Holding[];
}

interface LivePrice {
  symbol: string;
  price_usd: number;
  change_24h_pct: number;
}

// ─── localStorage persistence ────────────────────────────────────────────────

const STORAGE_KEY = "bitprivat_portfolios";

function loadPortfolios(): Portfolio[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  // Default starter portfolio
  return [
    {
      id: "p1",
      name: "Main Portfolio",
      description: "Primary trading book",
      strategyType: "manual",
      riskLevel: "medium",
      holdings: [
        { symbol: "BTC", quantity: 0.5, avg_cost: 65000 },
        { symbol: "ETH", quantity: 5, avg_cost: 3200 },
        { symbol: "SOL", quantity: 20, avg_cost: 150 },
      ],
    },
  ];
}

function savePortfolios(portfolios: Portfolio[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(portfolios));
}

// ─── Component ───────────────────────────────────────────────────────────────

const riskColors = {
  low:    "bg-emerald-500/15 text-emerald-400",
  medium: "bg-amber-500/15 text-amber-400",
  high:   "bg-red-500/15 text-red-400",
};

const strategyColors = {
  manual:    "bg-slate-700/30 text-slate-300",
  copy:      "bg-cyan-500/15 text-cyan-400",
  automated: "bg-violet-500/15 text-violet-400",
};

export default function PortfoliosPage() {
  const [portfolios, setPortfolios] = useState<Portfolio[]>([]);
  const [prices, setPrices] = useState<Record<string, LivePrice>>({});
  const [showCreate, setShowCreate] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setPortfolios(loadPortfolios());
    setMounted(true);
  }, []);

  useEffect(() => {
    if (portfolios.length > 0 && mounted) savePortfolios(portfolios);
  }, [portfolios, mounted]);

  // Fetch real prices
  const fetchPrices = useCallback(async () => {
    const allSymbols = new Set<string>();
    for (const p of portfolios) {
      for (const h of p.holdings) allSymbols.add(h.symbol);
    }
    if (allSymbols.size === 0) return;
    try {
      const res = await fetch(`/api/market/crypto?symbols=${[...allSymbols].join(",")}`);
      const env = await res.json();
      if (env.data && Array.isArray(env.data)) {
        const map: Record<string, LivePrice> = {};
        for (const c of env.data) {
          map[c.symbol.toUpperCase()] = {
            symbol: c.symbol.toUpperCase(),
            price_usd: c.price_usd,
            change_24h_pct: c.change_24h_pct ?? 0,
          };
        }
        setPrices(map);
      }
    } catch { /* silent */ }
  }, [portfolios]);

  useEffect(() => {
    fetchPrices();
    const id = setInterval(fetchPrices, 30_000);
    return () => clearInterval(id);
  }, [fetchPrices]);

  // Computed values
  function portfolioValue(p: Portfolio): number {
    return p.holdings.reduce((sum, h) => {
      const price = prices[h.symbol]?.price_usd ?? h.avg_cost;
      return sum + h.quantity * price;
    }, 0);
  }
  function portfolioCost(p: Portfolio): number {
    return p.holdings.reduce((sum, h) => sum + h.quantity * h.avg_cost, 0);
  }
  function portfolioPnlPct(p: Portfolio): number {
    const cost = portfolioCost(p);
    if (cost === 0) return 0;
    return ((portfolioValue(p) - cost) / cost) * 100;
  }

  const totalValue = portfolios.reduce((s, p) => s + portfolioValue(p), 0);
  const totalCost = portfolios.reduce((s, p) => s + portfolioCost(p), 0);
  const totalPnl = totalCost > 0 ? ((totalValue - totalCost) / totalCost) * 100 : 0;
  const totalPositions = portfolios.reduce((s, p) => s + p.holdings.length, 0);

  function addPortfolio(name: string, desc: string, strategy: Portfolio["strategyType"], risk: Portfolio["riskLevel"]) {
    setPortfolios((prev) => [...prev, {
      id: `p${Date.now()}`, name, description: desc,
      strategyType: strategy, riskLevel: risk, holdings: [],
    }]);
    setShowCreate(false);
  }

  function removePortfolio(id: string) {
    setPortfolios((prev) => prev.filter((p) => p.id !== id));
  }

  if (!mounted) return null;

  return (
      <div className="flex flex-col gap-6 p-6 max-w-[1600px] mx-auto">
        <div className="flex items-end justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-50 tracking-tight">Portfolios</h1>
            <p className="text-sm text-slate-400 mt-1">
              Track your holdings with real-time prices from CoinGecko.
            </p>
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-cyan-500 text-slate-950 text-sm font-semibold hover:bg-cyan-400 transition-colors shadow-[0_0_20px_-5px_rgba(34,211,238,0.5)]"
          >
            <Plus className="w-4 h-4" />
            New Portfolio
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Stat label="Total Value" value={`$${totalValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}`} />
          <Stat label="Portfolios" value={`${portfolios.length}`} />
          <Stat label="Holdings" value={`${totalPositions}`} />
          <Stat label="Total P&L" value={`${totalPnl >= 0 ? "+" : ""}${totalPnl.toFixed(1)}%`} accent={totalPnl >= 0 ? "text-emerald-400" : "text-red-400"} />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {portfolios.map((p) => {
            const value = portfolioValue(p);
            const pnl = portfolioPnlPct(p);
            const isProfit = pnl >= 0;
            const allocation = totalValue > 0 ? (value / totalValue) * 100 : 0;
            return (
              <div key={p.id} className="card-dark glow-card p-5 flex flex-col gap-4">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <p className="text-base font-bold text-slate-100 truncate">{p.name}</p>
                    <p className="text-xs text-slate-500 leading-relaxed mt-1 line-clamp-2">{p.description}</p>
                  </div>
                  <button
                    onClick={() => removePortfolio(p.id)}
                    className="w-7 h-7 flex items-center justify-center rounded-md text-slate-600 hover:text-red-400 hover:bg-slate-800 transition-colors shrink-0"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="flex items-center gap-1.5">
                  <span className={cn("text-[10px] font-bold uppercase px-1.5 py-0.5 rounded", strategyColors[p.strategyType])}>
                    {p.strategyType}
                  </span>
                  <span className={cn("text-[10px] font-bold uppercase px-1.5 py-0.5 rounded", riskColors[p.riskLevel])}>
                    {p.riskLevel} risk
                  </span>
                </div>

                <div className="flex items-end justify-between">
                  <div>
                    <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">Value</p>
                    <p className="text-2xl font-bold text-slate-50 number-font mt-0.5">${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">P&L</p>
                    <p className={cn("text-base font-bold number-font flex items-center justify-end gap-1", isProfit ? "text-emerald-400" : "text-red-400")}>
                      {isProfit ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                      {isProfit ? "+" : ""}{pnl.toFixed(1)}%
                    </p>
                  </div>
                </div>

                {/* Holdings list */}
                {p.holdings.length > 0 && (
                  <div className="space-y-1 text-xs">
                    {p.holdings.map((h) => {
                      const lp = prices[h.symbol];
                      const cur = lp?.price_usd ?? h.avg_cost;
                      const hPnl = ((cur - h.avg_cost) / h.avg_cost) * 100;
                      return (
                        <div key={h.symbol} className="flex justify-between items-center bg-slate-950 rounded px-2 py-1 border border-slate-800/40">
                          <span className="font-medium text-slate-200">{h.symbol}</span>
                          <span className="text-slate-400 number-font">{h.quantity}</span>
                          <span className="text-slate-300 number-font">${cur.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                          <span className={cn("number-font", hPnl >= 0 ? "text-emerald-400" : "text-red-400")}>
                            {hPnl >= 0 ? "+" : ""}{hPnl.toFixed(1)}%
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}

                <div>
                  <div className="flex items-center justify-between mb-1.5 text-[10px] text-slate-500 uppercase tracking-widest font-bold">
                    <span>Allocation</span>
                    <span className="number-font">{allocation.toFixed(1)}%</span>
                  </div>
                  <div className="w-full h-1 bg-slate-800 rounded-full overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-cyan-500 to-blue-500" style={{ width: `${Math.min(allocation, 100)}%` }} />
                  </div>
                </div>

                <div className="flex items-center justify-between text-[11px] text-slate-500 pt-2 border-t border-slate-800/60">
                  <span>{p.holdings.length} holdings</span>
                </div>
              </div>
            );
          })}

          <button
            onClick={() => setShowCreate(true)}
            className="card-dark border-dashed flex flex-col items-center justify-center p-12 hover:border-cyan-500/30 transition-colors group min-h-[280px]"
          >
            <div className="w-12 h-12 rounded-full bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center mb-3 group-hover:bg-cyan-500/20 transition-colors">
              <Plus className="w-5 h-5 text-cyan-400" />
            </div>
            <p className="text-sm font-semibold text-slate-300">New Portfolio</p>
            <p className="text-xs text-slate-500 mt-1">Start a fresh strategy book</p>
          </button>
        </div>

        {showCreate && <CreateDialog onClose={() => setShowCreate(false)} onCreate={addPortfolio} />}
      </div>
  );
}

function CreateDialog({ onClose, onCreate }: {
  onClose: () => void;
  onCreate: (name: string, desc: string, strategy: Portfolio["strategyType"], risk: Portfolio["riskLevel"]) => void;
}) {
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [strategy, setStrategy] = useState<Portfolio["strategyType"]>("manual");
  const [risk, setRisk] = useState<Portfolio["riskLevel"]>("medium");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 w-full max-w-md space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-100">New Portfolio</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300"><X className="w-4 h-4" /></button>
        </div>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Portfolio name"
          className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200 outline-none focus:border-cyan-500" />
        <input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Description (optional)"
          className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200 outline-none focus:border-cyan-500" />
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div>
            <p className="text-slate-500 mb-1 uppercase tracking-wider">Strategy</p>
            {(["manual", "copy", "automated"] as const).map((s) => (
              <label key={s} className="flex items-center gap-2 py-1 cursor-pointer">
                <input type="radio" checked={strategy === s} onChange={() => setStrategy(s)}
                  className="accent-cyan-400" />
                <span className="text-slate-300 capitalize">{s}</span>
              </label>
            ))}
          </div>
          <div>
            <p className="text-slate-500 mb-1 uppercase tracking-wider">Risk</p>
            {(["low", "medium", "high"] as const).map((r) => (
              <label key={r} className="flex items-center gap-2 py-1 cursor-pointer">
                <input type="radio" checked={risk === r} onChange={() => setRisk(r)}
                  className="accent-cyan-400" />
                <span className="text-slate-300 capitalize">{r}</span>
              </label>
            ))}
          </div>
        </div>
        <button
          disabled={!name.trim()}
          onClick={() => onCreate(name.trim(), desc.trim(), strategy, risk)}
          className="w-full py-2 rounded-lg bg-cyan-500 text-slate-950 font-semibold text-sm hover:bg-cyan-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Create Portfolio
        </button>
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="card-dark p-4">
      <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">{label}</p>
      <p className={cn("text-xl font-bold number-font mt-1", accent ?? "text-slate-100")}>{value}</p>
    </div>
  );
}
