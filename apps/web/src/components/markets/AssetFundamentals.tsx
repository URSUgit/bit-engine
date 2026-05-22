"use client";

import { useEffect, useState } from "react";
import { Building2, Calendar } from "lucide-react";
import { marketApi, type Fundamentals, type CompanyProfile, type EarningEvent } from "@/lib/market-api";

function fmtCap(n: number): string {
  if (!isFinite(n) || n === 0) return "—";
  if (Math.abs(n) >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  return `$${n.toFixed(0)}`;
}

function fmtNum(n: number, decimals = 2): string {
  if (!isFinite(n) || n === 0) return "—";
  return n.toFixed(decimals);
}

export function AssetFundamentals({ symbol }: { symbol: string }) {
  const [fundamentals, setFundamentals] = useState<Fundamentals | null>(null);
  const [profile, setProfile] = useState<CompanyProfile | null>(null);
  const [earnings, setEarnings] = useState<EarningEvent[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [hasData, setHasData] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      marketApi.stocks.fundamentals(symbol),
      marketApi.stocks.profile(symbol),
      marketApi.stocks.earnings(symbol),
    ]).then(([f, p, e]) => {
      if (cancelled) return;
      if (f.data) setFundamentals(f.data);
      if (p.data) setProfile(p.data);
      if (e.data) setEarnings(e.data);
      setHasData(Boolean(f.data || p.data || (e.data && e.data.length > 0)));
      setLoaded(true);
    });
    return () => { cancelled = true; };
  }, [symbol]);

  if (!loaded || !hasData) return null;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {profile && (
        <div className="card-dark p-4 lg:col-span-2">
          <div className="flex items-center gap-2 mb-3">
            <Building2 className="w-4 h-4 text-cyan-400" />
            <h3 className="text-sm font-semibold text-slate-200">Company profile</h3>
            <span className="ml-auto text-[10px] text-slate-600 uppercase tracking-wider">finnhub</span>
          </div>
          <div className="flex items-start gap-3">
            {profile.logo && (
              <img src={profile.logo} alt={profile.name} className="w-12 h-12 rounded bg-slate-800" />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-base font-semibold text-slate-100">{profile.name}</p>
              <p className="text-xs text-slate-500">
                {profile.exchange} · {profile.industry} · {profile.country}
              </p>
              {profile.weburl && (
                <a href={profile.weburl} target="_blank" rel="noopener noreferrer"
                   className="text-xs text-cyan-400 hover:underline mt-1 inline-block">
                  {profile.weburl.replace(/^https?:\/\//, "")}
                </a>
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 mt-3 text-xs">
            <Stat label="IPO" value={profile.ipo || "—"} />
            <Stat label="Market cap" value={fmtCap(profile.market_cap)} />
          </div>
        </div>
      )}

      {fundamentals && (
        <div className="card-dark p-4 lg:col-span-1">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-slate-200">Fundamentals</h3>
            <span className="text-[10px] text-slate-600 uppercase tracking-wider">alpha vantage</span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <Stat label="P/E" value={fmtNum(fundamentals.pe_ratio)} />
            <Stat label="Fwd P/E" value={fmtNum(fundamentals.forward_pe)} />
            <Stat label="P/B" value={fmtNum(fundamentals.price_to_book)} />
            <Stat label="PEG" value={fmtNum(fundamentals.peg_ratio)} />
            <Stat label="EPS" value={fmtNum(fundamentals.eps)} />
            <Stat label="Beta" value={fmtNum(fundamentals.beta)} />
            <Stat label="Div yield" value={`${fmtNum(fundamentals.dividend_yield_pct)}%`} />
            <Stat label="Margin" value={`${fmtNum(fundamentals.profit_margin)}%`} />
            <Stat label="ROE" value={`${fmtNum(fundamentals.return_on_equity)}%`} />
            <Stat label="Revenue TTM" value={fmtCap(fundamentals.revenue_ttm)} />
            <Stat label="EBITDA" value={fmtCap(fundamentals.ebitda)} />
            <Stat label="Target" value={fmtNum(fundamentals.analyst_target_price) === "—" ? "—" : `$${fundamentals.analyst_target_price.toFixed(2)}`} />
          </div>
        </div>
      )}

      {earnings.length > 0 && (
        <div className="card-dark p-4 lg:col-span-3">
          <div className="flex items-center gap-2 mb-3">
            <Calendar className="w-4 h-4 text-cyan-400" />
            <h3 className="text-sm font-semibold text-slate-200">Upcoming earnings</h3>
            <span className="ml-auto text-[10px] text-slate-600 uppercase tracking-wider">finnhub</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500 border-b border-slate-800">
                  <th className="py-1.5 pr-3">Date</th>
                  <th className="py-1.5 pr-3">Time</th>
                  <th className="py-1.5 pr-3">Quarter</th>
                  <th className="py-1.5 pr-3 text-right">EPS est.</th>
                  <th className="py-1.5 pr-3 text-right">EPS actual</th>
                  <th className="py-1.5 text-right">Rev. est.</th>
                </tr>
              </thead>
              <tbody>
                {earnings.slice(0, 8).map((e, i) => (
                  <tr key={i} className="border-b border-slate-800/40">
                    <td className="py-1.5 pr-3 text-slate-300">{e.date}</td>
                    <td className="py-1.5 pr-3 text-slate-500 uppercase">{e.hour || "—"}</td>
                    <td className="py-1.5 pr-3 text-slate-400">Q{e.quarter ?? "?"} {e.year ?? ""}</td>
                    <td className="py-1.5 pr-3 text-right text-slate-300 number-font">{e.eps_estimate?.toFixed(2) ?? "—"}</td>
                    <td className="py-1.5 pr-3 text-right number-font">
                      {e.eps_actual !== null ? (
                        <span className={e.eps_actual >= (e.eps_estimate ?? 0) ? "text-emerald-400" : "text-red-400"}>
                          {e.eps_actual.toFixed(2)}
                        </span>
                      ) : "—"}
                    </td>
                    <td className="py-1.5 text-right text-slate-400 number-font">
                      {e.revenue_estimate ? fmtCap(e.revenue_estimate) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-slate-950 rounded px-2 py-1.5 border border-slate-800/60">
      <p className="text-[10px] uppercase tracking-wider text-slate-500">{label}</p>
      <p className="text-slate-200 number-font font-medium">{value}</p>
    </div>
  );
}
