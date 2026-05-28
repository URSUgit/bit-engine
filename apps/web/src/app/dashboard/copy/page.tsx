"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown, Plus, Settings2, Loader2 } from "lucide-react";
import type { TraderEntry } from "@/app/api/market/traders/route";
import { usePaperTrading } from "@/hooks/usePaperTrading";

const AVATAR_COLORS = [
  "from-cyan-500 to-blue-600",
  "from-violet-500 to-purple-600",
  "from-emerald-500 to-teal-600",
  "from-amber-500 to-orange-600",
  "from-pink-500 to-rose-600",
];

const defaultConfig = {
  allocationUsdc: 5_000,
  maxPositionSizeUsdc: 1_500,
  stopLossPct: 5,
  maxDailyLossPct: 3,
  copyLeverage: false,
};

type CopyConfig = typeof defaultConfig;

export default function CopyPage() {
  const [traders, setTraders] = useState<TraderEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [followingAddrs, setFollowingAddrs] = useState<string[]>([]);
  const [activeAddr, setActiveAddr] = useState<string>("");
  const [configs, setConfigs] = useState<Record<string, CopyConfig>>({});
  const { livePositions } = usePaperTrading();

  useEffect(() => {
    fetch("/api/market/traders?limit=20")
      .then((r) => r.json())
      .then((res: { data?: TraderEntry[] }) => {
        const list = res.data ?? [];
        setTraders(list);
        const initial = list.slice(0, 3).map((t) => t.address);
        setFollowingAddrs(initial);
        setActiveAddr(initial[0] ?? "");
        setConfigs(Object.fromEntries(initial.map((addr) => [addr, { ...defaultConfig }])));
      })
      .catch(() => setTraders([]))
      .finally(() => setLoading(false));
  }, []);

  const followed = traders.filter((t) => followingAddrs.includes(t.address));
  const activeTrader = followed.find((t) => t.address === activeAddr) ?? followed[0];
  const cfg = configs[activeAddr] ?? defaultConfig;

  const updateCfg = (patch: Partial<CopyConfig>) =>
    setConfigs((prev) => ({ ...prev, [activeAddr]: { ...(prev[activeAddr] ?? defaultConfig), ...patch } }));

  const totalAllocation = followingAddrs.reduce((s, addr) => s + (configs[addr]?.allocationUsdc ?? defaultConfig.allocationUsdc), 0);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-5 h-5 animate-spin text-slate-500" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-6 max-w-[1600px] mx-auto">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-50 tracking-tight">Copy Trading</h1>
          <p className="text-sm text-slate-400 mt-1">
            Following <span className="text-slate-200 font-semibold">{followed.length}</span> traders ·
            Total allocation <span className="text-slate-200 font-semibold number-font">${totalAllocation.toLocaleString()}</span>
          </p>
        </div>
        <button className="flex items-center gap-2 px-4 py-2 rounded-lg bg-cyan-500 text-slate-950 text-sm font-semibold hover:bg-cyan-400 transition-colors shadow-[0_0_20px_-5px_rgba(34,211,238,0.5)]">
          <Plus className="w-4 h-4" />
          Add Trader
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4">
        {/* Sidebar list */}
        <div className="card-dark p-2">
          {followed.map((t, i) => {
            const isActive = t.address === activeAddr;
            const roi = t.roi_30d;
            return (
              <button
                key={t.address}
                onClick={() => setActiveAddr(t.address)}
                className={cn(
                  "w-full text-left flex items-center gap-3 p-3 rounded-lg transition-colors",
                  isActive ? "bg-cyan-500/10 border border-cyan-500/30" : "hover:bg-slate-900 border border-transparent"
                )}
              >
                <div className={cn("w-9 h-9 rounded-full bg-gradient-to-br flex items-center justify-center text-xs font-bold text-white shrink-0", AVATAR_COLORS[i % AVATAR_COLORS.length])}>
                  {(t.handle?.[0] ?? "?").toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className={cn("text-sm font-semibold truncate", isActive ? "text-cyan-200" : "text-slate-100")}>{t.handle}</p>
                  <p className={cn("text-xs number-font", roi >= 0 ? "text-emerald-400" : "text-red-400")}>
                    {roi >= 0 ? "+" : ""}{roi.toFixed(1)}% · 30d
                  </p>
                </div>
                <span className="text-[10px] text-slate-500 number-font">
                  ${(configs[t.address]?.allocationUsdc ?? defaultConfig.allocationUsdc).toLocaleString()}
                </span>
              </button>
            );
          })}
        </div>

        {/* Detail panel */}
        {activeTrader && (
          <div className="flex flex-col gap-4">
            {/* Trader header */}
            <div className="card-dark p-5">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-3">
                  <div className={cn("w-12 h-12 rounded-full bg-gradient-to-br flex items-center justify-center text-base font-bold text-white", AVATAR_COLORS[followed.indexOf(activeTrader) % AVATAR_COLORS.length])}>
                    {(activeTrader.handle?.[0] ?? "?").toUpperCase()}
                  </div>
                  <div>
                    <p className="text-lg font-bold text-slate-50">{activeTrader.handle}</p>
                    <a
                      href={`https://hyperliquid.xyz/stats/${activeTrader.address}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs font-mono text-slate-500 hover:text-cyan-400 transition-colors"
                    >
                      {activeTrader.address.slice(0, 10)}…{activeTrader.address.slice(-6)}
                    </a>
                  </div>
                </div>
                <button
                  onClick={() => {
                    setFollowingAddrs((prev) => prev.filter((a) => a !== activeTrader.address));
                    setActiveAddr(followingAddrs.find((a) => a !== activeTrader.address) ?? "");
                  }}
                  className="text-xs px-3 py-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors border border-red-500/20"
                >
                  Stop Copying
                </button>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5">
                <Metric label="ROI 30d"      value={`${activeTrader.roi_30d >= 0 ? "+" : ""}${activeTrader.roi_30d.toFixed(1)}%`} positive={activeTrader.roi_30d >= 0} />
                <Metric label="ROI 7d"       value={`${activeTrader.roi_7d >= 0 ? "+" : ""}${activeTrader.roi_7d.toFixed(1)}%`} positive={activeTrader.roi_7d >= 0} />
                <Metric label="Win Rate"     value={`${activeTrader.win_rate.toFixed(1)}%`} />
                <Metric label="Account"      value={`$${activeTrader.account_value >= 1e6 ? (activeTrader.account_value / 1e6).toFixed(2) + "M" : activeTrader.account_value >= 1e3 ? (activeTrader.account_value / 1e3).toFixed(0) + "K" : activeTrader.account_value.toFixed(0)}`} />
              </div>
            </div>

            {/* Copy config */}
            <div className="card-dark p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
                    <Settings2 className="w-4 h-4 text-slate-500" />
                    Copy Configuration
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">Risk-managed sizing per copied position</p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <Slider label="Allocation"
                        value={cfg.allocationUsdc}
                        min={500} max={50_000} step={500}
                        format={(v) => `$${v.toLocaleString()}`}
                        onChange={(v) => updateCfg({ allocationUsdc: v })} />
                <Slider label="Max Position Size"
                        value={cfg.maxPositionSizeUsdc}
                        min={100} max={cfg.allocationUsdc} step={100}
                        format={(v) => `$${v.toLocaleString()}`}
                        onChange={(v) => updateCfg({ maxPositionSizeUsdc: v })} />
                <Slider label="Stop Loss"
                        value={cfg.stopLossPct}
                        min={1} max={25} step={0.5}
                        format={(v) => `${v.toFixed(1)}%`}
                        onChange={(v) => updateCfg({ stopLossPct: v })} />
                <Slider label="Max Daily Loss"
                        value={cfg.maxDailyLossPct}
                        min={0.5} max={20} step={0.5}
                        format={(v) => `${v.toFixed(1)}%`}
                        onChange={(v) => updateCfg({ maxDailyLossPct: v })} />
              </div>

              <label className="flex items-center gap-2 mt-5 text-sm text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={cfg.copyLeverage}
                  onChange={(e) => updateCfg({ copyLeverage: e.target.checked })}
                  className="w-4 h-4 rounded bg-slate-800 border-slate-700 text-cyan-500 focus:ring-cyan-500/30"
                />
                Mirror trader&apos;s leverage (otherwise capped at 3×)
              </label>
            </div>

            {/* Open positions from paper trading */}
            <div className="card-dark p-5">
              <h3 className="text-sm font-semibold text-slate-100 mb-4">Your Open Positions</h3>
              {livePositions.length === 0 ? (
                <p className="text-sm text-slate-500 py-4 text-center">No open positions · open one from the Positions page</p>
              ) : (
                <div className="divide-y divide-slate-800/60">
                  {livePositions.slice(0, 5).map((p) => {
                    const isLong = p.side === "long";
                    const isProfit = p.unrealized_pnl >= 0;
                    return (
                      <div key={p.id} className="flex items-center gap-3 py-3">
                        <div className="w-8 h-8 rounded-lg bg-slate-800 flex items-center justify-center text-xs font-bold text-slate-300 shrink-0">
                          {p.symbol.slice(0, 3)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-medium text-slate-100">{p.symbol}</p>
                            <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded uppercase",
                              isLong ? "bg-emerald-500/15 text-emerald-400" : "bg-red-500/15 text-red-400")}>
                              {p.side}
                            </span>
                          </div>
                          <p className="text-xs text-slate-500 number-font">${p.size_usd.toLocaleString()} · {p.leverage}×</p>
                        </div>
                        <div className="text-right">
                          <div className={cn("text-sm font-semibold number-font flex items-center gap-1 justify-end", isProfit ? "text-emerald-400" : "text-red-400")}>
                            {isProfit ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                            {isProfit ? "+" : ""}${Math.abs(p.unrealized_pnl).toFixed(2)}
                          </div>
                          <p className="text-[10px] text-slate-600 number-font">{p.unrealized_pnl_pct.toFixed(2)}%</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Metric({ label, value, positive }: { label: string; value: string; positive?: boolean }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">{label}</p>
      <p className={cn("text-base font-bold number-font mt-1",
        positive === true ? "text-emerald-400" : positive === false ? "text-red-400" : "text-slate-100")}>
        {value}
      </p>
    </div>
  );
}

function Slider({ label, value, min, max, step, format, onChange }: {
  label: string; value: number; min: number; max: number; step: number;
  format: (v: number) => string; onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="text-xs font-medium text-slate-400">{label}</label>
        <span className="text-sm font-semibold text-cyan-300 number-font">{format(value)}</span>
      </div>
      <input
        type="range"
        min={min} max={max} step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full h-1.5 bg-slate-800 rounded-full appearance-none accent-cyan-500"
      />
      <div className="flex items-center justify-between mt-1 text-[10px] text-slate-600 number-font">
        <span>{format(min)}</span>
        <span>{format(max)}</span>
      </div>
    </div>
  );
}
