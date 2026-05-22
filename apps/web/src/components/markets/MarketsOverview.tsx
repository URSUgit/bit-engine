"use client";

import { useEffect, useState } from "react";
import { TrendingUp, TrendingDown, Activity, Globe2, LineChart } from "lucide-react";
import { marketApi, type Movers, type ForexRates, type MacroSeries } from "@/lib/market-api";

function fmtNum(n: number, decimals = 2): string {
  if (!isFinite(n)) return "—";
  if (Math.abs(n) >= 1e12) return `${(n / 1e12).toFixed(2)}T`;
  if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toFixed(decimals);
}

export function MarketsOverview() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <MoversPanel />
      <ForexPanel />
      <MacroPanel />
    </div>
  );
}

function PanelShell({ title, icon, source, error, children }: {
  title: string; icon: React.ReactNode; source?: string; error?: string; children: React.ReactNode;
}) {
  return (
    <div className="bg-slate-900/50 border border-slate-800 rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-cyan-400">{icon}</span>
          <h3 className="text-sm font-semibold text-slate-200">{title}</h3>
        </div>
        {source && <span className="text-[10px] text-slate-600 uppercase tracking-wider">{source}</span>}
      </div>
      {error ? (
        <p className="text-xs text-slate-500 italic">{error}</p>
      ) : children}
    </div>
  );
}

function MoversPanel() {
  const [data, setData] = useState<Movers | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    marketApi.movers().then((r) => {
      if (r.error) setError(r.error);
      else setData(r.data);
    });
  }, []);

  return (
    <PanelShell
      title="Top movers (US)"
      icon={<Activity className="w-4 h-4" />}
      source="alpha vantage"
      error={error ?? undefined}
    >
      {!data ? (
        <p className="text-xs text-slate-600">Loading…</p>
      ) : (
        <div className="space-y-3 text-xs">
          <MoverRow label="Gainers" rows={data.top_gainers.slice(0, 5)} positive />
          <MoverRow label="Losers" rows={data.top_losers.slice(0, 5)} positive={false} />
        </div>
      )}
    </PanelShell>
  );
}

function MoverRow({ label, rows, positive }: { label: string; rows: Movers["top_gainers"]; positive: boolean }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">{label}</p>
      <div className="space-y-1">
        {rows.map((r) => (
          <div key={r.ticker} className="flex justify-between items-center">
            <span className="font-medium text-slate-200">{r.ticker}</span>
            <span className="number-font text-slate-400">${fmtNum(r.price)}</span>
            <span className={positive ? "text-emerald-400 number-font" : "text-red-400 number-font"}>
              {positive ? "+" : ""}{r.change_pct.toFixed(2)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ForexPanel() {
  const [data, setData] = useState<ForexRates | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    marketApi.forex.live().then((r) => {
      if (r.error) setError(r.error);
      else setData(r.data);
    });
  }, []);

  const majors = ["EUR", "GBP", "JPY", "CHF", "CAD", "AUD", "CNY", "RON"];

  return (
    <PanelShell
      title="Forex (vs USD)"
      icon={<Globe2 className="w-4 h-4" />}
      source="open exchange rates"
      error={error ?? undefined}
    >
      {!data ? (
        <p className="text-xs text-slate-600">Loading…</p>
      ) : (
        <div className="grid grid-cols-2 gap-2 text-xs">
          {majors.map((c) => {
            const rate = data.rates[c];
            if (!rate) return null;
            return (
              <div key={c} className="flex justify-between bg-slate-950 rounded px-2 py-1.5 border border-slate-800/60">
                <span className="text-slate-400">USD/{c}</span>
                <span className="number-font text-slate-200">{rate.toFixed(c === "JPY" || c === "INR" ? 2 : 4)}</span>
              </div>
            );
          })}
        </div>
      )}
    </PanelShell>
  );
}

function MacroPanel() {
  const [data, setData] = useState<MacroSeries[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    marketApi.macro(undefined, 2).then((r) => {
      if (r.error) setError(r.error);
      else setData(r.data);
    });
  }, []);

  return (
    <PanelShell
      title="US macro"
      icon={<LineChart className="w-4 h-4" />}
      source="fred"
      error={error ?? undefined}
    >
      {!data ? (
        <p className="text-xs text-slate-600">Loading…</p>
      ) : (
        <div className="space-y-1.5 text-xs">
          {data.map((s) => {
            const last = s.observations[s.observations.length - 1];
            const prev = s.observations[s.observations.length - 2];
            if (!last) return (
              <div key={s.series_id} className="flex justify-between bg-slate-950 rounded px-2 py-1.5 border border-slate-800/60">
                <span className="text-slate-500">{s.series_id}</span>
                <span className="text-slate-600">—</span>
              </div>
            );
            const delta = prev ? last.value - prev.value : 0;
            const up = delta >= 0;
            return (
              <div key={s.series_id} className="flex justify-between items-center bg-slate-950 rounded px-2 py-1.5 border border-slate-800/60">
                <div className="min-w-0">
                  <p className="text-slate-300 font-medium truncate" title={s.title}>{s.series_id}</p>
                  <p className="text-[10px] text-slate-600 truncate">{s.title}</p>
                </div>
                <div className="text-right shrink-0 pl-2">
                  <p className="text-slate-200 number-font">{fmtNum(last.value, 2)}</p>
                  {prev && (
                    <p className={`text-[10px] number-font flex items-center justify-end gap-0.5 ${up ? "text-emerald-400" : "text-red-400"}`}>
                      {up ? <TrendingUp className="w-2.5 h-2.5" /> : <TrendingDown className="w-2.5 h-2.5" />}
                      {up ? "+" : ""}{delta.toFixed(2)}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </PanelShell>
  );
}
