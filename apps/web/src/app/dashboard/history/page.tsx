"use client";

import { useMemo, useState } from "react";
import { Search, TrendingUp, TrendingDown, Download } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { usePaperTrading } from "@/hooks/usePaperTrading";
import { cn } from "@/lib/utils";

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

export default function HistoryPage() {
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
    <DashboardLayout>
      <div className="flex flex-col gap-6 p-6 max-w-[1600px] mx-auto">
        <div className="flex items-end justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-50 tracking-tight">Trade History</h1>
            <p className="text-sm text-slate-400 mt-1">Closed paper positions · fills at real Binance prices</p>
          </div>
          <button
            onClick={() => exportCsv(filtered)}
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg bg-slate-900 text-slate-300 border border-slate-800 hover:bg-slate-800 transition-colors">
            <Download className="w-3.5 h-3.5" /> Export CSV
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Stat label="Trades" value={`${filtered.length}`} />
          <Stat label="Win Rate" value={filtered.length ? `${winRate.toFixed(1)}%` : "—"} />
          <Stat label="Total Volume" value={totalVolume >= 1000 ? `$${(totalVolume / 1000).toFixed(1)}K` : `$${totalVolume.toFixed(0)}`} />
          <Stat label="Realized P&L" value={filtered.length ? `${totalPnl >= 0 ? "+" : ""}$${totalPnl.toFixed(2)}` : "—"} positive={filtered.length > 0 ? totalPnl >= 0 : undefined} />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 flex-1 min-w-[260px] max-w-md">
            <Search className="w-3.5 h-3.5 text-slate-500" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search asset…"
              className="bg-transparent outline-none text-sm text-slate-200 placeholder:text-slate-600 w-full" />
          </div>
          <FilterChips label="Side" options={["all", "long", "short"]} value={side} onChange={(v) => setSide(v as typeof side)} />
        </div>

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
    </DashboardLayout>
  );
}

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
